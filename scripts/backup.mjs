/**
 * 数据库备份。
 *
 *   node scripts/backup.mjs            # 做一次备份
 *   node scripts/backup.mjs --list     # 列出已有备份
 *
 * 产出（默认在 BACKUP_DIR）：
 *   yueqiu-YYYYMMDD-HHmmss.dump.gz   压缩的自定义格式备份
 *   yueqiu-YYYYMMDD-HHmmss.json      清单：大小、sha256、各表行数
 *
 * 关键点：
 *   - 备份完立刻用 pg_restore --list 验一遍，坏掉的备份等于没有备份；
 *   - 按保留策略清理旧备份（默认留 14 个日备 + 8 个周备）；
 *   - 支持把备份推到远端（BACKUP_UPLOAD_CMD），异地才有意义。
 */
import { execFileSync, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGzip, createGunzip } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// 副作用导入：把 .env 装进 process.env（否则 DATABASE_URL 是空的）
import '../server/src/env.js'

const execFileAsync = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups', 'db')
const CONTAINER = process.env.PG_CONTAINER || 'yueqiu-pg'
const KEEP_DAILY = Number(process.env.BACKUP_KEEP_DAILY || 14)
const KEEP_WEEKLY = Number(process.env.BACKUP_KEEP_WEEKLY || 8)

/** 从 DATABASE_URL 里取出连接参数 */
function parseDsn(dsn = process.env.DATABASE_URL || '') {
  const u = new URL(dsn)
  return {
    user: decodeURIComponent(u.username || 'yueqiu'),
    password: decodeURIComponent(u.password || ''),
    db: decodeURIComponent(u.pathname.replace(/^\//, '') || 'yueqiu'),
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
  }
}

const dsn = parseDsn()

/** 在容器里跑 psql；容器不在就退回本机 psql */
async function pgExec(args, { input } = {}) {
  const inContainer = process.env.PG_CONTAINER !== 'none'
  if (inContainer) {
    return execFileAsync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', dsn.user, '-d', dsn.db, ...args], {
      input,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: dsn.password },
    })
  }
  return execFileAsync('psql', ['-h', dsn.host, '-p', dsn.port, '-U', dsn.user, '-d', dsn.db, ...args], {
    input,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PGPASSWORD: dsn.password },
  })
}

/** 导出备份：容器内 pg_dump 或本机 pg_dump，产物都落到宿主机可见的目录 */
function dumpTo(localFile) {
  const inContainer = process.env.PG_CONTAINER !== 'none'
  if (inContainer) {
    execFileSync('docker', ['exec', CONTAINER, 'pg_dump', '-U', dsn.user, '-d', dsn.db, '-Fc', '-f', '/tmp/_backup.dump'], {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: dsn.password },
    })
    execFileSync('docker', ['cp', `${CONTAINER}:/tmp/_backup.dump`, localFile], { stdio: 'inherit' })
    execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', '/tmp/_backup.dump'], { stdio: 'inherit' })
    return
  }
  execFileSync('pg_dump', ['-h', dsn.host, '-p', dsn.port, '-U', dsn.user, '-d', dsn.db, '-Fc', '-f', localFile], {
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: dsn.password },
  })
}

/** 校验备份包：能被 pg_restore 读出目录才算有效 */
function listEntries(localFile) {
  const inContainer = process.env.PG_CONTAINER !== 'none'
  const remote = '/tmp/_verify.dump'
  if (inContainer) {
    execFileSync('docker', ['cp', localFile, `${CONTAINER}:${remote}`], { stdio: 'inherit' })
    const out = execFileSync('docker', ['exec', CONTAINER, 'pg_restore', '--list', remote], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', remote], { stdio: 'inherit' })
    return out.split('\n').filter(Boolean).length
  }
  const out = execFileSync('pg_restore', ['-h', dsn.host, '-p', dsn.port, '-U', dsn.user, '--list', localFile], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PGPASSWORD: dsn.password },
  })
  return out.split('\n').filter(Boolean).length
}

/** 各表行数，写进清单做恢复后的核对基准 */
async function tableCounts() {
  const { stdout } = await pgExec(['-t', '-A', '-c', `
    select relname||'='||n_live_tup from pg_stat_user_tables order by relname;
  `])
  const out = {}
  for (const line of stdout.trim().split('\n')) {
    const [k, v] = line.split('=')
    if (k) out[k] = Number(v)
  }
  return out
}

