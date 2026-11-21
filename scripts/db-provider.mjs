/**
 * 在 SQLite 与 PostgreSQL 之间切换 Prisma 的 provider，并同步 .env 里的 DATABASE_URL。
 *   node scripts/db-provider.mjs postgresql
 *   node scripts/db-provider.mjs sqlite
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = path.join(root, 'server', 'prisma', 'schema.prisma')
const envPath = path.join(root, '.env')

const target = String(process.argv[2] || '').toLowerCase()
if (!['sqlite', 'postgresql'].includes(target)) {
  console.error('用法： node scripts/db-provider.mjs <sqlite|postgresql>')
  process.exit(1)
}

const schema = fs.readFileSync(schemaPath, 'utf8')
const next = schema.replace(
  /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"(sqlite|postgresql)"/,
  `$1"${target}"`,
)
if (next === schema && !schema.includes(`provider = "${target}"`)) {
  console.error('没找到 datasource provider，请手动检查 schema.prisma')
  process.exit(1)
}
fs.writeFileSync(schemaPath, next, 'utf8')

const url =
  target === 'sqlite'
    ? 'file:./dev.db'
    : process.env.POSTGRES_URL || 'postgresql://yueqiu:yueqiu@127.0.0.1:5432/yueqiu?schema=public'

const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
const envNext = /^DATABASE_URL=.*$/m.test(env)
  ? env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url}"`)
  : `${env}\nDATABASE_URL="${url}"\n`
fs.writeFileSync(envPath, envNext, 'utf8')

console.log(`已切换为 ${target}`)
console.log(`  schema.prisma provider = "${target}"`)
console.log(`  DATABASE_URL = ${url}`)
console.log('')
console.log('接着执行：')
console.log('  pnpm db:generate && pnpm db:migrate && pnpm db:reset')
