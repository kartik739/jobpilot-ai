# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
#   - Installs all dependencies (including devDependencies for tsc)
#   - Runs `prisma generate` so the generated client is available to tsc
#   - Compiles TypeScript to dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifest files first for layer-cache efficiency
COPY package.json package-lock.json ./

# Install all deps (dev + prod) needed for the build
RUN npm ci

# Copy Prisma schema so `prisma generate` can run
COPY prisma ./prisma

# Generate the Prisma client (output goes into node_modules/.prisma/client)
RUN npx prisma generate

# Copy the rest of the source tree and compile
COPY tsconfig.json ./
COPY src ./src

RUN npx tsc

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
#   - Lean image with only what is needed to run the server
#   - Copies compiled output, production node_modules, and prisma dir
#     (migrations are needed at runtime for `prisma migrate deploy`)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy compiled JavaScript
COPY --from=builder /app/dist ./dist

# Copy production node_modules (includes generated Prisma client)
COPY --from=builder /app/node_modules ./node_modules

# Copy Prisma schema + migrations (required by `prisma migrate deploy`)
COPY --from=builder /app/prisma ./prisma

# Copy package.json so Node.js module resolution works correctly
COPY --from=builder /app/package.json ./package.json

# Copy and configure the entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