async function sha256(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}

function listBackups() {
  if (!existsSync(BACKUP_DIR)) return []
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump.gz'))
    .sort()
}

/** 保留策略：最近 N 个日备 + 每周第一个（ISO 周一）各留 M 个 */
async function applyRetention() {
  const files = listBackups()
  const keep = new Set()
  const seenWeeks = new Set()

  for (const f of files.slice().reverse()) {
    const m = /^yueqiu-(\d{8})-(\d{6})\.dump\.gz$/.exec(f)
    if (!m) continue
    const d = new Date(
      `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z`,
    )
    const week = isoWeek(d)
    if (!seenWeeks.has(week)) {
      seenWeeks.add(week)
      keep.add(f)
      if (seenWeeks.size > KEEP_WEEKLY) {
        const [oldest] = [...seenWeeks].sort().slice(0, 1)
        seenWeeks.delete(oldest)
      }
    }
  }
  const daily = files.slice(-KEEP_DAILY)
  daily.forEach((f) => keep.add(f))

  let removed = 0
  for (const f of files) {
    if (!keep.has(f)) {
      rmSync(path.join(BACKUP_DIR, f), { force: true })
      const meta = f.replace('.dump.gz', '.json')
      rmSync(path.join(BACKUP_DIR, meta), { force: true })
      removed += 1
    }
  }
  return removed
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`
}

async function main() {
  if (process.argv.includes('--list')) {
    for (const f of listBackups()) {
      const s = statSync(path.join(BACKUP_DIR, f))
      console.log(`${f}  ${(s.size / 1048576).toFixed(2)} MB  ${s.mtime.toISOString()}`)
    }
    return
  }

  mkdirSync(BACKUP_DIR, { recursive: true })
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  const base = `yueqiu-${stamp}`
  const dumpFile = path.join(BACKUP_DIR, `${base}.dump`)

  console.log(`[backup] 开始备份 ${dsn.db} → ${dumpFile}`)

  // 1) 导出（容器内 pg_dump，避免宿主机没装客户端）
  dumpTo(dumpFile)

  // 2) 压缩
  const gzFile = `${dumpFile}.gz`
  await pipeline(createReadStream(dumpFile), createGzip({ level: 6 }), createWriteStream(gzFile))
  rmSync(dumpFile, { force: true })

  // 3) 校验：解回来后能用 pg_restore 读出目录，才算有效备份
  const gzTemp = path.join(BACKUP_DIR, `_verify_${Date.now()}.dump`)
  await pipeline(createReadStream(gzFile), createGunzip(), createWriteStream(gzTemp))
  let entries = 0
  try {
    entries = listEntries(gzTemp)
  } catch (err) {
    rmSync(gzTemp, { force: true })
    throw new Error(`备份校验失败：${err.message}`)
  }
  rmSync(gzTemp, { force: true })
  if (entries < 5) throw new Error(`备份校验失败：pg_restore 只读出 ${entries} 条目录`)

  // 4) 清单
  const manifest = {
    createdAt: new Date().toISOString(),
    database: dsn.db,
    file: `${base}.dump.gz`,
    bytes: statSync(gzFile).size,
    sha256: await sha256(gzFile),
    restoreEntries: entries,
    tableRows: await tableCounts(),
  }
  writeFileSync(path.join(BACKUP_DIR, `${base}.json`), JSON.stringify(manifest, null, 2))

  // 5) 可选：推到远端（异地才有意义）
  if (process.env.BACKUP_UPLOAD_CMD) {
    console.log('[backup] 推送到远端…')
    execFileSync(process.env.BACKUP_UPLOAD_CMD, [gzFile], { stdio: 'inherit', shell: true })
  }

  const removed = await applyRetention()
  console.log(
    `[backup] 完成：${manifest.file}  ${(manifest.bytes / 1048576).toFixed(2)} MB  ` +
      `条目 ${entries}  sha256 ${manifest.sha256.slice(0, 12)}…  清理旧备份 ${removed} 个`,
  )
}

main().catch((err) => {
  console.error('[backup] 失败：', err.message)
  process.exit(1)
})
