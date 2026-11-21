import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useApi } from '../hooks.js'
import { useSheet, useToast } from '../state.jsx'
import { Avatar, ErrorBanner, SkeletonList } from '../ui.jsx'
import { fmtLv, timeAgo } from '../format.js'

export default function Feed() {
  const { data, loading, error, reload } = useApi(() => api.get('/feed'), [])
  const [posts, setPosts] = useState([])
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const sheet = useSheet()
  const toast = useToast()

  useEffect(() => {
    if (data?.posts) setPosts(data.posts)
  }, [data])

  async function publish() {
    const value = text.trim()
    if (!value || posting) return
    setPosting(true)
    try {
      const res = await api.post('/feed', { text: value })
      setPosts((list) => [res.post, ...list])
      setText('')
      toast.show('已发布到球友圈')
    } catch (err) {
      toast.show(err.message)
    } finally {
      setPosting(false)
    }
  }

  async function toggleLike(post) {
    const optimistic = { ...post, liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) }
    setPosts((list) => list.map((p) => (p.id === post.id ? optimistic : p)))
    try {
      const res = await api.post(`/feed/${post.id}/like`)
      setPosts((list) => list.map((p) => (p.id === post.id ? res.post : p)))
    } catch (err) {
      setPosts((list) => list.map((p) => (p.id === post.id ? post : p)))
      toast.show(err.message)
    }
  }

  function openComments(post) {
    sheet.openSheet(<CommentSheet post={post} onChange={reload} />)
  }

  return (
    <>
      <header className="topbar">
        <h1>球友圈</h1>
        <p className="sub">{loading ? '正在加载动态…' : `${posts.length} 条动态`}</p>
      </header>

      <div className="composer">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') publish()
          }}
          maxLength={200}
          placeholder="分享你的球场瞬间…"
        />
        <button className="btn" type="button" onClick={publish} disabled={posting}>
          {posting ? '…' : '发布'}
        </button>
      </div>

      {error && <ErrorBanner error={error} onRetry={reload} />}

      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <div className="list">
          {posts.map((p) => (
            <article key={p.id} className="post">
              <div className="p-head">
                <Avatar user={p.author} />
                <div>
                  <div className="p-name">{p.author?.name}</div>
                  <div className="p-time">{timeAgo(p.createdAt)}</div>
                </div>
                <span className="p-lv">{fmtLv(p.author?.level)} 级</span>
              </div>
              <p className="p-text">{p.text}</p>
              <div className="p-acts">
                <button type="button" className={p.liked ? 'liked' : ''} onClick={() => toggleLike(p)}>
                  <span className="hrt">♥</span> {p.likeCount}
                </button>
                <button type="button" onClick={() => openComments(p)}>
                  💬 {p.commentCount}
                </button>
                <button type="button" style={{ marginLeft: 'auto' }} onClick={() => toast.show('分享功能还没做（下一版）')}>
                  ↗ 分享
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}

function CommentSheet({ post, onChange }) {
  const req = useApi(() => api.get(`/posts/${post.id}/comments`), [post.id])
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (req.data) setComments(req.data.comments)
  }, [req.data])

  async function send() {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const res = await api.post(`/posts/${post.id}/comments`, { text: value })
      setComments((list) => [...list, res.comment])
      setText('')
      onChange?.()
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
        <h2 className="d-title" style={{ fontSize: 18 }}>评论 · {comments.length}</h2>
        <p className="d-sub">{post.author?.name}：{post.text.slice(0, 36)}{post.text.length > 36 ? '…' : ''}</p>

        {req.loading ? (
          <p className="tips">
            <span className="spin" /> 加载中…
          </p>
        ) : comments.length === 0 ? (
          <div className="empty">
            <p>还没有人评论，来说两句</p>
          </div>
        ) : (
          <div className="comments">
            {comments.map((c) => (
              <div key={c.id} className="comment">
                <Avatar user={c.author} />
                <div>
                  <div className="c-head">
                    <span className="c-name">{c.author?.name}</span>
                    <span className="c-time">{timeAgo(c.createdAt)}</span>
                  </div>
                  <div className="c-text">{c.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sheet-foot" style={{ gap: 8 }}>
        <input
          className="comment-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          maxLength={200}
          placeholder="说点什么…"
        />
        <button className="btn lime" type="button" onClick={send} disabled={busy || !text.trim()}>
          发送
        </button>
      </div>
    </>
  )
}
