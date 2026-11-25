import { config, ROOT, assertProductionConfig } from './env.js'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

import { prisma } from './db.js'
import { logger } from './logger.js'
import authRoutes from './routes/auth.js'
import venueRoutes from './routes/venues.js'
import gameRoutes from './routes/games.js'
import meRoutes from './routes/me.js'
import { commentRouter, feedRouter } from './routes/feed.js'
import { HttpError } from './util.js'

export function createApp() {
  const app = express()
  if (config.trustProxy) app.set('trust proxy', 1)

  // 请求日志：方法 / 路径 / 状态 / 耗时 / 用户。
  // 健康检查走 debug 级，避免把正常流量刷满。
  app.use((req, res, next) => {
    const started = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
      const line = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(ms * 10) / 10,
        ip: req.ip,
        userId: req.user?.id || null,
      }
      if (req.path === '/api/health') logger.debug(line, 'health')
      else logger[level](line, 'http')
    })
    next()
  })

  // 安全响应头：CSP / HSTS / X-Content-Type-Options / Referrer-Policy 等
  //
  // 注意 CSP 里的 upgrade-insecure-requests：它会把页面引用的子资源（JS/CSS）
  // 强制升级到 HTTPS。只有在真的有 TLS 时才加——否则纯 HTTP 部署（还没有域名、
  // 签不了证书）会因为脚本加载失败而白屏。
  // helmet 的默认 CSP 自带 upgrade-insecure-requests，
  // 显式给 null 才能关掉（给 [] 是启用，缺省是沿用默认值）。
  const cspDirectives = (upgradeInsecure) => ({
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    // 前端大量使用 style={{...}} 内联样式，必须放行 unsafe-inline
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: upgradeInsecure ? [] : null,
  })

  const helmetHttps = helmet({
    contentSecurityPolicy: { directives: cspDirectives(true) },
    strictTransportSecurity: config.isProd ? undefined : false,
    crossOriginEmbedderPolicy: false,
  })
  const helmetHttp = helmet({
    contentSecurityPolicy: { directives: cspDirectives(false) },
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
    // HTTP 源不是"可信来源"，浏览器会忽略 COOP 并在控制台报警
    crossOriginOpenerPolicy: false,
  })

  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')
    return (proto === 'https' ? helmetHttps : helmetHttp)(req, res, next)
  })

  // 跨域：生产只放行配置里列出来的来源；未配置就不放行任何来源
  app.use(
    cors({
      origin(origin, cb) {
        // 同源请求 / curl / 服务端调用没有 Origin 头
        if (!origin) return cb(null, true)
        if (!config.corsOrigins.length) return cb(null, false)
        cb(null, config.corsOrigins.includes(origin))
      },
      credentials: true,
    }),
  )

  app.use(
    express.json({
      limit: '256kb',
      // 微信支付回调要用未解析的原始报文验签，这里留一份
      verify: (req, _res, buf) => {
        req.rawBody = buf
      },
    }),
  )

  const api = express.Router()

  // 全局限流：防止单个 IP 把接口打爆
  api.use(
    rateLimit({
      windowMs: 60_000,
      max: config.rateLimit.apiPerIp,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: '请求太频繁，请稍后再试' } },
    }),
  )

  api.get('/health', async (_req, res) => {
    const [users, games, posts, orders] = await Promise.all([
      prisma.user.count(),
      prisma.game.count(),
      prisma.post.count(),
      prisma.order.count(),
    ])
    res.json({ ok: true, time: new Date().toISOString(), counts: { users, games, posts, orders } })
  })

  api.use('/auth', authRoutes)
  api.use('/venues', venueRoutes)
  api.use('/games', gameRoutes)
  api.use('/feed', feedRouter)
  api.use('/posts', commentRouter)
  api.use('/', meRoutes)

  api.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
  })

  app.use('/api', api)

  // 生产模式：托管 web/dist
  const dist = path.join(ROOT, 'web', 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
    logger.info({ dist }, '已托管前端静态站点')
  }

  // 统一错误出口：zod / prisma / HttpError 都转成 { error: { code, message, field } }
  app.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0]
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issue?.message || '参数不合法',
          field: issue?.path?.join('.') || null,
        },
      })
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return res
          .status(409)
          .json({ error: { code: 'DUPLICATE', message: '记录已存在（唯一约束冲突）' } })
      }
      if (err.code === 'P2025') {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' } })
      }
      return res
        .status(400)
        .json({ error: { code: 'DB_ERROR', message: '数据库操作失败', detail: err.code } })
    }

    const status = err instanceof HttpError ? err.status : 500
    if (status >= 500) {
      logger.error(
        { err: { message: err.message, stack: err.stack, code: err.code }, path: _req.path },
        'api error',
      )
    } else {
      logger.warn({ code: err.code, message: err.message, path: _req.path }, 'api reject')
    }
    res.status(status).json({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || '服务器开小差了',
        field: err.field || null,
      },
    })
  })

  return app
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  // 配置不安全就直接拒绝启动，而不是静默降级
  try {
    assertProductionConfig()
  } catch (err) {
    console.error('[api] ' + err.message)
    process.exit(1)
  }

  // 崩溃兜底：先落日志再退出，别让异常静默吞掉
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: { message: err.message, stack: err.stack } }, 'uncaught exception')
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: { message: String(reason), stack: reason?.stack } }, 'unhandled rejection')
  })

  const app = createApp()
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, dist: fs.existsSync(path.join(ROOT, 'web', 'dist')) },
      '羽球局 API 已启动',
    )
    if (config.devSms) logger.warn('DEV_SMS=true：验证码会直接返回给前端（仅演示用）')
  })

  const shutdown = async (signal) => {
    logger.info({ signal }, '收到退出信号，开始优雅关闭')
    server.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

// 便于测试直接拿到 fileURL
export const serverUrl = fileURLToPath(import.meta.url)
