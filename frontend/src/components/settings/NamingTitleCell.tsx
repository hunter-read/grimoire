import { useTranslation } from 'react-i18next'
import { badgeStyle } from './filenameRulesStyles'
import type { PreviewRow } from './namingPreview'

/** What a preview row's title is now, and what the filename would make it. */
export default function NamingTitleCell({ row }: { row: PreviewRow }) {
  const { t } = useTranslation()
  if (row.title_status === 'no_match') {
    return (
      <>
        <div style={{ color: 'var(--text-dim)' }}>{row.title}</div>
        <span style={badgeStyle('muted')}>{t('filenameRules.preview.titleNoMatch')}</span>
      </>
    )
  }
  if (row.title_status === 'same') {
    return (
      <>
        <div>{row.title}</div>
        <span style={badgeStyle('muted')}>{t('filenameRules.preview.titleSame')}</span>
      </>
    )
  }
  return (
    <>
      {/* Struck through for the eye; a screen reader does not say so, so the
          old and new titles are labelled in words. */}
      <div style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>
        <span className="sr-only">{t('a11y.settingsAdmin.was')} </span>
        {row.title}
      </div>
      <div style={{ color: 'var(--text)', fontWeight: 600 }}>
        <span className="sr-only">{t('a11y.settingsAdmin.becomes')} </span>
        {String(row.read?.title ?? '')}
      </div>
    </>
  )
}
