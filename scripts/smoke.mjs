/**
 * 对着一台已经跑起来的服务做一次快速体检（不需要 vitest）：
 *   node scripts/smoke.mjs
 * 默认打 http://127.0.0.1:8787，可用 API_BASE 覆盖。
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787/api'
const PHONE = process.env.SMOKE_PHONE || '13800000000'

let failed = 0
const ok = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) failed += 1
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data }
}

console.log('\n羽球局 API 冒烟\n')

const health = await call('/health')
ok('GET /health', health.status === 200 && health.data?.ok, JSON.stringify(health.data?.counts))

const sms = await call('/auth/sms', { method: 'POST', body: { phone: PHONE } })
ok('POST /auth/sms', sms.status === 200 && !!sms.data?.devCode, sms.data?.devCode ? '验证码已返回（DEV_SMS）' : '')

const login = await call('/auth/login', {
  method: 'POST',
  body: { phone: PHONE, code: sms.data?.devCode },
})
const token = login.data?.accessToken
ok('POST /auth/login', login.status === 200 && !!token, login.data?.user?.name)
ok('POST /auth/refresh', (await call('/auth/refresh', {
  method: 'POST',
  body: { refreshToken: login.data?.refreshToken },
})).status === 200)

const games = await call('/games')
ok('GET /games', games.status === 200 && Array.isArray(games.data?.games), `${games.data?.games?.length} 个局`)

const venues = await call('/venues')
const venue = venues.data?.venues?.[0]
ok('GET /venues', venues.status === 200 && !!venue, `${venues.data?.venues?.length} 个，今日可订 ${venue?.freeSlotsToday}`)

const date = games.data?.serverDate
const slots = await call(`/venues/${venue?.id}/slots?date=${date}`)
const free = slots.data?.slots?.filter((s) => s.status === 'free') || []
ok('GET /venues/:id/slots', slots.status === 200, `${free.length} 个空位`)

const me = await call('/me', { token })
ok('GET /me', me.status === 200, `本月 ${me.data?.stats?.gamesThisMonth} 场 · 待支付 ${me.data?.stats?.unpaidOrders} 笔`)

const feed = await call('/feed')
ok('GET /feed', feed.status === 200 && feed.data.posts.length > 0, `${feed.data?.posts?.length} 条动态`)

const notes = await call('/notifications', { token })
ok('GET /notifications', notes.status === 200, `未读 ${notes.data?.unread}`)

const orders = await call('/me/orders', { token })
ok('GET /me/orders', orders.status === 200, `${orders.data?.orders?.length} 笔订单`)

const unauth = await call('/games', { method: 'POST', body: {} })
ok('未登录写操作被拒', unauth.status === 401)

console.log(`\n${failed === 0 ? '全部通过 ✅' : failed + ' 项失败 ❌'}\n`)
process.exit(failed === 0 ? 0 : 1)
