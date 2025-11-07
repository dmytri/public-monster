FROM docker.io/oven/bun:alpine
WORKDIR /app

COPY . .

RUN bun install --production

EXPOSE 3000
CMD ["bun", "server.ts"]
