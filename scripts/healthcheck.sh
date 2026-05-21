#!/bin/sh
# Health check script for mdforest
# Usage: ./scripts/healthcheck.sh [host]
# Default: localhost

HOST=${1:-localhost}

echo "=== mdforest Health Check ==="

# Check Next.js app
echo -n "App (Next.js): "
APP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://$HOST:3000/api/trpc/health")
if [ "$APP_STATUS" = "200" ]; then
  echo "OK ($APP_STATUS)"
else
  echo "FAIL ($APP_STATUS)"
fi

# Check WebSocket server
echo -n "WebSocket:     "
WS_HEALTH=$(curl -s "http://$HOST:3001/health")
if [ $? -eq 0 ]; then
  echo "OK - $WS_HEALTH"
else
  echo "FAIL - unable to connect"
fi

# Check database
echo -n "Database:      "
if npx prisma db execute --stdin <<<"SELECT 1" > /dev/null 2>&1; then
  echo "OK"
else
  echo "FAIL"
fi

echo "=== Done ==="
