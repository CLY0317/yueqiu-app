/** API 客户端：access token + refresh 轮换 + 401 自动续期 */

const ACCESS_KEY = 'yq_access'
const REFRESH_KEY = 'yq_refresh'

let access = localStorage.getItem(ACCESS_KEY) || ''
let refresh = localStorage.getItem(REFRESH_KEY) || ''
let refreshing = null

export class ApiError extends Error {
  constructor(message, status, code, field) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
  }
}

export function setTokens(res) {
  access = res.accessToken || ''
  refresh = res.refreshToken || refresh
  if (access) localStorage.setItem(ACCESS_KEY, access)
  else localStorage.removeItem(ACCESS_KEY)
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens() {
  access = ''
  refresh = ''
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export const getRefreshToken = () => refresh
export const hasSession = () => !!refresh

function authLost() {
  clearTokens()
  window.dispatchEvent(new CustomEvent('yq:logout'))
}

async function raw(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('连不上服务器，确认 API 已启动', 0, 'NETWORK')
  }

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const e = data?.error || {}
    throw new ApiError(e.message || `请求失败（${res.status}）`, res.status, e.code, e.field)
  }
  return data
}

async function ensureRefresh() {
  if (!refresh) {
    authLost()
    throw new ApiError('请先登录', 401, 'UNAUTHORIZED')
  }
  if (!refreshing) {
    refreshing = raw('/auth/refresh', { method: 'POST', body: { refreshToken: refresh } })
      .then((res) => {
        setTokens(res)
        return res
      })
      .catch((err) => {
        authLost()
        throw err
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

async function request(path, opts = {}) {
  try {
    return await raw(path, opts)
  } catch (err) {
    if (err.status === 401 && !opts.retried && hasSession()) {
      await ensureRefresh()
      return raw(path, opts)
    }
    throw err
  }
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  del: (path) => request(path, { method: 'DELETE' }),
}
