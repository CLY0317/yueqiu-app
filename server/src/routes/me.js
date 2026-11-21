import { Router } from 'express'
import { prisma } from '../db.js'
import { requireAuth } from '../auth.js'
import { config } from '../env.js'
import { createPaymentChannel } from '../channels/payment.js'
import { gameDTO, notificationDTO, orderDTO, userDTO } from '../dto.js'
import { gameInclude } from './games.js'
import { notify } from '../notify.js'
import { conflict, notFound, today } from '../util.js'

const router = Router()

/* ------------------------------ 我的资料 ------------------------------ */

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id
    const games = await prisma.game.findMany({
      where: { status: 'open', players: { some: { userId } } },
      include: { players: true },
    })

    const month = today().slice(0, 7)
    const thisMonth = games.filter((g) => g.date.startsWith(month))

    const spend = await prisma.order.aggregate({
      where: { userId, status: 'paid' },
      _sum: { amount: true },
    })
    const unpaid = await prisma.order.count({ where: { userId, status: 'unpaid' } })

    const friends = new Set()
    games.forEach((g) => g.players.forEach((p) => p.userId !== userId && friends.add(p.userId)))

    res.json({
      user: userDTO(req.user),
      stats: {
        gamesThisMonth: thisMonth.length,
        spend: spend._sum.amount || 0,
        friends: friends.size,
        totalGames: games.length,
        unpaidOrders: unpaid,
        gamesToNextLevel: Math.max(0, 5 - games.length),
      },
    })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------ 我的球局 ------------------------------ */

router.get('/me/games', requireAuth, async (req, res, next) => {
  try {
    const role = req.query.role === 'joined' ? 'joined' : 'host'
    const where =
      role === 'host'
        ? { hostId: req.user.id, status: 'open' }
        : { status: 'open', players: { some: { userId: req.user.id } } }

    const games = await prisma.game.findMany({
      where,
      include: gameInclude,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })

    res.json({ role, games: games.map((g) => gameDTO(g, req.user.id)) })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------ 订单 & 支付 ------------------------------ */

router.get('/me/orders', requireAuth, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: { game: { include: { venue: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ orders: orders.map(orderDTO) })
  } catch (err) {
    next(err)
  }
})

/** 把订单置为已支付并推通知（dev 渠道与微信回调共用） */
async function markOrderPaid(order) {
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'paid', paidAt: new Date() },
  })
  await notify(order.userId, {
    type: 'payment',
    title: '支付成功',
    body: `${order.game?.title || '球局'} · 已支付 ¥${order.amount}`,
    refId: order.gameId,
  })
  return prisma.order.findUnique({
    where: { id: order.id },
    include: { game: { include: { venue: true } } },
  })
}

/**
 * 发起支付：
 * - dev 渠道直接置为已支付（模拟网关）
 * - wechat 渠道走 Native 下单，返回 code_url 给前端出二维码，真正的状态变更等回调
 */
router.post('/orders/:id/pay', requireAuth, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { game: true },
    })
    if (!order) throw notFound('订单不存在')
    if (order.userId !== req.user.id) throw conflict('FORBIDDEN', '这不是你的订单')
    if (order.status === 'paid') throw conflict('ALREADY_PAID', '这笔订单已经支付过了')
    if (order.status === 'refunded') throw conflict('ORDER_REFUNDED', '订单已退款')
    if (order.game.status !== 'open') throw conflict('GAME_CLOSED', '球局已解散，无需支付')

    const channel = createPaymentChannel()

    if (channel.name !== 'dev') {
      const { codeUrl } = await channel.createOrder({
        orderId: order.id,
        description: `${order.game.title} · AA 场地费`,
        amountFen: order.amount * 100,
        notifyUrl: `${config.publicBaseUrl}/api/pay/wechat/notify`,
      })
      const fresh = await prisma.order.findUnique({
        where: { id: order.id },
        include: { game: { include: { venue: true } } },
      })
      return res.json({ order: orderDTO(fresh), codeUrl })
    }

    res.json({ order: orderDTO(await markOrderPaid(order)) })
  } catch (err) {
    next(err)
  }
})

/**
 * 微信支付回调（公开路由，靠签名而不是登录态鉴权）。
 * 幂等：同一笔订单收到多次通知只生效一次；验签失败回 401，微信会重试。
 */
router.post('/pay/wechat/notify', async (req, res) => {
  try {
    const channel = createPaymentChannel()
    if (channel.name !== 'wechat') {
      return res.status(400).json({ code: 'FAIL', message: '未启用微信支付' })
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body)
    const info = await channel.parseNotify({ headers: req.headers, rawBody })

    if (info.tradeState !== 'SUCCESS') {
      return res.json({ code: 'SUCCESS', message: '非成功状态，已忽略' })
    }

    const order = await prisma.order.findUnique({
      where: { id: info.outTradeNo },
      include: { game: true },
    })
    if (!order) return res.status(404).json({ code: 'FAIL', message: '订单不存在' })
    if (order.amount * 100 !== info.totalFen) {
      return res.status(400).json({ code: 'FAIL', message: '金额与订单不一致' })
    }
    if (order.status === 'paid') {
      return res.json({ code: 'SUCCESS', message: '重复通知，幂等返回' })
    }

    await markOrderPaid(order)
    res.json({ code: 'SUCCESS' })
  } catch (err) {
    res.status(401).json({ code: 'FAIL', message: err.message })
  }
})

/* ------------------------------ 通知 ------------------------------ */

router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const [list, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    ])
    res.json({ notifications: list.map(notificationDTO), unread })
  } catch (err) {
    next(err)
  }
})

router.post('/notifications/read', requireAuth, async (req, res, next) => {
  try {
    const id = req.body?.id
    await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
