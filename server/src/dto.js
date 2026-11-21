/** 数据库行 → 前端 DTO（把 userId 展开、算 myRole / 支付状态等） */
import { addMinutes } from './util.js'

export const userDTO = (u) =>
  u && { id: u.id, name: u.name, level: u.level, district: u.district, phone: maskPhone(u.phone) }

const maskPhone = (p) => (p && p.length >= 11 ? `${p.slice(0, 3)}****${p.slice(-4)}` : p)

export const venueDTO = (v) => ({
  id: v.id,
  name: v.name,
  area: v.area,
  distanceKm: v.distanceKm,
  courts: v.courts,
  price: v.price,
  tag: v.tag,
})

export const slotDTO = (s) =>
  s && {
    id: s.id,
    venueId: s.venueId,
    date: s.date,
    startTime: s.startTime,
    duration: s.duration,
    price: s.price,
    status: s.status,
    gameId: s.game?.id || null,
  }

export function gameDTO(g, viewerId = null) {
  const players = g.players
    .map((p) => ({
      id: p.user.id,
      name: p.user.name,
      level: p.user.level,
      isHost: p.isHost,
      me: p.user.id === viewerId,
    }))
    .sort((a, b) => Number(b.isHost) - Number(a.isHost))

  const isFull = players.length >= g.maxPlayers
  const mine = players.find((p) => p.me)
  const myOrder = viewerId ? g.orders.find((o) => o.userId === viewerId) : null

  return {
    id: g.id,
    title: g.title,
    venueId: g.venueId,
    venue: g.venue ? venueDTO(g.venue) : null,
    slot: slotDTO(g.slot),
    date: g.date,
    startTime: g.startTime,
    endTime: addMinutes(g.startTime, g.duration),
    duration: g.duration,
    mode: g.mode,
    maxPlayers: g.maxPlayers,
    levelMin: g.levelMin,
    levelMax: g.levelMax,
    fee: g.fee,
    note: g.note,
    status: g.status,
    version: g.version,
    createdAt: g.createdAt,
    host: { id: g.host.id, name: g.host.name, level: g.host.level },
    players,
    playersCount: players.length,
    shortBy: Math.max(0, g.maxPlayers - players.length),
    isFull,
    myRole: g.hostId === viewerId ? 'host' : mine ? 'joined' : null,
    myOrder: myOrder ? { id: myOrder.id, amount: myOrder.amount, status: myOrder.status } : null,
    paidCount: g.orders.filter((o) => o.status === 'paid').length,
  }
}

export function postDTO(p, viewerId = null) {
  return {
    id: p.id,
    author: userDTO(p.author),
    text: p.text,
    likeCount: p.likes.length,
    liked: viewerId ? p.likes.some((l) => l.userId === viewerId) : false,
    commentCount: p.commentCount,
    createdAt: p.createdAt,
  }
}

export const commentDTO = (c) => ({
  id: c.id,
  postId: c.postId,
  author: userDTO(c.user),
  text: c.text,
  createdAt: c.createdAt,
})

export const orderDTO = (o) => ({
  id: o.id,
  amount: o.amount,
  status: o.status,
  paidAt: o.paidAt,
  refundedAt: o.refundedAt,
  createdAt: o.createdAt,
  game: o.game
    ? {
        id: o.game.id,
        title: o.game.title,
        date: o.game.date,
        startTime: o.game.startTime,
        status: o.game.status,
        venue: o.game.venue?.name || null,
      }
    : null,
})

export const notificationDTO = (n) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  refId: n.refId,
  read: !!n.readAt,
  createdAt: n.createdAt,
})
