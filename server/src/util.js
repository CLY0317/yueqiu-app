/** 时间 / 错误 / 校验相关的小工具 */

export const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function today() {
  return ymd(new Date())
}

export function dayAt(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return ymd(d)
}

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isWeekend(s) {
  const w = parseYmd(s).getDay()
  return w === 0 || w === 6
}

export function addMinutes(hhmm, min) {
  const [h, m] = String(hhmm).split(':').map(Number)
  let total = h * 60 + m + Number(min || 0)
  total = ((total % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export function lvName(level) {
  if (level <= 2) return '新手'
  if (level <= 3.5) return '初级'
  if (level <= 5) return '中级'
  if (level <= 6.5) return '高级'
  return '高手'
}

export class HttpError extends Error {
  constructor(status, code, message, field) {
    super(message)
    this.status = status
    this.code = code
    this.field = field || null
  }
}

export const bad = (message, field) => new HttpError(400, 'VALIDATION_ERROR', message, field)
export const notFound = (message = '资源不存在') => new HttpError(404, 'NOT_FOUND', message)
export const conflict = (code, message) => new HttpError(409, code, message)
