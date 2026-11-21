/**
 * 初始化演示数据。
 *   node server/prisma/seed.mjs --reset
 * 会清空并重建：用户 / 场馆 / 时段 / 球局 / 订单 / 动态 / 评论 / 通知
 */
import { prisma } from '../src/db.js'
import { dayAt } from '../src/util.js'

const reset = process.argv.includes('--reset')

const USERS = [
  { name: '林小羽', phone: '13800000000', level: 3.5, district: '浦东新区' },
  { name: '阿哲', phone: '13800000001', level: 4.2 },
  { name: '小铁', phone: '13800000002', level: 3.8 },
  { name: '木木', phone: '13800000003', level: 3.2, district: '徐汇区' },
  { name: '阿宽', phone: '13800000004', level: 2.6, district: '闵行区' },
  { name: '老K', phone: '13800000005', level: 4.0, district: '徐汇区' },
  { name: '豆豆', phone: '13800000006', level: 3.0 },
  { name: '张海', phone: '13800000007', level: 3.6, district: '杨浦区' },
  { name: '小满', phone: '13800000008', level: 2.2, district: '杨浦区' },
  { name: '大树', phone: '13800000009', level: 5.2 },
  { name: '米粒', phone: '13800000010', level: 3.9, district: '闵行区' },
  { name: '乐乐', phone: '13800000011', level: 1.8, district: '闵行区' },
]

const VENUES = [
  { key: 'v1', name: '羽动力运动中心', area: '浦东 · 世纪公园', distanceKm: 1.2, courts: 12, price: 60, tag: '标准木地板' },
  { key: 'v2', name: '羽林军球馆', area: '徐汇 · 漕河泾', distanceKm: 2.8, courts: 8, price: 45, tag: '新开 · 空调足' },
  { key: 'v3', name: '星河体育公园', area: '闵行 · 七宝', distanceKm: 3.5, courts: 16, price: 38, tag: '性价比高' },
  { key: 'v4', name: '羽你同行 · 滨江馆', area: '杨浦 · 五角场', distanceKm: 4.6, courts: 6, price: 55, tag: '江景球场' },
]

const SLOT_TIMES = ['10:00', '14:00', '19:30', '21:00']

/** 球局：date 用 offset 表示"今天 +N 天" */
const GAMES = [
  { venue: 'v1', off: 0, start: '19:30', dur: 120, mode: '双打', max: 4, lo: 3, hi: 5, fee: 35, host: '阿哲', players: ['阿哲', '小铁', '木木'], title: '周五夜 · 中级双打', note: '木地板 + 灯光好，球自带，场地费 AA。水平中级左右，能连续拉吊就行，不卷。' },
  { venue: 'v3', off: 0, start: '20:00', dur: 90, mode: '单打', max: 2, lo: 1.5, hi: 3.5, fee: 40, host: '阿宽', players: ['阿宽'], title: '新手单打 · 练多拍', note: '新手单打，主要练多拍和步伐，不嫌弃菜的来。' },
  { venue: 'v2', off: 1, start: '19:00', dur: 120, mode: '双打', max: 4, lo: 2.5, hi: 4.5, fee: 30, host: '老K', players: ['老K', '林小羽', '豆豆', '张海'], title: '周六晚 · 稳一点的双打', note: '固定球友局，差人时开放拼场。' },
  { venue: 'v4', off: 1, start: '10:00', dur: 120, mode: '6人转', max: 6, lo: 1, hi: 3, fee: 25, host: '小满', players: ['小满', '乐乐', '阿宽', '木木', '豆豆'], title: '新手友好 · 有人带热身', note: '完全新手也可以来，前 20 分钟有球友带热身和握拍。' },
  { venue: 'v1', off: 2, start: '18:30', dur: 120, mode: '8人转', max: 8, lo: 4, hi: 6, fee: 45, host: '大树', players: ['大树', '老K', '阿哲', '张海', '米粒', '小铁'], title: '周日黄昏 · 高手 8 人转', note: '按水平分两组，打完统计比分。' },
  { venue: 'v3', off: 3, start: '14:00', dur: 120, mode: '双打', max: 4, lo: 3, hi: 5, fee: 32, host: '米粒', players: ['米粒', '老K', '豆豆', '阿哲'], title: '下周一 · 午休双打', note: '已成局，有人请假会在圈里喊人。' },
]

