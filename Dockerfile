# Single-container deploy: API (port 4000, internal) + Web (public $PORT) in one service.
# The web app proxies /api/* to the API, so the whole platform lives on one domain.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV API_INTERNAL_URL=http://127.0.0.1:4000
RUN npm ci && npm run build -w @ctp/api && npm run build -w @ctp/web
EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
