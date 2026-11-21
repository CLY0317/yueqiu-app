import { defineConfig, devices } from '@playwright/test'

// 默认打生产构建：Express 在 8787 上同时托管 dist 与 /api
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:8787'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // 用例共享同一套种子数据，串行跑，避免互相改状态
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    viewport: { width: 420, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
})
