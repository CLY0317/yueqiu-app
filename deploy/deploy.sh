#!/usr/bin/env bash
# 部署：备份 → 构建新版本 → 迁移 → 切换 → 健康检查 → 失败自动回滚
#
#   cd /srv/yueqiu-app && ./deploy/deploy.sh
#   ./deploy/deploy.sh --version v2.1.0     # 指定版本标签
#
# 前提：
#   - deploy/.env.production 已配好
#   - 当前用户能操作 docker compose
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE="deploy/.env.production"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

VERSION=""
if [ "${1:-}" = "--version" ]; then VERSION="$2"; fi

log()  { printf '\033[0;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "缺少 $ENV_FILE（参考 .env.production.example 复制一份）"
command -v docker >/dev/null || die "没有 docker"
docker compose version >/dev/null 2>&1 || die "docker compose 不可用"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# ---------- 1. 记录当前版本（回滚目标） ----------
CURRENT_VERSION="$(grep -E '^YUEQIU_VERSION=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)"
[ -n "$CURRENT_VERSION" ] || CURRENT_VERSION="latest"
ROLLBACK_FILE="deploy/.last-version"
echo "$CURRENT_VERSION" > "$ROLLBACK_FILE"
log "当前版本：$CURRENT_VERSION（已记入 $ROLLBACK_FILE，失败会回滚到这里）"

NEW_VERSION="${VERSION:-$(date +%Y%m%d-%H%M%S)}"
log "目标版本：$NEW_VERSION"

# ---------- 2. 部署前先备份 ----------
log "部署前备份数据库…"
BACKUP_OK=0
dc run --rm --no-deps -e PG_CONTAINER=postgres backup node scripts/backup.mjs && BACKUP_OK=1 \
  || warn "备份失败或被跳过，继续（强烈建议不要在无备份的情况下部署）"

# ---------- 3. 构建新镜像 ----------
log "构建镜像 yueqiu-app:$NEW_VERSION …"
dc build --build-arg VERSION="$NEW_VERSION" app \
  || die "镜像构建失败"
docker tag "yueqiu-app:${YUEQIU_VERSION:-latest}" "yueqiu-app:$NEW_VERSION" 2>/dev/null || true

# ---------- 3.5 先把数据库容器拉起来 ----------
# 迁移要连库，而首次部署时数据库还没起 —— 必须先 up 并等它 healthy
log "启动数据库容器…"
dc up -d --wait postgres || die "数据库容器启动失败"

# ---------- 4. 应用迁移 ----------
log "应用数据库迁移…"
dc run --rm --no-deps app node node_modules/prisma/build/index.js migrate deploy --schema server/prisma/schema.prisma \
  || die "迁移失败（已回滚到 $CURRENT_VERSION）"

# ---------- 5. 切换版本 ----------
log "切换到 $NEW_VERSION 并重启…"
sed -i.bak "s/^YUEQIU_VERSION=.*/YUEQIU_VERSION=$NEW_VERSION/" "$ENV_FILE"
dc up -d --no-deps app || die "启动新版本失败"

# ---------- 6. 健康检查 ----------
log "健康检查（最多 ${HEALTH_RETRIES} 次，每次间隔 ${HEALTH_INTERVAL}s）…"
HEALTHY=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T app \
       curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    HEALTHY=1
    log "健康检查通过（第 $i 次）"
    break
  fi
  sleep "$HEALTH_INTERVAL"
done

# ---------- 7. 不健康就自动回滚 ----------
if [ "$HEALTHY" -ne 1 ]; then
  warn "新版本健康检查失败，自动回滚到 $CURRENT_VERSION"
  dc logs --tail 100 app || true
  sed -i.bak2 "s/^YUEQIU_VERSION=.*/YUEQIU_VERSION=$CURRENT_VERSION/" "$ENV_FILE"
  dc up -d --no-deps app || warn "回滚后启动也失败了，请人工介入！"
  sleep "$HEALTH_INTERVAL"
  if dc exec -T app curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    warn "已回滚到 $CURRENT_VERSION，服务恢复正常"
  else
    warn "回滚后仍不健康！请立刻人工检查：docker compose logs app"
  fi
  exit 1
fi

# ---------- 7.5 启动反向代理 ----------
# 注意：上面只 --no-deps 起了 app，caddy 必须单独起（它依赖 app healthy）
log "启动反向代理 Caddy…"
dc up -d caddy || warn "Caddy 启动失败（应用本身仍在跑，只是没有对外入口）"

# ---------- 8. 顺手起一下运维侧车 ----------
if [ "${ENABLE_OPS:-1}" = "1" ]; then
  log "启动运维侧车（巡检 + 备份）…"
  dc --profile ops up -d watchdog backup || warn "运维侧车启动失败（不影响主服务）"
fi

log "部署完成：$NEW_VERSION"
log "  看日志：docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f app"
log "  回滚：  ./deploy/rollback.sh"
