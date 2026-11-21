/**
 * 准备测试库（PostgreSQL）：重置 schema → 应用迁移 → 写入最小种子数据。
 * 由 `pnpm test` 在 vitest 之前调用。
 *
 * 注意：`migrate reset` 会在库不存在时自动建库，所以只要 PG 实例可连即可。
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prismaBin = path.join(root, 'node_modules', 'prisma', 'build', 'index.js')
const schema = path.join('server', 'prisma', 'schema.prisma')

const baseUrl =
  process.env.DATABASE_URL || 'postgresql://yueqiu:yueqiu@127.0.0.1:5432/yueqiu'
const testUrl =
  process.env.TEST_DATABASE_URL || baseUrl.replace(/\/[^/?]+(\?|$)/, '/yueqiu_test$1')

console.log('[test-db] 目标库：', testUrl)

// 1) 重置测试库：drop schema → 建库（若不存在）→ 应用迁移
execFileSync(
  process.execPath,
  [prismaBin, 'migrate', 'reset', '--force', '--skip-seed', '--schema', schema],
  { cwd: root, stdio: 'inherit', env: { ...process.env, DATABASE_URL: testUrl } },
)

// 2) 最小种子：一个场馆 + 两个时段 + 一个无关用户
process.env.DATABASE_URL = testUrl
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

const venue = await prisma.venue.create({
  data: { name: '测试球馆', area: '浦东 · 测试', distanceKm: 1, courts: 8, price: 50, tag: '测试场地' },
})

const now = new Date()
const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
  now.getDate(),
).padStart(2, '0')}`

for (const startTime of ['10:00', '19:30']) {
  await prisma.courtSlot.create({
    data: { venueId: venue.id, date: ymd, startTime, duration: 120, price: 100 },
  })
}

await prisma.user.create({ data: { phone: '13900000009', name: '房主', level: 4 } })
await prisma.$disconnect()

console.log(`[test-db] 完成：场馆 ${venue.id}，日期 ${ymd}`)
