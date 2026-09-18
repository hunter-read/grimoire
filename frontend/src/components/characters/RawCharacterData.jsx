import { useTranslation } from 'react-i18next'

/**
 * What a character renders as when its schema is not installed: its stored
 * values, exactly as they are.
 *
 * Not pretty, and deliberately so — the point is that nothing is lost. A player
 * who uninstalls a sheet, or opens a character shared from an instance that has
 * one they do not, still sees everything they wrote, and reinstalling the schema
 * brings the real sheet straight back.
 */
export default function RawCharacterData({ data }) {
  const { t } = useTranslation()
  const entries = Object.entries(data || {})

  if (!entries.length) {
    return <p style={{ color: 'var(--text-muted)' }}>{t('characters.noData')}</p>
  }

  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0 }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--text-muted)', fontSize: 13 }}>{key}</dt>
          <dd style={{ margin: 0, fontSize: 13 }}>{String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
