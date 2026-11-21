import { useState } from 'react'
import { api } from '../api.js'
import { useApi } from '../hooks.js'
import { useAuth, useSheet, useToast } from '../state.jsx'
import { Avatar, Empty, ErrorBanner, SkeletonList } from '../ui.jsx'
import { dateLabel, fmtLv, lvName } from '../format.js'
import GameSheet from './GameSheet.jsx'

const ORDER_TEXT = {
  paid: { label: '已支付', cls: 'ok' },
  unpaid: { label: '待支付', cls: 'wait' },
  refunded: { label: '已退款', cls: 'wait' },
}

export default function Mine() {
  const { user, logout } = useAuth()
  const [role, setRole] = useState('host')
  const toast = useToast()
  const sheet = useSheet()

  const meReq = useApi(() => api.get('/me'), [user?.id])
  const gamesReq = useApi(() => api.get(`/me/games?role=${role}`), [role, user?.id])
  const ordersReq = useApi(() => api.get('/me/orders'), [user?.id])

  const stats = meReq.data?.stats
  const me = meReq.data?.user || user
  const games = gamesReq.data?.games || []
  const orders = ordersReq.data?.orders || []

  const openGame = (game) => {
    sheet.openSheet(<GameSheet initial={game} onChanged={gamesReq.reload} />)
  }

  function openAccount() {
    sheet.openSheet(<AccountSheet onSwitched={() => {
      meReq.reload()
      gamesReq.reload()
      ordersReq.reload()
    }} />)
  }

  async function onLogout() {
    await logout()
    toast.show('已退出登录')
  }

  const progress = stats ? Math.min(100, 40 + stats.totalGames * 10) : 40

  return (
    <>
      <header className="topbar" style={{ paddingBottom: 6 }}>
        <div className="tb-row">
          <button className="city" type="button" onClick={openAccount}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
            切换账号
          </button>
        </div>
      </header>

      {meReq.error && <ErrorBanner error={meReq.error} onRetry={meReq.reload} />}

      <div className="profile">
        <div className="pf-top">
          <div className="pf-av">{me?.name?.slice(0, 1) || '羽'}</div>
          <div>
            <div className="pf-name">{me?.name || '…'}</div>
            <div className="pf-meta">
              <span className="pf-lv">
                业余 {fmtLv(me?.level ?? 0)} 级 · {lvName(me?.level ?? 0)}
              </span>
              <span>{me?.phone || me?.district}</span>
            </div>
          </div>
        </div>
        <div className="pf-stats">
          <div>
            <b>{stats?.gamesThisMonth ?? '—'}</b>
            <span>本月场次</span>
          </div>
          <div>
            <b>{stats ? `¥${stats.spend}` : '—'}</b>
            <span>AA 已付</span>
          </div>
          <div>
            <b>{stats?.friends ?? '—'}</b>
            <span>球友</span>
          </div>
        </div>
        <div className="pf-bar">
          <div className="t">
            <span>距离 4.0 级（高级）</span>
            <span>{stats ? (stats.gamesToNextLevel ? `再打 ${stats.gamesToNextLevel} 场升级` : '已达标 🎉') : '—'}</span>
          </div>
          <div className="track">
            <i style={{ width: progress + '%' }} />
          </div>
        </div>
      </div>

      <div className="seg2">
        <button type="button" className={role === 'host' ? 'on' : ''} onClick={() => setRole('host')}>
          我发起的
        </button>
        <button type="button" className={role === 'joined' ? 'on' : ''} onClick={() => setRole('joined')}>
          我报名的
        </button>
      </div>

      {gamesReq.error && <ErrorBanner error={gamesReq.error} onRetry={gamesReq.reload} />}

      {gamesReq.loading ? (
        <SkeletonList count={2} />
      ) : games.length === 0 ? (
        <Empty
          text={role === 'host' ? '你还没有发起过球局' : '你还没有报名过球局'}
          cta={role === 'host' ? '去发一个局' : '去大厅看看'}
          to={role === 'host' ? '/create' : '/'}
        />
      ) : (
        <div className="list">
          {games.map((g) => (
            <button key={g.id} type="button" className="mini" onClick={() => openGame(g)}>
              <div className="m-body">
                <div className="m-t">
                  {dateLabel(g.date)} {g.startTime} · {g.title}
                </div>
                <div className="m-s">
                  {g.venue?.name} · {g.playersCount}/{g.maxPlayers} 已报 · ¥{g.fee}/人
                  {g.myOrder?.status === 'unpaid' ? ' · 待支付' : ''}
                </div>
              </div>
              <span className={'m-b' + (g.isFull ? ' ok' : '')}>{g.isFull ? '已成局' : `还差 ${g.shortBy} 人`}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sec-title" style={{ marginTop: 20 }}>
        <h3>我的订单</h3>
        <span>{orders.length} 笔</span>
      </div>

      {ordersReq.loading ? (
        <SkeletonList count={1} />
      ) : orders.length === 0 ? (
        <p className="tips" style={{ padding: '0 22px' }}>还没有 AA 订单，报名或发起球局后会自动生成</p>
      ) : (
        <div className="list">
          {orders.map((o) => {
            const meta = ORDER_TEXT[o.status] || ORDER_TEXT.unpaid
            return (
              <div key={o.id} className="order">
                <div className="o-body">
                  <div className="o-t">{o.game?.title || '球局已删除'}</div>
                  <div className="o-s">
                    {o.game ? `${dateLabel(o.game.date)} ${o.game.startTime} · ${o.game.venue || ''}` : '—'}
                  </div>
                </div>
                <div className="o-right">
                  <b>¥{o.amount}</b>
                  <span className={'badge ' + meta.cls}>{meta.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="rows">
        <button className="row-i" type="button" onClick={openAccount}>
          <span className="ic">👥</span> 切换演示账号 <span className="val">{me?.name}</span>
        </button>
        <button className="row-i" type="button" onClick={() => toast.show('等级评测还没做（下一版）')}>
          <span className="ic">📈</span> 等级评测 <span className="val">去测一测</span>
        </button>
        <button className="row-i" type="button" onClick={() => toast.show('数据在 Prisma + SQLite（server/prisma/dev.db）')}>
          <span className="ic">🏸</span> 关于羽球局 <span className="val">v2.0</span>
        </button>
        <button className="row-i" type="button" onClick={onLogout}>
          <span className="ic">🚪</span> 退出登录 <span className="val">{me?.phone}</span>
        </button>
      </div>
      <div style={{ height: 20 }} />
    </>
  )
}

function AccountSheet({ onSwitched }) {
  const { user, login } = useAuth()
  const sheet = useSheet()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function pick(u) {
    if (busy) return
    setBusy(true)
    try {
      // 演示账号都预置了「验证码已用」状态：直接走短信登录流程换号
      const sms = await api.post('/auth/sms', { phone: u.phone })
      if (!sms.devCode) {
        toast.show('请用该手机号走正常验证码登录')
        return
      }
      await login({ phone: u.phone, code: sms.devCode })
      toast.show(`已切换为 ${u.name}`)
      sheet.close()
      onSwitched?.()
    } catch (err) {
      toast.show(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="grab" />
      <div className="sheet-body">
        <h2 className="d-title" style={{ fontSize: 18 }}>切换演示账号</h2>
        <p className="d-sub">演示环境会直接发验证码并自动登录。数据按账号隔离。</p>
        <div className="plist">
          {DEMO_ACCOUNTS.map((u) => (
            <button
              key={u.phone}
              type="button"
              className="pitem"
              style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
              onClick={() => pick(u)}
              disabled={busy}
            >
              <Avatar user={{ id: u.phone, name: u.name }} />
              <div>
                <div className="pn">{u.name}</div>
                <div className="pl">
                  业余 {fmtLv(u.level)} 级 · {u.phone}
                </div>
              </div>
              {user?.phone === u.phone && <span className="ph">当前</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn ghost" type="button" onClick={() => sheet.close()}>
          关闭
        </button>
      </div>
    </>
  )
}

const DEMO_ACCOUNTS = [
  { name: '林小羽', phone: '13800000000', level: 3.5 },
  { name: '阿哲', phone: '13800000001', level: 4.2 },
  { name: '老K', phone: '13800000005', level: 4.0 },
  { name: '小满', phone: '13800000008', level: 2.2 },
  { name: '大树', phone: '13800000009', level: 5.2 },
]
