/**
 * 健康巡检 + 告警。
 *
 *   node scripts/watchdog.mjs            # 常驻巡检
 *   node scripts/watchdog.mjs --once     # 只查一次（给部署脚本用）
 *
 * 逻辑：连续失败 N 次才告警（避免抖动误报），恢复时再发一条「已恢复」。
 *
 * 告警通道（配一个就行，都支持）：
 *   ALERT_WEBHOOK=dingtalk:https://oapi.dingtalk.com/robot/send?access_token=xxx
 *   ALERT_WEBHOOK=wecom:https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
 *   ALERT_WEBHOOK=url:https://example.com/hook     # 自定义，POST {text}
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG_FILE = process.env.WATCHDOG_LOG || path.join(ROOT, 'logs', 'watchdog.log')

const HEALTH_URL = process.env.HEALTH_URL || 'http://127.0.0.1:8787/api/health'
const INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS || 30_000)
const FAIL_THRESHOLD = Number(process.env.WATCHDOG_FAIL_THRESHOLD || 3)
const TIMEOUT_MS = Number(process.env.WATCHDOG_TIMEOUT_MS || 5_000)
const WEBHOOK = process.env.ALERT_WEBHOOK || ''

let consecutiveFailures = 0
let alerting = false

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`
  console.log(text)
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, text + '\n')
  } catch {
    /* 日志写不进去也不能影响巡检本身 */
  }
}

/** 检查一次健康端点 */
async function check() {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(HEALTH_URL, { signal: ac.signal })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const body = await res.json().catch(() => null)
    if (!body?.ok) return { ok: false, reason: `健康检查返回 ${JSON.stringify(body)}` }
    return { ok: true, counts: body.counts }
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? `超时 ${TIMEOUT_MS}ms` : err.cause?.code || err.message }
  } finally {
    clearTimeout(timer)
  }
}

/** 发告警 */
async function alert(title, body, isError = true) {
  const text = `【羽球局】${title}\n${body}`
  log(`ALERT ${title} :: ${body}`)

  if (!WEBHOOK) {
    log('（未配置 ALERT_WEBHOOK，只记本地日志）')
    return
  }
  try {
    const [kind, ...rest] = WEBHOOK.split(':')
    const url = rest.join(':')
    let payload
    if (kind === 'dingtalk') {
      payload = { msgtype: 'text', text: { content: text } }
    } else if (kind === 'wecom') {
      payload = { msgtype: 'text', text: { content: text } }
    } else {
      payload = { text }
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    })
    log(`  告警已发送：${res.status} ${(await res.text()).slice(0, 120)}`)
  } catch (err) {
    log(`  告警发送失败：${err.cause?.code || err.message}`)
  }
}

async function tick() {
  const result = await check()
  if (result.ok) {
    if (alerting) {
      await alert('服务已恢复', `健康检查恢复正常：${JSON.stringify(result.counts)}`, false)
      alerting = false
    }
    consecutiveFailures = 0
    log(`健康 ✓ ${JSON.stringify(result.counts)}`)
    return true
  }

  consecutiveFailures += 1
  log(`健康 ✗ ${result.reason}（连续第 ${consecutiveFailures} 次）`)
  if (consecutiveFailures >= FAIL_THRESHOLD && !alerting) {
    alerting = true
    await alert(
      '服务不可用',
      `健康检查连续 ${consecutiveFailures} 次失败：${result.reason}\n地址：${HEALTH_URL}\n时间：${new Date().toLocaleString('zh-CN')}`,
    )
  }
  return false
}

async function main() {
  if (process.argv.includes('--once')) {
    const r = await check()
    console.log(JSON.stringify({ url: HEALTH_URL, ok: r.ok, reason: r.reason || null, counts: r.counts || null }))
    process.exit(r.ok ? 0 : 1)
  }

  log(`巡检启动：${HEALTH_URL}，间隔 ${INTERVAL_MS / 1000}s，连续失败 ${FAIL_THRESHOLD} 次告警`)
  // 启动时先查一次
  await tick()
  setInterval(() => {
    tick().catch((err) => log(`巡检自身异常：${err.message}`))
  }, INTERVAL_MS)
}

main().catch((err) => {
  console.error('[watchdog] 启动失败：', err.message)
  process.exit(1)
})
