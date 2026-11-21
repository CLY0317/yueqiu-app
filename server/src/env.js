/** 极简 .env 加载（不引 dotenv）：已存在的环境变量优先 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const file = path.join(ROOT, '.env')
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const value = m[2].replace(/^["']|["']$/g, '')
    if (process.env[m[1]] == null) process.env[m[1]] = value
  }
}

export const config = {
  port: Number(process.env.PORT || 8787),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  accessTtl: Number(process.env.ACCESS_TOKEN_TTL || 900),
  refreshDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  devSms: process.env.DEV_SMS === 'true',
  isTest: process.env.NODE_ENV === 'test',
}
