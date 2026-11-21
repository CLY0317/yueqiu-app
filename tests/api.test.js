import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

process.env.DATABASE_URL ||= 'postgresql://yueqiu:yueqiu@127.0.0.1:5432/yueqiu_test?schema=public'
process.env.NODE_ENV ||= 'test'

const { createApp } = await import('../server/src/index.js')
const { prisma } = await import('../server/src/db.js')

const app = createApp()

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = ymd(new Date())

async function login(phone, name) {
  const sms = await request(app).post('/api/auth/sms').send({ phone })
  expect(sms.status).toBe(200)
  const res = await request(app)
    .post('/api/auth/login')
    .send({ phone, code: sms.body.devCode, name })
  return res.body
}

const host = {} // { user, accessToken, refreshToken }
const p1 = {}
const p2 = {}

let venue
let freeSlot
let secondSlot
let game

beforeAll(async () => {
  Object.assign(host, await login('13911110001', '房主甲'))
  Object.assign(p1, await login('13911110002', '球友乙'))
  Object.assign(p2, await login('13911110003', '球友丙'))
})

describe('认证', () => {
  it('健康检查返回各表条数', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.counts.users).toBeGreaterThan(0)
  })

  it('未登录的写操作返回 401', async () => {
    const res = await request(app).post('/api/games').send({})
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('验证码有 60 秒冷却', async () => {
    const phone = '13911110009'
    expect((await request(app).post('/api/auth/sms').send({ phone })).status).toBe(200)
    const again = await request(app).post('/api/auth/sms').send({ phone })
    expect(again.status).toBe(429)
    expect(again.body.error.code).toBe('SMS_TOO_FREQUENT')
  })

  it('验证码错误被拒绝', async () => {
    const phone = '13911110008'
    await request(app).post('/api/auth/sms').send({ phone })
    const res = await request(app).post('/api/auth/login').send({ phone, code: '000000' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CODE_MISMATCH')
  })

  it('登录返回 access + refresh + 用户信息', () => {
    expect(host.accessToken).toBeTruthy()
    expect(host.refreshToken).toBeTruthy()
    expect(host.user.name).toBe('房主甲')
    expect(host.user.phone).toContain('****')
  })

  it('refresh 轮换后旧令牌立即失效', async () => {
    const first = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: host.refreshToken })
    expect(first.status).toBe(200)
    expect(first.body.accessToken).toBeTruthy()

    const replay = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: host.refreshToken })
    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('REFRESH_INVALID')

    host.refreshToken = first.body.refreshToken
    host.accessToken = first.body.accessToken
  })

  it('带 token 可以拿到 /auth/me', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${host.accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(host.user.id)
  })
})

describe('场馆与时段', () => {
  it('场馆列表带今日可订时段数', async () => {
    const res = await request(app).get('/api/venues')
    expect(res.status).toBe(200)
    expect(res.body.venues.length).toBeGreaterThan(0)
    venue = res.body.venues[0]
    expect(venue.freeSlotsToday).toBeGreaterThan(0)
  })

  it('按日期查时段', async () => {
    const res = await request(app).get(`/api/venues/${venue.id}/slots?date=${today}`)
    expect(res.status).toBe(200)
    expect(res.body.slots.length).toBeGreaterThanOrEqual(2)
    const free = res.body.slots.filter((s) => s.status === 'free')
    expect(free.length).toBeGreaterThanOrEqual(2)
    freeSlot = free[0]
    secondSlot = free[1]
  })
})

