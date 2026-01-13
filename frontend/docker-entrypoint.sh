#!/bin/sh
set -e

# Default values if not provided
: ${POCKETBASE_HOST:=bunking-pocketbase}
: ${POCKETBASE_PORT:=8090}
: ${SOLVER_HOST:=bunking-solver}
: ${SOLVER_PORT:=8000}

echo "Configuring nginx with:"
echo "  PocketBase: ${POCKETBASE_HOST}:${POCKETBASE_PORT}"
echo "  Solver: ${SOLVER_HOST}:${SOLVER_PORT}"

# Process the nginx template with environment variables
envsubst '${POCKETBASE_HOST} ${POCKETBASE_PORT} ${SOLVER_HOST} ${SOLVER_PORT}' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# Remove the template to avoid confusion
rm -f /etc/nginx/conf.d/default.conf.template

# Execute the original nginx command
exec "$@"