# JobPilot AI — Beginner's Building Guide (TypeScript Edition)

This guide walks you through building the entire project yourself, phase by phase.
Every example is TypeScript. Every explanation answers **why**, not just **what**.

---

## Before You Start: The Big Picture

### Why are we building this the way we are?

Before touching any code, understand the architecture decisions:

**Why TypeScript everywhere?**
You write one language — TypeScript — for both the backend (Fastify) and the frontend (Next.js).
This means you only need to learn one set of tools, one way to handle types, and one way to
write async code. Mistakes are caught at compile time, not when a user hits a bug at 2am.

**Why Fastify instead of Express?**
Fastify is faster, has better TypeScript support built-in, and forces you to use a plugin system
that keeps your code organized. Express is older and messier — Fastify is what Express wishes it was.

**Why Prisma instead of raw SQL?**
Prisma lets you define your database tables in one file (`schema.prisma`), generates TypeScript
types for every table automatically, and manages database changes (migrations) for you.
Without it, you'd write raw SQL strings that TypeScript can't check for errors.

**Why BullMQ for background tasks?**
The application automation, job discovery, and email monitoring can take minutes to run.
You don't want the user's browser to wait that long for a response. BullMQ lets you say
"do this later, in the background" while the user gets an immediate response.

**Why Redis?**
Redis is an extremely fast in-memory database. It's used here for three things:
1. Storing JWT refresh tokens (needs to be fast to check on every request)
2. BullMQ job queues (needs to be fast because workers poll it constantly)
3. Rate limiting (needs atomic operations to work correctly under concurrent load)

**Why Playwright for browser automation?**
Many job sites don't have APIs. The only way to interact with them is like a real user would —
opening a browser, clicking buttons, filling forms. Playwright controls a real Chromium browser
programmatically. It's the same browser your users use, so it works on any site.

---

## Prerequisites: What to Install

1. **Node.js 20 LTS** — https://nodejs.org (download the LTS version)
2. **Docker Desktop** — https://docker.com/products/docker-desktop
3. **VS Code** — https://code.visualstudio.com
4. **Git** — https://git-scm.com

### VS Code extensions (install all of these)
Open VS Code → press `Ctrl+Shift+X` → search and install each:
- `ESLint` — catches TypeScript errors as you type
- `Prettier` — auto-formats your code on save
- `Tailwind CSS IntelliSense` — autocomplete for CSS classes
- `Prisma` — syntax highlighting for database schema files
- `Docker` — manage containers from VS Code

### Verify your installs
Open a terminal (in VS Code: Terminal → New Terminal):
```
node --version    # should show v20.x.x
npm --version     # should show 10.x.x
docker --version  # should show 24.x or higher
git --version     # any version is fine
```


---

## Phase 1: Project Foundation & Infrastructure

**What you're building**: The skeleton — folder structure, database, server, and Docker setup.
Nothing visible to users yet. But without this foundation, nothing else works.

**Why do this first?** Because every other phase depends on having a running database,
a running server, and working authentication. Build the foundation once, correctly.

**Estimated time**: 3–5 days for a beginner

---

### Step 1: Create your project structure

```
mkdir jobpilot-ai
cd jobpilot-ai
mkdir backend frontend nginx prometheus grafana
```

Your project will look like this when done:
```
jobpilot-ai/
├── backend/          ← Fastify TypeScript server
│   ├── src/
│   ├── prisma/
│   └── package.json
├── frontend/         ← Next.js React app
│   ├── app/
│   └── package.json
├── nginx/            ← Reverse proxy config
├── prometheus/       ← Metrics collection config
├── grafana/          ← Metrics dashboards
└── docker-compose.yml
```

---

### Step 2: Understand Docker Compose (Task 1)

**Why Docker?** Without Docker, you'd need to install PostgreSQL, Redis, and 6 other services
directly on your computer. That's complex, platform-specific, and hard to undo.
With Docker, each service runs in an isolated container. You start everything with one command.
You can delete everything and start fresh with one command.

**Why docker-compose.yml?** It's a recipe file. It describes every service, how they connect,
and what data they store.

Create `docker-compose.yml` in your project root:
```yaml
version: "3.9"

services:
  postgres:
    image: pgvector/pgvector:pg16
    # pgvector/pgvector is PostgreSQL 16 with the pgvector extension pre-installed.
    # We need pgvector for AI semantic search later (finding similar job descriptions).
    environment:
      POSTGRES_USER: jobpilot
      POSTGRES_PASSWORD: jobpilot_secret
      POSTGRES_DB: jobpilot
    volumes:
      - postgres_data:/var/lib/postgresql/data
      # This named volume persists data even when the container restarts.
      # Without it, all your data disappears every time you run "docker compose down".
    ports:
      - "5432:5432"
      # Makes the DB accessible at localhost:5432 for development tools like TablePlus.
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jobpilot"]
      interval: 10s
      retries: 5
      # Other services won't start until postgres is actually ready to accept connections.

  redis:
    image: redis:7-alpine
    # alpine = minimal size image. Redis 7 is the current stable version.
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5

  seaweedfs:
    image: chrislusf/seaweedfs:latest
    # SeaweedFS is our file storage for resumes, cover letters, screenshots.
    # It provides an S3-compatible API — same interface as Amazon S3, but free and local.
    command: server -dir=/data -s3
    ports:
      - "9333:9333"   # SeaweedFS master port
      - "8333:8333"   # S3 API port
    volumes:
      - seaweedfs_data:/data

volumes:
  postgres_data:
  seaweedfs_data:
```

Test it:
```
docker compose up postgres redis seaweedfs
```
You should see all three services start without errors. Press `Ctrl+C` to stop.


---

### Step 3: Scaffold the Fastify backend (Task 2)

**Why Fastify instead of just writing a plain Node.js HTTP server?**
A plain HTTP server is fine for learning, but you'd have to manually handle routing, request
parsing, error formatting, authentication, CORS, and dozens of other things. Fastify handles
all of that for you through plugins. You focus on your business logic.

```
cd backend
npm init -y
npm install fastify @fastify/cors @fastify/helmet @fastify/jwt @fastify/multipart @fastify/websocket @fastify/rate-limit
npm install prisma @prisma/client bullmq ioredis openai googleapis bcryptjs zod pino @sentry/node pgvector archiver fast-levenshtein
npm install -D typescript @types/node @types/bcryptjs vitest fast-check tsx
npx tsc --init
```

Create `tsconfig.json` (replace the generated one):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Why `strict: true`?** This turns on all TypeScript safety checks. It means TypeScript will
catch more bugs before you run the code. More errors at write-time = fewer bugs at run-time.

Create `src/server.ts`:
```typescript
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import { logger } from './core/logger.js'

export async function buildServer() {
  const app = Fastify({
    logger: false,  // We use pino directly instead
  })

  // CORS: allows your frontend (port 3000) to talk to this backend (port 8000)
  // Without this, browsers block cross-origin requests for security reasons.
  await app.register(cors, {
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  })

  // Helmet: adds security headers to every response automatically.
  // These headers tell browsers to be extra careful with this content.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],  // needed for Next.js
      },
    },
  })

  // JWT: handles token creation and validation
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'change-this-in-production',
    sign: { expiresIn: '1h' },  // access tokens expire in 1 hour
  })

  // Health check — lets Docker and monitoring tools verify the server is running
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  return app
}

// Start the server
const app = await buildServer()
await app.listen({ port: 8000, host: '0.0.0.0' })
logger.info('Server running at http://localhost:8000')
```

Add to `package.json`:
```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "test": "vitest run"
}
```

Run it:
```
npm run dev
```
Open http://localhost:8000/health — you should see `{"status":"ok","timestamp":"..."}`.


---

### Step 4: Set up pino logging (Task 2.2)

**Why do we need a logger at all? Can't we just use `console.log`?**
`console.log` just prints text. In production, you need to know *when* something happened,
*which user* triggered it, *how long* it took, and *what level* it is (info vs error).
Pino outputs structured JSON that monitoring tools can parse and search.

**Why JSON logs?** When you have thousands of log lines, you need to be able to search them.
`grep "user_id: 123"` on plain text logs is fragile. Searching JSON with a tool like
Grafana or Loki is reliable and fast.

Create `src/core/logger.ts`:
```typescript
import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isDev
    ? {
        // Pretty-print in development: human-readable with colors
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      }
    : undefined, // In production: raw JSON (fast, machine-readable)
})

// Usage: logger.info({ userId: '123', company: 'Stripe' }, 'Application submitted')
// Output: {"level":"info","time":1234567890,"userId":"123","company":"Stripe","msg":"Application submitted"}
//
// NEVER log: passwords, tokens, encryption keys, full credit card numbers
// ALWAYS log: IDs, operation names, durations, error messages (not stack traces in prod)
```

Install the pretty-printer for development:
```
npm install -D pino-pretty
```

---

### Step 5: Set up Prisma and define database tables (Task 3.1)

**What is an ORM?** ORM stands for Object-Relational Mapper. It's a layer between your code
and the database that lets you work with TypeScript objects instead of writing SQL.

Without Prisma:
```sql
-- You write raw SQL strings
SELECT * FROM users WHERE email = 'user@example.com'
-- TypeScript has no idea what columns this returns
```

With Prisma:
```typescript
// TypeScript knows exactly what fields are returned
const user = await prisma.user.findUnique({ where: { email: 'user@example.com' } })
// user.id, user.email, user.hashedPassword — all type-safe
```

Initialize Prisma:
```
cd backend
npx prisma init
```