async function main() {
  const existing = await prisma.user.count()
  if (existing > 0 && !reset) {
    console.log(`已有 ${existing} 个用户；要重新初始化请加 --reset`)
    return
  }

  if (reset) {
    console.log('清空现有数据…')
    await prisma.notification.deleteMany()
    await prisma.comment.deleteMany()
    await prisma.postLike.deleteMany()
    await prisma.post.deleteMany()
    await prisma.order.deleteMany()
    await prisma.gamePlayer.deleteMany()
    await prisma.game.deleteMany()
    await prisma.courtSlot.deleteMany()
    await prisma.venue.deleteMany()
    await prisma.refreshToken.deleteMany()
    await prisma.smsCode.deleteMany()
    await prisma.user.deleteMany()
  }

  const users = {}
  for (const u of USERS) {
    users[u.name] = await prisma.user.create({ data: u })
  }
  console.log(`用户 ${Object.keys(users).length} 个`)

  const venues = {}
  for (const v of VENUES) {
    venues[v.key] = await prisma.venue.create({
      data: {
        name: v.name,
        area: v.area,
        distanceKm: v.distanceKm,
        courts: v.courts,
        price: v.price,
        tag: v.tag,
      },
    })
  }
  console.log(`场馆 ${Object.keys(venues).length} 个`)

  // 未来 7 天 × 每天 4 个时段
  const slots = {}
  for (const v of VENUES) {
    for (let off = 0; off < 7; off += 1) {
      const date = dayAt(off)
      for (const start of SLOT_TIMES) {
        const slot = await prisma.courtSlot.create({
          data: {
            venueId: venues[v.key].id,
            date,
            startTime: start,
            duration: 120,
            price: v.price * 2,
          },
        })
        slots[`${v.key}|${date}|${start}`] = slot
      }
    }
  }
  console.log(`可订时段 ${Object.keys(slots).length} 个`)

  let paidCount = 0
  for (const g of GAMES) {
    const date = dayAt(g.off)
    const venue = venues[g.venue]
    const slot = slots[`${g.venue}|${date}|${g.start}`]

    const game = await prisma.game.create({
      data: {
        title: g.title,
        venueId: venue.id,
        slotId: slot?.id,
        date,
        startTime: g.start,
        duration: g.dur,
        mode: g.mode,
        maxPlayers: g.max,
        levelMin: g.lo,
        levelMax: g.hi,
        fee: g.fee,
        note: g.note,
        hostId: users[g.host].id,
        players: {
          create: g.players.map((name) => ({
            userId: users[name].id,
            isHost: name === g.host,
          })),
        },
      },
    })

    if (slot) {
      await prisma.courtSlot.update({ where: { id: slot.id }, data: { status: 'booked' } })
    }

    // 报名即生成 AA 订单：留一个人未支付，方便演示"去支付"
    for (const name of g.players) {
      const unpaid = g.title.includes('稳一点') && name === '林小羽'
      await prisma.order.create({
        data: {
          gameId: game.id,
          userId: users[name].id,
          amount: g.fee,
          status: unpaid ? 'unpaid' : 'paid',
          paidAt: unpaid ? null : new Date(Date.now() - 3600_000),
        },
      })
      if (!unpaid) paidCount += 1
    }
  }
  console.log(`球局 ${GAMES.length} 个，已支付订单 ${paidCount} 笔`)

  const p1 = await prisma.post.create({
    data: {
      authorId: users['阿哲'].id,
      text: '今晚 19:30 羽动力还差 1 个中级，能拉吊的那种。不来就变成 3 打 1 了。',
      commentCount: 1,
      likes: {
        create: ['小铁', '木木', '豆豆', '张海'].map((n) => ({ userId: users[n].id })),
      },
    },
  })
  await prisma.comment.create({
    data: {
      postId: p1.id,
      userId: users['小铁'].id,
      text: '我来，正好想试试新拍子。',
    },
  })

  await prisma.post.create({
    data: {
      authorId: users['小满'].id,
      text: '第一次打 6 人转，被带着热身＋纠正握拍，教练式球友真的存在。新手别怕，去就完事了。',
      commentCount: 0,
      likes: {
        create: ['乐乐', '阿宽', '木木', '豆豆', '林小羽', '老K'].map((n) => ({ userId: users[n].id })),
      },
    },
  })

  await prisma.post.create({
    data: {
      authorId: users['大树'].id,
      text: '周日黄昏 8 人转已满，这次按水平分两场打，结束后统计比分。下次想试试按双打组合打循环赛。',
      commentCount: 0,
      likes: { create: ['阿哲', '老K', '张海', '米粒', '小铁'].map((n) => ({ userId: users[n].id })) },
    },
  })
  console.log('动态 3 条')

  await prisma.notification.create({
    data: {
      userId: users['林小羽'].id,
      type: 'system',
      title: '欢迎来到羽球局',
      body: '大厅里已经有缺人的局了，点开卡片就能报名。记得先完成 AA 支付。',
    },
  })

  console.log('\n演示账号：林小羽 13800000000（验证码登录，DEV_SMS=true 时验证码直接返回）')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
