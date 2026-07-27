import { useRef } from 'react'
import { LuX } from 'react-icons/lu'

/**
 * Chip-style tag input shared by the system and book editors. Tags are stored
 * lowercase; Enter/comma commits the pending text, Backspace on an empty input
 * removes the last chip. The pending input value is controlled by the parent so
 * it can be flushed into the payload on save.
 */
export default function TagChipInput({
  id,
  tags,
  onChange,
  inputValue,
  onInputChange,
  placeholder = '',
}) {
  const inputRef = useRef(null)

  const commit = () => {
    const tag = inputValue.trim().toLowerCase().replace(/,+$/, '')
    if (tag && !tags.includes(tag)) onChange([...tags, tag])
    onInputChange('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 5,
        alignItems: 'center',
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'text',
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        minHeight: 36,
      }}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            fontSize: 12,
            padding: '2px 6px 2px 8px',
            borderRadius: 10,
            background: 'rgba(201,168,76,0.15)',
            border: '1px solid var(--gold-dim)',
            color: 'var(--gold)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onChange(tags.filter((x) => x !== tag))
            }}
            aria-label={`Remove ${tag}`}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              padding: '0 0 0 4px',
              lineHeight: 1,
            }}
          >
            <LuX size={10} />
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={inputRef}
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={handleKey}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : ''}
        style={{
          fontSize: 13,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--text)',
          minWidth: 80,
          flex: 1,
        }}
      />
    </div>
  )
}
