/**
 * 数据库恢复。
 *
 *   node scripts/restore.mjs <备份文件.dump.gz>        # 恢复到当前库（先清空）
 *   node scripts/restore.mjs <备份文件.dump.gz> --verify-only   # 只校验，不落库
 *   node scripts/restore.mjs --latest                  # 用最新一份备份
 *
 * 恢复后会拿清单里的表行数做核对，对不上直接报错——恢复成功不等于恢复正确。
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 副作用导入：把 .env 装进 process.env（否则 DATABASE_URL 是空的）
import '../server/src/env.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups', 'db')
const CONTAINER = process.env.PG_CONTAINER || 'yueqiu-pg'

function dsnParts(dsn = process.env.DATABASE_URL || '') {
  const u = new URL(dsn)
  return {
    user: decodeURIComponent(u.username || 'yueqiu'),
    password: decodeURIComponent(u.password || ''),
    db: decodeURIComponent(u.pathname.replace(/^\//, '') || 'yueqiu'),
  }
}
const dsn = dsnParts()

function latestBackup() {
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.dump.gz')).sort()
  if (!files.length) throw new Error(`${BACKUP_DIR} 里没有备份`)
  return path.join(BACKUP_DIR, files[files.length - 1])
}

function manifestFor(file) {
  const meta = file.replace(/\.dump\.gz$/, '.json')
  return existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : null
}

async function tableCounts() {
  const out = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', dsn.user, '-d', dsn.db, '-t', '-A', '-c',
      "select relname||'='||n_live_tup from pg_stat_user_tables order by relname;"],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: dsn.password } },
  )
  const counts = {}
  for (const line of out.trim().split('\n')) {
    const [k, v] = line.split('=')
    if (k) counts[k] = Number(v)
  }
  return counts
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || args[0] === '--help') {
    console.log('用法：node scripts/restore.mjs <备份文件.dump.gz> | --latest [--verify-only]')
    process.exit(0)
  }

  const file = args[0] === '--latest' ? latestBackup() : args[0]
  if (!existsSync(file)) throw new Error(`找不到备份文件：${file}`)
  const manifest = manifestFor(file)
  const verifyOnly = args.includes('--verify-only')

  console.log(`[restore] 备份：${file}  ${(statSync(file).size / 1048576).toFixed(2)} MB`)
  if (manifest) console.log(`[restore] 清单：${manifest.createdAt}  表行数基准 ${JSON.stringify(manifest.tableRows)}`)

  // 解压到容器内
  const tmp = path.join(BACKUP_DIR, `_restore_${Date.now()}.dump`)
  await pipeline(createReadStream(file), createGunzip(), createWriteStream(tmp))
  execFileSync('docker', ['cp', tmp, `${CONTAINER}:/tmp/_restore.dump`], { stdio: 'inherit' })
  rmSync(tmp, { force: true })

  // 先用 pg_restore --list 确认这个包是好的
  const list = execFileSync('docker', ['exec', CONTAINER, 'pg_restore', '--list', '/tmp/_restore.dump'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const entries = list.split('\n').filter(Boolean).length
  console.log(`[restore] 包内条目 ${entries} 个`)
  if (entries < 5) throw new Error('这个备份包看起来是坏的')

  if (verifyOnly) {
    execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', '/tmp/_restore.dump'], { stdio: 'inherit' })
    console.log('[restore] 仅校验通过，未落库')
    return
  }

  // 落库：--clean 会先删掉现有对象再重建
  console.log('[restore] 开始恢复…')
  const restore = execFileSync(
    'docker',
    ['exec', CONTAINER, 'pg_restore', '-U', dsn.user, '-d', dsn.db, '--clean', '--if-exists', '--no-owner', '/tmp/_restore.dump'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: dsn.password } },
  )
  execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', '/tmp/_restore.dump'], { stdio: 'inherit' })
  if (restore.trim()) console.log('[restore] pg_restore 输出：', restore.trim().split('\n').slice(0, 5).join(' | '))

  // 核对行数
  const now = await tableCounts()
  if (manifest?.tableRows) {
    const diffs = []
    for (const [table, expected] of Object.entries(manifest.tableRows)) {
      const actual = now[table]
      if (actual === undefined) continue
      if (Math.abs(actual - expected) > Math.max(2, expected * 0.1)) {
        diffs.push(`${table}: 期望 ${expected}，实际 ${actual}`)
      }
    }
    if (diffs.length) {
      console.error('[restore] 行数核对不通过：')
      diffs.forEach((d) => console.error('   ', d))
      throw new Error('恢复后的数据与备份清单对不上')
    }
    console.log('[restore] 行数核对通过 ✓')
  }
  console.log('[restore] 完成')
}

main().catch((err) => {
  console.error('[restore] 失败：', err.message)
  process.exit(1)
})
