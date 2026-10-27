import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuSave } from 'react-icons/lu'

/**
 * Names and saves the live queue or soundboard as a set.
 *
 * `existing` is the user's already-saved names for this kind, so re-using one
 * can warn that saving will overwrite it before it happens — the API overwrites
 * by (kind, name), which is the wanted behaviour but a surprise unannounced.
 */
export default function SaveAudioSetModal({ kind, count, existing = [], onSave, onClose }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = name.trim()
  const overwrites = existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())

  const submit = async () => {
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await onSave(trimmed)
      if (!saved) throw new Error(t('audioSets.saveFailed'))
      onClose()
    } catch (err) {
      setError(err.message || t('audioSets.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('audioSets.saveTitle')}
      style={overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={panel}>
        <div style={header}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            {kind === 'soundboard' ? t('audioSets.saveBoard') : t('audioSets.savePlaylist')}
          </span>
          <button onClick={onClose} style={closeBtn} aria-label={t('common.close')}>
            <LuX size={16} />
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
          {kind === 'soundboard'
            ? t('audioSets.saveBoardIntro', { count })
            : t('audioSets.savePlaylistIntro', { count })}
        </p>

        <label style={label} htmlFor="audio-set-name">
          {t('audioSets.nameLabel')}
        </label>
        <input
          id="audio-set-name"
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('audioSets.namePlaceholder')}
          style={input}
        />

        {overwrites && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            {t('audioSets.overwriteWarning', { name: trimmed })}
          </p>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={cancelBtn}>
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!trimmed || saving}
            style={{ ...goldBtn, opacity: !trimmed || saving ? 0.5 : 1 }}
          >
            <LuSave size={14} />
            {saving ? t('audioSets.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
  padding: 16,
}
const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 24,
  width: 380,
  maxWidth: '92vw',
  boxSizing: 'border-box',
}
const header = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const label = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const input = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
}
const cancelBtn = {
  padding: '7px 16px',
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 14,
  cursor: 'pointer',
}
const goldBtn = {
  padding: '7px 18px',
  borderRadius: 6,
  background: 'var(--gold-dim)',
  border: 'none',
  color: 'var(--bg-deep)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
