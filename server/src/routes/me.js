import { Router } from 'express'
import { prisma } from '../db.js'
import { requireAuth } from '../auth.js'
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

/** 模拟支付网关：真实项目这里应该创建支付单并等回调 */
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

    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'paid', paidAt: new Date() },
    })

    await notify(req.user.id, {
      type: 'payment',
      title: '支付成功',
      body: `${order.game.title} · 已支付 ¥${order.amount}`,
      refId: order.game.id,
    })

    const fresh = await prisma.order.findUnique({
      where: { id: order.id },
      include: { game: { include: { venue: true } } },
    })
    res.json({ order: orderDTO(fresh) })
  } catch (err) {
    next(err)
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
