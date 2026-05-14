import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasourceUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/jobpilot?schema=public',
})
