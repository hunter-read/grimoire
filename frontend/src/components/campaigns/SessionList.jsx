import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuNotebook, LuPlus, LuTrash2, LuCalendar, LuChevronDown, LuChevronRight, LuSearch, LuX } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
}

function InlineNoteEditor({ campaign, sessionId, userId }) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const debounce = useRef(null)

  useEffect(() => {
    campaigns.getSession(campaign.id, sessionId).then(data => {
      const mine = data.player_notes.find(n => n.user_id === userId)
      setNote(mine?.content ?? '')
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [campaign.id, sessionId, userId])

  const handleChange = (val) => {
    setNote(val)
    setSaved(false)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setSaving(true)
      try {
        await campaigns.savePlayerNote(campaign.id, sessionId, val)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } finally {
        setSaving(false)
      }
    }, 800)
  }

  if (!loaded) return <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spinner size={18} /></div>

  return (
    <div style={{ padding: '14px 18px 18px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{t('sessions.myNotes')}</span>
        <span aria-live="polite" aria-atomic="true">
          {saving && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('sessions.saving')}</span>}
          {!saving && saved && <span style={{ fontSize: 11, color: 'var(--gold)' }}>{t('sessions.saved')}</span>}
        </span>
      </div>
      <textarea
        value={note}
        onChange={e => handleChange(e.target.value)}
        placeholder={t('sessions.notePlaceholder')}
        rows={6}
        style={{
          width: '100%', padding: '10px 12px', background: 'var(--bg-deep)',
          border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
          fontSize: 14, lineHeight: 1.7, resize: 'vertical', fontFamily: 'Alegreya, serif',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

function highlightMatch(text, query) {
  if (!query || !text) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'var(--gold-dim)', color: 'var(--text)', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function SessionList({ campaign, isOwner, onSelectSession, userId }) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const searchDebounce = useRef(null)

  const NOTE_TYPE_LABEL = {
    player:      { label: t('sessions.noteTypePLayerNote'),  color: 'var(--text-muted)' },
    gm_external: { label: t('sessions.noteTypeGmShared'),    color: 'var(--gold)'       },
    gm_internal: { label: t('sessions.noteTypeGmInternal'),  color: '#b87333'           },
  }

  const isPersonal = !campaign.is_gm_campaign

  const load = () => {
    campaigns.listSessions(campaign.id).then(setSessions).catch(() => setSessions([]))
  }

  useEffect(() => { load() }, [campaign.id])

  const handleQueryChange = (val) => {
    setQuery(val)
    clearTimeout(searchDebounce.current)
    if (!val.trim()) { setSearchResults(null); return }
    setSearching(true)
    searchDebounce.current = setTimeout(() => {
      campaigns.searchSessions(campaign.id, val.trim())
        .then(data => setSearchResults(data.results))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 350)
  }

  const createSession = async (e) => {
    e.preventDefault()
    if (!newDate) return
    setSaving(true)
    try {
      await campaigns.createSession(campaign.id, { session_date: newDate, title: newTitle || '' })
      setCreating(false)
      setNewDate('')
      setNewTitle('')
      load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteSession = async (sessionId, e) => {
    e.stopPropagation()
    if (!confirm(t('sessions.deleteConfirm'))) return
    await campaigns.deleteSession(campaign.id, sessionId)
    if (expandedId === sessionId) setExpandedId(null)
    load()
  }

  const handleSessionClick = (s) => {
    if (isPersonal) {
      setExpandedId(id => id === s.id ? null : s.id)
    } else {
      onSelectSession(s.id)
    }
  }

  if (!sessions) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={24} /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LuNotebook size={15} /> {t('sessions.title')}
        </h3>
        <button
          onClick={() => setCreating(!creating)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13,
          }}
        >
          <LuPlus size={14} /> {t('sessions.newSession')}
        </button>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <LuSearch size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          placeholder={t('sessions.searchPlaceholder')}
          style={{
            width: '100%', padding: '8px 32px 8px 32px', boxSizing: 'border-box',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text)', fontSize: 13,
          }}
        />
        {query && (
          <button
            onClick={() => handleQueryChange('')}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
          >
            <LuX size={13} />
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={createSession}
          style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 10,
            padding: '16px 18px', marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 12 }}>{t('sessions.createSession')}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>{t('sessions.dateLabel')}</label>
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle}>{t('sessions.titleLabel')}</label>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder={t('sessions.titlePlaceholder')}
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setCreating(false)} style={cancelBtn}>{t('sessions.cancel')}</button>
              <button type="submit" disabled={saving} style={submitBtn}>{saving ? '...' : t('sessions.create')}</button>
            </div>
          </div>
        </form>
      )}

      {/* Search results */}
      {query.trim() && (
        <div style={{ marginBottom: 16 }}>
          {searching ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner size={20} /></div>
          ) : searchResults && searchResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 14, color: 'var(--text-muted)' }}>
              {t('sessions.noNotesFound', { query })}
            </div>
          ) : searchResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {searchResults.map((r, i) => {
                const typeInfo = NOTE_TYPE_LABEL[r.note_type] ?? NOTE_TYPE_LABEL.player
                const authorLabel = r.author_display_name || r.author_username
                return (
                  <div
                    key={i}
                    onClick={() => onSelectSession(r.session_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectSession(r.session_id) } }}
                    style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                      padding: '12px 16px', cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>
                        {r.session_title || `Session — ${formatDate(r.session_date)}`}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDate(r.session_date)}</span>
                      <span style={{ fontSize: 11, color: typeInfo.color, marginLeft: 'auto' }}>
                        {typeInfo.label}{r.note_type === 'player' ? ` · ${authorLabel}` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, fontFamily: 'Alegreya, serif' }}>
                      {highlightMatch(r.snippet, query)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Session list — hidden while search is active */}
      {!query.trim() && sessions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          <LuNotebook size={32} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>{t('sessions.noSessions')}</div>
        </div>
      )}
      {!query.trim() && sessions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map(s => {
            const isExpanded = expandedId === s.id
            return (
              <div
                key={s.id}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                  overflow: 'hidden',
                  borderColor: isExpanded ? 'var(--border-light)' : 'var(--border)',
                  transition: 'border-color 0.15s',
                }}
              >
                <div
                  onClick={() => handleSessionClick(s)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSessionClick(s) } }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isPersonal ? isExpanded : undefined}
                  style={{
                    padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <div style={{
                    width: 36, height: 36, background: 'var(--bg-deep)', border: '1px solid var(--border)',
                    borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <LuCalendar size={16} style={{ color: 'var(--gold)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{s.title || `Session — ${formatDate(s.session_date)}`}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{formatDate(s.session_date)}</div>
                  </div>
                  {isPersonal && (
                    isExpanded
                      ? <LuChevronDown size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      : <LuChevronRight size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                  )}
                  {isOwner && (
                    <button
                      onClick={(e) => deleteSession(s.id, e)}
                      aria-label={`Delete session ${s.title || formatDate(s.session_date)}`}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, flexShrink: 0 }}
                    >
                      <LuTrash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>

                {isPersonal && isExpanded && (
                  <InlineNoteEditor campaign={campaign} sessionId={s.id} userId={userId} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const labelStyle = { fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }
const inputStyle = { padding: '8px 10px', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14, colorScheme: 'dark', accentColor: 'var(--gold)' }
const cancelBtn = { padding: '8px 14px', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13 }
const submitBtn = { padding: '8px 14px', background: 'var(--gold)', border: 'none', borderRadius: 8, color: '#1a1209', cursor: 'pointer', fontSize: 13, fontWeight: 600 }
