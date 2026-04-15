import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPause, LuPlay, LuSearch, LuArrowDown } from 'react-icons/lu'
import api from '../../api'

const LEVELS = ['debug', 'info', 'warning', 'error', 'critical']

const LEVEL_COLORS = {
  DEBUG:    '#9ca3af',
  INFO:     '#e5e7eb',
  WARNING:  '#fbbf24',
  ERROR:    '#f87171',
  CRITICAL: '#ff6b6b',
}

const LEVEL_BG = {
  DEBUG:    'transparent',
  INFO:     'transparent',
  WARNING:  'rgba(251,191,36,0.07)',
  ERROR:    'rgba(248,113,113,0.09)',
  CRITICAL: 'rgba(255,107,107,0.14)',
}

const LEVEL_LABELS = {
  DEBUG: 'DEBUG', INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL',
}

const INITIAL_LIMIT = 1000

function LevelBadge({ level }) {
  const color = LEVEL_COLORS[level] ?? LEVEL_COLORS.INFO
  return (
    <span
      aria-label={`Log level: ${LEVEL_LABELS[level] ?? level}`}
      style={{ color, fontWeight: level === 'DEBUG' ? 400 : 600, letterSpacing: '0.02em', minWidth: 56, display: 'inline-block' }}
    >
      {LEVEL_LABELS[level] ?? level}
    </span>
  )
}

function LogRow({ entry, searchQuery }) {
  const bg   = LEVEL_BG[entry.level] ?? 'transparent'
  const time = entry.timestamp.slice(11, 23)

  let messageContent = entry.message
  if (searchQuery) {
    const idx = entry.message.toLowerCase().indexOf(searchQuery.toLowerCase())
    if (idx !== -1) {
      messageContent = (
        <>
          {entry.message.slice(0, idx)}
          <mark style={{ background: 'rgba(251,191,36,0.35)', color: 'inherit', borderRadius: 2 }}>
            {entry.message.slice(idx, idx + searchQuery.length)}
          </mark>
          {entry.message.slice(idx + searchQuery.length)}
        </>
      )
    }
  }

  return (
    <div role="row" style={{ display: 'grid', gridTemplateColumns: '90px 72px 1fr', gap: '0 10px', padding: '3px 12px', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.55, background: bg, borderBottom: '1px solid rgba(255,255,255,0.03)', wordBreak: 'break-word' }}>
      <span role="cell" aria-label={`Time: ${time}`} style={{ color: '#6b7280', flexShrink: 0, userSelect: 'none' }}>{time}</span>
      <span role="cell"><LevelBadge level={entry.level} /></span>
      <span role="cell" aria-label={`Message: ${entry.message}`} style={{ color: LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.INFO }}>{messageContent}</span>
    </div>
  )
}

function isAtBottom(el, threshold = 40) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

