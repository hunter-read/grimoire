import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'

const VISIBLE_LIMIT = 15

/**
 * Horizontal tag-pill filter row. Shows up to VISIBLE_LIMIT tags with a
 * show-more/less toggle and a clear button. `selected` is a Set of active tags;
 * `onToggle(tag)` and `onClear()` mutate it in the parent.
 */
export default function TagFilterBar({ tags, selected, onToggle, onClear }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)

  if (tags.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 24,
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: 4 }}>
        {t('common.tags')}
      </span>
      {(showAll ? tags : tags.slice(0, VISIBLE_LIMIT)).map((tag) => (
        <button
          key={tag}
          onClick={() => onToggle(tag)}
          style={{
            fontSize: 13,
            padding: '3px 10px',
            borderRadius: 10,
            cursor: 'pointer',
            border: 'none',
            background: selected.has(tag) ? 'rgba(201,168,76,0.2)' : 'var(--tag-bg)',
            color: selected.has(tag) ? 'var(--gold)' : 'var(--text-dim)',
            outline: selected.has(tag)
              ? '1px solid var(--gold-dim)'
              : '1px solid var(--tag-border)',
          }}
        >
          {tag.charAt(0).toUpperCase() + tag.slice(1)}
        </button>
      ))}
      {tags.length > VISIBLE_LIMIT && (
        <button
          onClick={() => setShowAll((v) => !v)}
          style={{
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 10,
            cursor: 'pointer',
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          {showAll
            ? t('common.showLess')
            : t('common.showMore', { count: tags.length - VISIBLE_LIMIT })}
        </button>
      )}
      {selected.size > 0 && (
        <button
          onClick={onClear}
          style={{
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 10,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <LuX size={11} /> {t('common.clear')}
        </button>
      )}
    </div>
  )
}
