import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

interface InlineTextProps {
  value: string
  label: string
  placeholder?: string
  maxLength?: number
  multiline?: boolean
  onCommit: (value: string) => void
  style?: CSSProperties
}

const base: CSSProperties = {
  width: '100%',
  minWidth: 0,
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  padding: '3px 6px',
  color: 'inherit',
  font: 'inherit',
}

/**
 * Text edited where it sits - a countdown's name, a pool's note. What is typed
 * is kept locally and saved when the box is left or Enter is pressed, so a
 * name is one save rather than one per letter.
 */
export default function InlineText({
  value,
  label,
  placeholder,
  maxLength = 120,
  multiline,
  onCommit,
  style,
}: InlineTextProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  const shared = {
    'aria-label': label,
    value: draft,
    placeholder,
    maxLength,
    onBlur: commit,
    className: 'gm-inline-text',
    style: { ...base, ...style },
  }
  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        style={{ ...shared.style, resize: 'vertical' }}
      />
    )
  }
  return (
    <input
      {...shared}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          setDraft(value)
        }
      }}
    />
  )
}
