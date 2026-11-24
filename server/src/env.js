/** 极简 .env 加载（不引 dotenv）：已存在的环境变量优先 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const file = path.join(ROOT, '.env')
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const value = m[2].replace(/^["']|["']$/g, '')
    if (process.env[m[1]] == null) process.env[m[1]] = value
  }
}

const num = (v, d) => (v == null || v === '' ? d : Number(v))
const bool = (v, d) => (v == null || v === '' ? d : v === 'true' || v === '1')

const isProd = process.env.NODE_ENV === 'production'

export const config = {
  port: num(process.env.PORT, 8787),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  accessTtl: num(process.env.ACCESS_TOKEN_TTL, 900),
  refreshDays: num(process.env.REFRESH_TOKEN_DAYS, 30),
  devSms: bool(process.env.DEV_SMS, false),
  isTest: process.env.NODE_ENV === 'test',
  isProd,
  // 支付回调需要外部可达的地址；本地开发可用内网穿透
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${num(process.env.PORT, 8787)}`).replace(/\/$/, ''),
  // 允许的跨域来源（逗号分隔）。生产环境必须显式配置，否则不放行任何来源。
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 是否允许 dev 短信通道（把验证码回显给前端）。生产环境永远为 false。
  allowDevSms: bool(process.env.ALLOW_DEV_SMS, false),
  // 限流。
  // 按手机号的额度要紧（防刷短信烧钱）；按 IP 的必须宽松——
  // 同一 NAT 出口的公司/校园里几十号人共用一个 IP，限太紧会误伤正常用户。
  // 防爆破主要靠验证码自身的 5 次尝试上限与 5 分钟有效期。
  rateLimit: {
    smsPerPhone: num(process.env.RATE_LIMIT_SMS_PER_PHONE, 5),
    smsPerIp: num(process.env.RATE_LIMIT_SMS_PER_IP, 100),
    loginPerIp: num(process.env.RATE_LIMIT_LOGIN_PER_IP, 60),
    apiPerIp: num(process.env.RATE_LIMIT_API_PER_IP, 300),
  },
  trustProxy: bool(process.env.TRUST_PROXY, false),
}

/**
 * 启动前的硬校验：配置不安全就直接拒绝启动。
 * 这些是"配错了就等于没有防护"的项，宁可起不来也不要静默降级。
 *
 * 注意：这里直接读 process.env（而不是用上面缓存的 config），
 * 因为校验必须针对**当前真实环境**，不能被模块加载时的快照带偏。
 */
export function assertProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return
  const problems = []

  const secret = env.JWT_SECRET || ''
  if (secret.length < 32) {
    problems.push('JWT_SECRET 必须是至少 32 位的随机字符串（当前缺失或过短）')
  }
  if (secret.includes('请替换') || secret === 'dev-secret' || secret.includes('change-me')) {
    problems.push('JWT_SECRET 还是示例占位符，必须换掉')
  }
  if (env.ALLOW_DEV_SMS === 'true' || env.DEV_SMS === 'true') {
    problems.push('生产环境不允许 dev 短信通道：请设置 ALLOW_DEV_SMS=false 且 DEV_SMS=false')
  }
  if (!env.SMS_PROVIDER || env.SMS_PROVIDER === 'dev') {
    problems.push('生产环境必须配置真实短信渠道 SMS_PROVIDER=aliyun')
  }
  const origins = String(env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!origins.length) {
    problems.push('生产环境必须配置 CORS_ORIGINS（逗号分隔的允许来源）')
  }
  if (!env.DATABASE_URL) {
    problems.push('缺少 DATABASE_URL')
  }

  if (problems.length) {
    const err = new Error(`生产环境配置校验失败：\n  - ${problems.join('\n  - ')}`)
    err.code = 'INVALID_PRODUCTION_CONFIG'
    throw err
  }
}
