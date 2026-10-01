#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT=/volume2/ssd_docker/market-board
PROXY=${MARKET_BOARD_PROXY:-http://192.168.31.192:34421}

trap 'echo "Update failed at line $LINENO. Existing data has not been deleted." >&2' ERR
if [[ ! -d "$PROJECT/.git" || ! -f "$PROJECT/docker-compose.yml" ]]; then
  echo "Project or Git repository missing: $PROJECT" >&2
  exit 1
fi
cd "$PROJECT"
sudo -v

echo '[1/3] Pulling code through proxy...'
if command -v git >/dev/null 2>&1; then
  git -c "http.proxy=$PROXY" pull --ff-only
else
  # Image pulls use the Docker daemon proxy; Git inside the container uses PROXY.
  sudo docker run --rm \
    -e HTTP_PROXY="$PROXY" -e HTTPS_PROXY="$PROXY" \
    -e NO_PROXY=localhost,127.0.0.1,192.168.31.192 \
    -v "$PROJECT:/repo" -w /repo \
    alpine/git -c safe.directory=/repo -c "http.proxy=$PROXY" pull --ff-only
fi

echo '[2/3] Building and updating...'
# Build before replacing the running container so build failures leave it running.
sudo docker compose build --build-arg HTTP_PROXY="$PROXY" --build-arg HTTPS_PROXY="$PROXY"
sudo docker compose up -d --no-build

echo '[3/3] Checking service...'
for attempt in {1..20}; do
  if sudo docker exec market-board node -e "fetch('http://127.0.0.1:3001/api/health').then(async r=>{if(!r.ok || !(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo 'Update complete: http://192.168.31.192:3001'
    echo 'Refresh the browser with Ctrl+F5.'
    exit 0
  fi
  sleep 2
done
sudo docker compose ps
sudo docker compose logs --tail 30
echo 'Container started but health check failed. See logs above.' >&2
exit 1
