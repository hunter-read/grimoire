import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronRight } from 'react-icons/lu'

/**
 * One collapsible release in the About dialog's changelog.
 *
 * Controlled rather than self-managing its open state: the list decides which
 * release is expanded (the running version, initially), and a release that
 * closed itself would have no way to honour that.
 */
export default function ChangelogRelease({ release, isCurrent, isOpen, onToggle }) {
  const { t } = useTranslation()
  const panelId = useId()
  const { version, date, summary, sections } = release

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '9px 2px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text)',
          font: 'inherit',
        }}
      >
        <LuChevronRight
          size={13}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: 'var(--text-muted)',
            transform: isOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{version}</span>
        {isCurrent && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--gold-dim)',
              color: 'var(--bg-deep)',
            }}
          >
            {t('about.currentVersion')}
          </span>
        )}
        {date && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {date}
          </span>
        )}
      </button>

      {isOpen && (
        <div id={panelId} style={{ padding: '0 2px 12px 21px' }}>
          {summary && (
            <p
              style={{
                margin: '0 0 10px',
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--text-dim)',
              }}
            >
              {summary}
            </p>
          )}
          {sections.map((section, i) => (
            <div key={`${section.title}-${i}`} style={{ marginBottom: 10 }}>
              {/* A section parsed from bullets with no heading above them has
                  an empty title; render its entries without inventing one. */}
              {section.title && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--text-muted)',
                    marginBottom: 4,
                  }}
                >
                  {section.title}
                </div>
              )}
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {section.entries.map((entry, j) => (
                  <li
                    key={j}
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: 'var(--text-dim)',
                      marginBottom: 2,
                    }}
                  >
                    {entry}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
