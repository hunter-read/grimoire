import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFileText, LuHash } from 'react-icons/lu'
import type { TrieEntry } from './wikiLinkTarget'

// The open "[[" nearest the caret, if the caret is still inside it. Returns the
// query typed so far plus the span to replace on accept. A "]]" or a newline
// between the brackets and the caret closes the link, so we stop looking.
export function findActiveLinkQuery(
  text: string | null | undefined,
  caret: number
): { query: string; start: number; end: number } | null {
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
type LinkMatch = Pick<TrieEntry, 'key' | 'label' | 'detail'>

/** The DOM id of option `index` in the listbox `listId`, for aria-activedescendant. */
export function linkOptionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`
}

export default function WikiLinkAutocomplete<M extends LinkMatch>({
  id = 'wiki-link-suggestions',
  matches,
  position,
  onAccept,
  activeIndex,
  onActiveIndexChange,
}: {
  /**
   * The listbox's id. The textarea points at it (aria-controls) and at the
   * highlighted option (aria-activedescendant), since focus stays in the
   * textarea while the arrow keys move the highlight.
   */
  id?: string
  matches: readonly M[] | null | undefined
  position: { top: number; left: number }
  onAccept: (match: M) => void
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLUListElement>(null)

  // Keep the highlighted row scrolled into view during keyboard navigation.
  // Guarded because scrollIntoView is absent in jsdom and older embedded views.
  useLayoutEffect(() => {
    const el = listRef.current?.children[activeIndex]
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  if (!matches?.length) return null

  return (
    <div
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
      {/* Focus never leaves the textarea, so a screen reader needs telling that
          suggestions appeared, and how many. */}
      <div role="status" className="sr-only">
        {t('a11y.campaignNotes.suggestionCount', { count: matches.length })}
      </div>
      <ul
        id={id}
        role="listbox"
        aria-label={t('wiki.linkSuggestions')}
        aria-describedby={`${id}-hint`}
        ref={listRef}
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {matches.map((m, i) => (
          <li
            key={m.key}
            id={linkOptionId(id, i)}
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
          </li>
        ))}
      </ul>
      <div
        id={`${id}-hint`}
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
