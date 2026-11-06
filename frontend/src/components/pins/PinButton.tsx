import { useTranslation } from 'react-i18next'
import type { CSSProperties } from 'react'
import { LuPin } from 'react-icons/lu'

interface Props {
  /** What is pinned, for the button's name: "Pin Tom Cartos". */
  name: string
  pinned: boolean
  onToggle: () => void
  style?: CSSProperties
}

/**
 * Pins a folder or system to the top of its view. A toggle: pressed while
 * pinned. The visible word stays "Pin" either way so it matches the button's
 * name; the filled gold pin shows the state.
 */
export default function PinButton({ name, pinned, onToggle, style }: Props) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={t('pins.pin', { name })}
      title={pinned ? t('pins.unpinTitle', { name }) : t('pins.pinTitle', { name })}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 5,
        fontSize: 12,
        flexShrink: 0,
        cursor: 'pointer',
        color: pinned ? 'var(--on-accent)' : 'var(--text-muted)',
        background: pinned ? 'var(--gold)' : 'var(--bg-card)',
        border: `1px solid ${pinned ? 'var(--gold)' : 'var(--border)'}`,
        ...style,
      }}
    >
      <LuPin size={11} aria-hidden="true" fill={pinned ? 'currentColor' : 'none'} />
      {t('pins.pinShort')}
    </button>
  )
}
