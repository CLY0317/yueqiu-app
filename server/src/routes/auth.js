import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import {
  issueRefresh,
  requireAuth,
  revokeRefresh,
  rotateRefresh,
  sendSmsCode,
  signAccess,
  verifySmsCode,
} from '../auth.js'
import { userDTO } from '../dto.js'
import { HttpError } from '../util.js'

const router = Router()

const phoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不对')

/** 发送验证码（演示环境直接返回验证码） */
router.post('/sms', async (req, res, next) => {
  try {
    const phone = phoneSchema.parse(req.body?.phone)
    const devCode = await sendSmsCode(phone)
    res.json({ sent: true, devCode: devCode || undefined, expiresIn: 300 })
  } catch (err) {
    next(err)
  }
})

/** 验证码登录：不存在就注册 */
router.post('/login', async (req, res, next) => {
  try {
    const body = z
      .object({
        phone: phoneSchema,
        code: z.string().regex(/^\d{6}$/, '验证码是 6 位数字'),
        name: z.string().trim().min(1).max(20).optional(),
      })
      .parse(req.body)

    await verifySmsCode(body.phone, body.code)

    let user = await prisma.user.findUnique({ where: { phone: body.phone } })
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: body.phone,
          name: body.name || `球友${body.phone.slice(-4)}`,
        },
      })
    } else if (body.name && body.name !== user.name) {
      user = await prisma.user.update({ where: { id: user.id }, data: { name: body.name } })
    }

    res.json({
      accessToken: signAccess(user),
      refreshToken: await issueRefresh(user.id),
      user: userDTO(user),
    })
  } catch (err) {
    next(err)
  }
})

/** 刷新令牌轮换：旧 refresh 立即失效 */
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = z
      .object({ refreshToken: z.string().min(10) })
      .parse(req.body)

    const { userId, refreshToken: nextToken } = await rotateRefresh(refreshToken)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', '用户不存在')

    res.json({
      accessToken: signAccess(user),
      refreshToken: nextToken,
      user: userDTO(user),
    })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', async (req, res, next) => {
  try {
    await revokeRefresh(req.body?.refreshToken)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: userDTO(req.user) })
})

export default router
