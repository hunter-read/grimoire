import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PanelBodyProps } from './panelProps'

const SAVE_AFTER_MS = 800

/**
 * The GM's own jottings - names made up on the spot, who owes whom. Saved a
 * moment after typing stops, and when the box is left, so nothing is lost and
 * the server is not asked to save every letter.
 */
export default function ScratchPanel({ panel, onState }: PanelBodyProps) {
  const { t } = useTranslation()
  const stored = typeof panel.state.text === 'string' ? panel.state.text : ''
  const [text, setText] = useState(stored)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  const save = useRef(onState)
  save.current = onState

  // Follow a change from elsewhere (a reset, another device) unless the GM is
  // mid-sentence here.
  useEffect(() => {
    if (pending.current === null) setText(stored)
  }, [stored])

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current !== null) {
      save.current({ text: pending.current })
      pending.current = null
    }
  }

  useEffect(() => flush, [])

  return (
    <textarea
      aria-label={panel.title || t('gmScreen.kinds.scratch')}
      value={text}
      maxLength={20000}
      placeholder={t('gmScreen.scratch.placeholder')}
      onChange={(event) => {
        setText(event.target.value)
        pending.current = event.target.value
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(flush, SAVE_AFTER_MS)
      }}
      onBlur={flush}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 80,
        resize: 'none',
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        font: 'inherit',
        fontSize: 13,
        lineHeight: 1.5,
        outline: 'none',
      }}
    />
  )
}
