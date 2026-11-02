import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface SpinnerProps {
  size?: number
  /**
   * Hide it from screen readers. Worked out on its own when the spinner sits
   * inside a button or link, which already says what is happening ("Saving…"),
   * so pass this only for some other labelled control.
   */
  decorative?: boolean
}

/**
 * A loading indicator. On its own it is a status, read as "Loading…". Inside a
 * control it is decoration: as a status there it became part of the control's
 * name, so a Save button read "Loading… Save".
 */
export default function Spinner({ size = 24, decorative = false }: SpinnerProps) {
  const { t } = useTranslation()
  const ref = useRef<SVGSVGElement>(null)
  const [inControl, setInControl] = useState(false)
  useLayoutEffect(() => {
    setInControl(!!ref.current?.parentElement?.closest('button, a, [role="button"]'))
  }, [])
  const hidden = decorative || inControl
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ animation: 'pulse 1s infinite' }}
      {...(hidden
        ? { 'aria-hidden': true, focusable: 'false' }
        : { role: 'status', 'aria-label': t('common.loading') })}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="var(--gold-dim)"
        strokeWidth="2"
        strokeDasharray="31.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
