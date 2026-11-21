import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { optionalAuth, requireAuth } from '../auth.js'
import { commentDTO, postDTO } from '../dto.js'
import { notify } from '../notify.js'
import { notFound } from '../util.js'

const postInclude = {
  author: true,
  likes: true,
}

/* ------------------------------ 动态 ------------------------------ */
export const feedRouter = Router()

feedRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const posts = await prisma.post.findMany({
      include: postInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ posts: posts.map((p) => postDTO(p, req.user?.id || null)) })
  } catch (err) {
    next(err)
  }
})

feedRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { text } = z
      .object({ text: z.string().trim().min(1, '写点什么再发布吧').max(200, '最多 200 个字') })
      .parse(req.body)

    const post = await prisma.post.create({
      data: { authorId: req.user.id, text },
      include: postInclude,
    })
    res.status(201).json({ post: postDTO(post, req.user.id) })
  } catch (err) {
    next(err)
  }
})

feedRouter.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } })
    if (!post) throw notFound('这条动态不存在')

    const key = { postId_userId: { postId: post.id, userId: req.user.id } }
    const exists = await prisma.postLike.findUnique({ where: key })
    if (exists) await prisma.postLike.delete({ where: key })
    else await prisma.postLike.create({ data: { postId: post.id, userId: req.user.id } })

    const updated = await prisma.post.findUnique({
      where: { id: post.id },
      include: postInclude,
    })
    res.json({ post: postDTO(updated, req.user.id) })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------ 评论 ------------------------------ */
export const commentRouter = Router()

commentRouter.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } })
    if (!post) throw notFound('这条动态不存在')

    const comments = await prisma.comment.findMany({
      where: { postId: post.id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    res.json({
      comments: comments.map(commentDTO),
      total: post.commentCount,
    })
  } catch (err) {
    next(err)
  }
})

commentRouter.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const { text } = z
      .object({ text: z.string().trim().min(1, '说点什么吧').max(200, '评论最多 200 个字') })
      .parse(req.body)

    const post = await prisma.post.findUnique({ where: { id: req.params.id } })
    if (!post) throw notFound('这条动态不存在')

    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: { postId: post.id, userId: req.user.id, text },
        include: { user: true },
      })
      await tx.post.update({
        where: { id: post.id },
        data: { commentCount: { increment: 1 } },
      })
      return c
    })

    if (post.authorId !== req.user.id) {
      await notify(post.authorId, {
        type: 'comment',
        title: `${req.user.name} 评论了你的动态`,
        body: text.slice(0, 40),
        refId: post.id,
      })
    }

    res.status(201).json({ comment: commentDTO(comment) })
  } catch (err) {
    next(err)
  }
})
