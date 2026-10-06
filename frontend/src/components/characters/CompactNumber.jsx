import { useState, useEffect } from 'react'

const WHOLE = /^[-+]?\d+$/

/**
 * A number box without the spinner - `<g-field variant="compact">`.
 *
 * A native number input's spinner takes most of a narrow box: in a hit point or
 * coin cell it left room for a digit and a half. This is a text box that only
 * accepts a whole number, with a numeric keyboard on a phone.
 *
 * It keeps what is being typed as text, so a half-typed "-" survives until the
 * digit that follows it, and only whole numbers ever reach the character.
 * Clearing it stores nothing (null), as the ordinary number box does.
 */
export default function CompactNumber({ id, value, min, max, autoFocus, onChange, style }) {
  const [draft, setDraft] = useState(value ?? '')

  // Follow the stored value when it changes from outside - a pick, a reset.
  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  const change = (text) => {
    if (text !== '' && !/^[-+]?\d*$/.test(text)) return
    setDraft(text)
    if (text === '') onChange?.(null)
    else if (WHOLE.test(text)) {
      let number = Number(text)
      if (typeof min === 'number') number = Math.max(min, number)
      if (typeof max === 'number') number = Math.min(max, number)
      onChange?.(number)
    }
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      autoFocus={autoFocus}
      onChange={(event) => change(event.target.value)}
      // A lone sign left behind reads as nothing, rather than sticking.
      onBlur={() => {
        if (draft !== '' && !WHOLE.test(String(draft))) setDraft(value ?? '')
      }}
      style={{ ...style, textAlign: 'center' }}
    />
  )
}
