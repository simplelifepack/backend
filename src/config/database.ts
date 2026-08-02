export function assertDatabaseConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }
}
