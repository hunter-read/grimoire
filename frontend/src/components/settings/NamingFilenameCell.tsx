import { useTranslation } from 'react-i18next'
import { badgeStyle, hintStyle } from './filenameRulesStyles'
import type { PreviewRow } from './namingPreview'

/** The filename a preview row would be renamed to, and why it might not be. */
export default function NamingFilenameCell({ row }: { row: PreviewRow }) {
  const { t } = useTranslation()
  const status = row.rename_status
  return (
    <>
      {row.proposed && (
        <div style={{ color: status === 'ok' ? 'var(--text)' : 'var(--text-dim)' }}>
          {row.proposed}
        </div>
      )}
      {status === 'same' && (
        <span style={badgeStyle('muted')}>{t('filenameRules.preview.status.same')}</span>
      )}
      {status === 'missing' && (
        <span style={badgeStyle('warn')}>
          {t('filenameRules.preview.status.missing', {
            fields: (row.missing ?? []).map((f) => `{${f}}`).join(', '),
          })}
        </span>
      )}
      {status === 'too_long' && (
        <span style={badgeStyle('danger')}>{t('filenameRules.preview.status.too_long')}</span>
      )}
      {status === 'conflict' && (
        <span style={badgeStyle('danger')}>{t('filenameRules.preview.status.conflict')}</span>
      )}
      {row.proposed && status !== 'same' && row.long_path && (
        <div style={{ ...hintStyle, color: 'var(--gold)' }}>
          {t('filenameRules.preview.longPath', { length: row.path_length })}
        </div>
      )}
      {row.proposed && status === 'ok' && !row.reads_back && (
        <div style={hintStyle}>{t('filenameRules.preview.readsBack')}</div>
      )}
    </>
  )
}
