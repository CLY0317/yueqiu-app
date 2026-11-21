import { useEffect, useRef } from 'react'
import { BrowserRouter, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, SheetProvider, ToastProvider, useAuth } from './state.jsx'
import { Intro, StatusBar } from './ui.jsx'
import Home from './pages/Home.jsx'
import Create from './pages/Create.jsx'
import Feed from './pages/Feed.jsx'
import Mine from './pages/Mine.jsx'
import Login from './pages/Login.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="create" element={<Create />} />
            <Route path="feed" element={<Feed />} />
            <Route path="me" element={<Mine />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

function Layout() {
  const { ready, user } = useAuth()
  const location = useLocation()
  const screenRef = useRef(null)
  const authed = !!user

  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = 0
  }, [location.pathname, authed])

  return (
    <div className="stage">
      <Intro />
      <div className="phone">
        <div className="notch" />
        <StatusBar />
        <ToastProvider>
          <SheetProvider>
            <div className="screens">
              <main className="screen" ref={screenRef}>
                {!ready ? <Boot /> : !authed ? <Login /> : <Outlet />}
              </main>
            </div>
            {authed && <TabBar />}
            {authed && location.pathname === '/create' && <PublishBar />}
          </SheetProvider>
        </ToastProvider>
      </div>
    </div>
  )
}

function Boot() {
  return (
    <div className="empty">
      <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span className="spin" /> 正在连接后端…
      </p>
    </div>
  )
}

function PublishBar() {
  return (
    <div className="pubbar">
      <button className="btn lime" type="submit" form="create-game-form">
        发布这个局 · 开始召集
      </button>
    </div>
  )
}

const tabs = [
  {
    to: '/',
    label: '约球',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h11M4 18h7" />
      </svg>
    ),
  },
  {
    to: '/create',
    label: '发局',
    fab: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    to: '/feed',
    label: '球友圈',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.8 8.8 0 0 1-3.6-.8L3 21l1.9-5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
      </svg>
    ),
  },
  {
    to: '/me',
    label: '我的',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
    ),
  },
]

function TabBar() {
  return (
    <nav className="tabbar">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => 'tab' + (isActive ? ' on' : '') + (t.fab ? ' fab' : '')}
        >
          {t.fab ? <span className="fabwrap">{t.icon}</span> : t.icon}
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
