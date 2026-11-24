#!/usr/bin/env bash
# 回滚：把 YUEQIU_VERSION 改回上一次部署的版本并重启。
#
#   ./deploy/rollback.sh            # 回滚到上一次部署的版本
#   ./deploy/rollback.sh v2.0.0    # 回滚到指定版本
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE="deploy/.env.production"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

log()  { printf '\033[0;36m[rollback]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[rollback]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[rollback]\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "缺少 $ENV_FILE"
command -v docker >/dev/null || die "没有 docker"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

CURRENT="$(grep -E '^YUEQIU_VERSION=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)"

if [ -n "${1:-}" ]; then
  TARGET="$1"
else
  [ -f deploy/.last-version ] || die "没有 deploy/.last-version，无法确定回滚目标，请手动指定版本号"
  TARGET="$(cat deploy/.last-version | xargs)"
fi

[ -n "$TARGET" ] || die "回滚目标为空"
log "当前版本 $CURRENT → 回滚到 $TARGET"

docker image inspect "yueqiu-app:$TARGET" >/dev/null 2>&1 \
  || die "本机没有 yueqiu-app:$TARGET 这个镜像（可能已被清理），请先构建或换目标版本"

sed -i.bak "s/^YUEQIU_VERSION=.*/YUEQIU_VERSION=$TARGET/" "$ENV_FILE"
dc up -d --no-deps app || die "启动 $TARGET 失败"

log "健康检查…"
HEALTHY=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  if dc exec -T app curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    HEALTHY=1
    log "回滚成功，服务正常（第 $i 次检查通过）"
    break
  fi
  sleep "$HEALTH_INTERVAL"
done

if [ "$HEALTHY" -ne 1 ]; then
  dc logs --tail 100 app || true
  die "回滚后仍不健康，请人工介入"
fi
