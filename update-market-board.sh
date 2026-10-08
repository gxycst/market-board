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
  echo 'Using Git installed on the NAS.'
  GIT=(git)
else
  if ! command -v docker >/dev/null 2>&1; then
    echo 'Neither Git nor Docker is installed; unable to pull updates.' >&2
    exit 1
  fi
  echo 'Git is not installed; using the alpine/git Docker image instead.'
  GIT=(sudo docker run --rm -v "$PROJECT:/repo" -w /repo alpine/git -c safe.directory=/repo)
fi
BEFORE_COMMIT=$("${GIT[@]}" rev-parse HEAD)
BRANCH=$("${GIT[@]}" branch --show-current)
UPSTREAM=$("${GIT[@]}" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)
if [[ -z "$BRANCH" || -z "$UPSTREAM" ]]; then
  echo 'The repository must be on a branch with an upstream remote before it can be updated.' >&2
  echo "Current branch: ${BRANCH:-detached HEAD}; upstream: ${UPSTREAM:-not configured}" >&2
  exit 1
fi
echo "Branch: $BRANCH -> $UPSTREAM"
echo "Before: $("${GIT[@]}" log -1 --format='%h %s')"
HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" NO_PROXY=localhost,127.0.0.1,192.168.31.192 \
  "${GIT[@]}" -c "http.proxy=$PROXY" pull --ff-only
AFTER_COMMIT=$("${GIT[@]}" rev-parse HEAD)
if [[ "$BEFORE_COMMIT" == "$AFTER_COMMIT" ]]; then
  echo 'No new commit was pulled. Confirm that the new code has been pushed to this upstream remote.'
else
  echo "Updated: $("${GIT[@]}" log -1 --format='%h %s')"
fi

echo '[2/3] Building and updating...'
# Build before replacing the running container so build failures leave it running.
sudo docker compose build --build-arg HTTP_PROXY="$PROXY" --build-arg HTTPS_PROXY="$PROXY"
BUILT_IMAGE=$(sudo docker image inspect local/market-board:latest --format '{{.Id}}')
sudo docker compose up -d --no-build --force-recreate
RUNNING_IMAGE=$(sudo docker inspect market-board --format '{{.Image}}')
if [[ "$RUNNING_IMAGE" != "$BUILT_IMAGE" ]]; then
  echo "Container image mismatch: built $BUILT_IMAGE but running $RUNNING_IMAGE" >&2
  exit 1
fi
echo "Running commit: $("${GIT[@]}" log -1 --format='%h %s')"
echo "Running image: ${RUNNING_IMAGE#sha256:}"

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
