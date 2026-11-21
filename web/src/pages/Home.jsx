import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useApi } from '../hooks.js'
import { useSheet } from '../state.jsx'
import { ErrorBanner, Empty, GameCard, SkeletonList } from '../ui.jsx'
import { dateFull, dateLabel, weekday, ymd } from '../format.js'
import GameSheet from './GameSheet.jsx'
import NotificationsSheet from './Notifications.jsx'

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今天' },
  { id: 'weekend', label: '周末' },
  { id: 'newbie', label: '新手友好' },
  { id: 'need', label: '还缺人' },
]

export default function Home() {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const sheet = useSheet()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250)
    return () => clearTimeout(t)
  }, [q])

  const gamesReq = useApi(
    () => api.get(`/games?filter=${filter}&q=${encodeURIComponent(debouncedQ)}`),
    [filter, debouncedQ],
  )
  const notesReq = useApi(() => api.get('/notifications'), [])

  const games = gamesReq.data?.games || []
  const loading = gamesReq.loading
  const today = ymd(new Date())
  const unread = notesReq.data?.unread || 0

  const groups = useMemo(() => {
    const map = new Map()
    games.forEach((g) => {
      if (!map.has(g.date)) map.set(g.date, [])
      map.get(g.date).push(g)
    })
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1))
  }, [games])

  const openToday = games.filter((g) => g.date === today && !g.isFull).length

  function openGame(game) {
    sheet.openSheet(<GameSheet initial={game} onChanged={gamesReq.reload} />)
  }

  function openNotifications() {
    sheet.openSheet(<NotificationsSheet onChange={notesReq.reload} />)
  }

  return (
    <>
      <header className="topbar">
        <div className="tb-row">
          <button className="city" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.6" />
            </svg>
            上海 · 浦东
          </button>
          <div className="tb-actions">
            <button className="icon-btn" type="button" onClick={openNotifications} aria-label="消息">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
                <path d="M13.7 20a2 2 0 0 1-3.4 0" />
              </svg>
              {unread > 0 && <i className="bell-dot">{unread > 9 ? '9+' : unread}</i>}
            </button>
            <button className="icon-btn" type="button" onClick={() => setSearchOpen((v) => !v)} aria-label="搜索">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.6-3.6" />
              </svg>
            </button>
          </div>
        </div>

        <h1>
          今晚，去<em>打球</em>
        </h1>
        <p className="sub">
          {loading
            ? '正在拉取附近的局…'
            : filter === 'all' && !debouncedQ
              ? `附近 ${gamesReq.data?.total ?? games.length} 个局在召集`
              : `筛出 ${games.length} 个局 · 共 ${gamesReq.data?.total ?? games.length} 个`}
        </p>

        {searchOpen && (
          <div className="searchbox">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa8a0" strokeWidth="2.1" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.6-3.6" />
            </svg>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜场馆、局名，比如「羽动力」" />
          </div>
        )}
      </header>

      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={'chip' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {!loading && !gamesReq.error && (
        <button className="notice" type="button" onClick={() => setFilter('today')}>
          <span className="emo">🔥</span>
          <span>
            {openToday > 0 ? (
              <>
                今天还有 <b>{openToday}</b> 个局缺人，点我只看今天的
              </>
            ) : (
              <>今天的局都满员了，看看别人的场次</>
            )}
          </span>
          <span className="arrow">›</span>
        </button>
      )}

      {gamesReq.error && <ErrorBanner error={gamesReq.error} onRetry={gamesReq.reload} />}

      <div className="sec-title">
        <h3>附近球场</h3>
        <span>{loading ? '加载中' : `共 ${games.length} 个局`}</span>
      </div>

      {loading ? (
        <SkeletonList count={3} />
      ) : games.length === 0 ? (
        <Empty text="这个筛选条件下暂时没有球局，换个条件或者自己发起一个" cta="去发局" to="/create" />
      ) : (
        <div className="list" style={{ gap: 18 }}>
          {groups.map(([date, items]) => (
            <div key={date} style={{ display: 'grid', gap: 13 }}>
              <div className="sec-title" style={{ padding: '6px 0 2px' }}>
                <h3>
                  {dateLabel(date)} · {dateFull(date)} · {weekday(date)}
                </h3>
                <span>{items.length} 个局</span>
              </div>
              {items.map((g) => (
                <GameCard key={g.id} game={g} onOpen={openGame} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
