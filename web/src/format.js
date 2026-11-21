/** 展示层格式化：日期、等级、头像配色、相对时间 */

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad = (n) => String(n).padStart(2, '0')

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayAt(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return ymd(d)
}

function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function dateLabel(s) {
  if (s === dayAt(0)) return '今天'
  if (s === dayAt(1)) return '明天'
  if (s === dayAt(2)) return '后天'
  const d = parseYmd(s)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WD[d.getDay()]}`
}

export function dateFull(s) {
  const d = parseYmd(s)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function weekday(s) {
  return WD[parseYmd(s).getDay()]
}

export function lvName(level) {
  if (level <= 2) return '新手'
  if (level <= 3.5) return '初级'
  if (level <= 5) return '中级'
  if (level <= 6.5) return '高级'
  return '高手'
}

export const fmtLv = (l) => String(Math.round(Number(l) * 10) / 10)

export function levelText(game) {
  const mid = (game.levelMin + game.levelMax) / 2
  return `${lvName(mid)} ${fmtLv(game.levelMin)}–${fmtLv(game.levelMax)} 级`
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d === 1) return '昨天'
  if (d < 7) return `${d} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

const PAL = [
  'linear-gradient(135deg,#93c5fd,#2563eb)',
  'linear-gradient(135deg,#fda4af,#e11d48)',
  'linear-gradient(135deg,#86efac,#15803d)',
  'linear-gradient(135deg,#fcd34d,#d97706)',
  'linear-gradient(135deg,#c4b5fd,#7c3aed)',
  'linear-gradient(135deg,#67e8f9,#0891b2)',
  'linear-gradient(135deg,#fdba74,#ea580c)',
]

/** 同一个 id 永远得到同一个配色（FNV-1a，分布比简单取模均匀） */
export function colorFor(key = '') {
  let h = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return PAL[(h >>> 0) % PAL.length]
}

/** 头像上显示的字：中文取一个字，"阿哲/小铁/老K/大树"这类取后一个字更像昵称 */
export function shortName(name = '') {
  const s = String(name).trim()
  if (!s) return '?'
  if (s.length > 1 && /[小阿老大]/.test(s[0])) return s[1]
  return s.slice(0, 1)
}
