import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { colorFor, dateLabel, levelText, shortName } from './format.js'

/* --------------------------- 小零件 --------------------------- */

export function Shuttle({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.2 14.2 5.5 4.6Q12 2.1 18.5 4.6l-2.7 9.6" />
      <path d="M10 13.8 8.6 4.9M12 13.8V3.4M14 13.8l1.4-8.9" />
      <path d="M6.9 7.8h10.2" />
      <circle cx="12" cy="16.9" r="3.1" />
    </svg>
  )
}

export function Avatar({ user, className = '' }) {
  if (!user) return null
  return (
    <span className={'av ' + className} style={{ background: colorFor(user.id || user.name) }}>
      {shortName(user.name)}
    </span>
  )
}

export function StatusBar() {
  const time = useMemo(() => {
    const d = new Date()
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }, [])
  return (
    <div className="statusbar">
      <span>{time}</span>
      <div className="sb-right">
        <div className="sb-bar"><i /><i /><i /><i /></div>
        <svg width="15" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M5 12.5a10 10 0 0 1 14 0" />
          <path d="M8.5 16a5 5 0 0 1 7 0" />
          <circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
        <div className="sb-bat" />
      </div>
    </div>
  )
}

export function Intro() {
  return (
    <aside className="intro">
      <div className="logo">
        <Shuttle size={30} />
      </div>
      <h2>羽球局</h2>
      <p>约球 / 拼场 / 球友圈 —— React + Express 的可运行版本，数据来自真后端接口。</p>
      <ul>
        <li><b>约球大厅</b>：筛选、搜索、报名、退出，名额由服务端校验，不会超卖。</li>
        <li><b>发起约球</b>：表单校验在前后端各做一遍，场馆 / 时长 / 水平都有约束。</li>
        <li><b>球友圈</b>：发动态、点赞，点赞关系存在用户维度。</li>
        <li><b>我的</b>：场次、AA 支出、球友数由服务端聚合，支持注销账号。</li>
      </ul>
      <p className="hint">
        前端 <code>5173</code>，API <code>8787</code>，数据落在 <code>PostgreSQL + Prisma</code>。
        刷新页面登录态和报名都还在。
      </p>
    </aside>
  )
}

/* --------------------------- 球局卡片 --------------------------- */

export function GameCard({ game, onOpen }) {
  const isFull = game.isFull
  const badge = isFull ? { cls: 'ok', txt: '已成局' } : { cls: 'wait', txt: `还差 ${game.shortBy} 人` }
  const mine = game.myRole === 'host'
    ? { cls: 'mine', txt: '我发起的' }
    : game.myRole === 'joined'
      ? { cls: 'ok', txt: '已报名' }
      : null

  let action = '报名'
  if (isFull) action = '看看谁在打'
  else if (game.myRole === 'joined') action = '已报名'
  else if (game.myRole === 'host') action = '管理'

  const pct = Math.round((game.playersCount / game.maxPlayers) * 100)

  return (
    <button type="button" className="card" onClick={() => onOpen(game)}>
      <div className="g-head">
        <div style={{ minWidth: 0 }}>
          <div className="g-badges">
            {mine && <span className={'badge ' + mine.cls}>{mine.txt}</span>}
            <span className={'badge ' + badge.cls}>{badge.txt}</span>
          </div>
          <h3 className="g-title">{game.title}</h3>
        </div>
        <div className="price">
          <b><i>¥</i>{game.fee}</b>
          <span>人均 AA</span>
        </div>
      </div>

      <div className="g-time">
        <span className="dot" />
        {dateLabel(game.date)} {game.startTime} – {game.endTime}
        <small>{game.duration / 60}h</small>
      </div>
      <div className="g-venue">
        {game.venue?.name}
        <em>{game.venue?.area}</em>
        <span className="dist" style={{ marginLeft: 'auto' }}>{game.venue?.distanceKm}km</span>
      </div>
      <div className="g-tags">
        <span className="tag hi">{levelText(game)}</span>
        <span className="tag">{game.mode} · {game.maxPlayers} 人</span>
        <span className="tag">{game.venue?.tag}</span>
      </div>
      <div className={'bar' + (isFull ? ' full' : '')}>
        <i style={{ width: pct + '%' }} />
      </div>
      <div className="g-foot">
        <div className="avatars">
          {game.players.slice(0, 4).map((p) => <Avatar key={p.id} user={p} />)}
          {game.playersCount > 4 && <span className="av more">+{game.playersCount - 4}</span>}
        </div>
        <span className="cnt"><b>{game.playersCount}</b>/{game.maxPlayers} 已报</span>
        <span className={'btn ' + (isFull || game.myRole ? 'ghost' : 'lime')}>{action}</span>
      </div>
    </button>
  )
}

/* --------------------------- 状态块 --------------------------- */

export function SkeletonList({ count = 3 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk sk-card" />
      ))}
    </>
  )
}

export function ErrorBanner({ error, onRetry }) {
  return (
    <div className="banner">
      <span>{error?.message || '加载失败'}</span>
      {onRetry && <button className="btn" onClick={onRetry}>重试</button>}
    </div>
  )
}

export function Empty({ text, cta, to }) {
  return (
    <div className="empty">
      <span className="e"><Shuttle /></span>
      <p>{text}</p>
      {cta && to && <Link className="btn" to={to}>{cta}</Link>}
    </div>
  )
}