This creates `prisma/schema.prisma`. Edit it:
```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Prisma reads the database URL from an environment variable.
  // Never hardcode connection strings — they contain passwords.
}

// Each model = one database table
// Each field = one database column
// Prisma generates TypeScript types from this file automatically.

model User {
  id             String    @id @default(uuid())
  // @id = primary key (uniquely identifies each row)
  // @default(uuid()) = auto-generates a UUID if you don't provide one
  
  email          String    @unique
  // @unique = no two users can have the same email
  
  hashedPassword String
  isActive       Boolean   @default(true)
  createdAt      DateTime  @default(now())
  
  profile        Profile?
  // This says: a User can have one optional Profile
  // The ? means it might not exist yet
}

model Profile {
  id               String   @id @default(uuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  // @relation connects this Profile to its User
  // onDelete: Cascade = when User is deleted, Profile is also deleted automatically
  
  fullName         String
  email            String
  phoneEncrypted   String?  // stored AES-256-GCM encrypted — note the name reminds us
  location         String?
  linkedinUrl      String?
  githubUrl        String?
  
  workAuthorization String[] // PostgreSQL array — ["US_CITIZEN", "H1B"]
  requiresSponsorship Boolean @default(false)
  noticePeriodDays Int      @default(0)
  
  targetRoles      String[] // ["Backend Engineer", "Senior SWE"]
  preferredLocations String[]
  remotePreference String   @default("flexible")
  salaryMinEncrypted String? // encrypted
  salaryMaxEncrypted String? // encrypted
  preferredCompanies String[]
  excludedCompanies String[]
  dailyApplyLimit  Int      @default(10)
  coverLetterMode  String   @default("review_first")
  
  completenessScore Int     @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  // @updatedAt = automatically set to current time whenever this row is updated
}
```

Create your `.env` file (never commit this to Git!):
```
DATABASE_URL="postgresql://jobpilot:jobpilot_secret@localhost:5432/jobpilot"
JWT_SECRET="generate-a-random-64-char-string-here"
ENCRYPTION_KEY="generate-a-random-32-byte-base64-string-here"
```

Add `.env` to `.gitignore`:
```
echo ".env" >> .gitignore
echo "node_modules/" >> .gitignore
echo "dist/" >> .gitignore
```

Generate the TypeScript client and run the migration:
```
docker compose up postgres -d   # start postgres in background
npx prisma migrate dev --name init
```

This creates the tables in your database AND generates TypeScript types.
Now in any file you can do:
```typescript
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const users = await prisma.user.findMany()
// TypeScript knows users is User[]
```


---

### Step 6: Implement JWT authentication (Task 4.1)

**What is JWT and why do we need it?**
When you log in, the server needs a way to remember who you are for all future requests.
Traditionally, servers stored "sessions" in a database. JWT (JSON Web Token) takes a different
approach: it gives you a small encoded string containing your user ID. You send that string
with every request. The server doesn't need to look anything up — it just verifies the signature.

**Why does JWT have an expiry time?**
If someone steals your token, you want it to stop working eventually. A 1-hour expiry means
stolen tokens are only dangerous for an hour. Refresh tokens (stored in Redis) let you get
a new access token without logging in again, as long as the refresh token is still valid.

Create `src/core/auth.ts`:
```typescript
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BCRYPT_ROUNDS = 12
// Why 12? bcrypt is intentionally slow. 12 rounds takes ~250ms to hash one password.
// That's fast enough for users, but slow enough that attackers can't try millions of passwords per second.
// If you set it to 4, it's fast but insecure. If you set it to 20, it's 1000× slower — too slow.

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS)
  // Never store the original password. Store only this hash.
  // The hash is one-way: you can verify a password matches, but you can't recover the original.
}

export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword)
  // bcrypt.compare handles the timing safely — it takes the same time whether the password
  // matches or not, which prevents "timing attacks" where attackers measure response time.
}

export function generateRefreshToken(): string {
  // crypto.randomBytes(32) generates 32 truly random bytes.
  // These are impossible to guess — good for one-time tokens.
  return crypto.randomBytes(32).toString('hex')
}
```

Create `src/api/routes/auth.ts`:
```typescript
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../core/database.js'
import { hashPassword, verifyPassword, generateRefreshToken } from '../../core/auth.js'
import { redis } from '../../core/redis.js'
import { z } from 'zod'

// Zod schema: defines the expected shape of the request body
// If the request doesn't match this shape, Fastify returns 422 automatically
const RegisterSchema = z.object({
  email: z.string().email('Must be a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register
  app.post('/api/auth/register', async (request, reply) => {
    // Parse and validate the request body
    const body = RegisterSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(422).send({ error: body.error.flatten() })
    }
    const { email, password } = body.data

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(422).send({ error: 'Email already registered' })
    }

    // Create user with hashed password (NEVER store plaintext password)
    const user = await prisma.user.create({
      data: { email, hashedPassword: await hashPassword(password) }
    })

    // Sign a JWT token containing the user's ID
    const accessToken = app.jwt.sign({ sub: user.id, type: 'access' })

    // Create refresh token and store in Redis with 7-day expiry
    const refreshToken = generateRefreshToken()
    await redis.setex(`refresh_token:${refreshToken}`, 60 * 60 * 24 * 7, user.id)
    // setex(key, seconds, value) — expires after 7 days automatically

    return reply.status(201).send({ accessToken, refreshToken })
  })

  // POST /api/auth/login
  app.post('/api/auth/login', async (request, reply) => {
    const body = LoginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(422).send({ error: body.error.flatten() })
    }
    const { email, password } = body.data

    const user = await prisma.user.findUnique({ where: { email } })

    // Important: same error message for wrong email OR wrong password.
    // If we said "email not found" vs "wrong password", attackers could enumerate valid emails.
    if (!user || !(await verifyPassword(password, user.hashedPassword))) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    const accessToken = app.jwt.sign({ sub: user.id, type: 'access' })
    const refreshToken = generateRefreshToken()
    await redis.setex(`refresh_token:${refreshToken}`, 60 * 60 * 24 * 7, user.id)

    return { accessToken, refreshToken }
  })
}
```

---

### Step 7: Implement AES-256-GCM encryption (Task 5.1)

**Why encrypt fields in the database?**
If someone gets unauthorized access to your PostgreSQL database (a hack, a backup leak,
a misconfigured permission), you don't want them to immediately see every user's phone number,
salary, and job portal passwords. Encrypted fields look like random garbage without the key.

**Why AES-256-GCM specifically?**
- AES-256: the gold standard symmetric encryption algorithm. Banks use it.
- GCM mode: provides both encryption AND authentication. If anyone tampers with the ciphertext,
  decryption fails — you'll know the data has been modified.

Create `src/core/encryption.ts`:
```typescript
import crypto from 'node:crypto'

// Load the key from environment variable
// The key must be exactly 32 bytes (256 bits) for AES-256
const rawKey = process.env.ENCRYPTION_KEY
if (!rawKey) throw new Error('ENCRYPTION_KEY environment variable is required')

const KEY = Buffer.from(rawKey, 'base64')
if (KEY.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes when base64-decoded')

export function encrypt(plaintext: string): string {
  // Generate a random 12-byte IV (Initialization Vector) for each encryption
  // Why random? If you used the same IV every time, patterns would emerge in the ciphertext.
  // Different IV each time = completely different output even for the same input.
  const iv = crypto.randomBytes(12)
  
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  
  // GCM produces an "auth tag" — a checksum that proves the data hasn't been tampered with
  const authTag = cipher.getAuthTag()
  
  // Store: iv (12 bytes) + authTag (16 bytes) + ciphertext
  // We need all three pieces to decrypt later
  const combined = Buffer.concat([iv, authTag, encrypted])
  return combined.toString('base64')
}

export function decrypt(encryptedBase64: string): string {
  const combined = Buffer.from(encryptedBase64, 'base64')
  
  // Extract the three pieces we stored
  const iv = combined.subarray(0, 12)
  const authTag = combined.subarray(12, 28)
  const ciphertext = combined.subarray(28)
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(authTag)
  // If the data was tampered with, setAuthTag will cause decrypt() to throw
  
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8')
}

// Generate a fresh ENCRYPTION_KEY (run this once and save the output):
// node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```


---

### Step 8: Set up BullMQ background jobs (Task 7)

**Why background jobs at all?**
When a user clicks "Start applying", the system needs to:
1. Search 10+ job sites (takes ~30 seconds)
2. Score hundreds of jobs against the profile (takes ~2 minutes)
3. Fill out application forms (takes 2–5 minutes each)

You can't make the user wait with a loading spinner for 10+ minutes.
Background jobs let you say: "I've accepted your request, I'll do it in the background,
and I'll notify you when it's done."

**Why BullMQ specifically?**
BullMQ stores jobs in Redis. Workers pull jobs from the queue and process them.
Features you get for free: retry on failure, exponential backoff, job prioritization,
rate limiting, scheduled jobs, and job events.

Create `src/workers/queue.ts`:
```typescript
import { Queue } from 'bullmq'
import { redis } from '../core/redis.js'

// Why separate queues? Each type of work has different characteristics.
// Discovery jobs run every hour. Application jobs run one at a time per user.
// Separating them means they can't block each other.
export const discoveryQueue = new Queue('job-discovery', { connection: redis })
export const applicationQueue = new Queue('job-application', { connection: redis })
export const emailQueue = new Queue('email-monitor', { connection: redis })

// Helper to add a job to the application queue
export async function enqueueApplication(userId: string, jobId: string) {
  await applicationQueue.add(
    'submit-application',  // job name (for logging/filtering)
    { userId, jobId },     // the data the worker will receive
    {
      attempts: 3,
      // Why 3 attempts? Network timeouts and temporary errors happen.
      // 3 tries is enough to handle transient issues without spamming.
      backoff: {
        type: 'exponential',
        delay: 1000,
        // Delay before retries: 1s, 2s, 4s
        // Exponential backoff prevents hammering a struggling service.
      },
      removeOnComplete: { count: 100 },
      // Keep the last 100 completed jobs for debugging. Delete older ones.
      removeOnFail: { count: 200 },
      // Keep more failed jobs so you can investigate issues.
    }
  )
}
```

