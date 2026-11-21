import { expect, test } from '@playwright/test'

/**
 * 端到端用例：跑在生产构建上（Express 单端口托管 dist + /api），
 * 数据库是灌过种子的演示数据。
 *
 * 注意：每个用例用**不同手机号**，否则会撞上 60 秒短信冷却；
 * CI 里另外把 SMS_COOLDOWN_MS 设为 0，这样失败重试也不会被冷却挡住。
 */

async function login(page, phone) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '羽球局' })).toBeVisible()
  await page.getByPlaceholder('11 位手机号').fill(phone)
  await page.getByRole('button', { name: '获取验证码' }).click()
  // dev 渠道会把验证码回填到输入框
  await expect(page.locator('.login-hint')).toContainText('已自动填入')
  await page.getByRole('button', { name: /登录 \/ 注册/ }).click()
  await expect(page.locator('.tabbar')).toBeVisible()
}

test('登录：验证码自动填入后进入约球大厅', async ({ page }) => {
  await login(page, '13900001111')
  await expect(page.locator('.tabbar')).toContainText('约球')
  await expect(page.locator('.card').first()).toBeVisible()
})

test('球局详情：弹出层展示时间、费用与报名入口', async ({ page }) => {
  await login(page, '13900002222')
  await page.locator('.card').first().click()

  const sheet = page.locator('.sheet.on')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('.d-title')).not.toBeEmpty()
  await expect(sheet.locator('.d-rows')).toContainText('时间')
  await expect(sheet.locator('.d-rows')).toContainText('人均')
  await expect(sheet.locator('.sheet-foot button')).toBeVisible()
})

test('付费闭环：报名还缺人的局 → 生成 AA 订单 → 支付成功', async ({ page }) => {
  await login(page, '13900003333')

  // 只看还缺人的局，确保能报名
  await page.getByRole('button', { name: '还缺人' }).click()
  const card = page.locator('.card', { has: page.locator('.badge.wait') }).first()
  await expect(card).toBeVisible()
  await card.click()

  const sheet = page.locator('.sheet.on')
  const joinBtn = sheet.locator('.sheet-foot button', { hasText: '报名' })
  await expect(joinBtn).toBeVisible()
  await joinBtn.click()

  // 报名成功后：身份变「我已报名」，并出现待支付的 AA 订单
  await expect(sheet.locator('.badge.ok', { hasText: '我已报名' })).toBeVisible()
  const paybox = sheet.locator('.paybox')
  await expect(paybox).toBeVisible()
  await expect(paybox).toContainText('待支付')

  await paybox.getByRole('button', { name: '去支付' }).click()

  // 支付后徽标持久显示「已支付」，不依赖转瞬即逝的 toast
  await expect(paybox.locator('.badge.ok', { hasText: '已支付' })).toBeVisible()
  await expect(sheet.locator('.d-label', { hasText: '已支付' })).toBeVisible()
})