export default function LogsTab() {
  const { t } = useTranslation()
  const [level,       setLevel]       = useState('info')
  const [search,      setSearch]      = useState('')
  const [entries,     setEntries]     = useState([])
  const [total,       setTotal]       = useState(0)
  const [live,        setLive]        = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pinned,      setPinned]      = useState(true)
  const [error,       setError]       = useState(null)

  const containerRef    = useRef(null)
  const sentinelRef     = useRef(null)
  const scrollAnchorRef = useRef(null)
  const levelRef      = useRef(level)
  const lastSeqRef    = useRef(0)   // max_seq from last successful fetch; poll cursor
  const liveRef       = useRef(live)

  useEffect(() => { levelRef.current = level }, [level])
  useEffect(() => { liveRef.current  = live  }, [live])

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    const anchor = scrollAnchorRef.current
    if (!anchor) return
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollTop + (el.scrollHeight - anchor)
    scrollAnchorRef.current = null
  })

  useEffect(() => {
    if (pinned) scrollToBottom()
  }, [entries, pinned, scrollToBottom])

  useEffect(() => {
    let cancelled = false
    setEntries([])
    setTotal(0)
    lastSeqRef.current = 0
    setPinned(true)
    setError(null)

    api.get(`/logs?level=${level}&limit=${INITIAL_LIMIT}&offset=0`)
      .then(data => {
        if (cancelled) return
        setEntries(data.entries)
        setTotal(data.total)
        lastSeqRef.current = data.max_seq ?? 0
      })
      .catch(e => {
        if (!cancelled) setError(e.message ?? 'Failed to load logs')
      })

    return () => { cancelled = true }
  }, [level])

  useEffect(() => {
    const id = setInterval(async () => {
      if (!liveRef.current) return
      const seq = lastSeqRef.current
      if (seq === 0) return
      try {
        const data = await api.get(
          `/logs?level=${levelRef.current}&limit=${INITIAL_LIMIT}&after_seq=${seq}`
        )
        if (!data.entries.length) return
        setEntries(prev => [...prev, ...data.entries])
        setTotal(data.total)
        lastSeqRef.current = data.max_seq
      } catch (_) {}
    }, 1000)

    return () => clearInterval(id)
  }, [])

  const totalRef        = useRef(0)
  const entriesLenRef   = useRef(0)
  useEffect(() => { totalRef.current      = total          }, [total])
  useEffect(() => { entriesLenRef.current = entries.length }, [entries.length])

  const loadOlder = useCallback(async () => {
    if (loadingMore) return
    const currentTotal  = totalRef.current
    const currentLen    = entriesLenRef.current
    const olderCount    = currentTotal - currentLen
    if (olderCount <= 0) return

    setLoadingMore(true)
    const el = containerRef.current
    if (el) scrollAnchorRef.current = el.scrollHeight

    try {
      const pageSize = Math.min(500, olderCount)
      const data = await api.get(
        `/logs?level=${levelRef.current}&limit=${pageSize}&offset=${currentLen}`
      )
      setEntries(prev => [...data.entries, ...prev])
      setTotal(data.total)
    } catch (_) {}
    setLoadingMore(false)
  }, [loadingMore])

  useEffect(() => {
    const sentinel  = sentinelRef.current
    const container = containerRef.current
    if (!sentinel || !container) return
    const observer = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) loadOlder() },
      { root: container, threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadOlder])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setPinned(isAtBottom(el))
  }, [])

  const filtered = search
    ? entries.filter(e => e.message.toLowerCase().includes(search.toLowerCase()))
    : entries

  const hasOlder = total > entries.length

  return (
    <div>
      <div role="toolbar" aria-label={t('logs.toolbarAriaLabel')} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>

        <div role="group" aria-label={t('logs.levelGroupAriaLabel')} style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {LEVELS.map((l, idx) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              aria-pressed={level === l}
              aria-label={t('logs.showLevelAbove', { level: l })}
              style={{
                padding: '6px 14px', fontSize: 12, cursor: 'pointer', border: 'none',
                borderRight: idx < LEVELS.length - 1 ? '1px solid var(--border)' : 'none',
                background: level === l ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                color: level === l ? 'var(--gold)' : 'var(--text-dim)',
                textTransform: 'uppercase', fontFamily: 'monospace',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <button
          onClick={() => setLive(v => !v)}
          aria-pressed={live}
          aria-label={live ? t('logs.pauseAriaLabel') : t('logs.resumeAriaLabel')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
            background: live ? 'rgba(80,180,80,0.12)' : 'var(--bg-card)',
            border: `1px solid ${live ? 'rgba(80,180,80,0.4)' : 'var(--border)'}`,
            color: live ? '#6fcf6f' : 'var(--text-dim)', transition: 'all 0.15s',
          }}
        >
          {live ? <LuPause size={13} aria-hidden="true" /> : <LuPlay size={13} aria-hidden="true" />}
          <span>{live ? t('logs.liveButton') : t('logs.pausedButton')}</span>
        </button>

        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <LuSearch size={13} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('logs.searchPlaceholder')}
            aria-label={t('logs.searchAriaLabel')}
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: 10, paddingTop: 6, paddingBottom: 6, fontSize: 13, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
          />
        </div>
      </div>

      {error && <div role="alert" style={{ marginBottom: 12, fontSize: 13, color: '#f87171' }}>{error}</div>}

      <div style={{ position: 'relative' }}>
        <div
          ref={containerRef}
          role="log"
          aria-label={t('logs.logOutputAriaLabel')}
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="additions"
          tabIndex={0}
          onScroll={handleScroll}
          style={{ background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, height: 480, overflowY: 'auto', overflowX: 'hidden', outline: 'none' }}
          onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--gold)' }}
          onBlur={e => { e.currentTarget.style.boxShadow = 'none' }}
        >
          <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />

          {loadingMore && (
            <div role="status" aria-label={t('logs.loadingOlderAriaLabel')} style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {t('logs.loadingOlder')}
            </div>
          )}

          {hasOlder && !loadingMore && (
            <div aria-label={t('logs.olderCountAriaLabel', { count: total - entries.length })} style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {t('logs.olderEntries', { count: total - entries.length })}
            </div>
          )}

          {filtered.length === 0 ? (
            <div role="status" style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              {search
                ? t('logs.noEntriesMatch', { query: search })
                : <span>{t('logs.noEntriesLevel', { level })}</span>
              }
            </div>
          ) : (
            <div role="rowgroup">
              {filtered.map((e, i) => <LogRow key={`${e.timestamp}-${i}`} entry={e} searchQuery={search} />)}
            </div>
          )}
        </div>

        {!pinned && (
          <button
            onClick={() => { setPinned(true); scrollToBottom() }}
            aria-label={t('logs.jumpToLatest')}
            style={{ position: 'absolute', bottom: 12, right: 12, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-dim)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', transition: 'background 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-card)' }}
          >
            <LuArrowDown size={12} aria-hidden="true" />
            {t('logs.jumpToLatest')}
          </button>
        )}
      </div>
    </div>
  )
}
