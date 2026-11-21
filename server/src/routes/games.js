import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { optionalAuth, requireAuth } from '../auth.js'
import { gameDTO } from '../dto.js'
import { notify } from '../notify.js'
import { bad, conflict, isWeekend, lvName, notFound, today } from '../util.js'

const router = Router()

export const gameInclude = {
  venue: true,
  slot: true,
  host: true,
  players: { include: { user: true } },
  orders: true,
}

const MODES = { 单打: 2, 双打: 4, '6人转': 6, '8人转': 8 }
const DURATIONS = [60, 90, 120, 150, 180]

const createSchema = z.object({
  venueId: z.string().min(1, '请选择场馆'),
  slotId: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式不对'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '开始时间格式不对'),
  duration: z.number().int().refine((v) => DURATIONS.includes(v), '时长只能是 1 / 1.5 / 2 / 2.5 / 3 小时'),
  mode: z.enum(['单打', '双打', '6人转', '8人转'], { message: '模式不正确' }),
  level: z.number().min(1, '水平需要在 1–9 级之间').max(9, '水平需要在 1–9 级之间'),
  fee: z.number().int().min(0).max(500),
  title: z.string().trim().max(40, '局名最多 40 个字').optional(),
  note: z.string().trim().max(200, '备注最多 200 个字').optional(),
})

/* ------------------------------ 列表 ------------------------------ */

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const filter = String(req.query.filter || 'all')
    const keyword = String(req.query.q || '').trim()

    const rows = await prisma.game.findMany({
      where: { status: 'open', date: { gte: today() } },
      include: gameInclude,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })

    const games = rows
      .filter((g) => {
        if (filter === 'today' && g.date !== today()) return false
        if (filter === 'weekend' && !isWeekend(g.date)) return false
        if (filter === 'newbie' && g.levelMin > 2.5) return false
        if (filter === 'need' && g.players.length >= g.maxPlayers) return false
        if (keyword) {
          const hay = `${g.title} ${g.venue?.name || ''} ${g.venue?.area || ''}`
          if (!hay.includes(keyword)) return false
        }
        return true
      })
      .map((g) => gameDTO(g, req.user?.id || null))

    res.json({ games, total: games.length, serverDate: today() })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const game = await prisma.game.findUnique({
      where: { id: req.params.id },
      include: gameInclude,
    })
    if (!game) throw notFound('这个局不存在或已解散')
    res.json({ game: gameDTO(game, req.user?.id || null) })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------ 发起 ------------------------------ */

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body)
    if (data.date < today()) throw bad('不能发起已经过去的时间', 'date')

    const maxPlayers = MODES[data.mode]
    const levelMin = Math.max(1, data.level - 1)
    const levelMax = Math.min(9, data.level + 1)
    const title = data.title || `${lvName(data.level)} · ${data.mode} · 来组个局`

    const gameId = await prisma.$transaction(async (tx) => {
      const venue = await tx.venue.findUnique({ where: { id: data.venueId } })
      if (!venue) throw bad('场馆不存在', 'venueId')

      let slotId = null
      if (data.slotId) {
        const slot = await tx.courtSlot.findUnique({ where: { id: data.slotId } })
        if (!slot) throw bad('时段不存在', 'slotId')
        if (slot.status !== 'free') throw conflict('SLOT_TAKEN', '这个时段刚被订走了，换一个吧')
        if (
          slot.venueId !== data.venueId ||
          slot.date !== data.date ||
          slot.startTime !== data.startTime
        ) {
          throw bad('时段与球局信息不一致，请重新选择', 'slotId')
        }
        slotId = slot.id
      }

      const game = await tx.game.create({
        data: {
          title,
          venueId: data.venueId,
          slotId,
          date: data.date,
          startTime: data.startTime,
          duration: data.duration,
          mode: data.mode,
          maxPlayers,
          levelMin,
          levelMax,
          fee: data.fee,
          note: data.note || '',
          hostId: req.user.id,
          players: { create: { userId: req.user.id, isHost: true } },
          orders: { create: { userId: req.user.id, amount: data.fee } },
        },
      })

      if (slotId) {
        await tx.courtSlot.update({ where: { id: slotId }, data: { status: 'booked' } })
      }
      return game.id
    })

    const game = await prisma.game.findUnique({ where: { id: gameId }, include: gameInclude })
    res.status(201).json({ game: gameDTO(game, req.user.id) })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------ 报名 / 退出 ------------------------------ */

