import { expect, test } from '@playwright/test'
import { login, newPhone, tab } from './helpers.js'

/**
 * 基础三条：登录、球局详情、付费闭环。
 * 手机号每次运行都不同（见 helpers.js），所以可以反复运行。
 */

test('登录：验证码自动填入后进入约球大厅', async ({ page }) => {
  await login(page, newPhone())
  await expect(page.locator('.tabbar')).toContainText('约球')
  await expect(page.locator('.card').first()).toBeVisible()
})

test('球局详情：弹出层展示时间、费用与报名入口', async ({ page }) => {
  await login(page, newPhone())
  await page.locator('.card').first().click()

  const sheet = page.locator('.sheet.on')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('.d-title')).not.toBeEmpty()
  await expect(sheet.locator('.d-rows')).toContainText('时间')
  await expect(sheet.locator('.d-rows')).toContainText('人均')
  await expect(sheet.locator('.sheet-foot button')).toBeVisible()
})

test('付费闭环：报名还缺人的局 → 生成 AA 订单 → 支付成功', async ({ page }) => {
  await login(page, newPhone())

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
