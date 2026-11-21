# 羽球局 · 约球 App（React + Express + Prisma + PostgreSQL）

[![CI](https://github.com/CLY0317/yueqiu-app/actions/workflows/ci.yml/badge.svg)](https://github.com/CLY0317/yueqiu-app/actions/workflows/ci.yml)

一个「约球 / 拼场 / 球友圈」的羽毛球约局应用，交互参考闪动。
v2 把 v1 的本地演示版升级成了**有真实账号体系、能订场、能收钱、有通知**、数据落在 **PostgreSQL** 上的完整工程。

![界面预览](docs/overview.png)

## v1 → v2 做了什么

| 能力 | v1 | v2 |
| --- | --- | --- |
| 登录 | 无（自动用演示账号） | 手机号 + 短信验证码（演示环境回显验证码）、JWT access(15min) + refresh(30d) 轮换 |
| 场地 | 只有一个场馆名字段 | 场馆时段库存，发局可**锁定场地**，解散自动释放 |
| 费用 | 只显示"人均 AA" | 报名即生成 AA 订单，可支付 / 退款，我的订单可查 |
| 球友圈 | 发动态、点赞 | 增加评论，作者收到站内通知 |
| 通知 | 无 | 报名 / 解散 / 评论 / 支付都会推一条，红点未读数 |
| 存储 | 手写 JSON 文件 | **Prisma + PostgreSQL**（迁移、关系、事务），可一键切回 SQLite |
| 测试 | 一个 node 冒烟脚本 | Vitest + supertest 23 个用例（含并发/退款/鉴权边界） |

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 18 + React Router 6 + Vite 6（手写 CSS，手机壳布局） |
| 后端 | Node.js + Express 4 + zod 校验 |
| 数据 | Prisma 6 + PostgreSQL 16（Docker）；SQLite 作为零安装备选 |
| 鉴权 | jsonwebtoken + 刷新令牌轮换（只存 sha256 摘要） |
| 测试 | Vitest + supertest（跑在独立的 yueqiu_test 库上） |

## 目录结构

```
yueqiu-app/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma        # 12 张表：User/RefreshToken/SmsCode/Venue/CourtSlot/Game/...
│   │   ├── migrations/          # PostgreSQL 迁移
│   │   └── seed.mjs             # 演示数据（12 用户 / 4 场馆 / 112 时段 / 6 球局 / 订单）
│   └── src/
│       ├── index.js             # createApp()：路由装配 + 统一错误出口
│       ├── auth.js              # JWT、刷新令牌轮换、短信验证码、鉴权中间件
│       ├── db.js / env.js       # Prisma 单例、.env 加载
│       ├── dto.js               # 行 → 前端 DTO（myRole / myOrder / isFull…）
│       ├── notify.js            # 站内通知
│       └── routes/              # auth / venues / games / feed / me
├── web/src/                     # pages: Home Create Feed Mine Login GameSheet Notifications
├── scripts/                     # dev / test-db / smoke / db-provider
├── tests/api.test.js            # 23 个集成测试
└── docker-compose.yml           # PostgreSQL 16
```

## 快速开始

```bash
pnpm install

pnpm db:up        # docker compose up -d postgres（首次会拉镜像）
pnpm db:generate  # 生成 Prisma Client
pnpm db:migrate   # 应用迁移（建表）
pnpm db:reset     # 灌演示数据（会清空重来）

pnpm dev          # API :8787 + 前端 :5173
# 打开 http://127.0.0.1:5173
```

**演示账号**：手机号 `13800000000`（林小羽，已报名一局且有一笔 ¥30 待支付）。
登录页点「获取验证码」后，演示环境会把验证码直接回显并自动填入（`DEV_SMS=true`）。

生产构建：

```bash
pnpm build && pnpm start     # Express 单端口托管 dist + API，http://127.0.0.1:8787
```

## 关键设计

**登录**：`POST /auth/sms` 发码（60 秒冷却、5 分钟有效、5 次尝试上限）→ `POST /auth/login` 换 access + refresh。
refresh 每次使用都会**轮换并作废旧令牌**，重放旧 refresh 直接 401。access 过期时前端自动静默续期，失败才踢回登录页。

**订场**：`CourtSlot` 有 `(venueId, date, startTime)` 唯一约束和 `free | booked` 状态。
发局带 `slotId` 时在**同一个事务**里校验空闲、建局、占位；同一时段并发下单只会有一个成功（409 `SLOT_TAKEN`）。
解散球局把时段释放回 `free`。

**AA 订单**：报名成功即生成一条该用户的 `Order(unpaid)`；`POST /orders/:id/pay` 走模拟网关置 `paid`（真实项目换成创建支付单 + 回调）。
退出报名或球局被解散时，已付订单转 `refunded` 并记录 `refundedAt`，同时给相关人推通知。

**通知**：报名 → 通知发起人；解散 → 通知其他参与者；评论 → 通知作者；支付 → 通知自己。
红点未读数来自 `GET /notifications`，打开列表即标记已读。

**校验**：所有写接口先用 zod 校验，错误统一成 `{ error: { code, message, field } }`；Prisma 的 P2002/P2025 也映射成 409/404。

## API

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/sms` | - | 发验证码（返回 `devCode`，仅 DEV_SMS） |
| POST | `/api/auth/login` | - | `{phone, code}` → `{accessToken, refreshToken, user}` |
| POST | `/api/auth/refresh` | - | 轮换刷新令牌 |
| POST | `/api/auth/logout` | - | 吊销 refresh |
| GET | `/api/auth/me` | ✓ | 当前用户 |
| GET | `/api/venues` | - | 场馆 + 今日可订时段数 |
| GET | `/api/venues/:id/slots?date=` | - | 某天时段（含已订） |
| GET | `/api/games?filter=&q=` | 可选 | 球局列表（all/today/weekend/newbie/need） |
| GET | `/api/games/:id` | 可选 | 详情（含 myRole / myOrder / paidCount） |
| POST | `/api/games` | ✓ | 发局，可带 `slotId` 锁场 |
| POST | `/api/games/:id/join` | ✓ | 报名（支持 `expectedVersion` 乐观锁） |
| POST | `/api/games/:id/leave` | ✓ | 退出（已付自动退款） |
| DELETE | `/api/games/:id` | ✓ | 解散（退款 + 释放场地） |
| GET/POST | `/api/feed` | 可选/✓ | 动态列表、发动态 |
| POST | `/api/feed/:id/like` | ✓ | 点赞切换 |
| GET/POST | `/api/posts/:id/comments` | 可选/✓ | 评论列表、发评论 |
| GET | `/api/me` | ✓ | 资料 + 场次/支出/球友/待支付 |
| GET | `/api/me/games?role=` | ✓ | 我发起的 / 我报名的 |
| GET | `/api/me/orders` | ✓ | 我的 AA 订单 |
| POST | `/api/orders/:id/pay` | ✓ | 模拟支付 |
| GET | `/api/notifications` | ✓ | 通知 + 未读数 |
| POST | `/api/notifications/read` | ✓ | 标记已读 |

## 数据库

主路径是 **PostgreSQL 16**（容器 `yueqiu-pg`，端口 5432，库 `yueqiu`，测试库 `yueqiu_test`），
迁移在 `server/prisma/migrations/`，是 PG 专用的 SQL。

| 命令 | 作用 |
| --- | --- |
| `pnpm db:up` / `pnpm db:down` | 起 / 停 PostgreSQL 容器 |
| `pnpm db:migrate` | `prisma migrate dev` 应用迁移 |
| `pnpm db:pg:reset` | 重置 schema 并重放迁移 |
| `pnpm db:reset` | 清空并灌演示数据 |

**切回 SQLite**（不想开 Docker 时）：

```bash
node scripts/db-provider.mjs sqlite   # 改 provider + DATABASE_URL=file:./dev.db
pnpm db:generate && pnpm db:push && pnpm db:reset
```

注意 SQLite 走 `db push`（没有独立迁移集），且 `pnpm test` 目前固定连 PG 测试库。

## 测试

```bash
pnpm db:up    # 测试需要 PostgreSQL
pnpm test     # 重建 yueqiu_test → 23 个用例（接口级）
pnpm smoke    # 对着已经跑起来的服务体检 12 项
pnpm e2e      # Playwright 端到端（需要先 build + 起服务 + 灌种子）
```

端到端要跑在生产构建上：先 `pnpm db:reset`、`pnpm build`、`pnpm start`，另开一个终端 `pnpm e2e`。
首次需要装浏览器：`pnpm e2e:install`（Chromium + 系统依赖）。用例覆盖登录、球局详情、以及「报名 → 生成 AA 订单 → 支付成功」这条付费闭环。

覆盖：验证码冷却/过期/错误、登录与 refresh 轮换重放、时段查表、锁场、重复预订 409、报名并发（ALREADY_JOINED / VERSION_CONFLICT）、
支付与重复支付、退出退款、解散退款并释放场地、非发起人不能解散、动态与空内容校验、评论计数与通知、点赞幂等、通知已读、我的统计与订单。

## 持续集成（GitHub Actions）

`.github/workflows/ci.yml` 把上面这套验证搬到 GitHub，**不需要本机 Docker**：CI 里用 service container 直接起 `postgres:16-alpine`（与 `docker-compose.yml` 同镜像、同账号）。

| 作业 | 跑什么 |
| --- | --- |
| `test` | `pnpm install --frozen-lockfile` → `prisma generate` → `pnpm test`（脚本先 `migrate reset` 重建 `yueqiu_test`，再跑 23 个用例）→ `pnpm build` |
| `smoke` | 对主库 `prisma migrate deploy` → `pnpm db:reset` 灌种子 → 后台起 API 并轮询 `/api/health` → `pnpm smoke` 12 项（失败时打印 API 日志） |
| `e2e` | 迁移 + 种子 → `pnpm build` → 装 Chromium → 起 API → `pnpm e2e` 三个 Playwright 用例（登录 / 详情 / 报名支付闭环） |

触发：任意分支 push、任意 PR、手动 `workflow_dispatch`；同一分支的新提交会取消上一次未完成的构建。

几个刻意的选择：

- **不用 `docker compose up`**：CI 里 service container 与本地 compose 是同一镜像同一套账号，但省掉了 compose 解析和健康轮询；`docker-compose.yml` 只服务本地开发。
- **pnpm store 显式指到 `~/.pnpm-store`**：仓库 `.npmrc` 的 `store-dir=.pnpm-store` 是给本机用的，CI 覆盖它，缓存才不会落进工作区。
- **`migrate deploy` 而不是 `migrate dev`**：CI 只应用已有迁移，不产生新迁移文件。
- **`DEV_SMS=true` 只在 CI**：测试和冒烟都要拿回显验证码；生产必须关掉。
- **两个作业都自带一份 PG service**：`smoke` 不依赖 `test` 留下的库状态，各自从空库开始。

不需要配置任何 Secret——数据库账号是每次构建里的一次性容器。

## 没有做的（下一批）

- 真实短信网关与支付渠道（现在都是模拟，接口形状已经留好）
- 地图/LBS 与按距离排序、图片上传、分页、WebSocket 推送
- Playwright 端到端（目前是 Vitest 接口级 + 手动点测）

## 环境备注

- Node ≥ 20（开发用 Node 24）；包管理器用 **pnpm 11**（CI 里固定 `version: 11`）。
- `pnpm-workspace.yaml` 里设了 `nodeLinker: hoisted` 与 `allowBuilds`。注意 **pnpm 11 已改用 `allowBuilds`**（`包名: true` 的映射），旧的 `onlyBuiltDependencies` 会被静默忽略——而 pnpm 11 把"未批准的构建脚本"当作**硬错误**（`ERR_PNPM_IGNORED_BUILDS`，exit 1），所以 `prisma`/`@prisma/client`/`@prisma/engines`/`esbuild` 必须在白名单里，否则 `pnpm install` 直接失败。这张白名单是 `pnpm approve-builds <包名>` 写出来的，不要手改回旧键。
- `.env` 里的 `JWT_SECRET`、`DEV_SMS` 只能用于本地；上线前必须换成随机值并关掉 `DEV_SMS`。
- **如果 Docker Hub 拉不动**（国内常见），可以走镜像站再打回标准 tag：

```bash
docker pull docker.m.daocloud.io/library/postgres:16-alpine
docker tag docker.m.daocloud.io/library/postgres:16-alpine postgres:16-alpine
pnpm db:up
```

- 手机壳用 `overflow: clip` 而不是 `hidden`：`hidden` 仍可被「滚动到聚焦元素」带动整体位移，会让底部弹层错位。
- 本机已验证：PG 容器 healthy、迁移可重放、23 个用例在 PG 上全绿、`pnpm build` 通过。
