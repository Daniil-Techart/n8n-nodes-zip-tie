#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
N8N_VERSION="${N8N_VERSION:-2.44.7}"
N8N_PORT="${N8N_PORT:-5681}"
FRONTEND_PORT="${FRONTEND_PORT:-8099}"
CONTAINER="n8n-zip-tie-e2e"
VOLUME="n8n-zip-tie-e2e-data"
TMP="$(mktemp -d)"
FRONTEND_PID=""

cleanup() {
	if [ -n "$FRONTEND_PID" ]; then kill "$FRONTEND_PID" >/dev/null 2>&1 || true; fi
	docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
	docker volume rm "$VOLUME" >/dev/null 2>&1 || true
	rm -rf "$TMP"
}
trap cleanup EXIT

wait_editor() {
	for _ in $(seq 1 180); do
		if docker logs "$CONTAINER" 2>&1 | grep -q 'Editor is now accessible'; then return 0; fi
		sleep 1
	done
	docker logs --tail 100 "$CONTAINER" 2>&1 || true
	return 1
}

cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
E2E_PASSWORD="E2e-$(openssl rand -hex 8)!"
E2E_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npm run build >/dev/null

python3 -m http.server "$FRONTEND_PORT" --bind 127.0.0.1 --directory frontend >"$TMP/frontend.log" 2>&1 &
FRONTEND_PID=$!

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker volume rm "$VOLUME" >/dev/null 2>&1 || true
docker run --rm -v "${VOLUME}:/data" -v "${ROOT}:/pkg:ro" alpine sh -c \
	'mkdir -p /data/.n8n/nodes/node_modules/n8n-nodes-zip-tie && cp -a /pkg/package.json /pkg/dist /data/.n8n/nodes/node_modules/n8n-nodes-zip-tie/ && chown -R 1000:1000 /data'
docker run -d --name "$CONTAINER" -p "127.0.0.1:${N8N_PORT}:5678" \
	-v "${VOLUME}:/home/node/.n8n" \
	-e N8N_USER_FOLDER=/home/node/.n8n \
	-e N8N_ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" \
	-e N8N_SECURE_COOKIE=false \
	-e N8N_PROTOCOL=http \
	-e N8N_HOST=127.0.0.1 \
	-e N8N_PORT=5678 \
	-e EXTERNAL_FRONTEND_HOOKS_URLS="http://127.0.0.1:${FRONTEND_PORT}/zip-ties-frontend.js?v=${VERSION}" \
	-e N8N_DIAGNOSTICS_ENABLED=false \
	-e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
	"docker.n8n.io/n8nio/n8n:${N8N_VERSION}" >/dev/null
wait_editor

OWNER_CODE=""
for _ in $(seq 1 180); do
	OWNER_CODE="$(curl -sS -c "$TMP/cookies.txt" -H 'Content-Type: application/json' \
		-d "{\"email\":\"e2e@example.com\",\"firstName\":\"E2E\",\"lastName\":\"Test\",\"password\":\"$E2E_PASSWORD\"}" \
		-o "$TMP/owner.json" -w '%{http_code}' "http://127.0.0.1:${N8N_PORT}/rest/owner/setup" || true)"
	if [ "$OWNER_CODE" = "200" ]; then break; fi
	sleep 1
done
if [ "$OWNER_CODE" != "200" ]; then
	cat "$TMP/owner.json" 2>/dev/null || true
	docker logs --tail 100 "$CONTAINER" 2>&1 || true
	exit 1
fi

CREATE_CODE="$(curl -sS -b "$TMP/cookies.txt" -H 'Content-Type: application/json' \
	-d @"$ROOT/test/e2e/workflow.json" -o "$TMP/workflow.json" -w '%{http_code}' \
	"http://127.0.0.1:${N8N_PORT}/rest/workflows")"
if [ "$CREATE_CODE" != "200" ]; then
	cat "$TMP/workflow.json"
	exit 1
fi

WORKFLOW_ID="$(node -e "console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).data.id)" "$TMP/workflow.json")"
N8N_BASE_URL="http://127.0.0.1:${N8N_PORT}" WORKFLOW_ID="$WORKFLOW_ID" E2E_PASSWORD="$E2E_PASSWORD" node "$ROOT/test/e2e/run.mjs"
