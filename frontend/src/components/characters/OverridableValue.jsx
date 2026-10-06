import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRotateCcw } from 'react-icons/lu'
import { iconBtn } from './characterStyles'

/**
 * A worked-out value the player can overrule.
 *
 * The rule for the whole character builder is that the player can override any
 * value: a formula is the sheet's best guess, and the table - a magic item the
 * sheet does not model, a GM's ruling - is the authority. So a computed value
 * draws exactly as it did, but clicking it lets the player type their own.
 *
 * Enter or leaving the box keeps the new value; Escape abandons it; clearing
 * the box hands the value back to its formula. An overridden value is marked,
 * and carries a reset button, so it is never mistaken for a calculated one.
 *
 * Without `onOverride` - someone else's sheet, a read-only view - this is the
 * plain value and nothing more.
 */
export default function OverridableValue({ label, display, raw, overridden, onOverride }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!onOverride) return <span>{display}</span>

  const begin = () => {
    setDraft(raw === null || raw === undefined ? '' : String(raw))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const text = draft.trim()
    if (text === String(raw ?? '') && overridden) return
    if (!text) {
      onOverride(undefined)
      return
    }
    // A number stays a number, so formulas depending on it keep doing
    // arithmetic rather than comparing text.
    const number = Number(text)
    onOverride(Number.isFinite(number) && /^[-+]?[\d.]+$/.test(text) ? number : text)
  }

  if (editing) {
    return (
      <input
        // Focused so the click that opened it can go straight to typing.
        autoFocus
        aria-label={t('characters.overrideValue', { label })}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setEditing(false)
        }}
        style={{
          width: `${Math.max(3, draft.length + 1)}ch`,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'inherit',
          background: 'var(--bg-deep)',
          border: '1px solid var(--gold)',
          borderRadius: 4,
          padding: '0 2px',
        }}
      />
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <button
        type="button"
        onClick={begin}
        aria-label={
          overridden
            ? t('characters.overriddenValue', { label, value: display })
            : t('characters.overrideValue', { label })
        }
        title={overridden ? t('characters.overriddenHint') : t('characters.overrideHint')}
        style={{
          font: 'inherit',
          color: 'inherit',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'text',
          // Marked, so an overruled value is never read as a calculated one.
          textDecoration: overridden ? 'underline dotted' : 'none',
          textUnderlineOffset: 3,
        }}
      >
        {display}
      </button>
      {overridden ? (
        <button
          type="button"
          onClick={() => onOverride(undefined)}
          aria-label={t('characters.resetOverride', { label })}
          title={t('characters.resetOverride', { label })}
          style={{ ...iconBtn, padding: 1, fontSize: 'initial' }}
        >
          <LuRotateCcw size={11} />
        </button>
      ) : null}
    </span>
  )
}
