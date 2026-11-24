/**
 * 结构化日志。
 *
 * 生产写 JSON 到 stdout —— Docker 的 json-file 日志驱动会直接收集，
 * `docker compose logs` / `docker logs` 能按行解析，采集器也能直接吃。
 * 开发环境写人眼可读的一行。
 *
 * 约定：不打印手机号全量、验证码、token；手机号统一脱敏。
 */
import pino from 'pino'
import { maskPhone } from './channels/sms.js'

const isProd = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
// 测试模式下静默：日志会污染 vitest 输出
const level = process.env.LOG_LEVEL || (isProd ? 'info' : isTest ? 'silent' : 'debug')

export const logger = pino({
  level,
  base: { service: 'yueqiu-api', env: process.env.NODE_ENV || 'development' },
  // 时间用 ISO，采集器好解析
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'code',
      'devCode',
      'token',
      'refreshToken',
      'accessToken',
      'phone',
      '*.phone',
      '*.code',
    ],
    censor: '[已脱敏]',
  },
  ...(isProd || isTest
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }),
})

/** 给手机号打码的便捷函数（与短信渠道共用同一套规则） */
export { maskPhone }

export default logger
