import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * A small "Beta" tag beside the name of a feature still settling in, such as
 * the GM screen. Its text is read with the name it follows, so a link or a
 * heading carrying it says so to a screen reader too.
 */
export default function BetaBadge({ style }: { style?: CSSProperties }) {
  const { t } = useTranslation()
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 8,
        padding: '1px 6px',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1.5,
        verticalAlign: 'middle',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        ...style,
      }}
    >
      {t('nav.beta')}
    </span>
  )
}
