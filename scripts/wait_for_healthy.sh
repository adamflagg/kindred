#!/bin/bash
# Wait for a container to be healthy
# Usage: ./scripts/wait_for_healthy.sh <container_name> [timeout_seconds]

CONTAINER=$1
TIMEOUT=${2:-30}

if [ -z "$CONTAINER" ]; then
    echo "Usage: $0 <container_name> [timeout_seconds]"
    exit 1
fi

echo -n "Waiting for $CONTAINER to be healthy"

for i in $(seq 1 "$TIMEOUT"); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" == "healthy" ]; then
        echo " ✓"
        exit 0
    fi
    echo -n "."
    sleep 1
done

echo " ✗"
echo "Container $CONTAINER failed to become healthy after ${TIMEOUT}s"
exit 1