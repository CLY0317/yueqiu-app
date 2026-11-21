import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './env.js'
import { prisma } from './db.js'
import { createSmsChannel } from './channels/sms.js'
import { HttpError } from './util.js'

/* ------------------------------ 访问令牌 ------------------------------ */

export function signAccess(user) {
  return jwt.sign({ sub: user.id, name: user.name }, config.jwtSecret, {
    expiresIn: config.accessTtl,
  })
}

export function verifyAccess(token) {
  try {
    return jwt.verify(token, config.jwtSecret)
  } catch {
    return null
  }
}

/* ------------------------------ 刷新令牌 ------------------------------ */

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex')

export async function issueRefresh(userId) {
  const token = crypto.randomBytes(48).toString('base64url')
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + config.refreshDays * 86_400_000),
    },
  })
  return token
}

/** 轮换：旧 token 立即作废，换发新的（防重放） */
export async function rotateRefresh(token) {
  const row = token
    ? await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } })
    : null

  if (!row || row.revokedAt || row.expiresAt < new Date()) {
    throw new HttpError(401, 'REFRESH_INVALID', '登录已过期，请重新登录')
  }

  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } })
  return { userId: row.userId, refreshToken: await issueRefresh(row.userId) }
}

export async function revokeRefresh(token) {
  if (!token) return
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/* ------------------------------ 短信验证码 ------------------------------ */

const SMS_TTL_MS = 5 * 60_000
const SMS_MAX_ATTEMPTS = 5

/** 冷却默认 60s；端到端测试里置 0 以便连续登录，生产不要动 */
const smsCooldownMs = () => Number(process.env.SMS_COOLDOWN_MS ?? SMS_TTL_MS / 5)

export async function sendSmsCode(phone) {
  const last = await prisma.smsCode.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  })
  if (last) {
    const wait = smsCooldownMs() - (Date.now() - last.createdAt.getTime())
    if (wait > 0) {
      throw new HttpError(429, 'SMS_TOO_FREQUENT', `太频繁了，${Math.ceil(wait / 1000)} 秒后再试`)
    }
  }

  const code = String(crypto.randomInt(100000, 1000000))
  await prisma.smsCode.create({
    data: { phone, code, expiresAt: new Date(Date.now() + SMS_TTL_MS) },
  })

  // dev 渠道把验证码回给前端；真实渠道（如阿里云）绝不回显
  const channel = createSmsChannel()
  await channel.send(phone, code)
  return channel.name === 'dev' ? code : null
}

export async function verifySmsCode(phone, code) {
  const row = await prisma.smsCode.findFirst({
    where: { phone, usedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!row || row.expiresAt < new Date()) {
    throw new HttpError(400, 'CODE_EXPIRED', '验证码已过期，请重新获取', 'code')
  }
  if (row.attempts >= SMS_MAX_ATTEMPTS) {
    throw new HttpError(429, 'CODE_TOO_MANY_ATTEMPTS', '尝试次数过多，请重新获取验证码', 'code')
  }
  if (row.code !== String(code)) {
    await prisma.smsCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    throw new HttpError(400, 'CODE_MISMATCH', '验证码不正确', 'code')
  }
  await prisma.smsCode.update({ where: { id: row.id }, data: { usedAt: new Date() } })
  return true
}

/* ------------------------------ 中间件 ------------------------------ */

function bearer(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

export async function optionalAuth(req, _res, next) {
  const payload = verifyAccess(bearer(req) || '')
  if (payload?.sub) {
    req.user = await prisma.user.findUnique({ where: { id: payload.sub } })
  }
  next()
}

export async function requireAuth(req, _res, next) {
  try {
    await optionalAuth(req, _res, () => {})
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', '请先登录')
    next()
  } catch (err) {
    next(err)
  }
}
