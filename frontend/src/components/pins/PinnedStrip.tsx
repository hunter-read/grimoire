import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuPin, LuX } from 'react-icons/lu'
import type { Pin } from '../../hooks/usePins'

export interface PinnedLink {
  pin: Pin
  /** What the chip reads: the folder or system name. */
  label: string
  /** Where it goes. */
  to: string
  /** Context under the name, when two pins could read alike ("Czepeku › Night"). */
  detail?: string
}

interface Props {
  links: PinnedLink[]
  onUnpin: (pin: Pin) => void
  /** The strip's landmark name: "Pinned folders". */
  label: string
}

/**
 * The view's pinned folders or systems, one click away at the top of the page.
 * Each chip opens its target; its × unpins it. Renders nothing with no pins.
 */
export default function PinnedStrip({ links, onUnpin, label }: Props) {
  const { t } = useTranslation()
  if (!links.length) return null
  return (
    <nav aria-label={label} style={{ marginBottom: 20 }}>
      <ul
        role="list"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <li
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            marginRight: 4,
            font: "600 12px 'Cinzel', serif",
            letterSpacing: '0.1em',
            color: 'var(--gold-dim)',
          }}
        >
          <LuPin size={12} />
          {t('pins.heading')}
        </li>
        {links.map(({ pin, label: name, to, detail }) => (
          <li
            key={pin.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              maxWidth: '100%',
              minWidth: 0,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-panel)',
            }}
          >
            <Link
              to={to}
              title={detail ? `${detail} › ${name}` : name}
              style={{
                padding: '5px 4px 5px 10px',
                fontSize: 14,
                color: 'var(--text)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {detail && (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{detail} › </span>
              )}
              {name}
            </Link>
            <button
              type="button"
              onClick={() => onUnpin(pin)}
              aria-label={t('pins.unpin', { name })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 24,
                minHeight: 24,
                margin: '0 4px 0 2px',
                padding: 0,
                borderRadius: 4,
                background: 'none',
                color: 'var(--text-muted)',
              }}
            >
              <LuX size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
