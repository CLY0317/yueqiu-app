import { expect, test } from '@playwright/test'
import { closeSheet, findFreeSlot, login, newPhone, stamp, tab, ymd } from './helpers.js'

/**
 * 覆盖三条关键流程：发局（表单 + 订场 + 发布）、评论（发动态 + 评论 + 计数）、解散退款（发起人解散 → 队友订单退款 + 收到通知）。
 */

test('发局：填写表单并订场发布，大厅出现「我发起的」', async ({ page }) => {
  await login(page, newPhone())

  const target = await findFreeSlot(page)
  if (!target) throw new Error('没有可订时段了，请先执行 pnpm db:reset 重灌种子')

  const title = `e2e 发局 ${stamp()}`
  await tab(page, '发局').click()
  await expect(page.locator('#create-game-form')).toBeVisible()

  await page.getByPlaceholder('例：周五晚 · 中级双打').fill(title)
  await page.locator('.form select').selectOption(target.venueId)
  await page.locator('.form input[type="date"]').fill(target.date)

  // 订一个空闲时段：选中后开始时间与 AA 费用会自动跟着变
  const slot = page
    .locator('.slots .slot:not(.off)')
    .filter({ hasText: new RegExp(`^${target.startTime}`) })
    .first()
  await expect(slot).toBeVisible()
  await slot.click()
  await expect(page.locator('.tips', { hasText: '场地费' })).toBeVisible()

  await page.locator('.form input[type="number"]').fill('40')
  await page.locator('.form textarea').fill('e2e 自动测试局 · 木地板')
  await page.getByRole('button', { name: '发布这个局 · 开始召集' }).click()

  // 发布后回到大厅，新局以「我发起的」出现
  const card = page.locator('.card', { hasText: title })
  await expect(card).toBeVisible()
  await expect(card).toContainText('我发起的')
  await expect(card).toContainText('¥40')
})

test('评论：发布动态并评论，评论内容与计数同步更新', async ({ page }) => {
  await login(page, newPhone())

  await tab(page, '球友圈').click()
  const postText = `e2e 动态 ${stamp()}`
  await page.getByPlaceholder('分享你的球场瞬间…').fill(postText)
  await page.getByRole('button', { name: '发布' }).click()

  const post = page.locator('.post', { hasText: postText }).first()
  await expect(post).toBeVisible()
  await expect(post.locator('.p-acts button').nth(1)).toContainText('💬 0')

  // 打开评论弹层
  await post.locator('.p-acts button').nth(1).click()
  const sheet = page.locator('.sheet.on')
  await expect(sheet).toBeVisible()

  const commentText = `e2e 评论 ${stamp()}`
  await sheet.locator('.comment-input').fill(commentText)
  await sheet.getByRole('button', { name: '发送' }).click()

  await expect(sheet.locator('.comment', { hasText: commentText })).toBeVisible()
  await expect(sheet.locator('.comment').first().locator('.c-text')).toHaveText(commentText)

  // 列表计数跟着 +1
  await expect(post.locator('.p-acts button').nth(1)).toContainText('💬 1')
})

test('注销账号：二次确认后删除账号并回到登录页', async ({ page }) => {
  const phone = newPhone()
  await login(page, phone)

  await tab(page, '我的').click()
  await page.getByRole('button', { name: /注销账号/ }).click()

  // 没输入确认词时按钮不可点
  const sheet = page.locator('.sheet.on')
  const confirmBtn = sheet.getByRole('button', { name: '确认注销' })
  await expect(confirmBtn).toBeDisabled()

  await sheet.locator('input[placeholder="注销"]').fill('注销')
  await expect(confirmBtn).toBeEnabled()
  await confirmBtn.click()

  // 回到登录页，且该手机号已不能再登录（账号已删除）
  await expect(page.getByPlaceholder('11 位手机号')).toBeVisible()
  await page.getByPlaceholder('11 位手机号').fill(phone)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await expect(page.getByPlaceholder('6 位验证码')).toHaveValue(/^\d{6}$/)
  await page.getByRole('button', { name: /登录 \/ 注册/ }).click()
  // 注销后再用同一手机号登录会重新注册一个新账号（不是原来那个）
  await expect(page.locator('.tabbar')).toBeVisible()
})

test('解散退款：发起人解散后，队友的已支付订单转已退款并收到通知', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const guestCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()

  try {
    const title = `e2e 解散局 ${stamp()}`

    /* --- 发起人：建一个局（不订场，避免占用时段库存） --- */
    await login(host, newPhone())
    await tab(host, '发局').click()
    await host.getByPlaceholder('例：周五晚 · 中级双打').fill(title)
    await host.locator('.form input[type="date"]').fill(ymd(0))
    await host.locator('.form input[type="number"]').fill('45')
    await host.getByRole('button', { name: '发布这个局 · 开始召集' }).click()
    await expect(host.locator('.card', { hasText: title })).toBeVisible()

    /* --- 队友：报名并支付 --- */
    await login(guest, newPhone())
    await guest.locator('.card', { hasText: title }).first().click()
    const guestSheet = guest.locator('.sheet.on')
    await expect(guestSheet).toBeVisible()

    await guestSheet.locator('.sheet-foot button', { hasText: '报名' }).click()
    await expect(guestSheet.locator('.badge.ok', { hasText: '我已报名' })).toBeVisible()

    const paybox = guestSheet.locator('.paybox')
    await expect(paybox).toContainText('待支付')
    await paybox.getByRole('button', { name: '去支付' }).click()
    await expect(paybox.locator('.badge.ok', { hasText: '已支付' })).toBeVisible()

    // 弹层还开着，遮罩会挡住底部 tab，先关掉
    await closeSheet(guest)

    /* --- 发起人解散 --- */
    await host.locator('.card', { hasText: title }).first().click()
    const hostSheet = host.locator('.sheet.on')
    await expect(hostSheet.locator('.sheet-foot button', { hasText: '解散这个局' })).toBeVisible()
    await hostSheet.locator('.sheet-foot button', { hasText: '解散这个局' }).click()

    // 解散后这个局从大厅消失
    await expect(host.locator('.card', { hasText: title })).toHaveCount(0)

    /* --- 队友：订单变已退款 + 收到解散通知 --- */
    await tab(guest, '我的').click()
    const order = guest.locator('.order', { hasText: title })
    await expect(order).toBeVisible()
    await expect(order).toContainText('已退款')

    await tab(guest, '约球').click()
    await guest.locator('.icon-btn[aria-label="消息"]').click()
    const notes = guest.locator('.sheet.on')
    await expect(notes.locator('.note-t', { hasText: '有球局被解散了' })).toBeVisible()
  } finally {
    await hostCtx.close()
    await guestCtx.close()
  }
})
