import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useApi } from '../hooks.js'
import { useSheet, useToast } from '../state.jsx'
import { timeAgo } from '../format.js'

const ICON = {
  game_join: '🙋',
  game_cancel: '⚠️',
  comment: '💬',
  payment: '💰',
  system: '🔔',
}

export default function NotificationsSheet({ onChange }) {
  const req = useApi(() => api.get('/notifications'), [])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const sheet = useSheet()
  const toast = useToast()

  useEffect(() => {
    if (!req.data) return
    setItems(req.data.notifications)
    setLoading(false)
    // 打开即视为已读
    if (req.data.unread > 0) {
      api
        .post('/notifications/read', {})
        .then(() => onChange?.())
        .catch(() => {})
    }
  }, [req.data, onChange])

  useEffect(() => {
    if (req.error) {
      setLoading(false)
      toast.show(req.error.message)
    }
  }, [req.error, toast])

  return (
    <>
      <div className="grab" />
      <div className="sheet-body">
        <h2 className="d-title" style={{ fontSize: 18 }}>消息通知</h2>
        <p className="d-sub">有人报名、评论、支付或球局被解散时，都会在这里</p>

        {loading ? (
          <div className="empty">
            <p>
              <span className="spin" /> 加载中…
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <p>还没有新消息</p>
          </div>
        ) : (
          <div className="notes">
            {items.map((n) => (
              <div key={n.id} className={'note' + (n.read ? '' : ' unread')}>
                <span className="note-ic">{ICON[n.type] || '🔔'}</span>
                <div>
                  <div className="note-t">{n.title}</div>
                  <div className="note-b">{n.body}</div>
                  <div className="note-time">{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sheet-foot">
        <button className="btn ghost" type="button" onClick={() => sheet.close()}>
          关闭
        </button>
      </div>
    </>
  )
}