Create `src/workers/applicationWorker.ts`:
```typescript
import { Worker } from 'bullmq'
import { redis } from '../core/redis.js'
import { logger } from '../core/logger.js'

const worker = new Worker(
  'job-application',
  async (job) => {
    // This function runs for each job in the queue
    const { userId, jobId } = job.data
    logger.info({ userId, jobId, attempt: job.attemptsMade }, 'Processing application job')
    
    // TODO: implement actual application logic (covered in Phase 6)
    // For now, just log that we received the job
  },
  {
    connection: redis,
    concurrency: 1,
    // concurrency: 1 means this worker processes one application at a time per user.
    // Why? We don't want to slam job sites with parallel requests from one user.
  }
)

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, 'Application job failed permanently')
})
```

---

### Step 9: Scaffold the Next.js frontend (Task 8)

**Why Next.js instead of plain React?**
Plain React (Create React App) gives you a blank page and you figure out the rest.
Next.js gives you: file-based routing, server-side rendering, image optimization,
API routes, and a production-ready build pipeline. It's React with the hard parts solved.

**Why Tailwind CSS?**
Traditional CSS requires naming things (`.my-special-button-container`) and writing separate
`.css` files. Tailwind gives you utility classes directly in HTML: `className="flex items-center gap-4 rounded-lg bg-blue-600 text-white"`. Faster to write, harder to mess up.

**Why shadcn/ui?**
It's a collection of pre-built UI components (buttons, inputs, cards, etc.) that you can
copy-paste into your project. Unlike other component libraries, you own the code — you can
customize every pixel without fighting the library's opinions.

```
cd ../frontend
npx create-next-app@14 . --typescript --tailwind --eslint --app
```

