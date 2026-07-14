import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRefreshCw } from 'react-icons/lu'
import Spinner from './Spinner'
import RescanModal from './RescanModal'
import useScanStatus from '../hooks/useScanStatus'

/**
 * Rescan control for a folder row or panel. Opens RescanModal to pick a mode,
 * then triggers a (optionally scoped) rescan via the shared useScanStatus hook.
 *
 * Props:
 *   scope   – path string under books/ maps/ tokens/, or null for whole library
 *   compact – icon-only styling for dense folder rows (default true)
 *   label   – optional text label shown next to the icon (non-compact)
 */
export default function RescanButton({ scope = null, compact = true, label }) {
  const { t } = useTranslation()
  const { status, startRescan } = useScanStatus()
  const [open, setOpen] = useState(false)
  const [triggered, setTriggered] = useState(false)

  const running = status.running && triggered

  const handleConfirm = (metadata_mode) => {
    setTriggered(true)
    startRescan({ scope, metadata_mode }).catch(() => setTriggered(false))
  }

  // Clear our "this button started it" flag once the global scan finishes.
  useEffect(() => {
    if (triggered && !status.running) setTriggered(false)
  }, [triggered, status.running])

  const title = t('rescan.button.title')

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        disabled={status.running}
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 0 : 6,
          padding: compact ? '2px 7px' : '6px 12px',
          borderRadius: compact ? 5 : 6,
          fontSize: compact ? 12 : 14,
          // Match the sibling Download button's content height (18px line box)
          // so an icon-only compact button isn't shorter than a text button.
          lineHeight: compact ? '18px' : undefined,
          minHeight: compact ? 18 : undefined,
          flexShrink: 0,
          color: running ? 'var(--gold)' : 'var(--text-muted)',
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          cursor: status.running ? 'default' : 'pointer',
        }}
      >
        {running ? <Spinner size={compact ? 11 : 13} /> : <LuRefreshCw size={compact ? 11 : 13} />}
        {!compact && (label || t('rescan.button.label'))}
      </button>

      {open && (
        <RescanModal scope={scope} onConfirm={handleConfirm} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
