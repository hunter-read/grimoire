import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowRight, LuCombine } from 'react-icons/lu'

import { formatSize } from '../../utils'
import { isExactGroup, pickKeeper, type DuplicateGroup } from '../../utils/duplicateGroups'

interface Props {
  group: DuplicateGroup
  onReview: (group: DuplicateGroup) => void
  onMerge: (group: DuplicateGroup) => void
}

/**
 * One duplicate group, as a skimmable row (issue #589).
 *
 * The list is for triage: enough to recognise a group whose answer is obvious
 * and merge it on the spot - the dialog still shows the dry run first - with
 * Review for the ones that need looking at side by side. Every copy is listed
 * with its full name, because the difference between two duplicates is usually
 * a suffix ("(1)", "-printable") that truncation would hide. The copy a merge
 * would keep is marked.
 */
export default function DuplicateGroupRow({ group, onReview, onMerge }: Props) {
  const { t } = useTranslation()
  const keeper = pickKeeper(group)
  const exact = isExactGroup(group)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 10,
        background: 'var(--bg-card)',
      }}
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 6,
          }}
        >
          <span style={badge}>
            {exact ? t('maintenance.dupes.match.exact') : group.reason_text}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t(`maintenance.dupes.collection.${group.resource_type}`, {
              defaultValue: group.resource_type,
            })}
            {' · '}
            {t('maintenance.dupes.confidence')}: {Math.round((group.confidence || 0) * 100)}%
          </span>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {(group.members || []).map((m) => {
            const keep = m.id === keeper?.id
            return (
              <li
                key={m.id}
                style={{
                  fontSize: keep ? 14 : 13,
                  color: keep ? 'var(--text)' : 'var(--text-dim)',
                  wordBreak: 'break-word',
                }}
              >
                {m.title || m.filename}
                <span style={{ color: 'var(--text-muted)' }}>
                  {' · '}
                  {formatSize(m.file_size || 0)}
                  {m.page_count ? ` · ${m.page_count}p` : ''}
                  {m.is_missing ? ` · ${t('merge.missingFile')}` : ''}
                </span>
                {keep && <span style={keepBadge}>{t('maintenance.dupes.review.keeps')}</span>}
              </li>
            )
          })}
        </ul>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => onMerge(group)} style={secondaryBtn}>
          <LuCombine size={13} aria-hidden="true" /> {t('merge.action')}
        </button>
        <button type="button" onClick={() => onReview(group)} style={primaryBtn}>
          {t('maintenance.dupes.review.open')} <LuArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

const badge: CSSProperties = {
  fontSize: 11,
  padding: '1px 7px',
  borderRadius: 8,
  color: 'var(--variant)',
  background: 'rgba(79,209,197,0.12)',
  border: '1px solid rgba(79,209,197,0.35)',
}

const keepBadge: CSSProperties = {
  marginLeft: 8,
  fontSize: 11,
  color: 'var(--variant)',
  whiteSpace: 'nowrap',
}

const primaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
}

const secondaryBtn: CSSProperties = {
  ...primaryBtn,
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
}
