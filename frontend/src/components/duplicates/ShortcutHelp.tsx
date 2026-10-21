import { useTranslation } from 'react-i18next'

const SHORTCUTS: [string, string][] = [
  ['1–4', 'keeper'],
  ['M', 'merge'],
  ['L', 'link'],
  ['D', 'dismiss'],
  ['S / →', 'skip'],
  ['←', 'back'],
  ['?', 'help'],
]

/** The review queue's keyboard shortcuts (issue #589), toggled with `?`. */
export default function ShortcutHelp() {
  const { t } = useTranslation()
  return (
    <div
      role="region"
      aria-label={t('maintenance.dupes.review.shortcutsTitle')}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 16,
        background: 'var(--bg-card)',
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.dupes.review.shortcutsTitle')}
      </div>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          gap: '4px 14px',
          margin: 0,
        }}
      >
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action} style={{ display: 'contents' }}>
            <dt>
              <kbd
                style={{
                  fontFamily: 'inherit',
                  padding: '0 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                }}
              >
                {keys}
              </kbd>
            </dt>
            <dd style={{ margin: 0, color: 'var(--text-dim)' }}>
              {t(`maintenance.dupes.review.shortcut.${action}`)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