Answer the prompts:
- Use `src/` directory? → **No** (we'll use `app/` at root)
- Use Turbopack? → **No** (use the stable webpack for now)

Install additional packages:
```
npm install @tanstack/react-query@5 zustand recharts react-hook-form zod socket.io-client @hookform/resolvers
npx shadcn-ui@latest init
```

When shadcn asks:
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

Install starter components:
```
npx shadcn-ui@latest add button card input label tabs progress badge toast
```

Create `lib/api.ts` — your central place to talk to the backend:
```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function getToken(): string | null {
  if (typeof window === 'undefined') return null  // Not available during SSR
  return localStorage.getItem('access_token')
}

// Why a centralized fetch wrapper?
// Every request needs the Authorization header. Instead of adding it manually
// to every single fetch call throughout the app, you do it once here.
// Also handles token expiry (401) by redirecting to login.
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (response.status === 401) {
    localStorage.removeItem('access_token')
    window.location.href = '/login'
    throw new Error('Session expired')
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const api = {
  get:    <T>(path: string)                  => apiFetch<T>(path),
  post:   <T>(path: string, body: unknown)   => apiFetch<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)   => apiFetch<T>(path, { method: 'PUT',   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown)   => apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string)                  => apiFetch<T>(path, { method: 'DELETE' }),
}
```

Test the frontend:
```
npm run dev
```
Open http://localhost:3000 — you should see the Next.js default page.

---

## Phase 1 Checkpoint

Before moving on, verify all of these work:
- [ ] `docker compose up postgres redis seaweedfs -d` starts without errors
- [ ] `npm run dev` in `/backend` starts without errors, http://localhost:8000/health returns `{"status":"ok"}`
- [ ] `POST http://localhost:8000/api/auth/register` with `{"email":"test@test.com","password":"password123"}` returns a token
- [ ] `POST http://localhost:8000/api/auth/login` with same credentials returns a token
- [ ] Registering with the same email twice returns 422
- [ ] `npm run dev` in `/frontend` starts, http://localhost:3000 shows Next.js page
- [ ] `npm run test` in `/backend` shows 0 test failures


---

## Phase 2: User Profile & Onboarding

**What you're building**: The profile system. Users enter all their information once —
name, experience, skills, resume, salary, preferences. The AI agents use this data for everything.

**Why "enter once"?** Job applications ask for the same information 50 times.
The point of JobPilot AI is that users answer questions once, and the system fills out
every form using that data automatically.

**Learn before starting**:
- Zod validation: https://zod.dev (read "Basic Usage" section)
- React Hook Form: https://react-hook-form.com/get-started
- TanStack Query: https://tanstack.com/query/v5/docs/react/quick-start

---

### Step 10: Profile completeness scoring (Task 67.1)

**Why track completeness?**
If a user's profile is missing their skills or work experience, the AI can't rank jobs or
write a good resume. The completeness score tells users exactly what's missing
and blocks automation until the profile is good enough (≥70%).

Create `src/services/completeness.ts`:
```typescript
import type { Profile } from '@prisma/client'

interface CompletenessInput {
  profile: Profile
  hasWorkExperience: boolean  // true if user has at least one WorkExperience row
  hasSkills: boolean          // true if user has at least one Skill row
}

// Why split into sections with different weights?
// Personal info (25 pts): needed for form filling
// Work experience (25 pts): the AI can't write a resume without it
// Skills (20 pts): needed for job matching
// Work auth (15 pts): needed to filter out jobs requiring different visas
// Preferences (15 pts): needed for job discovery searches
export function computeCompleteness({ profile, hasWorkExperience, hasSkills }: CompletenessInput): number {
  let score = 0

  // Personal info: 25 points (6.25 per field)
  const personalFields = [profile.fullName, profile.email, profile.phoneEncrypted, profile.location]
  const filledPersonal = personalFields.filter(Boolean).length
  score += Math.round((filledPersonal / personalFields.length) * 25)

  // Work experience: 25 points
  if (hasWorkExperience) score += 25

  // Skills: 20 points
  if (hasSkills) score += 20

  // Work authorization: 15 points
  if (profile.workAuthorization.length > 0) score += 15

  // Job preferences: 15 points (must have both target roles and locations)
  if (profile.targetRoles.length > 0 && profile.preferredLocations.length > 0) score += 15

  return Math.min(score, 100)  // Cap at 100 in case of rounding
}
```

Write a property test (Task 67.2) — this verifies it ALWAYS returns [0, 100]:
```typescript
// src/services/completeness.test.ts
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { computeCompleteness } from './completeness.js'

describe('computeCompleteness', () => {
  it('always returns a value in [0, 100] for any input', () => {
    // fast-check generates hundreds of random inputs automatically
    fc.assert(
      fc.property(
        fc.boolean(),  // hasWorkExperience
        fc.boolean(),  // hasSkills
        fc.array(fc.string()),  // workAuthorization
        fc.array(fc.string()),  // targetRoles
        fc.array(fc.string()),  // preferredLocations
        (hasWorkExperience, hasSkills, workAuth, roles, locations) => {
          const result = computeCompleteness({
            profile: {
              fullName: 'Test', email: 'test@test.com',
              phoneEncrypted: null, location: null,
              workAuthorization: workAuth, targetRoles: roles,
              preferredLocations: locations,
            } as any,
            hasWorkExperience,
            hasSkills,
          })
          return result >= 0 && result <= 100
        }
      )
    )
  })
})
```

Run it: `npm run test` — should say "1 test passed".

---

### Step 11: Profile API with Zod validation (Task 10.1 + 10.2)

**Why validate on the server, not just the frontend?**
Frontend validation is for user experience (showing inline errors). But users can bypass
the frontend and send requests directly to your API. Server-side validation is your last
line of defense against bad data entering your database.

Create `src/api/schemas/profile.ts`:
```typescript
import { z } from 'zod'

export const CreateProfileSchema = z.object({
  fullName: z.string()
    .min(1, 'Full name is required')
    .max(200, 'Full name must be 200 characters or less'),
  
  email: z.string()
    .email('Must be a valid email address')
    .max(254, 'Email must be 254 characters or less'),
    // 254 chars is the RFC 5321 maximum for email addresses
  
  phone: z.string().optional(),
  location: z.string().optional(),
  
  workAuthorization: z.array(z.string())
    .min(1, 'At least one work authorization type is required'),
    // Why validate this? Without it, the system can't filter out jobs you can't legally apply for.
  
  noticePeriodDays: z.number()
    .int()
    .min(0, 'Notice period cannot be negative'),
  
  targetRoles: z.array(z.string())
    .min(1, 'At least one target role is required'),
    // Why validate this? Without target roles, job discovery doesn't know what to search for.
  
  preferredLocations: z.array(z.string()).default([]),
  
  salaryMin: z.number().int().positive().optional(),
  salaryMax: z.number().int().positive().optional(),
  
  dailyApplyLimit: z.number()
    .int()
    .min(1, 'Daily apply limit must be at least 1')
    .max(50, 'Daily apply limit cannot exceed 50'),
    // Why max 50? Applying to 100 jobs/day would get accounts flagged by job sites.
  
}).refine(
  (data) => {
    // Cross-field validation: salary min must be ≤ salary max
    if (data.salaryMin && data.salaryMax) {
      return data.salaryMin <= data.salaryMax
    }
    return true
  },
  { message: 'Salary minimum must be less than or equal to salary maximum' }
)
```

Create `src/api/routes/profile.ts`:
```typescript
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../core/database.js'
import { encrypt, decrypt } from '../../core/encryption.js'
import { computeCompleteness } from '../../services/completeness.js'
import { CreateProfileSchema } from '../schemas/profile.js'

export async function profileRoutes(app: FastifyInstance) {
  // GET /api/profile — returns current user's profile
  app.get('/api/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub  // from JWT
    
    const profile = await prisma.profile.findUnique({
      where: { userId },
      include: {
        workExperiences: true,
        skills: true,
      }
    })
    
    if (!profile) return reply.status(404).send({ error: 'Profile not found' })
    
    // Decrypt sensitive fields before returning
    // Why decrypt here and not in the database? Encryption/decryption happens in the app,
    // not in PostgreSQL. The DB just stores the encrypted bytes.
    return {
      ...profile,
      phone: profile.phoneEncrypted ? decrypt(profile.phoneEncrypted) : null,
      salaryMin: profile.salaryMinEncrypted ? parseInt(decrypt(profile.salaryMinEncrypted)) : null,
      salaryMax: profile.salaryMaxEncrypted ? parseInt(decrypt(profile.salaryMaxEncrypted)) : null,
      // Never return phoneEncrypted, salaryMinEncrypted, salaryMaxEncrypted directly
    }
  })

  // POST /api/profile — creates or updates profile
  app.post('/api/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub
    
    const body = CreateProfileSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(422).send({ errors: body.error.flatten().fieldErrors })
    }
    
    const { phone, salaryMin, salaryMax, ...rest } = body.data
    
    const profile = await prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        ...rest,
        phoneEncrypted: phone ? encrypt(phone) : null,
        salaryMinEncrypted: salaryMin ? encrypt(String(salaryMin)) : null,
        salaryMaxEncrypted: salaryMax ? encrypt(String(salaryMax)) : null,
      },
      update: {
        ...rest,
        phoneEncrypted: phone ? encrypt(phone) : null,
        salaryMinEncrypted: salaryMin ? encrypt(String(salaryMin)) : null,
        salaryMaxEncrypted: salaryMax ? encrypt(String(salaryMax)) : null,
      },
    })
    
    // Recompute completeness after every update
    const [workExpCount, skillCount] = await Promise.all([
      prisma.workExperience.count({ where: { profileId: profile.id } }),
      prisma.skill.count({ where: { profileId: profile.id } }),
    ])
    
    const completeness = computeCompleteness({
      profile,
      hasWorkExperience: workExpCount > 0,
      hasSkills: skillCount > 0,
    })
    
    await prisma.profile.update({
      where: { id: profile.id },
      data: { completenessScore: completeness }
    })
    
    return { ...profile, completenessScore: completeness }
  })
}
```


---

### Step 12: Build the onboarding wizard frontend (Task 12)

**Why a wizard instead of one big form?**
A single form with 30+ fields is overwhelming. People abandon it.
Breaking it into 9 focused steps (one topic per step) keeps users engaged and
lets the system show progress. Each step saves data immediately so users don't lose work.

**Why store state in Zustand during the wizard?**
The user moves back and forth between steps. You need to remember their answers
across page navigations without making an API call on every step.
Zustand is a tiny state store — think of it as a global variable that React components
can read and write to, with automatic re-renders when it changes.

Create `store/onboarding.ts`:
```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// persist middleware saves the store to localStorage automatically
// so the user's progress survives page refreshes
interface OnboardingState {
  currentStep: number
  data: Record<string, unknown>
  setStep: (step: number) => void
  setData: (key: string, value: unknown) => void
  reset: () => void
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      currentStep: 1,
      data: {},
      setStep: (step) => set({ currentStep: step }),
      setData: (key, value) => set((state) => ({ data: { ...state.data, [key]: value } })),
      reset: () => set({ currentStep: 1, data: {} }),
    }),
    { name: 'jobpilot-onboarding' }  // localStorage key
  )
)
```

Create `app/(onboarding)/personal-info/page.tsx`:
```typescript
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOnboardingStore } from '@/store/onboarding'

const schema = z.object({
  fullName: z.string().min(1, 'Required').max(200),
  email: z.string().email('Must be a valid email'),
  phone: z.string().optional(),
  location: z.string().min(1, 'Required'),
})

type FormData = z.infer<typeof schema>
// z.infer extracts the TypeScript type from the Zod schema
// So FormData is automatically { fullName: string, email: string, phone?: string, location: string }
// You don't need to write this type manually

export default function PersonalInfoPage() {
  const router = useRouter()
  const { setData, setStep } = useOnboardingStore()

  const {
    register,      // connects input elements to the form
    handleSubmit,  // runs validation then calls your onSubmit function
    formState: { errors, isSubmitting }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    // zodResolver connects react-hook-form to your Zod schema
    // When the user submits, Zod validates the data first
  })

  const onSubmit = (data: FormData) => {
    setData('personalInfo', data)  // save to Zustand store
    setStep(2)
    router.push('/onboarding/work-experience')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Personal Information</h1>
        <p className="text-gray-500 mt-1">
          This information will be used to fill out application forms automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div>
          <Label htmlFor="fullName">Full Name *</Label>
          <Input
            id="fullName"
            {...register('fullName')}
            // register('fullName') connects this input to react-hook-form
            // It adds onChange, onBlur, name, and ref automatically
            placeholder="Jane Smith"
            className={errors.fullName ? 'border-red-500' : ''}
          />
          {errors.fullName && (
            <p className="text-red-500 text-sm mt-1">{errors.fullName.message}</p>
            // errors.fullName.message comes from your Zod schema
          )}
        </div>

        <div>
          <Label htmlFor="email">Email Address *</Label>
          <Input id="email" type="email" {...register('email')} placeholder="jane@example.com" />
          {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>}
        </div>

        <div>
          <Label htmlFor="location">Location *</Label>
          <Input id="location" {...register('location')} placeholder="San Francisco, CA" />
          {errors.location && <p className="text-red-500 text-sm mt-1">{errors.location.message}</p>}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          Continue to Work Experience →
        </Button>
      </form>
    </div>
  )
}
```

**The pattern for every onboarding step is the same:**
1. Define a Zod schema for that step's fields
2. Use `useForm` with `zodResolver`
3. On submit: save data to Zustand store, go to next step
4. On the final "Review" step: call the profile API with all accumulated data

---

## Phase 3: Job Discovery Agents

**What you're building**: The agents that automatically find jobs from 12+ sources.
Each source (Greenhouse, LinkedIn, X/Twitter, etc.) has its own connector file.

**Why a plugin architecture?**
If all job sources were hardcoded into one big function, adding a new source would mean
editing a sprawling file and risking breaking other sources. The plugin system lets you
add a new source by creating one new file that implements the `BaseJobDiscoveryConnector` interface.
Everything else (orchestration, rate limiting, error handling) is handled by the framework.

**Learn before starting**:
- TypeScript async generators: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of
- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch

---

### Step 13: Build the base connector (Task 16.1)

Create `src/agents/discovery/base.ts`:
```typescript
export interface RawJobPosting {
  sourceUrl: string
  platform: string
  discoveredAt: Date
  rawJson?: unknown
  rawHtml?: string
}

export interface JobPreferences {
  targetRoles: string[]
  preferredLocations: string[]
}

// Abstract class = a blueprint that every connector must follow
// TypeScript enforces that every subclass implements the discover() method
export abstract class BaseJobDiscoveryConnector {
  abstract readonly sourceName: string

  // AsyncGenerator lets us yield results one at a time as they arrive
  // This is better than waiting for ALL jobs to load before returning anything
  // (some sources return 100+ jobs — why wait for all 100 before processing the first?)
  abstract discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting>
}
```

Create `src/agents/discovery/orchestrator.ts`:
```typescript
import type { BaseJobDiscoveryConnector, RawJobPosting, JobPreferences } from './base.js'
import { logger } from '../../core/logger.js'

export class JobDiscoveryOrchestrator {
  constructor(private connectors: BaseJobDiscoveryConnector[]) {}

  // Why async generator here too?
  // The orchestrator runs ALL connectors in parallel and yields results as they arrive.
  // The caller starts processing jobs immediately, without waiting for all sources to finish.
  async *discoverAll(preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    // Run all connectors concurrently using Promise.race-style streaming
    const streams = this.connectors.map(c => this.streamConnector(c, preferences))

    // Merge all streams: yield from whichever connector returns a result first
    for await (const job of mergeAsyncGenerators(streams)) {
      yield job
    }
  }

  // Wrapper that catches errors so one connector failing doesn't stop the others
  private async *streamConnector(
    connector: BaseJobDiscoveryConnector,
    preferences: JobPreferences
  ): AsyncGenerator<RawJobPosting> {
    try {
      for await (const job of connector.discover(preferences)) {
        yield job
      }
    } catch (error) {
      // Log and continue — one broken connector doesn't stop the whole discovery run
      logger.error(
        { source: connector.sourceName, error: String(error) },
        'Job discovery connector failed'
      )
    }
  }
}

// Utility: merge multiple async generators into one
async function* mergeAsyncGenerators<T>(generators: AsyncGenerator<T>[]): AsyncGenerator<T> {
  // Each generator runs in its own promise chain, yielding results to a shared buffer
  const buffer: T[] = []
  let done = 0
  let resolve: (() => void) | null = null

  const promises = generators.map(async (gen) => {
    for await (const value of gen) {
      buffer.push(value)
      resolve?.()
    }
    done++
    resolve?.()
  })

  while (done < generators.length || buffer.length > 0) {
    if (buffer.length > 0) {
      yield buffer.shift()!
    } else {
      await new Promise<void>(r => { resolve = r })
    }
  }

  await Promise.all(promises)
}
```


---

### Step 14: Build the Greenhouse connector (Task 17)

**Why start with Greenhouse?** It has a completely free public API — no authentication needed.
You can fetch job listings from thousands of companies just by knowing their board token.

Create `src/agents/discovery/connectors/greenhouse.ts`:
```typescript
import { BaseJobDiscoveryConnector, type RawJobPosting, type JobPreferences } from '../base.js'
import { logger } from '../../../core/logger.js'

// Companies that use Greenhouse as their ATS.
// In production this comes from user configuration / a database table.
// For now, hardcode a starter list.
const GREENHOUSE_COMPANIES = [
  'airbnb', 'stripe', 'github', 'notion', 'figma',
  'shopify', 'atlassian', 'twilio', 'databricks', 'vercel',
]

export class GreenhouseConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'greenhouse'

  async *discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    for (const company of GREENHOUSE_COMPANIES) {
      try {
        // Greenhouse's public API — no auth needed, completely free to use
        const url = `https://api.greenhouse.io/v1/boards/${company}/jobs?content=true`
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
          // AbortSignal.timeout: if the request takes > 10 seconds, cancel it.
          // Without this, a hanging request blocks your worker indefinitely.
        })

        if (response.status === 404) continue  // company not on Greenhouse
        if (!response.ok) {
          logger.warn({ company, status: response.status }, 'Greenhouse API error')
          continue
        }

        const data = await response.json() as { jobs: unknown[] }

        for (const job of (data.jobs ?? [])) {
          const jobData = job as Record<string, unknown>

          // Basic filter: only yield jobs matching user's target roles
          const title = String(jobData.title ?? '').toLowerCase()
          const isRelevant = preferences.targetRoles.some(
            role => title.includes(role.toLowerCase())
          )
          if (!isRelevant) continue

          yield {
            sourceUrl: String(jobData.absolute_url ?? ''),
            platform: 'greenhouse',
            discoveredAt: new Date(),
            rawJson: jobData,
          }
        }

        // Small delay between companies to be respectful of rate limits
        await sleep(200)

      } catch (error) {
        // Never throw — log the error and continue to the next company
        logger.error({ company, error: String(error) }, 'Greenhouse company fetch failed')
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

---

### Step 15: Build the token bucket rate limiter (Task 16.2)

**Why do we need rate limiting?**
Job sites have limits on how many requests you can make per minute/hour. If you exceed them:
- Your IP gets temporarily blocked
- Your account gets suspended
- You violate the site's terms of service

A token bucket works like this: imagine a bucket that holds 10 tokens.
Each request takes one token. Tokens refill at a fixed rate (e.g., 1 per second).
If the bucket is empty, requests wait until a token is available.

**Why store the state in Redis instead of memory?**
If you have 3 workers running simultaneously, each worker needs to see the same rate limit state.
An in-memory counter in Worker 1 doesn't know about requests made by Worker 2.
Redis is shared across all workers, so the limit is enforced globally.

Create `src/services/rateLimiter.ts`:
```typescript
import { redis } from '../core/redis.js'
import { logger } from '../core/logger.js'

// Lua script runs atomically in Redis — no race conditions
// Why Lua? Because "check if tokens available, then take one" must happen as one
// indivisible operation. Otherwise two workers could both see "1 token available"
// and both take it, leaving you at -1 tokens.
const TAKE_TOKEN_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])  -- tokens per second
  local now = tonumber(ARGV[3])
  
  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1]) or capacity
  local last_refill = tonumber(bucket[2]) or now
  
  -- Add tokens based on elapsed time
  local elapsed = now - last_refill
  tokens = math.min(capacity, tokens + elapsed * refill_rate)
  
  if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, 3600)
    return 1  -- success: token taken
  else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    return 0  -- failure: no tokens available
  end
`

export class TokenBucketRateLimiter {
  constructor(
    private platform: string,
    private capacity: number,      // max tokens
    private refillRate: number,    // tokens per second
  ) {}

  // Returns when a token is available (waits if necessary)
  async acquire(): Promise<void> {
    const key = `rate_limit:${this.platform}`

    while (true) {
      const result = await redis.eval(
        TAKE_TOKEN_SCRIPT,
        1,               // number of keys
        key,             // KEYS[1]
        this.capacity,   // ARGV[1]
        this.refillRate, // ARGV[2]
        Date.now() / 1000  // ARGV[3] — current time in seconds
      ) as number

      if (result === 1) return  // got a token, proceed

      // No token available — calculate when the next one will appear
      const waitMs = Math.ceil(1000 / this.refillRate)
      logger.debug({ platform: this.platform, waitMs }, 'Rate limit: waiting for token')
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }
  }
}
```

---

### Step 16: Parse job descriptions with an LLM (Task 22.1)

**Why use an LLM to parse job descriptions?**
Job descriptions come in thousands of different formats. Some list skills as bullet points,
others embed them in paragraphs. Some show salary, many don't. A regex approach would require
hundreds of patterns and still miss edge cases. An LLM understands natural language and
extracts exactly the fields you ask for, regardless of format.

**What is `response_format: { type: 'json_object' }`?**
Without this, the LLM might respond with markdown, code blocks, or explanatory text
before the JSON. This setting forces the LLM to output only valid JSON, making parsing reliable.

Create `src/agents/discovery/parser.ts`:
```typescript
import { getLLMClient } from '../../core/llmProvider.js'
import { logger } from '../../core/logger.js'

const PARSE_PROMPT = `Extract structured data from this job posting. Return ONLY valid JSON.
Use null for fields you cannot find. Do not guess or invent values.

Return this exact JSON structure:
{
  "company": string or null,
  "title": string or null,
  "requiredSkills": string[] or [],
  "preferredSkills": string[] or [],
  "yearsExpMin": number or null,
  "yearsExpMax": number or null,
  "locations": string[] or [],
  "isRemote": boolean,
  "isHybrid": boolean,
  "salaryMin": number or null,
  "salaryMax": number or null,
  "currency": string or null,
  "employmentType": "full_time" | "part_time" | "contract" | "internship" | null,
  "applicationUrl": string or null
}

Job posting:
`

export interface ParsedJob {
  company: string | null
  title: string | null
  requiredSkills: string[]
  preferredSkills: string[]
  yearsExpMin: number | null
  yearsExpMax: number | null
  locations: string[]
  isRemote: boolean
  isHybrid: boolean
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  employmentType: string | null
  applicationUrl: string | null
}

export async function parseJobDescription(rawContent: string): Promise<ParsedJob | null> {
  const llm = getLLMClient()

  try {
    const response = await llm.chat.completions.create({
      model: process.env.LLM_MODEL ?? 'llama3.2',
      messages: [{ role: 'user', content: PARSE_PROMPT + rawContent.slice(0, 8000) }],
      // Slice to 8000 chars: LLMs have context limits. Most job descriptions are <3000 chars.
      response_format: { type: 'json_object' },
      temperature: 0,  // 0 = deterministic, no creativity — we want consistent extraction
    })

    const parsed = JSON.parse(response.choices[0].message.content ?? '{}') as ParsedJob

    // Quality check: if fewer than 3 fields were extracted, the content wasn't a real job posting
    const extractedCount = Object.values(parsed).filter(v => v !== null && v !== false).length
    if (extractedCount < 3) {
      logger.warn({ extractedCount }, 'Job parse failed: too few fields extracted')
      return null
    }

    return parsed

  } catch (error) {
    logger.error({ error: String(error) }, 'Job description parsing failed — using regex fallback')
    return regexFallback(rawContent)
  }
}

// When the LLM is unavailable, extract what we can with regex
function regexFallback(content: string): ParsedJob {
  const isRemote = /\bremote\b/i.test(content)
  const isHybrid = /\bhybrid\b/i.test(content)
  const expMatch = content.match(/(\d+)\+?\s*years?\s+of\s+(?:relevant\s+)?experience/i)

  return {
    company: null, title: null, requiredSkills: [], preferredSkills: [],
    yearsExpMin: expMatch ? parseInt(expMatch[1]) : null, yearsExpMax: null,
    locations: [], isRemote, isHybrid, salaryMin: null, salaryMax: null,
    currency: null, employmentType: null, applicationUrl: null,
  }
}
```


---

### Step 17: Set up the LLM client (Task 60)

**Why can we use one npm package for Ollama, Gemini, Groq, AND OpenRouter?**
They all implement the same OpenAI-compatible REST API. The `openai` npm package
lets you specify a `baseURL` to point to any compatible endpoint. You write the code once
and swap providers by changing one environment variable.

**Install Ollama first (free, local)**: https://ollama.ai
After installing: `ollama pull llama3.2`

Create `src/core/llmProvider.ts`:
```typescript
import OpenAI from 'openai'

// Provider configurations — all free, no credit card
const PROVIDERS = {
  ollama: {
    // Runs locally on your machine. Free, private, no internet required.
    // Best for development and sensitive data.
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',  // Ollama doesn't check the key, but the SDK requires a value
    defaultModel: 'llama3.2',
  },
  gemini: {
    // Google's free tier: 1,500 requests/day, no credit card
    // Get key at: https://aistudio.google.com/app/apikey
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: process.env.GEMINI_API_KEY ?? '',
    defaultModel: 'gemini-1.5-flash',
  },
  groq: {
    // Groq's free tier: 14,400 requests/day, no credit card
    // Get key at: https://console.groq.com
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY ?? '',
    defaultModel: 'llama-3.1-70b-versatile',
  },
  openrouter: {
    // OpenRouter free tier: 20+ models, no credit card
    // Get key at: https://openrouter.ai
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    defaultModel: 'meta-llama/llama-3.2-3b-instruct:free',
  },
} as const

type Provider = keyof typeof PROVIDERS

export function getLLMClient(): OpenAI {
  const providerName = (process.env.LLM_PROVIDER ?? 'ollama') as Provider
  const config = PROVIDERS[providerName] ?? PROVIDERS.ollama

  // Why create a new client each time?
  // In tests, you can override LLM_PROVIDER to 'mock' and inject a fake client.
  // This makes testing much easier — no real API calls needed.
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })
}

