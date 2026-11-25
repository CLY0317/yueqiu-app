# 基础镜像可换：国内拉不动 Docker Hub 时用
#   docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim .
ARG NODE_IMAGE=node:22-bookworm-slim

# 换 Debian 源为阿里云镜像：官方源在国内慢到能把一次构建拖到半小时
# （注意：RUN 必须写在某个 FROM 之后，写在最前面会报 "no build stage in current context"）
# 做法：把换源做成脚本，在每个 stage 里 apt-get update 之前调用

# ---------- 构建阶段 ----------
FROM ${NODE_IMAGE} AS builder

# pnpm 与 Prisma 需要的系统包
COPY deploy/apt-mirror.sh /tmp/apt-mirror.sh
RUN chmod +x /tmp/apt-mirror.sh && /tmp/apt-mirror.sh \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate

# 先只拷清单，依赖层能单独缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .
RUN pnpm db:generate \
  && pnpm build \
  && rm -rf /pnpm-store


# ---------- 运行阶段 ----------
FROM ${NODE_IMAGE} AS runner

COPY deploy/apt-mirror.sh /tmp/apt-mirror.sh
RUN chmod +x /tmp/apt-mirror.sh && /tmp/apt-mirror.sh \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
       https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://mirrors.aliyun.com/postgresql/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    PNPM_HOME=/pnpm

RUN corepack enable && corepack prepare pnpm@11 --activate

# 依赖与产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./

# 非 root 运行
RUN useradd --system --create-home --uid 10001 yueqiu \
  && mkdir -p /backups /app/logs \
  && chown -R yueqiu:yueqiu /app /backups
USER yueqiu

EXPOSE 8787

# 容器自身的健康检查（compose 里还会再配一次，探针语义不同）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "server/src/index.js"]
