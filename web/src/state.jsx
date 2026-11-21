import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, clearTokens, getRefreshToken, hasSession, setTokens } from './api.js'

/* ----------------------------- 登录态 ----------------------------- */
const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function boot() {
      if (hasSession()) {
        try {
          const me = await api.get('/auth/me')
          if (!cancelled) setUser(me.user)
        } catch {
          clearTokens()
        }
      }
      if (!cancelled) setReady(true)
    }

    const onLogout = () => setUser(null)
    window.addEventListener('yq:logout', onLogout)
    boot()

    return () => {
      cancelled = true
      window.removeEventListener('yq:logout', onLogout)
    }
  }, [])

  const login = useCallback(async ({ phone, code, name }) => {
    const res = await api.post('/auth/login', { phone, code, name: name || undefined })
    setTokens(res)
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: getRefreshToken() })
    } catch {
      /* 忽略 */
    }
    clearTokens()
    setUser(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ user, ready, login, logout }}>{children}</AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)

/* ------------------------------ Toast ------------------------------ */
const ToastCtx = createContext(null)

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('')
  const timer = useRef(null)

  const show = useCallback((m) => {
    setMsg(String(m || ''))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(''), 2400)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className={'toast' + (msg ? ' on' : '')}>{msg}</div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx) || { show: () => {} }

/* --------------------------- 底部弹层 --------------------------- */
const SheetCtx = createContext(null)

export function SheetProvider({ children }) {
  const [node, setNode] = useState(null)
  const [open, setOpen] = useState(false)

  const close = useCallback(() => setOpen(false), [])
  const openSheet = useCallback((element) => {
    setNode(element)
    setOpen(true)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <SheetCtx.Provider value={{ openSheet, close }}>
      {children}
      <div className={'mask' + (open ? ' on' : '')} onClick={close} />
      <div className={'sheet' + (open ? ' on' : '')}>{node}</div>
    </SheetCtx.Provider>
  )
}

export const useSheet = () => useContext(SheetCtx)
