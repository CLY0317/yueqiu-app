/**
 * 一条命令同时起 API 和前端开发服务器。
 *   node scripts/dev.mjs      (或 npm run dev)
 *
 * 这里直接用 node 执行 vite 的入口，而不是走 node_modules/.bin 的 .cmd 垫片，
 * 这样在没把 node 加进 PATH 的环境里也能跑。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

if (!fs.existsSync(viteBin)) {
  console.error('没有找到 vite，先安装依赖：pnpm install（或 npm install）')
  process.exit(1)
}

const children = []

function run(label, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${label}] 退出，code=${code}`)
      shutdown(code)
    }
  })
  children.push(child)
  return child
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill()
    } catch {
      /* ignore */
    }
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('──────────────────────────────────────────────')
console.log('  羽球局 dev')
console.log('  API   http://127.0.0.1:8787')
console.log('  Web   http://127.0.0.1:5173')
console.log('──────────────────────────────────────────────')

run('api', ['--watch', path.join(root, 'server', 'src', 'index.js')])
run('web', [viteBin, '--config', 'web/vite.config.js'])
