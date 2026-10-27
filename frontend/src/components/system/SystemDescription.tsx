import { useState, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const LINE_HEIGHT = 1.6
// Six lines at LINE_HEIGHT - how much shows before "Read more".
const COLLAPSED_HEIGHT = '9.6em'

const FADE = 'linear-gradient(to bottom, #000 60%, transparent)'

// A system's description, keeping the paragraph breaks typed in the editor.
// Text taller than COLLAPSED_HEIGHT is clamped with a fade and a toggle; the
// toggle only appears when the text actually overflows at the current width.
export interface SystemDescriptionProps {
  text: string
}

export default function SystemDescription({ text }: SystemDescriptionProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    if (expanded) return
    const el = ref.current
    if (!el) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [text, expanded])

  const clamped = !expanded
  const fade = clamped && overflows

  return (
    <div style={{ marginBottom: 12 }}>
      <p
        ref={ref}
        data-testid="system-description"
        style={{
          fontSize: 16,
          color: 'var(--text-dim)',
          lineHeight: LINE_HEIGHT,
          fontFamily: 'Alegreya, serif',
          whiteSpace: 'pre-wrap',
          margin: 0,
          ...(clamped && {
            maxHeight: COLLAPSED_HEIGHT,
            overflow: 'hidden',
          }),
          ...(fade && { maskImage: FADE, WebkitMaskImage: FADE }),
        }}
      >
        {text.trim()}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            marginTop: 4,
            padding: 0,
            fontSize: 14,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            color: 'var(--gold)',
          }}
        >
          {expanded ? t('systemDetail.showLess') : t('systemDetail.readMore')}
        </button>
      )}
    </div>
  )
}
