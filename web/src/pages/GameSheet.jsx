import { useState } from 'react'
import { api } from '../api.js'
import { useSheet, useToast } from '../state.jsx'
import { Avatar } from '../ui.jsx'
import { dateLabel, fmtLv, levelText, lvName } from '../format.js'

export default function GameSheet({ initial, onChanged }) {
  const [game, setGame] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [paying, setPaying] = useState(false)
  const sheet = useSheet()
  const toast = useToast()

  async function run(task, successMsg, { close = false } = {}) {
    if (busy) return
    setBusy(true)
    try {
      const res = await task()
      if (res?.game) setGame(res.game)
      if (successMsg) toast.show(successMsg)
      onChanged?.()
      if (close) sheet.close()
    } catch (err) {
      toast.show(err.message)
    } finally {
      setBusy(false)
    }
  }

  const join = () =>
    run(() => api.post(`/games/${game.id}/join`, { expectedVersion: game.version }), '报名成功 · 记得完成 AA 支付')

  const leave = () => run(() => api.post(`/games/${game.id}/leave`), '已退出报名 · 名额放回大厅')

  const dissolve = () =>
    run(() => api.del(`/games/${game.id}`), '这个局已解散，费用原路退回', { close: true })

  async function pay() {
    if (paying || !game.myOrder) return
    setPaying(true)
    try {
      const res = await api.post(`/orders/${game.myOrder.id}/pay`)
      // 支付后刷新整局，顺便更新"已支付 N 人"
      const fresh = await api.get(`/games/${game.id}`)
      setGame(fresh.game)
      toast.show(`支付成功 ¥${res.order.amount}`)
      onChanged?.()
    } catch (err) {
      toast.show(err.message)
    } finally {
      setPaying(false)
    }
  }

  const badge = game.isFull ? { cls: 'ok', txt: '已成局' } : { cls: 'wait', txt: `还差 ${game.shortBy} 人` }
  const mine =
    game.myRole === 'host'
      ? { cls: 'mine', txt: '我发起的' }
      : game.myRole === 'joined'
        ? { cls: 'ok', txt: '我已报名' }
        : null

  const orderStatus = game.myOrder?.status
  const orderBadge =
    orderStatus === 'paid'
      ? { cls: 'ok', txt: '已支付' }
      : orderStatus === 'refunded'
        ? { cls: 'wait', txt: '已退款' }
        : { cls: 'wait', txt: '待支付' }

  let foot
  if (game.myRole === 'host') {
    foot = (
      <button className="btn danger" onClick={dissolve} disabled={busy}>
        {busy ? '处理中…' : '解散这个局'}
      </button>
    )
  } else if (game.myRole === 'joined') {
    foot = (
      <button className="btn ghost" onClick={leave} disabled={busy}>
        {busy ? '处理中…' : '退出报名'}
      </button>
    )
  } else if (game.isFull) {
    foot = <button className="btn" disabled>已满员</button>
  } else {
    foot = (
      <button className="btn lime" onClick={join} disabled={busy}>
        {busy ? '提交中…' : `报名 · 人均 ¥${game.fee}`}
      </button>
    )
  }

  return (
    <>
      <div className="grab" />
      <div className="sheet-body">
        <div className="g-badges" style={{ marginBottom: 9 }}>
          {mine && <span className={'badge ' + mine.cls}>{mine.txt}</span>}
          <span className={'badge ' + badge.cls}>{badge.txt}</span>
          <span className="tag hi" style={{ marginLeft: 'auto' }}>{levelText(game)}</span>
        </div>

        <h2 className="d-title">{game.title}</h2>
        <p className="d-sub">
          {game.venue?.name} · {game.venue?.area} · 距离 {game.venue?.distanceKm}km
        </p>

        <div className="d-rows">
          <div className="d-row">
            <span>时间</span>
            <b>
              {dateLabel(game.date)} {game.startTime} – {game.endTime}
              <i>{game.duration} 分钟</i>
            </b>
          </div>
          <div className="d-row">
            <span>场馆</span>
            <b>
              {game.venue?.name}
              <i>{game.venue?.courts} 片 · {game.venue?.tag}</i>
            </b>
          </div>
          <div className="d-row">
            <span>模式</span>
            <b>{game.mode} · 上限 {game.maxPlayers} 人</b>
          </div>
          <div className="d-row">
            <span>费用</span>
            <b>
              人均 ¥{game.fee}
              <i>{game.slot ? `场地已锁定 ¥${game.slot.price}` : '未订场，自行解决'}</i>
            </b>
          </div>
          <div className="d-row">
            <span>发起</span>
            <b>
              {game.host?.name}
              <i>业余 {fmtLv(game.host?.level)} 级</i>
            </b>
          </div>
        </div>

        {game.myOrder && (
          <div className="paybox">
            <div className="paybox-l">
              <span>我的 AA 费用</span>
              <b>¥{game.myOrder.amount}</b>
            </div>
            <span className={'badge ' + orderBadge.cls}>{orderBadge.txt}</span>
            {orderStatus === 'unpaid' && game.status === 'open' && (
              <button className="btn lime small" onClick={pay} disabled={paying}>
                {paying ? '支付中…' : '去支付'}
              </button>
            )}
          </div>
        )}

        <p className="d-label">
          已报名 {game.playersCount} / {game.maxPlayers} 人
          {game.paidCount > 0 && <span style={{ fontWeight: 400 }}> · 已支付 {game.paidCount} 人</span>}
        </p>
        <div className="plist">
          {game.players.map((p) => (
            <div key={p.id} className={'pitem' + (p.me ? ' me' : '')}>
              <Avatar user={p} />
              <div>
                <div className="pn">
                  {p.name}
                  {p.me ? '（我）' : ''}
                </div>
                <div className="pl">业余 {fmtLv(p.level)} 级 · {lvName(p.level)}</div>
              </div>
              {p.isHost && <span className="ph">发起人</span>}
            </div>
          ))}
        </div>

        {game.note ? (
          <>
            <p className="d-label">发起人说</p>
            <div className="d-note">{game.note}</div>
          </>
        ) : null}
      </div>
      <div className="sheet-foot">{foot}</div>
    </>
  )
}
