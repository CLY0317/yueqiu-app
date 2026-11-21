import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 极简数据请求 hook：loading / error / data / reload
 * 依赖变化或调用 reload() 时重新拉取；组件卸载后不再 setState。
 */
export function useApi(fn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.resolve()
      .then(() => fnRef.current())
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { data, loading, error, reload }
}
