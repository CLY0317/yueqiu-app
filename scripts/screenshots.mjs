// 截取主要界面：登录 / 约球大厅 / 球局详情 / 发局 / 球友圈 / 我的
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const OUT = process.argv[2]
const BASE = 'http://127.0.0.1:8787'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 440, height: 940 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('✓', name)
}

// 1) 登录页
await page.goto(BASE)
await page.waitForTimeout(600)
await shot('1-登录')

// 登录
await page.getByPlaceholder('11 位手机号').fill('13800000000')
await page.getByRole('button', { name: '获取验证码' }).click()
await page.waitForFunction(() => {
  const el = document.querySelector('input[placeholder="6 位验证码"]')
  return el && el.value.length === 6
})
await page.getByRole('button', { name: /登录 \/ 注册/ }).click()
await page.waitForSelector('.tabbar')

// 2) 约球大厅
await shot('2-约球大厅')

// 3) 球局详情弹层
await page.locator('.card').first().click()
await page.waitForSelector('.sheet.on')
await shot('3-球局详情')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 4) 发局表单
await page.locator('.tabbar a', { hasText: '发局' }).click()
await page.waitForSelector('#create-game-form')
await page.waitForTimeout(600)
await shot('4-发起约球')
await page.locator('.tabbar a', { hasText: '约球' }).click()

// 5) 球友圈
await page.locator('.tabbar a', { hasText: '球友圈' }).click()
await page.waitForSelector('.post')
await shot('5-球友圈')

// 6) 我的
await page.locator('.tabbar a', { hasText: '我的' }).click()
await page.waitForSelector('.profile')
await shot('6-我的')

await browser.close()
console.log('done ->', OUT)
