# Backend Bun + Hono

This is a small backend service built on top of Bun and Hono.

What it does:

- Stores file metadata in PostgreSQL via Prisma.
- Uploads and stores encrypted file chunks in Discord.
- Exposes HTTP APIs to:
  - Upload encrypted chunks and finalize a file.
  - List files and retrieve metadata.
  - Download files, reconstructed and decrypted from Discord chunks.
  - Delete files and clean up related Discord messages.

Core technologies:

- Bun as the JavaScript runtime.
- Hono for HTTP routing and middleware.
- Prisma + PostgreSQL for metadata persistence.
- Discord API for encrypted blob storage.

How to run:

- Make sure required environment variables are set (DATABASE_URL, DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, ENCRYPTION_KEY, ALLOWED_ORIGIN, etc.).
- Start the server with `bun run src/index.ts` or `bun run dev` according to the scripts in `package.json`.