describe('球局 + 场地 + 订单', () => {
  it('发起球局会占用时段并生成待支付订单', async () => {
    const res = await request(app)
      .post('/api/games')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({
        venueId: venue.id,
        slotId: freeSlot.id,
        date: today,
        startTime: freeSlot.startTime,
        duration: 120,
        mode: '双打',
        level: 3.5,
        fee: 40,
        note: '测试局',
      })

    expect(res.status).toBe(201)
    game = res.body.game
    expect(game.myRole).toBe('host')
    expect(game.slot.id).toBe(freeSlot.id)
    expect(game.myOrder.status).toBe('unpaid')

    const slot = await prisma.courtSlot.findUnique({ where: { id: freeSlot.id } })
    expect(slot.status).toBe('booked')
  })

  it('同一时段不能被重复预订', async () => {
    const res = await request(app)
      .post('/api/games')
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .send({
        venueId: venue.id,
        slotId: freeSlot.id,
        date: today,
        startTime: freeSlot.startTime,
        duration: 120,
        mode: '双打',
        level: 3,
        fee: 30,
      })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SLOT_TAKEN')
  })

  it('报名生成 AA 订单，重复报名与版本冲突都被拦', async () => {
    const join = await request(app)
      .post(`/api/games/${game.id}/join`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .send({ expectedVersion: game.version })

    expect(join.status).toBe(200)
    expect(join.body.game.playersCount).toBe(2)
    expect(join.body.game.myOrder.status).toBe('unpaid')

    const again = await request(app)
      .post(`/api/games/${game.id}/join`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .send({})
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('ALREADY_JOINED')

    const stale = await request(app)
      .post(`/api/games/${game.id}/join`)
      .set('Authorization', `Bearer ${p2.accessToken}`)
      .send({ expectedVersion: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
  })

  it('支付订单后状态变 paid，重复支付被拒', async () => {
    const detail = await request(app)
      .get(`/api/games/${game.id}`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
    const orderId = detail.body.game.myOrder.id

    const pay = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
    expect(pay.status).toBe(200)
    expect(pay.body.order.status).toBe('paid')

    const again = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('ALREADY_PAID')
  })

  it('退出报名会把已付的钱退回', async () => {
    const res = await request(app)
      .post(`/api/games/${game.id}/leave`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body.game.playersCount).toBe(1)

    const order = await prisma.order.findFirst({
      where: { gameId: game.id, userId: p1.user.id },
    })
    expect(order.status).toBe('refunded')
    expect(order.refundedAt).toBeTruthy()
  })

  it('解散球局会释放时段并给所有人退款', async () => {
    const join = await request(app)
      .post(`/api/games/${game.id}/join`)
      .set('Authorization', `Bearer ${p2.accessToken}`)
      .send({})
    expect(join.status).toBe(200)

    const orderId = join.body.game.myOrder.id
    await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${p2.accessToken}`)
      .expect(200)

    const del = await request(app)
      .delete(`/api/games/${game.id}`)
      .set('Authorization', `Bearer ${host.accessToken}`)
    expect(del.status).toBe(200)
    expect(del.body.refunded).toBe(40)

    const slot = await prisma.courtSlot.findUnique({ where: { id: freeSlot.id } })
    expect(slot.status).toBe('free')

    const cancelled = await prisma.game.findUnique({ where: { id: game.id } })
    expect(cancelled.status).toBe('cancelled')

    const list = await request(app).get('/api/games')
    expect(list.body.games.some((g) => g.id === game.id)).toBe(false)
  })

  it('非发起人不能解散别人的局', async () => {
    const created = await request(app)
      .post('/api/games')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({
        venueId: venue.id,
        slotId: secondSlot.id,
        date: today,
        startTime: secondSlot.startTime,
        duration: 120,
        mode: '单打',
        level: 2,
        fee: 20,
      })
    expect(created.status).toBe(201)

    const res = await request(app)
      .delete(`/api/games/${created.body.game.id}`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('球友圈 + 通知', () => {
  let postId

  it('发动态', async () => {
    const res = await request(app)
      .post('/api/feed')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({ text: '测试动态：今晚有局吗' })
    expect(res.status).toBe(201)
    postId = res.body.post.id
    expect(res.body.post.commentCount).toBe(0)
  })

  it('空内容被校验拦住', async () => {
    const res = await request(app)
      .post('/api/feed')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({ text: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.error.field).toBe('text')
  })

  it('评论会累加计数并通知作者', async () => {
    const res = await request(app)
      .post(`/api/posts/${postId}/comments`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .send({ text: '我来一个' })
    expect(res.status).toBe(201)
    expect(res.body.comment.author.name).toBe('球友乙')

    const comments = await request(app).get(`/api/posts/${postId}/comments`)
    expect(comments.body.total).toBe(1)

    const notes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${host.accessToken}`)
    expect(notes.body.notifications.some((n) => n.type === 'comment')).toBe(true)
    expect(notes.body.unread).toBeGreaterThan(0)
  })

  it('点赞是幂等切换', async () => {
    const a = await request(app)
      .post(`/api/feed/${postId}/like`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
    expect(a.body.post.liked).toBe(true)
    expect(a.body.post.likeCount).toBe(1)

    const b = await request(app)
      .post(`/api/feed/${postId}/like`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
    expect(b.body.post.liked).toBe(false)
    expect(b.body.post.likeCount).toBe(0)
  })

  it('通知可以标记已读', async () => {
    const before = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${host.accessToken}`)
    expect(before.body.unread).toBeGreaterThan(0)

    await request(app)
      .post('/api/notifications/read')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({})
      .expect(200)

    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${host.accessToken}`)
    expect(after.body.unread).toBe(0)
  })
})

describe('我的', () => {
  it('/me 返回聚合统计', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${host.accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body.stats).toHaveProperty('gamesThisMonth')
    expect(res.body.stats).toHaveProperty('spend')
    expect(res.body.stats).toHaveProperty('friends')
  })

  it('订单列表包含已退款与已支付', async () => {
    const res = await request(app)
      .get('/api/me/orders')
      .set('Authorization', `Bearer ${p1.accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body.orders.length).toBeGreaterThan(0)
    expect(res.body.orders.every((o) => o.game)).toBe(true)
  })
})
