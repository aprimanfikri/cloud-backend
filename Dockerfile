FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install

COPY . .

RUN bun run db:generate

RUN bun run compile

FROM oven/bun:1-alpine AS runner

WORKDIR /app

# Copy files needed for migration
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

COPY --from=builder /app/server server

EXPOSE 4002

# Run migrations before starting the server
CMD ["/bin/sh", "-c", "bun run db:migrate && ./server"]