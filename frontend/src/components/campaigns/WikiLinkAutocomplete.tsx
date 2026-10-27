import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFileText, LuHash } from 'react-icons/lu'

// The open "[[" nearest the caret, if the caret is still inside it. Returns the
// query typed so far plus the span to replace on accept. A "]]" or a newline
// between the brackets and the caret closes the link, so we stop looking.
export function findActiveLinkQuery(text, caret) {
  const upto = (text || '').slice(0, caret)
  const open = upto.lastIndexOf('[[')
  if (open === -1) return null
  const inner = upto.slice(open + 2)
  if (inner.includes(']]') || inner.includes('\n')) return null
  return { query: inner, start: open, end: caret }
}

/**
 * Completion dropdown for `[[` wiki links (issue #196).
 *
 * Purely presentational: the editor owns the textarea, does the Trie matching,
 * and supplies both the matches and where to draw them. Each match's `target` is
 * the exact string to place inside `[[...]]` — already carrying `:#Heading` for a
 * heading completion (issue #279) and `:id-` when the title collides (issue #287).
 */
export default function WikiLinkAutocomplete({
  matches,
  position,
  onAccept,
  activeIndex,
  onActiveIndexChange,
}) {
  const { t } = useTranslation()
  const listRef = useRef(null)

  // Keep the highlighted row scrolled into view during keyboard navigation.
  // Guarded because scrollIntoView is absent in jsdom and older embedded views.
  useLayoutEffect(() => {
    const el = listRef.current?.children[activeIndex]
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  if (!matches?.length) return null

  return (
    <div
      role="listbox"
      aria-label={t('wiki.linkSuggestions')}
      ref={listRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 40,
        minWidth: 240,
        maxWidth: 380,
        maxHeight: 240,
        overflowY: 'auto',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 8px 24px var(--shadow)',
        padding: 4,
      }}
    >
      {matches.map((m, i) => (
        <button
          key={m.key}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          // The textarea must keep focus, so accept on mousedown and never let
          // the click steal it.
          onMouseDown={(e) => {
            e.preventDefault()
            onAccept(m)
          }}
          onMouseEnter={() => onActiveIndexChange(i)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            textAlign: 'left',
            padding: '6px 8px',
            background: i === activeIndex ? 'var(--bg-deep)' : 'transparent',
            border: 'none',
            borderRadius: 6,
            color: i === activeIndex ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 13,
          }}
        >
          {m.detail ? (
            <LuHash size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
          ) : (
            <LuFileText size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
          )}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.label}
          </span>
          {m.detail && (
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' }}>
              {m.detail}
            </span>
          )}
        </button>
      ))}
      <div
        style={{
          padding: '4px 8px 2px',
          fontSize: 11,
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          marginTop: 2,
        }}
      >
        {t('wiki.linkSuggestionsHint')}
      </div>
    </div>
  )
}
