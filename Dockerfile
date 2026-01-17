FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install

RUN bun run db:generate

COPY . .

RUN bun run compile

FROM oven/bun:1-alpine AS runner

WORKDIR /app

COPY --from=builder /app/server server

EXPOSE 4000

CMD ["./server"]