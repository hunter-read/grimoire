import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu'

/**
 * Mode-selection modal for a rescan. Presents the three scan modes with
 * descriptions and (for the destructive option) a warning. Confirming calls
 * `onConfirm(metadata_mode)`; the caller owns the actual rescan request.
 *
 * Props:
 *   scope     – path string the rescan will act on, or null for the whole library
 *   onConfirm – (metadata_mode: string) => void
 *   onClose   – () => void
 */
export default function RescanModal({ scope, onConfirm, onClose }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState('new')
  const firstRef = useRef(null)

  const MODES = [
    {
      id: 'new',
      label: t('rescan.modes.new.label'),
      description: t('rescan.modes.new.description'),
    },
    {
      id: 'missing',
      label: t('rescan.modes.missing.label'),
      description: t('rescan.modes.missing.description'),
    },
    {
      id: 'replace',
      label: t('rescan.modes.replace.label'),
      description: t('rescan.modes.replace.description'),
      warning: t('rescan.modes.replace.warning'),
    },
  ]

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleConfirm = () => {
    onConfirm(mode)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rescan-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 420,
          maxWidth: '92vw',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <span id="rescan-modal-title" style={{ fontSize: 15, fontWeight: 600 }}>
            {t('rescan.modal.title')}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 2,
            }}
            aria-label={t('common.close')}
          >
            <LuX size={16} />
          </button>
        </div>
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            marginBottom: 20,
            overflowWrap: 'anywhere',
          }}
        >
          {scope ? t('rescan.modal.scopeLabel', { scope }) : t('rescan.modal.wholeLibrary')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {MODES.map((m, i) => {
            const selected = mode === m.id
            return (
              <label
                key={m.id}
                ref={i === 0 ? firstRef : null}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') setMode(m.id)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--gold-dim)' : 'var(--border)'}`,
                  background: selected ? 'rgba(201,168,76,0.07)' : 'var(--bg-card)',
                  userSelect: 'none',
                }}
              >
                <input
                  type="radio"
                  name="rescan-mode"
                  value={m.id}
                  checked={selected}
                  onChange={() => setMode(m.id)}
                  style={{ marginTop: 2, accentColor: 'var(--gold)', flexShrink: 0 }}
                />
                <div>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: selected ? 'var(--gold)' : 'var(--text)',
                    }}
                  >
                    {m.label}
                  </span>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginTop: 2,
                      lineHeight: 1.4,
                    }}
                  >
                    {m.description}
                  </div>
                  {m.warning && selected && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--danger)',
                        marginTop: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        lineHeight: 1.4,
                      }}
                    >
                      <LuTriangleAlert size={13} style={{ flexShrink: 0 }} />
                      {m.warning}
                    </div>
                  )}
                </div>
              </label>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              borderRadius: 6,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {t('rescan.modal.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            style={{
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
            }}
          >
            <LuRefreshCw size={14} /> {t('rescan.modal.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
