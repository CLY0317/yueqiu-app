import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth, useToast } from '../state.jsx'
import { Shuttle } from '../ui.jsx'

export default function Login() {
  const { login } = useAuth()
  const toast = useToast()

  const [phone, setPhone] = useState('13800000000')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!countdown) return undefined
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  async function sendCode() {
    if (countdown || sending) return
    setErr('')
    setSending(true)
    try {
      const res = await api.post('/auth/sms', { phone })
      setCountdown(60)
      if (res.devCode) {
        setDevCode(res.devCode)
        setCode(res.devCode)
        toast.show('演示环境：验证码已自动填入')
      } else {
        toast.show('验证码已发送，请查收短信')
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setSending(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setErr('')
    setBusy(true)
    try {
      await login({ phone, code })
      toast.show('登录成功')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = /^1[3-9]\d{9}$/.test(phone) && /^\d{6}$/.test(code)

  return (
    <div className="login">
      <div className="login-logo">
        <Shuttle size={34} />
      </div>
      <h1>羽球局</h1>
      <p className="login-sub">手机号 + 验证码登录，第一次登录自动注册</p>

      <form onSubmit={submit}>
        <div className="field">
          <label>手机号</label>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={11}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="11 位手机号"
          />
        </div>

        <div className="field">
          <label>验证码</label>
          <div className="code-row">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6 位验证码"
            />
            <button type="button" className="btn ghost small" onClick={sendCode} disabled={!!countdown || sending}>
              {countdown ? `${countdown}s` : sending ? '发送中' : '获取验证码'}
            </button>
          </div>
        </div>

        {devCode && (
          <p className="login-hint">
            演示环境不接短信网关，验证码是 <b>{devCode}</b>（已自动填入）
          </p>
        )}
        {err && <p className="login-err">{err}</p>}

        <button className="btn lime login-btn" type="submit" disabled={!canSubmit || busy}>
          {busy ? '登录中…' : '登录 / 注册'}
        </button>
      </form>

      <p className="login-foot">
        演示账号：<b>13800000000</b>（林小羽）· 已报名一局、有一笔待支付
      </p>
    </div>
  )
}