export function getDefaultModel(): string {
  const providerName = (process.env.LLM_PROVIDER ?? 'ollama') as Provider
  const config = PROVIDERS[providerName] ?? PROVIDERS.ollama
  return process.env.LLM_MODEL ?? config.defaultModel
}
```

---

### Step 18: Generate embeddings with @xenova/transformers (Task 22.2)

**What is an embedding?**
An embedding converts text into a list of ~384 numbers. Similar texts produce similar
number lists. This lets you search for "software engineer" and find jobs that say
"developer", "programmer", or "SWE" — because their embeddings are numerically close.

**Why run the model locally instead of calling an API?**
1. Cost: embedding APIs charge per token. Running locally is free.
2. Privacy: job descriptions and resume content never leave your machine.
3. Speed: no network latency — 50ms locally vs 200ms+ over the internet.

Create `src/services/embeddings.ts`:
```typescript
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers'
import { logger } from '../core/logger.js'

// Module-level singleton — load the model once, reuse it for every call
// Why? Loading the model takes ~3 seconds. You don't want to pay that cost per request.
let embeddingPipeline: FeatureExtractionPipeline | null = null

async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) return embeddingPipeline

  logger.info('Loading all-MiniLM-L6-v2 embedding model (first load, ~3 seconds)...')

  // @xenova/transformers downloads the model from HuggingFace on first run (~22 MB)
  // Subsequent runs use the cached version
  embeddingPipeline = await pipeline(
    'feature-extraction',     // the type of task
    'Xenova/all-MiniLM-L6-v2' // the specific model
  )

  logger.info('Embedding model loaded')
  return embeddingPipeline
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text?.trim()) throw new Error('Cannot generate embedding for empty text')

  const pipe = await getEmbeddingPipeline()

  // Run the model
  const output = await pipe(text, {
    pooling: 'mean',       // average all token embeddings into one vector
    normalize: true,       // make the vector unit-length (required for cosine similarity)
  })

  const embedding = Array.from(output.data) as number[]

  // Always exactly 384 dimensions for all-MiniLM-L6-v2
  if (embedding.length !== 384) {
    throw new Error(`Expected 384 dimensions, got ${embedding.length}`)
  }

  return embedding
}
```

Property test to guarantee this is always true (Task 22.3):
```typescript
// src/services/embeddings.test.ts
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { generateEmbedding } from './embeddings.js'

