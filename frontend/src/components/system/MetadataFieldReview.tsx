import { useTranslation } from 'react-i18next'
import { LuExternalLink } from 'react-icons/lu'
import type { Schema } from '../../api'
import { addedLinks, formatValue, isMergedField, labelKey } from './metadataFieldValue'

/**
 * The per-field diff for one fetched match: a tickable row per field showing
 * the incoming value (and the value it would replace), then the source's
 * attribution. Choosing what to apply is the parent's job — this only renders
 * the rows and reports toggles.
 *
 * Props:
 *   detail   – the metadata-fetch response ({ fields, attribution, url })
 *   selected – field names currently ticked
 *   onToggle – (field) => void
 */
export interface MetadataFieldReviewProps {
  detail: Pick<Schema<'MetadataFetchResponse'>, 'fields' | 'attribution' | 'url'>
  selected: string[]
  onToggle: (field: string) => void
}

/** A link-list field value, as the merged fields hold them. */
type LinkList = { url?: unknown }[] | null | undefined

export default function MetadataFieldReview({
  detail,
  selected,
  onToggle,
}: MetadataFieldReviewProps) {
  const { t } = useTranslation()

  const statusLabel: Record<string, string> = {
    only_incoming: t('metadataFetch.statusNew'),
    differs: t('metadataFetch.statusDiffers'),
    same: t('metadataFetch.statusSame'),
  }
  const statusColor: Record<string, string> = {
    only_incoming: 'var(--gold-dim)',
    differs: 'var(--warning, #d98324)',
    same: 'var(--text-muted)',
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {detail.fields.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {t('metadataFetch.nothingToApply')}
          </p>
        )}
        {detail.fields.map((row) => {
          const disabled = row.status === 'same'
          return (
            <label
              key={row.field}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 10,
                alignItems: 'start',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-deep)',
                opacity: disabled ? 0.6 : 1,
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(row.field)}
                disabled={disabled}
                onChange={() => onToggle(row.field)}
                aria-label={row.field}
                style={{ marginTop: 3 }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {t(labelKey(row.field), row.field)}
                  </span>
                  <span style={{ fontSize: 11, color: statusColor[row.status] }}>
                    {statusLabel[row.status]}
                  </span>
                </div>
                {row.status === 'differs' && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      textDecoration: 'line-through',
                      wordBreak: 'break-word',
                    }}
                  >
                    {formatValue(row.current)}
                  </div>
                )}
                <div style={{ fontSize: 13, wordBreak: 'break-word' }}>
                  {isMergedField(row.field)
                    ? formatValue(addedLinks(row.current as LinkList, row.incoming as LinkList))
                    : formatValue(row.incoming)}
                </div>
                {isMergedField(row.field) && ((row.current as LinkList)?.length ?? 0) > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('metadataFetch.keepsExisting', { count: (row.current as unknown[]).length })}
                  </div>
                )}
              </div>
            </label>
          )
        })}
      </div>

      {detail.attribution && (
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 12,
          }}
        >
          {detail.attribution}
          {detail.url && (
            <a
              href={detail.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                color: 'var(--gold-dim)',
              }}
            >
              {t('metadataFetch.viewSource')}
              <LuExternalLink size={11} />
            </a>
          )}
        </p>
      )}
    </>
  )
}