router.post('/:id/join', requireAuth, async (req, res, next) => {
  try {
    const expected = req.body?.expectedVersion

    const { game, hostId } = await prisma.$transaction(async (tx) => {
      const g = await tx.game.findUnique({
        where: { id: req.params.id },
        include: { players: true },
      })
      if (!g || g.status !== 'open') throw notFound('这个局不存在或已解散')

      if (expected != null && Number(expected) !== g.version) {
        throw conflict('VERSION_CONFLICT', '有人刚刚加入了，名额有变化，请刷新后再试')
      }
      if (g.hostId === req.user.id) throw conflict('ALREADY_HOST', '发起人不用报名')
      if (g.players.some((p) => p.userId === req.user.id)) {
        throw conflict('ALREADY_JOINED', '你已经在这个局里了')
      }
      if (g.players.length >= g.maxPlayers) {
        throw conflict('GAME_FULL', '手慢了，这个局刚刚满员')
      }

      await tx.gamePlayer.create({ data: { gameId: g.id, userId: req.user.id } })
      await tx.order.create({ data: { gameId: g.id, userId: req.user.id, amount: g.fee } })
      const updated = await tx.game.update({
        where: { id: g.id },
        data: { version: { increment: 1 } },
        include: gameInclude,
      })
      return { game: updated, hostId: g.hostId }
    })

    await notify(hostId, {
      type: 'game_join',
      title: `${req.user.name} 报名了你的局`,
      body: `${game.title} · ${game.date} ${game.startTime}`,
      refId: game.id,
    })

    res.json({ game: gameDTO(game, req.user.id) })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/leave', requireAuth, async (req, res, next) => {
  try {
    const game = await prisma.$transaction(async (tx) => {
      const g = await tx.game.findUnique({
        where: { id: req.params.id },
        include: { players: true, orders: true },
      })
      if (!g || g.status !== 'open') throw notFound('这个局不存在或已解散')
      if (g.hostId === req.user.id) throw conflict('IS_HOST', '你是发起人，请改用"解散这个局"')

      const player = g.players.find((p) => p.userId === req.user.id)
      if (!player) throw conflict('NOT_JOINED', '你还没报名这个局')

      await tx.gamePlayer.delete({
        where: { gameId_userId: { gameId: g.id, userId: req.user.id } },
      })

      const order = g.orders.find((o) => o.userId === req.user.id)
      if (order) {
        if (order.status === 'paid') {
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'refunded', refundedAt: new Date() },
          })
        } else if (order.status === 'unpaid') {
          await tx.order.delete({ where: { id: order.id } })
        }
      }

      return tx.game.update({
        where: { id: g.id },
        data: { version: { increment: 1 } },
        include: gameInclude,
      })
    })

    res.json({ game: gameDTO(game, req.user.id) })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------ 解散 ------------------------------ */

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { game, refunded, notifyList } = await prisma.$transaction(async (tx) => {
      const g = await tx.game.findUnique({
        where: { id: req.params.id },
        include: { players: { include: { user: true } }, orders: true, slot: true },
      })
      if (!g) throw notFound('这个局不存在或已解散')
      if (g.hostId !== req.user.id) throw conflict('FORBIDDEN', '只有发起人才能解散这个局')
      if (g.status !== 'open') throw conflict('ALREADY_CANCELLED', '这个局已经解散过了')

      const paid = g.orders.filter((o) => o.status === 'paid')
      if (paid.length) {
        await tx.order.updateMany({
          where: { id: { in: paid.map((o) => o.id) } },
          data: { status: 'refunded', refundedAt: new Date() },
        })
      }
      if (g.slotId) {
        await tx.courtSlot.update({ where: { id: g.slotId }, data: { status: 'free' } })
      }
      const updated = await tx.game.update({
        where: { id: g.id },
        data: { status: 'cancelled', version: { increment: 1 } },
      })

      return {
        game: updated,
        refunded: paid.reduce((s, o) => s + o.amount, 0),
        notifyList: g.players.filter((p) => p.userId !== req.user.id).map((p) => p.userId),
      }
    })

    await Promise.all(
      notifyList.map((uid) =>
        notify(uid, {
          type: 'game_cancel',
          title: '有球局被解散了',
          body: `${game.title} · ${game.date} ${game.startTime}，已缴纳的费用已原路退回`,
          refId: game.id,
        }),
      ),
    )

    res.json({ ok: true, refunded: refunded })
  } catch (err) {
    next(err)
  }
})

export default router
