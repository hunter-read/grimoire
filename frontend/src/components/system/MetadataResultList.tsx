import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The candidate matches from a metadata search, as a list of buttons.
 *
 * Built to be driven from the keyboard (issue #466): the first match takes
 * focus as soon as the list arrives, so Enter picks the likeliest one, and the
 * arrow keys move between matches. Up from the first match returns to the
 * search box (`onExitTop`), so the query can be adjusted without the mouse.
 *
 * Props:
 *   results   – [{ identity, label }] from the search endpoint
 *   picked    – identity chosen last time on this item, marked so a wrong
 *               pick between look-alikes is easy to tell apart on return
 *   onChoose  – (identity) => void
 *   onExitTop – () => void, called on ArrowUp from the first match
 */
export default function MetadataResultList({ results, picked, onChoose, onExitTop }) {
  const { t } = useTranslation()
  const refs = useRef([])

  // Focus once per result set, not on every render, so a mouse user who has
  // clicked into the search box is not yanked back out of it.
  useEffect(() => {
    refs.current[0]?.focus()
  }, [results])

  const onKeyDown = (e, i) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      refs.current[Math.min(results.length - 1, i + 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (i === 0) onExitTop?.()
      else refs.current[i - 1]?.focus()
    }
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {results.map((r, i) => (
        <li key={r.identity} style={{ marginBottom: 6 }}>
          <button
            ref={(el) => (refs.current[i] = el)}
            onClick={() => onChoose(r.identity)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={resultBtn}
          >
            {r.label}
            {/* A real space, so screen readers don't run the label into it. */}
            {r.identity === picked && (
              <>
                {' '}
                <span style={pickedTag}>{t('metadataFetch.pickedBefore')}</span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

const resultBtn = {
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  cursor: 'pointer',
}
const pickedTag = {
  marginLeft: 4,
  fontSize: 11,
  color: 'var(--text-muted)',
}
