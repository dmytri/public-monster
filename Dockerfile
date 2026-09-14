FROM docker.io/oven/bun:1.4.2-alpine

WORKDIR /app

COPY . .

RUN apk add zip
RUN bun install --production

EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
