import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'

// The fields worth showing, in the order a user is likely to reach for them.
// Kept as a display list rather than rendered from GET /search/fields: the API
// knows the aliases but not which are worth a user's attention, nor what an
// example of each looks like.
const FIELD_EXAMPLES = [
  { field: 'title', example: 'title:avatar' },
  { field: 'author', example: 'author:"Gary Gygax"' },
  { field: 'system', example: 'system:pbta' },
  { field: 'category', example: 'category:adventure' },
  { field: 'tag', example: 'tag:dungeon' },
  { field: 'publisher', example: 'publisher:Wizards' },
  { field: 'year', example: 'year:2015-2020' },
  { field: 'text', example: 'text:fireball' },
]

/**
 * The `field:` syntax reference for the search box (issue #343).
 *
 * A search box that quietly supports a syntax nobody is told about is a search
 * box nobody uses that way, so the popover is reachable from an always-visible
 * (i) button. Clicking an example inserts it, which teaches the syntax by
 * letting the user run it rather than by asking them to retype it.
 */
export default function SearchHelp({ onClose, onInsert, triggerRef }) {
  const { t } = useTranslation()
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  // Escape closes, and focus moves into the panel so a keyboard user isn't left
  // behind on the input while a dialog is open in front of them.
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // A click anywhere outside dismisses. The trigger is excluded: it runs its own
  // toggle, and closing here as well would immediately be undone by that toggle
  // reopening the panel — leaving a button that can never close what it opened.
  useEffect(() => {
    const onClick = (e) => {
      const inPanel = panelRef.current?.contains(e.target)
      const onTrigger = triggerRef?.current?.contains(e.target)
      if (!inPanel && !onTrigger) onClose()
    }
    document.addEventListener('mouseup', onClick)
    return () => document.removeEventListener('mouseup', onClick)
  }, [onClose, triggerRef])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('search.help.title')}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        zIndex: 20,
        width: 'min(360px, calc(100vw - 32px))',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 16,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>{t('search.help.title')}</strong>
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: 2,
            display: 'flex',
          }}
        >
          <LuX size={16} />
        </button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
        {t('search.help.intro')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {FIELD_EXAMPLES.map(({ field, example }) => (
          <button
            key={field}
            onClick={() => onInsert(example)}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              borderRadius: 6,
              padding: '5px 6px',
              cursor: 'pointer',
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <code
              style={{
                fontSize: 12,
                color: 'var(--gold-dim)',
                whiteSpace: 'nowrap',
                fontFamily: 'monospace',
              }}
            >
              {example}
            </code>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t(`search.help.fields.${field}`)}
            </span>
          </button>
        ))}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.5 }}>
        {t('search.help.note')}
      </p>
    </div>
  )
}
