FROM docker.io/oven/bun:alpine

WORKDIR /app

COPY . .

RUN apk add zip
RUN bun install --production

# Minify JavaScript files using Bun's build functionality
RUN find public/js -name "*.js" -exec bun build --minify --outfile={} {} \; 2>/dev/null || echo "No JS files to minify"

EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
