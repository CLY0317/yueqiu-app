import { prisma } from './db.js'

/** 站内通知（事务外调用，失败不影响主流程） */
export async function notify(userId, { type, title, body, refId = null }) {
  if (!userId) return
  try {
    await prisma.notification.create({ data: { userId, type, title, body, refId } })
  } catch (err) {
    console.error('[notify] 写入失败', err.message)
  }
}
