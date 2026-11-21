import { config, ROOT } from './env.js'
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

import { prisma } from './db.js'
import authRoutes from './routes/auth.js'
import venueRoutes from './routes/venues.js'
import gameRoutes from './routes/games.js'
import meRoutes from './routes/me.js'
import { commentRouter, feedRouter } from './routes/feed.js'
import { HttpError } from './util.js'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '256kb' }))

  const api = express.Router()

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
    console.log('[web] 已托管静态站点：', dist)
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
    if (status >= 500) console.error('[api]', err)
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
  const app = createApp()
  const server = app.listen(config.port, () => {
    console.log(`[api] 羽球局 API： http://127.0.0.1:${config.port}/api/health`)
    if (config.devSms) console.log('[api] DEV_SMS=true：验证码会直接返回给前端（仅演示用）')
  })

  const shutdown = async () => {
    server.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// 便于测试直接拿到 fileURL
export const serverUrl = fileURLToPath(import.meta.url)
