#!/bin/sh
set -eu

echo "[entrypoint] prisma migrate deploy..."
npx prisma migrate deploy

echo "[entrypoint] starting app..."
exec node dist/src/main.js
