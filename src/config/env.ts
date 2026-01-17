function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (!value || value.trim() === "") {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const appConfig = () => ({
  APP_ENV: requiredEnv("APP_ENV"),
  PORT: Number(requiredEnv("PORT")),
  DEBUG_LOGS: requiredEnv("DEBUG_LOGS") === "true",
  DATABASE_URL: requiredEnv("DATABASE_URL"),
  DISCORD_BOT_TOKEN: requiredEnv("DISCORD_BOT_TOKEN"),
  DISCORD_CHANNEL_ID: requiredEnv("DISCORD_CHANNEL_ID"),
  ENCRYPTION_KEY: requiredEnv("ENCRYPTION_KEY"),
  ALLOWED_ORIGIN: requiredEnv("ALLOWED_ORIGIN"),
});

export const config = appConfig();
