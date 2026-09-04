import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

// Platform-appropriate name for the modifier. macOS users read "Ctrl" as a
// different key, not as a synonym, so showing the wrong one makes the whole
// table look wrong.
const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

/**
 * The file manager's keyboard reference.
 *
 * Keyboard navigation is invisible until someone tries it, so the bindings need
 * somewhere to be read. Grouped rather than listed flat: seventeen bindings in
 * one column is a wall, and they fall naturally into moving around, acting on a
 * row, and selecting.
 */
export default function ShortcutsOverlay({ onClose }) {
  const { t } = useTranslation()
  const mod = isMac() ? '⌘' : 'Ctrl'

  // Escape closes from here rather than from the pane: this carries
  // `role="dialog"`, which the pane's own handler treats as "keys are not mine".
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groups = [
    [
      t('files.shortcutGroupMove'),
      [
        ['↑  /  ↓', t('files.shortcutMove')],
        ['→', t('files.shortcutExpand')],
        ['←', t('files.shortcutCollapse')],
        [`${mod}  ↓`, t('files.shortcutOpenFolder')],
        [`${mod}  ↑`, t('files.shortcutGoUp')],
        ['Home  /  End', t('files.shortcutFirstLast')],
        ['PgUp  /  PgDn', t('files.shortcutPage')],
        ['Tab', t('files.shortcutSwitchPane')],
      ],
    ],
    [
      t('files.shortcutGroupAct'),
      [
        ['Space', t('files.shortcutPreview')],
        ['Enter  /  F2', t('files.shortcutRename')],
        ['Delete', t('files.shortcutDelete')],
        [`${mod}  I`, t('files.shortcutMetadata')],
      ],
    ],
    [
      t('files.shortcutGroupSelect'),
      [
        ['Shift  ↑  /  ↓', t('files.shortcutExtend')],
        [`${mod}  ↑  /  ↓`, t('files.shortcutCursorOnly')],
        [`${mod}  A`, t('files.shortcutSelectAll')],
        ['Esc', t('files.shortcutClearSelection')],
      ],
    ],
  ]

  return (
    <div style={backdrop} onClick={onClose}>
      <div
        style={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('files.keyboardShortcuts')}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          {t('files.keyboardShortcuts')}
        </h3>
        {groups.map(([heading, bindings]) => (
          <div key={heading} style={{ marginBottom: 16 }}>
            <div style={groupHeading}>{heading}</div>
            {bindings.map(([key, desc]) => (
              <div key={key} style={row}>
                <kbd style={kbd}>{key}</kbd>
                <span style={{ color: 'var(--text-dim)' }}>{desc}</span>
              </div>
            ))}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={closeBtn}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 22,
  width: 'min(460px, 100%)',
  maxHeight: '85vh',
  overflowY: 'auto',
}

const groupHeading = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  marginBottom: 8,
}

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 13,
  padding: '3px 0',
}

const kbd = {
  flexShrink: 0,
  minWidth: 104,
  padding: '2px 7px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  fontSize: 11,
  fontFamily: 'inherit',
  textAlign: 'center',
}

const closeBtn = {
  padding: '7px 15px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-dim)',
}
