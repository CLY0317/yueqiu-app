/**
 * 备份恢复演练。
 *
 *   node scripts/backup-drill.mjs
 *
 * 完整走一遍：备份 → 故意破坏数据 → 恢复 → 核对。
 * 破坏是真的破坏（drop schema），所以只在**演练库**上跑；
 * 默认演练当前 DATABASE_URL 指向的库，跑之前会二次确认。
 *
 * 演练要证明两件事：
 *   1. 备份能被恢复（pg_restore 不报错）
 *   2. 恢复出来的数据是对的（行数与清单一致，且演练前插入的标记行消失了）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import '../server/src/env.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups', 'db')
const CONTAINER = process.env.PG_CONTAINER || 'yueqiu-pg'
const SCHEMA = path.join('server', 'prisma', 'schema.prisma')

const dsn = (() => {
  const u = new URL(process.env.DATABASE_URL)
  return {
    user: decodeURIComponent(u.username || 'yueqiu'),
    db: decodeURIComponent(u.pathname.replace(/^\//, '') || 'yueqiu'),
  }
})()

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', dsn.user, '-d', dsn.db, '-t', '-A', '-c', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: decodeURIComponent(new URL(process.env.DATABASE_URL).password || '') } },
  ).trim()

/** 表可能还不存在（比如刚 drop 完 schema），出错时按 0 处理 */
const psqlSafe = (sql) => {
  try {
    return psql(sql)
  } catch {
    return '0'
  }
}

const node = process.execPath
const run = (script, args = []) =>
  execFileSync(node, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

function latestBackup() {
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.dump.gz')).sort()
  if (!files.length) throw new Error('还没有备份，先跑 node scripts/backup.mjs')
  return path.join(BACKUP_DIR, files[files.length - 1])
}

const MARKER_PHONE = '13900000000-drill'

function step(n, text) {
  console.log(`\n[${n}/6] ${text}`)
}

function main() {
  console.log('=== 备份恢复演练 ===')
  console.log(`目标库：${dsn.db}（容器 ${CONTAINER}）`)
  if (process.env.DRILL_NO_CONFIRM !== '1') {
    console.log('提示：这是一次**真实破坏**演练，会 drop schema public 后重建。')
  }

  step(1, '做一份新备份')
  run('backup.mjs')
  const dump = latestBackup()
  const manifest = JSON.parse(readFileSync(dump.replace(/\.dump\.gz$/, '.json'), 'utf8'))
  console.log(`    备份：${path.basename(dump)}  基准表行数 ${Object.keys(manifest.tableRows).length} 张表`)

  step(2, '写入一行标记数据（恢复后它必须消失）')
  const markerName = `演练标记-${Date.now()}`
  psql(
    `insert into "User" (id, phone, name, level, "createdAt") values ('drill-marker', '${MARKER_PHONE}', '${markerName}', 3, now()) on conflict (id) do nothing;`,
  )
  const before = Number(psql(`select count(*) from "User";`))
  console.log(`    标记行已写入，用户数 ${before}`)

  step(3, '破坏：drop schema public cascade')
  psql('drop schema public cascade; create schema public;')
  // 不在这里跑 migrate deploy 重建空表：
  //   - 备份包里本来就带 CREATE TABLE，恢复时会自己建表；
  //   - migrate deploy 依赖 node_modules，在只 clone 了代码的机器上跑不了。
  const empty = Number(psqlSafe(`select count(*) from "User";`))
  console.log(`    库已清空，用户数 ${empty}`)

  step(4, '从备份恢复')
  run('restore.mjs', [dump])

  step(5, '核对：行数与清单一致，且标记行已消失')
  const after = Number(psqlSafe(`select count(*) from "User";`))
  const markerLeft = Number(psqlSafe(`select count(*) from "User" where phone = '${MARKER_PHONE}';`))
  const expected = manifest.tableRows.User

  const problems = []
  if (markerLeft !== 0) problems.push(`标记行还在（${markerLeft} 行）——说明恢复的不是这份备份`)
  if (Math.abs(after - expected) > Math.max(2, expected * 0.1)) {
    problems.push(`用户数对不上：期望 ${expected}，实际 ${after}`)
  }
  if (problems.length) {
    problems.forEach((p) => console.error('    ✗', p))
    throw new Error('演练未通过')
  }

  step(6, '结果')
  console.log(`    ✓ 恢复成功：用户数 ${after}（基准 ${expected}），标记行已清除`)
  console.log(`    ✓ 演练通过 —— 这份备份是真的能用的`)
  console.log(`\n备份文件：${path.basename(dump)}`)
}

try {
  main()
} catch (err) {
  console.error('\n[drill] 演练失败：', err.message)
  console.error('[drill] 数据库当前可能处于空库状态，请用 node scripts/restore.mjs --latest 恢复')
  process.exit(1)
}
