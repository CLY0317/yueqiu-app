// 对线上站点截图（真 Chromium 直连，不走浏览器插件的代理）
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const URL = process.argv[2] || 'http://123.57.200.28'
const OUT = process.argv[3] || 'F:/大模型/工作目录/yueqiu-app/docs/screenshots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 440, height: 940 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForSelector('.login', { timeout: 15000 })
await page.screenshot({ path: `${OUT}/线上-1-登录.png` })
console.log('✓ 线上-1-登录')

// 登录（演示环境 dev 通道已关闭，这里只能看到登录页；用生产配置无法取码）
console.log('标题：', await page.title())
console.log('H1：', await page.locator('h1').first().textContent())

const health = await (await page.request.get(`${URL}/api/health`)).json()
console.log('健康：', JSON.stringify(health.counts))

const games = await (await page.request.get(`${URL}/api/games`)).json()
console.log('球局数：', games.total, '｜首条：', games.games?.[0]?.title)

const headers = await page.request.get(`${URL}/api/health`)
console.log('安全头：', ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'strict-transport-security']
  .filter((h) => headers.headers()[h]).join(', '))

console.log('控制台错误：', errors.length ? errors.slice(0, 3) : '无')
await browser.close()