describe('generateEmbedding', () => {
  it('always returns exactly 384 dimensions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),  // any non-empty string
        async (text) => {
          const embedding = await generateEmbedding(text)
          return embedding.length === 384
        }
      ),
      { numRuns: 10 }  // limit runs because each call takes ~50ms
    )
  })
})
```

---

## Phase 4: Job Ranking & Matching

**What you're building**: The AI engine that scores every job against your profile
and decides which ones are worth applying to.

**Why score jobs instead of applying to all of them?**
Applying to 500 jobs without filtering is noisy and disrespectful to employers.
A targeted approach — applying to 10 well-matched jobs — gets better results.
The score also helps you understand *why* a job is or isn't a good match.

---

### Step 19: Implement the match scorer (Task 27.1)

Create `src/agents/ranking/scorer.ts`:
```typescript
export interface MatchScore {
  overall: number          // 0-100 composite score
  skillMatch: number       // % of required skills the user has
  experienceMatch: number  // how well years of experience align
  locationMatch: number    // location preference alignment
  salaryMatch: number      // salary range overlap
  techMatch: number        // tech stack alignment
  llmHolistic: number      // AI's overall assessment
  disqualifiers: string[]  // reasons to skip this job entirely
}

export function computeSkillMatch(
  requiredSkills: string[],
  userSkills: string[]
): number {
  if (requiredSkills.length === 0) return 75  // no requirements = mostly favorable

  const required = new Set(requiredSkills.map(s => s.toLowerCase()))
  const user = new Set(userSkills.map(s => s.toLowerCase()))

  // Count how many required skills the user has
  let matched = 0
  for (const skill of required) {
    if (user.has(skill)) matched++
  }

  return (matched / required.size) * 100
}

export function computeExperienceMatch(
  yearsRequired: number | null,
  userYears: number
): number {
  if (yearsRequired === null) return 75  // no requirement stated = mostly favorable

  if (userYears >= yearsRequired) return 100  // meets or exceeds requirement
  if (userYears >= yearsRequired * 0.8) return 80  // close enough (within 20%)
  if (userYears >= yearsRequired * 0.5) return 50  // somewhat under-qualified

  // Proportional score for larger gaps
  return Math.max(0, (userYears / yearsRequired) * 50)
}

export function computeMatchScore(params: {
  job: {
    requiredSkills: string[]
    preferredSkills: string[]
    yearsExpMin: number | null
    isRemote: boolean
    salaryMin: number | null
    salaryMax: number | null
    company: string | null
    visaRequirements?: string[]
  }
  profile: {
    skills: string[]
    totalYearsExperience: number
    remotePreference: string
    salaryMin: number | null
    salaryMax: number | null
    workAuthorization: string[]
    preferredCompanies: string[]
    preferredLocations: string[]
  }
  llmScore?: number  // 0-100, pass 50 if LLM unavailable
}): MatchScore {
  const { job, profile, llmScore = 50 } = params
  const disqualifiers: string[] = []

  // ── Hard disqualifier checks ──────────────────────────────────────────────
  // These cause immediate rejection regardless of other scores.

  // Check skill coverage — must have at least 50% of required skills
  const skillScore = computeSkillMatch(job.requiredSkills, profile.skills)
  if (job.requiredSkills.length > 0 && skillScore < 50) {
    disqualifiers.push('insufficient_required_skills')
    return { overall: 0, skillMatch: skillScore, experienceMatch: 0,
             locationMatch: 0, salaryMatch: 0, techMatch: 0, llmHolistic: 0, disqualifiers }
  }

  // ── Component scores ──────────────────────────────────────────────────────
  const expScore = computeExperienceMatch(job.yearsExpMin, profile.totalYearsExperience)

  const locationScore = job.isRemote
    ? (profile.remotePreference === 'remote_only' ? 100 : 85)
    : (profile.remotePreference === 'remote_only' ? 30 : 80)

  const salaryScore = computeSalaryMatch(
    job.salaryMin, job.salaryMax,
    profile.salaryMin, profile.salaryMax
  )

  // techMatch: same algorithm as skillMatch but weighted differently
  const techScore = computeSkillMatch(
    [...job.requiredSkills, ...job.preferredSkills],
    profile.skills
  )

  // ── Weighted composite ────────────────────────────────────────────────────
  let overall =
    skillScore   * 0.35 +  // 35% — most important: can you do the job?
    expScore     * 0.20 +  // 20% — do you have enough experience?
    locationScore* 0.15 +  // 15% — is the location acceptable?
    salaryScore  * 0.10 +  // 10% — is the salary in your range?
    techScore    * 0.10 +  // 10% — does the tech stack match?
    llmScore     * 0.10    // 10% — what does the AI think overall?

  // ── Preferred company boost ───────────────────────────────────────────────
  // If the user explicitly marked this company as preferred, boost the score 20%.
  // Why? The user wants to work there — increase its priority in the queue.
  const company = (job.company ?? '').toLowerCase()
  const isPreferred = profile.preferredCompanies
    .some(c => c.toLowerCase() === company)
  if (isPreferred) overall *= 1.2

  // Clamp to valid range [0, 100]
  overall = Math.min(100, Math.max(0, overall))

  return {
    overall,
    skillMatch: skillScore,
    experienceMatch: expScore,
    locationMatch: locationScore,
    salaryMatch: salaryScore,
    techMatch: techScore,
    llmHolistic: llmScore,
    disqualifiers,
  }
}

function computeSalaryMatch(
  jobMin: number | null, jobMax: number | null,
  userMin: number | null, userMax: number | null
): number {
  // No salary info from either side — neutral score
  if (!jobMin && !jobMax && !userMin && !userMax) return 75

  // User hasn't set expectations — don't penalize
  if (!userMin && !userMax) return 75

  // Job hasn't posted salary — slight uncertainty
  if (!jobMin && !jobMax) return 60

  // Check for range overlap
  const effectiveJobMin = jobMin ?? 0
  const effectiveJobMax = jobMax ?? Infinity
  const effectiveUserMin = userMin ?? 0
  const effectiveUserMax = userMax ?? Infinity

  const hasOverlap = effectiveJobMin <= effectiveUserMax && effectiveJobMax >= effectiveUserMin
  return hasOverlap ? 100 : 20  // Big penalty for non-overlapping salary ranges
}
```


---

## Phase 5: Resume Optimizer & Cover Letter Agents

**What you're building**: The AI that tailors your resume for each job and writes cover letters.

**The most important constraint in this entire project:**
The resume optimizer MUST NEVER add information that isn't in the original resume.
It can reorder, rewrite, and emphasize — but it cannot fabricate experience.
This is both ethical (honesty) and legal (fraud risk).

---

### Step 20: Build the resume optimizer (Task 31.1 + 31.2)

Create `src/agents/resumeOptimizer.ts`:
```typescript
import { getLLMClient, getDefaultModel } from '../core/llmProvider.js'
import { logger } from '../core/logger.js'

interface Experience {
  company: string
  title: string
  technologies: string[]
  description: string
  [key: string]: unknown
}

interface BaseResume {
  summary: string
  experiences: Experience[]
  projects: Array<{ technologies: string[]; description: string; [key: string]: unknown }>
  skills: string[]
  education: unknown[]
  certifications: unknown[]
}

export interface TruthfulnessReport {
  hasFabrications: boolean
  violations: string[]
}

