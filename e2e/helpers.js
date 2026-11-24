import { expect } from '@playwright/test'

/**
 * e2e 公共助手。
 *
 * 手机号必须是**每次运行都不一样**的：
 * - 固定号码会被上一轮留下的状态污染（该账号已经报名过、订单已经付过），用例就不再可重复运行；
 * - 撞上 60 秒短信冷却时，同号会直接 429。
 * 这里用「时间戳 + 随机后缀」凑出 11 位，且登录框有 maxLength={11}，
 * 多一位会被静默截断（序号位被砍掉 → 所有用例拿到同一个号），所以自己先断言位数。
 */

const RUN = String(Date.now()).slice(-5)
let n = 0

export function newPhone() {
  n = (n + 1) % 1000
  const phone = `139${RUN}${String(n).padStart(3, '0')}`
  if (phone.length !== 11) throw new Error(`手机号必须是 11 位，实际 ${phone.length} 位：${phone}`)
  return phone
}

/** 局名 / 动态文案用的唯一标记 */
export const stamp = () => String(Date.now()).slice(-6)

/** 今天 + offset 天，格式 YYYY-MM-DD */
export function ymd(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function login(page, phone) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '羽球局' })).toBeVisible()
  await page.getByPlaceholder('11 位手机号').fill(phone)
  await page.getByRole('button', { name: '获取验证码' }).click()
  // dev 短信通道会把验证码回填到输入框。
  // 这里断言输入框，而不是断言"演示环境已自动填入"那段提示——
  // 那段提示受 DEMO_MODE 控制，生产构建里不渲染。
  await expect(page.getByPlaceholder('6 位验证码')).toHaveValue(/^\d{6}$/)
  await page.getByRole('button', { name: /登录 \/ 注册/ }).click()
  await expect(page.locator('.tabbar')).toBeVisible()
}

export const tab = (page, name) => page.locator('.tabbar a', { hasText: name })

/** 关闭底部弹层：弹层打开时遮罩会挡住底部 tab，必须先关掉才能切页 */
export async function closeSheet(page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('.sheet.on')).toHaveCount(0)
}

/**
 * 找一个真正可订的空时段。
 * 走 API 而不是直接点 UI：发局表单默认选第一个场馆，而反复跑测试会把它当天时段订满，
 * 那样 UI 上就一个可选时段都没有了。这里从近到远扫日期 × 场馆，拿到一个确定的空位。
 */
export async function findFreeSlot(page) {
  const venues = (await (await page.request.get('/api/venues')).json()).venues
  for (let offset = 0; offset <= 5; offset += 1) {
    const date = ymd(offset)
    for (const v of venues) {
      const res = await (await page.request.get(`/api/venues/${v.id}/slots?date=${date}`)).json()
      const free = (res.slots || []).find((s) => s.status === 'free')
      if (free) return { venueId: v.id, venueName: v.name, date, startTime: free.startTime }
    }
  }
  return null
}
