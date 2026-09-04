import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuCheck, LuChevronDown } from 'react-icons/lu'

import variantLabel, { variantFilename } from '../utils/variantLabel'

/**
 * Switch between the versions of one item.
 *
 * A book, map, token, or audio track can collapse several files into one entry —
 * a printer-friendly cut, a gridless map, an older version (issues #304, #306).
 * Only the main entry appears in listings; this is how the others are reached.
 *
 * A button and a menu rather than a `<select>`: an `<option>` holds a single run
 * of text, which forced the filename into parentheses on the same line and made
 * a long one (`Universal VTT (No Water Night - Alchemy District.uvtt)`) unreadable
 * at a glance. A menu row can put the version's name on one line and its filename
 * underneath in smaller, dimmer text, which is what the download menu beside it
 * already does — so the two now match instead of diverging.
 *
 * Renders nothing when there is only one version, so callers can mount it
 * unconditionally rather than repeating the check at every call site.
 */
export default function VariantPicker({ item, detailPath, compact = false }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Dismissal is wired the way every other menu in the app does it (the download
  // menu, the reader's ⋮, the campaign menus): mousedown outside, or Escape.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const siblings = item?.variants || []
  if (siblings.length === 0) return null

  // The family is (main entry + its variants); the main entry is not in
  // `variants`, so it is prepended here to make one flat list of choices.
  const mainId = item.variant_main_id || item.id
  const options = [
    { id: mainId, kind: '', label: '', isMain: true, filename: item.filename },
    ...siblings.map((v) => ({ ...v, isMain: false })),
  ]
  const current = options.find((o) => o.id === item.id)

  const choose = (id) => {
    setOpen(false)
    if (id !== item.id) navigate(detailPath(id))
  }

  const fontSize = compact ? 12 : 13

  return (
    <span
      ref={wrapRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize,
        color: 'var(--text-dim)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          padding: '1px 6px',
          borderRadius: 8,
          color: 'var(--variant)',
          background: 'rgba(79,209,197,0.12)',
          border: '1px solid rgba(79,209,197,0.35)',
          fontWeight: 600,
        }}
      >
        {t('variants.badge', { count: options.length })}
      </span>
      <button
        type="button"
        aria-label={t('variants.switchLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'var(--bg-card)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          // The trigger shows only the version's name, never its filename: it
          // sits inline next to the title, and a long filename here is what
          // pushed the rest of the header off screen.
          maxWidth: 260,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? variantLabel(current, t) : t('variants.switchLabel')}
        </span>
        <LuChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 2000,
            minWidth: 220,
            maxWidth: 360,
            padding: '4px 0',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            boxShadow: '0 6px 20px var(--shadow)',
          }}
        >
          {options.map((option) => {
            const filename = variantFilename(option, t)
            const isCurrent = option.id === item.id
            return (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                aria-current={isCurrent || undefined}
                onClick={() => choose(option.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  width: '100%',
                  padding: '6px 12px',
                  border: 'none',
                  background: isCurrent ? 'var(--bg-card)' : 'transparent',
                  color: 'var(--text)',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <LuCheck
                  size={12}
                  aria-hidden="true"
                  // Held in the layout rather than removed, so the rows stay
                  // aligned whichever one is current.
                  style={{ marginTop: 3, flexShrink: 0, opacity: isCurrent ? 1 : 0 }}
                />
                <span style={{ minWidth: 0 }}>
                  {variantLabel(option, t)}
                  {filename && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginTop: 1,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {filename}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