export function validateTruthfulness(
  original: BaseResume,
  optimized: BaseResume
): TruthfulnessReport {
  const violations: string[] = []

  // Rule 1: Same number of experiences (we reorder, never add or remove)
  if (optimized.experiences.length !== original.experiences.length) {
    violations.push(
      `Experience count changed: ${original.experiences.length} → ${optimized.experiences.length}`
    )
  }

  // Rule 2: Same number of projects
  if (optimized.projects.length !== original.projects.length) {
    violations.push(
      `Project count changed: ${original.projects.length} → ${optimized.projects.length}`
    )
  }

  // Rule 3: Skills in optimized must be a subset of original skills
  const originalSkills = new Set(original.skills.map(s => s.toLowerCase()))
  const addedSkills = optimized.skills.filter(s => !originalSkills.has(s.toLowerCase()))
  if (addedSkills.length > 0) {
    violations.push(`New skills added that were not in original: ${addedSkills.join(', ')}`)
  }

  // Rule 4: No new certifications added
  if (optimized.certifications.length > original.certifications.length) {
    violations.push('New certifications added')
  }

  return { hasFabrications: violations.length > 0, violations }
}

export async function optimizeResume(
  baseResume: BaseResume,
  job: { requiredSkills: string[]; preferredSkills: string[]; title: string }
): Promise<BaseResume> {
  const requiredSkills = new Set(job.requiredSkills.map(s => s.toLowerCase()))
  const preferredSkills = new Set(job.preferredSkills.map(s => s.toLowerCase()))
  const allTargetSkills = new Set([...requiredSkills, ...preferredSkills])

  // Step 1: Score and reorder experiences by relevance
  // WHY reorder? Recruiters spend ~7 seconds on a resume. Most relevant experience first.
  const scoredExperiences = baseResume.experiences.map(exp => ({
    exp,
    score: [
      ...exp.technologies.filter(t => requiredSkills.has(t.toLowerCase())).length * 2,
      exp.technologies.filter(t => preferredSkills.has(t.toLowerCase())).length,
    ].reduce((a, b) => a + b, 0)
  }))
  const reorderedExperiences = scoredExperiences
    .sort((a, b) => b.score - a.score)
    .map(s => s.exp)

  // Step 2: Reorder projects by relevance (same logic)
  const scoredProjects = baseResume.projects.map(proj => ({
    proj,
    score: proj.technologies.filter(t => allTargetSkills.has(t.toLowerCase())).length
  }))
  const reorderedProjects = scoredProjects
    .sort((a, b) => b.score - a.score)
    .map(s => s.proj)

  // Step 3: Reorder skills — matching skills first, then remaining
  // WHY? ATS systems often scan the first N skills. Put the most relevant ones first.
  const matchingSkills = baseResume.skills.filter(s => allTargetSkills.has(s.toLowerCase()))
  const otherSkills = baseResume.skills.filter(s => !allTargetSkills.has(s.toLowerCase()))
  const reorderedSkills = [...matchingSkills, ...otherSkills]

  // Step 4: Generate a tailored summary using LLM
  // The prompt EXPLICITLY constrains the LLM to not add new information
  const tailoredSummary = await generateTailoredSummary(baseResume.summary, job)

  const optimized: BaseResume = {
    ...baseResume,
    summary: tailoredSummary,
    experiences: reorderedExperiences,
    projects: reorderedProjects,
    skills: reorderedSkills,
  }

  // Step 5: ALWAYS validate before returning
  const report = validateTruthfulness(baseResume, optimized)
  if (report.hasFabrications) {
    logger.warn({ violations: report.violations }, 'Truthfulness check failed — returning original')
    return baseResume  // Fall back to original — never submit a fabricated resume
  }

  return optimized
}

async function generateTailoredSummary(
  originalSummary: string,
  job: { title: string; requiredSkills: string[] }
): Promise<string> {
  if (!originalSummary) return ''

  const llm = getLLMClient()
  const model = getDefaultModel()

  // The key constraint in the prompt: "ONLY use information already in the summary"
  // This is what prevents fabrication — the LLM is explicitly told it cannot add facts.
  const prompt = `Rewrite this professional summary to better align with the job role.

STRICT RULES — you will be checked for compliance:
1. Use ONLY information already present in the original summary
2. Do NOT add any new skills, companies, years, or achievements not in the original
3. Do NOT change any numbers or dates
4. Keep the same length (±20%)
5. Make it sound more tailored to: ${job.title}

Original summary:
${originalSummary}

Relevant skills for this role: ${job.requiredSkills.slice(0, 5).join(', ')}

Rewritten summary (original facts only):`

  try {
    const response = await llm.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,  // slight creativity allowed, but mostly deterministic
      max_tokens: 300,
    })
    return response.choices[0].message.content?.trim() ?? originalSummary
  } catch {
    return originalSummary  // LLM failed — use original
  }
}
```

---

## Phase 6: Application Automation

**What you're building**: The Playwright automation that fills out job application forms.
This is the most complex phase — you're controlling a real browser programmatically.

**Key rules (from the spec) that you must never violate:**
1. NEVER attempt to solve or bypass CAPTCHA — pause and notify the user
2. NEVER attempt to bypass MFA — same
3. ALWAYS release the browser context in a `finally` block — no matter what happens

---

### Step 21: Build the browser pool (Task 37)

**Why a pool and not just "open a browser per application"?**
Opening a Chromium browser takes 2–3 seconds and uses ~100 MB of RAM.
A pool keeps 3–5 browsers open permanently and reuses them.
This makes application submission much faster.

**Why a Semaphore?**
If you have 3 browsers but 10 jobs to apply to, you can only run 3 at once.
The Semaphore ensures the 4th job waits until one of the first 3 finishes.
Without it, you'd open more browsers than you have, crashing the server.

Create `src/services/browserPool.ts`:
```typescript
import { chromium, type BrowserContext } from 'playwright'
import { logger } from '../core/logger.js'

const MAX_BROWSERS = 3

export class BrowserPool {
  private contexts: BrowserContext[] = []
  private available: BrowserContext[] = []
  // Semaphore: a Promise that resolves when a browser becomes available
  private waiters: Array<(context: BrowserContext) => void> = []

  async initialize() {
    const browser = await chromium.launch({
      headless: true,  // true = invisible (for servers), false = visible (for debugging)
    })

    for (let i = 0; i < MAX_BROWSERS; i++) {
      const context = await browser.newContext({
        // Each context is isolated — separate cookies, localStorage, sessions
        // This prevents login state from one portal leaking to another
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      })
      this.contexts.push(context)
      this.available.push(context)
    }

    logger.info({ count: MAX_BROWSERS }, 'Browser pool initialized')
  }

  async acquire(): Promise<BrowserContext> {
    if (this.available.length > 0) {
      return this.available.pop()!
    }

    // All browsers in use — wait for one to become available
    return new Promise(resolve => {
      this.waiters.push(resolve)
    })
  }

  release(context: BrowserContext) {
    if (this.waiters.length > 0) {
      // Someone is waiting — give the context directly to them
      const waiter = this.waiters.shift()!
      waiter(context)
    } else {
      // Nobody waiting — return to available pool
      this.available.push(context)
    }
  }

  async shutdown() {
    for (const ctx of this.contexts) {
      await ctx.close()
    }
  }
}

// Helper: guarantees the context is always released, even if an error occurs
// Usage: await withBrowser(pool, async (context) => { ... })
export async function withBrowser<T>(
  pool: BrowserPool,
  fn: (context: BrowserContext) => Promise<T>
): Promise<T> {
  const context = await pool.acquire()
  try {
    return await fn(context)
  } finally {
    // ALWAYS runs — even if fn() throws an error
    // This is the key guarantee from the spec: browser sessions are always released
    pool.release(context)
  }
}
```


---

### Step 22: Build the application automation agent (Task 38.1)

Create `src/agents/applicationAgent.ts`:
```typescript
import type { BrowserPool } from '../services/browserPool.js'
import { withBrowser } from '../services/browserPool.js'
import { logger } from '../core/logger.js'

export interface ApplicationResult {
  success: boolean
  requiresManualIntervention: boolean
  failureReason?: string
  screenshotPath?: string
  confirmationNumber?: string
  retryable: boolean
}

// CAPTCHA selectors — add more as you discover them in the wild
const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.cf-challenge',
  '[class*="captcha" i]',
  '#captcha',
]

async function detectCaptcha(page: any): Promise<boolean> {
  for (const selector of CAPTCHA_SELECTORS) {
    const el = await page.$(selector)
    if (el) return true
  }
  return false
}

