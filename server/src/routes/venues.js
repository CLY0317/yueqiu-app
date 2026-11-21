import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { venueDTO, slotDTO } from '../dto.js'
import { notFound, today } from '../util.js'

const router = Router()

/** 场馆列表（带今天可订时段数） */
router.get('/', async (_req, res, next) => {
  try {
    const date = today()
    const venues = await prisma.venue.findMany({ orderBy: { distanceKm: 'asc' } })
    const counts = await prisma.courtSlot.groupBy({
      by: ['venueId'],
      where: { date, status: 'free' },
      _count: { _all: true },
    })
    const freeMap = new Map(counts.map((c) => [c.venueId, c._count._all]))
    res.json({
      venues: venues.map((v) => ({ ...venueDTO(v), freeSlotsToday: freeMap.get(v.id) || 0 })),
    })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const venue = await prisma.venue.findUnique({ where: { id: req.params.id } })
    if (!venue) throw notFound('场馆不存在')
    res.json({ venue: venueDTO(venue) })
  } catch (err) {
    next(err)
  }
})

/** 某天的可订时段（含已被订走的，前端置灰） */
router.get('/:id/slots', async (req, res, next) => {
  try {
    const date = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default(today())
      .parse(req.query.date || today())

    const venue = await prisma.venue.findUnique({ where: { id: req.params.id } })
    if (!venue) throw notFound('场馆不存在')

    const slots = await prisma.courtSlot.findMany({
      where: { venueId: venue.id, date },
      orderBy: { startTime: 'asc' },
      include: { game: { select: { id: true } } },
    })

    res.json({
      date,
      venue: venueDTO(venue),
      slots: slots.map((s) => ({ ...slotDTO(s), gameId: s.game?.id || null })),
    })
  } catch (err) {
    next(err)
  }
})

export default router
