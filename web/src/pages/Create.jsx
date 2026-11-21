import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useApi } from '../hooks.js'
import { useToast } from '../state.jsx'
import { lvName, ymd } from '../format.js'

const MODES = [
  { v: '单打', n: 2 },
  { v: '双打', n: 4 },
  { v: '6人转', n: 6 },
  { v: '8人转', n: 8 },
]

const DURATIONS = [
  { v: 60, label: '1 小时' },
  { v: 90, label: '1.5 小时' },
  { v: 120, label: '2 小时' },
  { v: 150, label: '2.5 小时' },
  { v: 180, label: '3 小时' },
]

function addMinutes(hhmm, min) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = (((h * 60 + m + min) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export default function Create() {
  const venuesReq = useApi(() => api.get('/venues'), [])
  const navigate = useNavigate()
  const toast = useToast()

  const [form, setForm] = useState({
    title: '',
    venueId: '',
    date: ymd(new Date()),
    startTime: '19:30',
    duration: 120,
    mode: '双打',
    level: 3.5,
    fee: 35,
    note: '',
  })
  const [slotId, setSlotId] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotLoading, setSlotLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  const venues = venuesReq.data?.venues || []
  const maxPlayers = MODES.find((m) => m.v === form.mode)?.n || 4
  const lo = Math.max(1, Number(form.level) - 1)
  const hi = Math.min(9, Number(form.level) + 1)

  useEffect(() => {
    if (venues.length && !form.venueId) setForm((f) => ({ ...f, venueId: venues[0].id }))
  }, [venues, form.venueId])

  useEffect(() => {
    if (!form.venueId) return undefined
    let cancelled = false
    setSlotLoading(true)
    api
      .get(`/venues/${form.venueId}/slots?date=${form.date}`)
      .then((res) => {
        if (cancelled) return
        setSlots(res.slots)
        setSlotId((current) => (res.slots.some((s) => s.id === current && s.status === 'free') ? current : null))
      })
      .catch(() => {
        if (!cancelled) setSlots([])
      })
      .finally(() => {
        if (!cancelled) setSlotLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.venueId, form.date])

  const selectedSlot = useMemo(() => slots.find((s) => s.id === slotId) || null, [slots, slotId])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function pickSlot(slot) {
    if (slot.status !== 'free') {
      toast.show('这个时段已经被订走了')
      return
    }
    const nextSlotId = slotId === slot.id ? null : slot.id
    setSlotId(nextSlotId)
    if (nextSlotId) {
      setForm((f) => ({
        ...f,
        startTime: slot.startTime,
        duration: slot.duration,
        fee: Math.ceil(slot.price / maxPlayers),
      }))
    }
  }

  function pickMode(mode) {
    const n = MODES.find((m) => m.v === mode)?.n || 4
    setForm((f) => ({
      ...f,
      mode,
      fee: selectedSlot ? Math.ceil(selectedSlot.price / n) : f.fee,
    }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrMsg('')
    try {
      await api.post('/games', {
        ...form,
        duration: Number(form.duration),
        level: Number(form.level),
        fee: Number(form.fee),
        slotId: slotId || undefined,
      })
      toast.show(slotId ? '发布成功 · 场地已锁定' : '发布成功 · 已出现在大厅')
      navigate('/')
    } catch (err) {
      setErrMsg(err.message || '发布失败')
      toast.show(err.message || '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="tb-row">
          <div className="city" style={{ cursor: 'default', background: 'var(--lime)', borderColor: 'var(--lime-d)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M12 5v14M5 12h14" />
            </svg>
            发起新的局
          </div>
        </div>
        <h1>组一个<em>羽毛球局</em></h1>
        <p className="sub">选个场地时段，剩下的交给球友来拼</p>
      </header>

      {errMsg && <div className="banner" style={{ marginTop: 0 }}>{errMsg}</div>}

      <form className="form" id="create-game-form" onSubmit={onSubmit}>
        <div className="field">
          <label>局名（可留空）</label>
          <input type="text" value={form.title} onChange={set('title')} maxLength={40} placeholder="例：周五晚 · 中级双打" />
        </div>

        <div className="field">
          <label>场馆</label>
          <select value={form.venueId} onChange={set('venueId')}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.area}（今日可订 {v.freeSlotsToday} 个时段）
              </option>
            ))}
          </select>
        </div>

        <div className="row2">
          <div className="field">
            <label>日期</label>
            <input type="date" value={form.date} min={ymd(new Date())} onChange={set('date')} />
          </div>
          <div className="field">
            <label>开始时间</label>
            <input type="time" value={form.startTime} onChange={(e) => { setSlotId(null); set('startTime')(e) }} />
          </div>
        </div>

        <div className="field">
          <label>
            订场（可选）
            {slotLoading && <span className="spin" style={{ marginLeft: 8, verticalAlign: 'middle' }} />}
          </label>
          <div className="slots">
            <button
              type="button"
              className={'slot' + (slotId === null ? ' on' : '')}
              onClick={() => setSlotId(null)}
            >
              <b>只约球</b>
              <small>自己找场</small>
            </button>
            {slots.map((s) => (
              <button
                key={s.id}
                type="button"
                className={'slot' + (slotId === s.id ? ' on' : '') + (s.status !== 'free' ? ' off' : '')}
                onClick={() => pickSlot(s)}
                disabled={s.status !== 'free'}
              >
                <b>{s.startTime}</b>
                <small>{s.status === 'free' ? `¥${s.price}` : '已订'}</small>
              </button>
            ))}
            {!slots.length && !slotLoading && <p className="tips">这一天没有可订时段，换一天试试</p>}
          </div>
          {selectedSlot && (
            <p className="tips" style={{ marginTop: 10 }}>
              场地费 ¥{selectedSlot.price}，按 {maxPlayers} 人 AA ≈ <b>¥{Math.ceil(selectedSlot.price / maxPlayers)}/人</b>
            </p>
          )}
        </div>

        <div className="field">
          <label>时长</label>
          <div className="segs">
            {DURATIONS.map((d) => (
              <button
                key={d.v}
                type="button"
                className={'seg' + (Number(form.duration) === d.v ? ' on' : '')}
                onClick={() => setForm((f) => ({ ...f, duration: d.v }))}
                disabled={!!selectedSlot && selectedSlot.duration !== d.v}
              >
                {d.label}
              </button>
            ))}
          </div>
          {selectedSlot && <p className="tips" style={{ marginTop: 8 }}>时长跟随所订时段（{selectedSlot.duration} 分钟）</p>}
        </div>

        <div className="field">
          <label>模式</label>
          <div className="segs">
            {MODES.map((m) => (
              <button key={m.v} type="button" className={'seg' + (form.mode === m.v ? ' on' : '')} onClick={() => pickMode(m.v)}>
                {m.v}
                <small>{m.v.endsWith('转') ? '轮转' : m.n + ' 人'}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>水平要求</label>
          <div className="lv-wrap">
            <input
              type="range"
              min="1"
              max="9"
              step="0.5"
              value={form.level}
              onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))}
            />
            <div className="lv-out">{lvName(Number(form.level))}</div>
          </div>
          <p className="tips">可拼 {lo} – {hi} 级 · 同水平好打起来</p>
        </div>

        <div className="row2">
          <div className="field">
            <label>AA 人均（元）</label>
            <input type="number" min="0" max="500" step="1" value={form.fee} onChange={set('fee')} />
          </div>
          <div className="field">
            <label>人数上限</label>
            <input type="text" readOnly value={`${maxPlayers} 人（${form.mode}）`} style={{ color: 'var(--muted)' }} />
          </div>
        </div>

        <div className="field">
          <label>备注</label>
          <textarea value={form.note} onChange={set('note')} maxLength={200} placeholder="例：木地板，球自带，AA 场地费，来能拉吊的。" />
        </div>

        <p className="tips" style={{ textAlign: 'center', paddingBottom: 4 }}>
          发布后 {addMinutes(form.startTime || '19:30', Number(form.duration))} 结束 · 报名即生成 AA 待支付订单
        </p>
      </form>
    </>
  )
}
