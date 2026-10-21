import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import type { Schema } from '../../api'

export type MergeResult = Schema<'MergeResult'>

// The order references are listed in, matching the backend's REFERENCE_KINDS.
const KINDS = [
  'bookmarks',
  'favorites',
  'tags',
  'campaigns',
  'share_links',
  'access_grants',
  'audio_sets',
  'system_covers',
  'notes',
] as const

interface Props {
  /** One dry run, or several (a batch) to be summed into one summary. */
  results: MergeResult[]
}

/**
 * What a merge will do, read from its dry run (issue #589).
 *
 * The confirmation for an irreversible step, so it says everything the merge
 * changes - fields filled in, references moved, families re-homed, files
 * deleted - and nothing it does not. A batch is summed: one line per kind across
 * every group, so "merge all exact matches" fits on one screen however many
 * groups it covers.
 */
export default function MergeSummary({ results }: Props) {
  const { t } = useTranslation()
  if (results.length === 0) return null
  const single = results.length === 1 ? results[0] : null

  const refs = KINDS.map((kind) => {
    let moved = 0
    let deduplicated = 0
    for (const r of results) {
      moved += r.references?.[kind]?.moved || 0
      deduplicated += r.references?.[kind]?.deduplicated || 0
    }
    return { kind, moved, deduplicated }
  }).filter((r) => r.moved + r.deduplicated > 0)

  const fieldNames = single
    ? (single.fields || []).map((f) =>
        t(`maintenance.dupes.field.${f.field}`, { defaultValue: f.field })
      )
    : []
  const fieldCount = results.reduce((n, r) => n + (r.fields?.length || 0), 0)
  const tags = [...new Set(results.flatMap((r) => r.tags_added || []))]
  const reparented = results.reduce((n, r) => n + (r.variants_reparented || 0), 0)
  const files = results.flatMap((r) => r.files || [])
  const deleting = files.filter((f) => f.delete)
  const keeping = files.length - deleting.length
  const warnings = results.flatMap((r) => r.warnings || [])

  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)' }}>
      {single && fieldNames.length > 0 && (
        <p style={para}>{t('merge.summary.fieldsFilled', { fields: fieldNames.join(', ') })}</p>
      )}
      {!single && fieldCount > 0 && (
        <p style={para}>{t('merge.summary.fieldsCount', { count: fieldCount })}</p>
      )}
      {tags.length > 0 && (
        <p style={para}>{t('merge.summary.tagsAdded', { tags: tags.join(', ') })}</p>
      )}

      {refs.length > 0 ? (
        <div style={para}>
          <div style={{ color: 'var(--text)' }}>{t('merge.summary.movesHeading')}</div>
          <ul style={{ margin: '2px 0 0', paddingLeft: 20 }}>
            {refs.map((r) => (
              <li key={r.kind}>
                {t(`merge.summary.ref.${r.kind}`, { count: r.moved + r.deduplicated })}
                {r.deduplicated > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    {t('merge.summary.alreadyThere', { n: r.deduplicated })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p style={para}>{t('merge.summary.nothingMoves')}</p>
      )}

      {reparented > 0 && (
        <p style={para}>{t('merge.summary.variantsReparented', { count: reparented })}</p>
      )}
      {single?.keeper_promoted && <p style={para}>{t('merge.summary.keeperPromoted')}</p>}

      {deleting.length > 0 && (
        <div style={para}>
          <div style={{ color: 'var(--danger)' }}>
            {t('merge.summary.filesDelete', { count: deleting.length })}
          </div>
          {single && (
            <ul style={{ margin: '2px 0 0', paddingLeft: 20, wordBreak: 'break-word' }}>
              {deleting.map((f) => (
                <li key={f.id}>{f.path}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {keeping > 0 && <p style={para}>{t('merge.summary.filesKeep', { count: keeping })}</p>}

      {warnings.length > 0 && (
        <ul role="list" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {warnings.map((w, i) => (
            <li
              key={`${w.code}-${w.id || i}`}
              style={{ display: 'flex', gap: 6, color: 'var(--gold)', marginBottom: 4 }}
            >
              <LuTriangleAlert
                size={14}
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 3 }}
              />
              <span>
                {t(`merge.summary.warning.${w.code}`, {
                  count: w.count ?? 0,
                  pages: w.pages,
                  keepPages: w.keep_pages,
                  defaultValue: w.code,
                })}
                {w.out_of_range ? ` ${t('merge.summary.outOfRange', { n: w.out_of_range })}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const para = { margin: '0 0 8px' }
