import { useTranslation } from 'react-i18next'

import { imageSources } from '../../api'
import variantLabel from '../../utils/variantLabel'
import LazyImg from '../LazyImg'

/**
 * The other versions of the selected image, offered as a choice.
 *
 * The library search returns main versions only — one entry per map, not one per
 * cut of it — which is right for linking a resource to a campaign but wrong for
 * a picker that *composes* with the file. A portrait's black-and-white cut is a
 * different token from its colour original, so the editor has to be able to
 * reach it.
 *
 * Only rendered for the row that is actually selected: showing every row's
 * versions inline would double the length of a gallery to answer a question
 * almost nobody is asking at that moment.
 */
export default function ImageSourceVariants({ row, value, onChange }) {
  const { t } = useTranslation()
  const variants = (row?.variants || []).filter((v) => v.has_thumbnail)
  if (!row || variants.length === 0) return null

  const entries = [{ ...row, isMain: true }, ...variants]

  return (
    <div
      style={{
        margin: '8px 0 10px',
        padding: '8px 10px',
        borderRadius: 8,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
    >
      <span
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-dim)',
          marginBottom: 6,
        }}
      >
        {t('imagePicker.chooseVersion')}
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {entries.map((entry) => {
          const selected = value?.source_id === entry.resource_id
          const src = imageSources.thumbUrl(row.resource_type, entry.resource_id)
          const label = variantLabel(
            {
              isMain: !!entry.isMain,
              kind: entry.variant_kind,
              label: entry.variant_label,
              filename: entry.name,
            },
            t
          )
          return (
            <button
              key={entry.resource_id}
              type="button"
              title={label}
              aria-pressed={selected}
              onClick={() =>
                onChange({
                  source_type: row.resource_type,
                  source_id: entry.resource_id,
                  name: entry.name,
                  preview: src,
                })
              }
              style={{
                width: 74,
                padding: 0,
                background: 'var(--bg-deep)',
                border: `2px solid ${selected ? 'var(--gold)' : 'var(--border)'}`,
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                display: 'block',
              }}
            >
              <LazyImg
                src={src}
                alt=""
                placeholder
                style={{ width: '100%', height: 52, objectFit: 'cover', display: 'block' }}
              />
              <span
                style={{
                  display: 'block',
                  fontSize: 9,
                  lineHeight: 1.3,
                  color: selected ? 'var(--text)' : 'var(--text-muted)',
                  padding: '3px 4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
