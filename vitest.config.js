import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://yueqiu:yueqiu@127.0.0.1:5432/yueqiu_test?schema=public',
      JWT_SECRET: 'test-secret',
      DEV_SMS: 'true',
      ALLOW_DEV_SMS: 'true',
      SMS_PROVIDER: 'dev',
    },
  },
})