export async function submitApplication(
  pool: BrowserPool,
  params: {
    applicationUrl: string
    formAnswers: Record<string, string>
    resumePdfBuffer: Buffer
    coverLetterPdfBuffer?: Buffer
  }
): Promise<ApplicationResult> {

  // withBrowser guarantees the context is released even if we throw
  return withBrowser(pool, async (context) => {
    const page = await context.newPage()

    try {
      logger.info({ url: params.applicationUrl }, 'Starting application')

      await page.goto(params.applicationUrl, { timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 })

      // ── CAPTCHA check immediately after page load ─────────────────────
      // Check BEFORE doing anything. If there's a CAPTCHA, stop immediately.
      // We do NOT try to solve it — the spec explicitly prohibits this.
      if (await detectCaptcha(page)) {
        const screenshot = await page.screenshot()
        const screenshotPath = await storeScreenshot(screenshot)
        logger.warn({ url: params.applicationUrl }, 'CAPTCHA detected — pausing for manual intervention')
        return {
          success: false,
          requiresManualIntervention: true,
          failureReason: 'captcha_detected',
          screenshotPath,
          retryable: false,
        }
      }

      // ── Fill form fields ──────────────────────────────────────────────
      for (const [selector, value] of Object.entries(params.formAnswers)) {
        const el = await page.$(selector)
        if (el) {
          await el.fill(value)
          await page.waitForTimeout(100)  // Small delay to appear human-like
        }
      }

      // ── Upload resume ──────────────────────────────────────────────────
      // Find the file input for resume upload
      const resumeInput = await page.$('input[type="file"][name*="resume" i], input[type="file"][accept*="pdf"]')
      if (resumeInput) {
        // Write buffer to a temp file and set it as the input value
        const tmpPath = `/tmp/resume_${Date.now()}.pdf`
        await import('node:fs/promises').then(fs => fs.writeFile(tmpPath, params.resumePdfBuffer))
        await resumeInput.setInputFiles(tmpPath)
        await import('node:fs/promises').then(fs => fs.unlink(tmpPath).catch(() => {}))
      }

      // ── Final CAPTCHA check before submit ─────────────────────────────
      if (await detectCaptcha(page)) {
        const screenshot = await page.screenshot()
        return {
          success: false,
          requiresManualIntervention: true,
          failureReason: 'captcha_before_submit',
          screenshotPath: await storeScreenshot(screenshot),
          retryable: false,
        }
      }

      // ── Submit ──────────────────────────────────────────────────────────
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]')
      if (submitBtn) {
        await submitBtn.click()
        await page.waitForLoadState('networkidle', { timeout: 15_000 })
      }

      // ── Capture confirmation ──────────────────────────────────────────
      const screenshot = await page.screenshot({ fullPage: true })
      const screenshotPath = await storeScreenshot(screenshot)

      const pageText = await page.innerText('body')
      const isConfirmed = /thank you|application received|successfully submitted/i.test(pageText)

      return {
        success: isConfirmed,
        requiresManualIntervention: false,
        screenshotPath,
        failureReason: isConfirmed ? undefined : 'no_confirmation_detected',
        retryable: !isConfirmed,
      }

    } catch (error) {
      const isTimeout = String(error).includes('Timeout') || String(error).includes('timeout')
      const screenshot = await page.screenshot().catch(() => null)
      const screenshotPath = screenshot ? await storeScreenshot(screenshot) : undefined

      logger.error({ error: String(error), url: params.applicationUrl }, 'Application automation failed')

      return {
        success: false,
        requiresManualIntervention: false,
        failureReason: String(error),
        screenshotPath,
        retryable: isTimeout,  // Timeouts are worth retrying; DOM errors are not
      }
    }
    // NOTE: no finally needed here — withBrowser() handles context.close()
  })
}

// Store screenshot in SeaweedFS and return the key
async function storeScreenshot(buffer: Buffer): Promise<string> {
  const { uploadFile } = await import('../services/storage.js')
  const key = `screenshots/${Date.now()}_${Math.random().toString(36).slice(2)}.png`
  await uploadFile(key, buffer, 'image/png')
  return key
}
```

---

## Phases 7–10: Quick Reference

The remaining phases follow the same patterns you've already learned.
Here's what each phase introduces that's new:

### Phase 7: Gmail Integration

**New concept: OAuth 2.0**
OAuth lets users grant your app access to their Gmail without giving you their password.
The flow: redirect user to Google → user approves → Google sends back a token → you use the token.

```typescript
// src/integrations/gmail.ts
import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:8000/api/auth/gmail/callback'
)

export function getAuthUrl(): string {
  return oauth2Client.generateAuthUrl({
    scope: ['gmail.readonly', 'gmail.modify'],
    access_type: 'offline',  // 'offline' gives us a refresh token
  })
}
```

**New concept: Email classification with LLM**
The same LLM you use for job parsing can classify emails:
```typescript
const response = await llm.chat.completions.create({
  model: getDefaultModel(),
  messages: [{
    role: 'user',
    content: `Classify this email. Return JSON: {"type": "interview_invite"|"rejection"|"offer"|"other", "confidence": 0-1}
    Subject: ${subject}
    Body: ${body.slice(0, 1000)}`
  }],
  response_format: { type: 'json_object' },
})
```

### Phase 8: Analytics with Prisma groupBy

**New concept: SQL aggregation in Prisma**
```typescript
// Count applications grouped by source
const bySource = await prisma.applicationRecord.groupBy({
  by: ['source'],
  where: { userId, appliedAt: { gte: startDate } },
  _count: { _all: true },
})
// Result: [{ source: 'greenhouse', _count: { _all: 42 } }, ...]
```

### Phase 8: WebSocket real-time updates

**New concept: WebSocket with Fastify**
WebSockets keep a persistent connection open so the server can push updates to the browser
without the browser asking. Used for: "Application submitted to Stripe", "Interview detected".

```typescript
// Backend: emit an event to a specific user
await redis.publish(`user:${userId}:events`, JSON.stringify({
  type: 'application_submitted',
  company: 'Stripe',
  role: 'Backend Engineer',
}))

// Frontend: listen for events
const socket = io('http://localhost:8000')
socket.on('application_submitted', (data) => {
  toast({ title: `Applied to ${data.company}!` })
})
```

### Phase 10: Security headers (one line)

`@fastify/helmet` adds all required security headers automatically when you register it:
```typescript
await app.register(helmet)
// That's it — adds HSTS, X-Content-Type-Options, X-Frame-Options, CSP automatically
```

---

## Testing Your Code

### Running tests
```bash
cd backend
npm run test           # run all tests once
npm run test -- --watch  # re-run on file changes (great during development)
```

### Writing a test
```typescript
// src/agents/ranking/scorer.test.ts
import { describe, it, expect } from 'vitest'
import { computeSkillMatch } from './scorer.js'

describe('computeSkillMatch', () => {
  it('returns 100 when user has all required skills', () => {
    const score = computeSkillMatch(
      ['TypeScript', 'React', 'PostgreSQL'],
      ['typescript', 'react', 'postgresql', 'docker']  // lowercase — function should normalize
    )
    expect(score).toBe(100)
  })

  it('returns 0 when user has no required skills', () => {
    const score = computeSkillMatch(['Java', 'Spring'], ['TypeScript', 'React'])
    expect(score).toBe(0)
  })

  it('returns proportional score for partial match', () => {
    const score = computeSkillMatch(['TypeScript', 'React', 'Java'], ['TypeScript', 'React'])
    expect(score).toBeCloseTo(66.67, 1)
  })
})
```

### Debugging tips

**"Cannot find module"** — You imported a file that doesn't exist yet, or forgot `.js` extension in the import:
```typescript
// Wrong in Node.js ESM:
import { foo } from './utils'
// Correct:
import { foo } from './utils.js'
```

**"PrismaClientKnownRequestError: Unique constraint failed"** — You tried to create a record that already exists.
The duplicate application guard should catch this, but if you see it elsewhere, check your unique constraints.

**"Connection refused"** — A service isn't running. Run `docker compose up` and check all containers are healthy.

**Playwright timeouts** — The page took too long to respond. Increase `timeout` values during development.
In production, these are usually real issues (slow site, network error).

---

## Quick Reference: File Structure

```
backend/src/
├── server.ts                    ← Fastify app entry point
├── core/
│   ├── auth.ts                  ← bcrypt + JWT utilities
│   ├── database.ts              ← Prisma client singleton
│   ├── encryption.ts            ← AES-256-GCM encrypt/decrypt
│   ├── llmProvider.ts           ← getLLMClient() factory
│   ├── logger.ts                ← pino structured logging
│   └── redis.ts                 ← ioredis client singleton
├── api/
│   ├── routes/
│   │   ├── auth.ts              ← POST /api/auth/register, /login, /refresh
│   │   ├── profile.ts           ← GET/POST /api/profile
│   │   ├── jobs.ts              ← GET /api/jobs, POST /api/jobs/manual
│   │   └── applications.ts      ← GET/PATCH /api/applications
│   └── schemas/
│       └── profile.ts           ← Zod validation schemas
├── agents/
│   ├── discovery/
│   │   ├── base.ts              ← Abstract connector class
│   │   ├── orchestrator.ts      ← Runs all connectors in parallel
│   │   ├── parser.ts            ← LLM job description extraction
│   │   └── connectors/          ← One .ts file per platform
│   ├── ranking/
│   │   └── scorer.ts            ← Match score computation
│   ├── resumeOptimizer.ts       ← Reorder + tailor resume (no fabrication)
│   ├── coverLetter.ts           ← Generate cover letters
│   ├── applicationAgent.ts      ← Playwright form automation
│   ├── emailMonitor.ts          ← Gmail classification
│   ├── interviewPrep.ts         ← Generate interview Q&A
│   └── analytics.ts             ← Metrics computation
├── services/
│   ├── browserPool.ts           ← Playwright browser management
│   ├── embeddings.ts            ← @xenova/transformers local embeddings
│   ├── storage.ts               ← SeaweedFS file client
│   ├── rateLimiter.ts           ← Redis token bucket
│   ├── completeness.ts          ← Profile completeness scoring
│   └── notificationManager.ts   ← Create + deliver notifications
├── workers/
│   ├── queue.ts                 ← BullMQ queue definitions
│   ├── discoveryWorker.ts       ← Processes job discovery tasks
│   ├── applicationWorker.ts     ← Processes application submission
│   ├── emailWorker.ts           ← Processes email monitoring
│   └── rankingWorker.ts         ← Processes job ranking
└── integrations/
    ├── gmail.ts                 ← Gmail OAuth + API client
    └── googleCalendar.ts        ← Calendar event creation

frontend/
├── app/
│   ├── layout.tsx               ← Root layout (nav, providers)
│   ├── (onboarding)/            ← 9-step profile setup wizard
│   └── (dashboard)/
│       ├── jobs/                ← Ranked job list
│       ├── applications/        ← Application tracker (Kanban + timeline)
│       ├── analytics/           ← Charts and metrics
│       ├── profile/             ← Profile management forms
│       ├── sources/             ← Job source health status
│       └── settings/            ← LLM provider, limits, export
├── lib/
│   └── api.ts                   ← Fetch wrapper with auth
├── store/
│   └── onboarding.ts            ← Zustand wizard state
└── components/
    └── ui/                      ← shadcn/ui components

prisma/
└── schema.prisma                ← All database tables in one file

docker-compose.yml               ← Start everything with one command
```

Good luck — start with Phase 1, get the checkpoint passing, then move to Phase 2.
Every phase is a fully working milestone you can demo.
