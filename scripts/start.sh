#!/bin/sh
# Starts the whole platform in one container. Only secrets, database and broker keys
# need to be set as variables — everything else is derived from the public domain.
set -e

DOMAIN="${PUBLIC_DOMAIN:-${RENDER_EXTERNAL_HOSTNAME:-$RAILWAY_PUBLIC_DOMAIN}}"
if [ -z "$DOMAIN" ]; then echo "Set PUBLIC_DOMAIN (Render sets RENDER_EXTERNAL_HOSTNAME automatically)"; exit 1; fi
ORIGIN="https://$DOMAIN"

export NODE_ENV=production
export APP_ENV="${APP_ENV:-production}"
export COOKIE_SECURE="${COOKIE_SECURE:-true}"
export TRUST_PROXY="${TRUST_PROXY:-true}"
export PAPER_MODE="${PAPER_MODE:-true}"
export WEB_ORIGIN="${WEB_ORIGIN:-$ORIGIN}"
export API_PUBLIC_URL="${API_PUBLIC_URL:-$ORIGIN/api}"
export API_INTERNAL_URL="http://127.0.0.1:4000"
export ZERODHA_REDIRECT_URL="${ZERODHA_REDIRECT_URL:-$ORIGIN/api/brokers/zerodha/callback}"
export ANGEL_REDIRECT_URL="${ANGEL_REDIRECT_URL-$ORIGIN/api/brokers/angel-one/callback}"
WEB_PORT="${PORT:-3000}"

echo "Public URL:        $ORIGIN"
echo "Zerodha redirect:  $ZERODHA_REDIRECT_URL"
echo "Angel redirect:    $ANGEL_REDIRECT_URL"

npm run prisma:deploy

exec npx concurrently -k -n api,web \
  "PORT=4000 npm run start -w @ctp/api" \
  "PORT=$WEB_PORT npm run start -w @ctp/web"
