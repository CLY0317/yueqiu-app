import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

process.env.DATABASE_URL ||= 'postgresql://yueqiu:yueqiu@127.0.0.1:5432/yueqiu_test?schema=public'
process.env.NODE_ENV ||= 'test'
process.env.ALLOW_DEV_SMS = 'true'
process.env.SMS_PROVIDER = 'dev'

const { createApp } = await import('../server/src/index.js')
const { prisma } = await import('../server/src/db.js')
const { createSmsChannel } = await import('../server/src/channels/sms.js')

const app = createApp()

async function login(phone, name) {
  const sms = await request(app).post('/api/auth/sms').send({ phone })
  expect(sms.status).toBe(200)
  const res = await request(app).post('/api/auth/login').send({ phone, code: sms.body.devCode, name })
  return res.body
}

describe('短信通道：dev 默认关闭、生产环境禁用', () => {
  it('没显式开 ALLOW_DEV_SMS 时，dev 通道拒绝启用', () => {
    expect(() => createSmsChannel({ NODE_ENV: 'development' })).toThrow(/ALLOW_DEV_SMS/)
  })

  it('生产环境无论如何都拒绝 dev 通道', () => {
    expect(() =>
      createSmsChannel({ NODE_ENV: 'production', SMS_PROVIDER: 'dev', ALLOW_DEV_SMS: 'true' }),
    ).toThrow(/生产环境/)
  })

  it('显式开启后 dev 通道可用', () => {
    expect(createSmsChannel({ NODE_ENV: 'development', ALLOW_DEV_SMS: 'true' }).name).toBe('dev')
  })
})

describe('生产配置硬校验', () => {
  it('配置不安全时直接抛错，不静默降级', async () => {
    const { assertProductionConfig } = await import('../server/src/env.js')
    const saved = { ...process.env }
    try {
      process.env.NODE_ENV = 'production'
      process.env.JWT_SECRET = 'short'
      process.env.SMS_PROVIDER = 'dev'
      process.env.ALLOW_DEV_SMS = 'true'
      process.env.CORS_ORIGINS = ''
      expect(() => assertProductionConfig()).toThrow(/JWT_SECRET|短信|CORS/)

      // 全部配齐后通过
      process.env.JWT_SECRET = 'x'.repeat(48)
      process.env.SMS_PROVIDER = 'aliyun'
      process.env.ALLOW_DEV_SMS = 'false'
      process.env.DEV_SMS = 'false'
      process.env.CORS_ORIGINS = 'https://example.com'
      expect(() => assertProductionConfig()).not.toThrow()
    } finally {
      Object.assign(process.env, saved)
    }
  })
})

describe('限流', () => {
  it('同一手机号发码超过上限后被拦截', async () => {
    const phone = '13911119999'
    const codes = []
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).post('/api/auth/sms').send({ phone })
      codes.push(res.status)
      if (res.status === 429 && res.body?.error?.code === 'SMS_RATE_LIMITED') {
        expect(i).toBeGreaterThan(0)
        return
      }
    }
    throw new Error(`限流没有生效，状态码序列：${codes.join(',')}`)
  })
})

describe('注销账号', () => {
  it('删除个人数据、取消ta主持的局、给其他球友退款并通知', async () => {
    const host = await login('13911117701', '要注销的人')
    const guest = await login('13911117702', '留下的球友')

    // 发起人建一个局（订场，验证场地会被释放）
    const venue = await prisma.venue.findFirst()
    const today = new Date()
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const slot = await prisma.courtSlot.create({
      data: { venueId: venue.id, date: ymd, startTime: '18:00', duration: 120, price: 100, status: 'free' },
    })

    const created = await request(app)
      .post('/api/games')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({
        venueId: venue.id,
        slotId: slot.id,
        date: ymd,
        startTime: '18:00',
        duration: 120,
        mode: '双打',
        level: 3.5,
        fee: 40,
        title: '要注销的局',
      })
    expect(created.status).toBe(201)
    const gameId = created.body.game.id

    // 球友报名并支付
    await request(app)
      .post(`/api/games/${gameId}/join`)
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .send({ expectedVersion: created.body.game.version })
    const guestGame = await prisma.game.findUnique({ where: { id: gameId }, include: { orders: true } })
    const guestOrder = guestGame.orders.find((o) => o.userId === guest.user.id)
    expect(guestOrder.status).toBe('unpaid')

    await request(app)
      .post(`/api/orders/${guestOrder.id}/pay`)
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .send({})
    expect((await prisma.order.findUnique({ where: { id: guestOrder.id } })).status).toBe('paid')

    // 注销
    const del = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({})
    expect(del.status).toBe(200)
    expect(del.body.ok).toBe(true)

    // 人没了
    expect(await prisma.user.findUnique({ where: { id: host.user.id } })).toBeNull()
    // 短信记录也清了
    expect(await prisma.smsCode.count({ where: { phone: '13911117701' } })).toBe(0)

    // 局被取消，场地被释放
    const game = await prisma.game.findUnique({ where: { id: gameId } })
    expect(game.status).toBe('cancelled')
    expect(game.hostId).not.toBe(host.user.id) // 挂到了系统占位账号
    expect((await prisma.courtSlot.findUnique({ where: { id: slot.id } })).status).toBe('free')

    // 球友的订单已退款，并且收到了通知
    const order = await prisma.order.findUnique({ where: { id: guestOrder.id } })
    expect(order.status).toBe('refunded')
    expect(order.refundedAt).not.toBeNull()

    const notes = await prisma.notification.findMany({ where: { userId: guest.user.id } })
    expect(notes.some((n) => n.title === '有球局被解散了')).toBe(true)
  })

  it('未登录不能注销', async () => {
    const res = await request(app).delete('/api/me').send({})
    expect(res.status).toBe(401)
  })
})
