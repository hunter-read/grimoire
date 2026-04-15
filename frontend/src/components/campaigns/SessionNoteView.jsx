import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronLeft, LuUser, LuShield, LuEye, LuEyeOff, LuPencil, LuCheck, LuX } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
  display: 'flex', alignItems: 'center', color: 'var(--text-muted)',
}

function NoteEditor({ label, value, onChange, placeholder, readOnly, lastSaved }) {
  const { t } = useTranslation()
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        {lastSaved && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('sessionNote.saved')}</span>}
      </div>
      <textarea
        value={value}
        onChange={onChange ? e => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        rows={8}
        style={{
          width: '100%', padding: '12px 14px', background: readOnly ? 'var(--bg-deep)' : 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 10, color: readOnly ? 'var(--text-dim)' : 'var(--text)',
          fontSize: 14, lineHeight: 1.7, resize: 'vertical', fontFamily: 'Alegreya, serif',
          boxSizing: 'border-box', opacity: readOnly ? 0.8 : 1,
        }}
      />
    </div>
  )
}

export default function SessionNoteView({ campaign, sessionId, isOwner, userId, onBack }) {
  const { t } = useTranslation()
  const [session, setSession] = useState(null)
  const [myNote, setMyNote] = useState('')
  const [gmInternal, setGmInternal] = useState('')
  const [gmExternal, setGmExternal] = useState('')
  const [savingPlayer, setSavingPlayer] = useState(false)
  const [savingGm, setSavingGm] = useState(false)
  const [savedPlayer, setSavedPlayer] = useState(false)
  const [savedGm, setSavedGm] = useState(false)
  const [showInternal, setShowInternal] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')

  const playerDebounce = useRef(null)
  const gmDebounce = useRef(null)

  useEffect(() => {
    campaigns.getSession(campaign.id, sessionId).then(data => {
      setSession(data)
      setTitleValue(data.title ?? '')
      const mine = data.player_notes.find(n => n.user_id === userId)
      if (mine) setMyNote(mine.content)
      if (data.gm_note) {
        setGmInternal(data.gm_note.internal_content ?? '')
        setGmExternal(data.gm_note.external_content ?? '')
      }
    })
  }, [campaign.id, sessionId, userId])

  const saveTitle = async () => {
    await campaigns.updateSession(campaign.id, sessionId, { title: titleValue.trim() })
    setSession(prev => ({ ...prev, title: titleValue.trim() }))
    setEditingTitle(false)
  }

  const cancelTitleEdit = () => {
    setTitleValue(session?.title ?? '')
    setEditingTitle(false)
  }

  const savePlayerNote = (content) => {
    clearTimeout(playerDebounce.current)
    playerDebounce.current = setTimeout(async () => {
      setSavingPlayer(true)
      try {
        await campaigns.savePlayerNote(campaign.id, sessionId, content)
        setSavedPlayer(true)
        setTimeout(() => setSavedPlayer(false), 2000)
      } finally {
        setSavingPlayer(false)
      }
    }, 800)
  }

  const handleMyNoteChange = (val) => {
    setMyNote(val)
    savePlayerNote(val)
  }

  const saveGmNotes = async () => {
    setSavingGm(true)
    try {
      await campaigns.saveGMNote(campaign.id, sessionId, {
        internal_content: gmInternal,
        external_content: gmExternal,
      })
      setSavedGm(true)
      setTimeout(() => setSavedGm(false), 2000)
    } finally {
      setSavingGm(false)
    }
  }

  const handleGmChange = (field, val) => {
    if (field === 'internal') setGmInternal(val)
    else setGmExternal(val)
    clearTimeout(gmDebounce.current)
    gmDebounce.current = setTimeout(saveGmNotes, 1000)
  }

  if (!session) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>

  const otherPlayerNotes = session.player_notes.filter(n => n.user_id !== userId)

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginBottom: 16 }}
      >
        <LuChevronLeft size={14} /> {t('sessionNote.backToSessionNotes')}
      </button>

      <div style={{ marginBottom: 24 }}>
        {editingTitle ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <input
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') cancelTitleEdit() }}
              autoFocus
              placeholder={`Session — ${formatDate(session.session_date)}`}
              style={{
                fontSize: 22, fontWeight: 700, background: 'var(--bg-deep)',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text)', padding: '4px 10px', flex: 1,
              }}
            />
            <button onClick={saveTitle} aria-label={t('sessionNote.saveTitle')} style={iconBtn}>
              <LuCheck size={16} color="var(--gold)" />
            </button>
            <button onClick={cancelTitleEdit} aria-label={t('sessionNote.cancelTitle')} style={iconBtn}>
              <LuX size={16} color="var(--text-muted)" />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              {session.title || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 400 }}>{t('sessionNote.untitledSession')}</span>}
            </h2>
            <button
              onClick={() => { setTitleValue(session.title ?? ''); setEditingTitle(true) }}
              aria-label={t('sessionNote.editSessionTitle')}
              style={{ ...iconBtn, opacity: 0.5 }}
            >
              <LuPencil size={14} />
            </button>
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{formatDate(session.session_date)}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* My Notes — always first */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LuUser size={14} /> {t('sessionNote.myNotes')}
            </div>
            <span aria-live="polite" aria-atomic="true">
              {savingPlayer && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('sessionNote.saving')}</span>}
              {savedPlayer && <span style={{ fontSize: 11, color: 'var(--gold)' }}>{t('sessionNote.saved')}</span>}
            </span>
          </div>
          <NoteEditor
            label=""
            value={myNote}
            onChange={handleMyNoteChange}
            placeholder={t('sessionNote.myNotesPlaceholder')}
          />
        </div>

        {/* GM notes editor (GM only) */}
        {isOwner && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <LuShield size={14} style={{ color: 'var(--gold)' }} /> {t('sessionNote.gmNotes')}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span aria-live="polite" aria-atomic="true">
                  {savingGm && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('sessionNote.saving')}</span>}
                  {savedGm && <span style={{ fontSize: 11, color: 'var(--gold)' }}>{t('sessionNote.saved')}</span>}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setShowInternal(true)}
                aria-pressed={showInternal}
                style={{
                  padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  background: showInternal ? 'var(--bg-deep)' : 'transparent',
                  border: showInternal ? '1px solid var(--border-light)' : '1px solid transparent',
                  color: showInternal ? 'var(--text)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <LuEyeOff size={12} aria-hidden="true" /> {t('sessionNote.internal')}
              </button>
              <button
                onClick={() => setShowInternal(false)}
                aria-pressed={!showInternal}
                style={{
                  padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  background: !showInternal ? 'var(--bg-deep)' : 'transparent',
                  border: !showInternal ? '1px solid var(--border-light)' : '1px solid transparent',
                  color: !showInternal ? 'var(--text)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <LuEye size={12} aria-hidden="true" /> {t('sessionNote.sharedWithPlayers')}
              </button>
            </div>

            {showInternal ? (
              <NoteEditor
                label=""
                value={gmInternal}
                onChange={val => handleGmChange('internal', val)}
                placeholder={t('sessionNote.internalPlaceholder')}
                lastSaved={savedGm}
              />
            ) : (
              <NoteEditor
                label=""
                value={gmExternal}
                onChange={val => handleGmChange('external', val)}
                placeholder={t('sessionNote.sharedPlaceholder')}
                lastSaved={savedGm}
              />
            )}
          </div>
        )}

        {/* GM external notes (players view) */}
        {!isOwner && session.gm_note?.external_content && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LuShield size={14} style={{ color: 'var(--gold)' }} />
              {campaign.gm_title || 'GM'} Notes
            </div>
            <NoteEditor label="" value={session.gm_note.external_content} readOnly placeholder="" />
          </div>
        )}

        {/* Other players' notes */}
        {otherPlayerNotes.map(n => (
          <div key={n.user_id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LuUser size={14} /> {t('sessionNote.playersNotes', { name: n.display_name || n.username })}
            </div>
            <NoteEditor
              label=""
              value={n.content || ''}
              readOnly
              placeholder={t('sessionNote.noNotesYet')}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
