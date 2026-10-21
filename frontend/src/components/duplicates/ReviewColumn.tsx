import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Schema } from '../../api'
import { formatSize } from '../../utils'
import PagePreview from './PagePreview'
import RefCounts from './RefCounts'

type CompareItem = Schema<'CompareItem'>

interface Props {
  resourceType: string
  item: CompareItem
  /** 1-based, the number key that makes this copy the keeper. */
  position: number
  isKeeper: boolean
  included: boolean
  page: number
  kind: string
  label: string
  kindOptions: string[]
  busy: boolean
  onMakeKeeper: () => void
  onToggleInclude: () => void
  onKind: (kind: string) => void
  onLabel: (label: string) => void
  /** Shown under a copy that is already a version of a third item. */
  familyNotice?: ReactNode
}

/**
 * One copy in the review queue (issue #589), with every decision about it in
 * its own column: keep this one, leave it out of the merge, or - if the copies
 * turn out to be editions - what kind of version it is.
 *
 * Kind and label sit here rather than in one shared form because a group can
 * hold several copies, and each is a different kind of version of the keeper.
 */
export default function ReviewColumn({
  resourceType,
  item,
  position,
  isKeeper,
  included,
  page,
  kind,
  label,
  kindOptions,
  busy,
  onMakeKeeper,
  onToggleInclude,
  onKind,
  onLabel,
  familyNotice,
}: Props) {
  const { t } = useTranslation()
  const dimmed = !isKeeper && !included

  return (
    <div
      style={{
        border: `1px solid ${isKeeper ? 'var(--variant)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: 14,
        background: isKeeper ? 'rgba(79,209,197,0.06)' : 'var(--bg-card)',
        opacity: dimmed ? 0.55 : 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 10,
          fontSize: 13,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="radio"
            name="keeper"
            checked={isKeeper}
            disabled={busy}
            onChange={onMakeKeeper}
          />
          {isKeeper
            ? t('maintenance.dupes.review.keeping')
            : t('maintenance.dupes.review.keepThis')}
          <kbd style={kbd}>{position}</kbd>
        </label>
        {!isKeeper && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={included} disabled={busy} onChange={onToggleInclude} />
            {t('maintenance.dupes.review.include')}
          </label>
        )}
      </div>

      <PagePreview resourceType={resourceType} item={item} page={page} />

      <div style={{ fontSize: 14, wordBreak: 'break-word', marginTop: 10 }}>
        {item.title || item.filename}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-word' }}>
        {item.relative_path}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        {formatSize(item.file_size || 0)}
        {item.page_count ? ` · ${item.page_count}p` : ''}
        {item.game_system_name ? ` · ${item.game_system_name}` : ''}
        {item.is_missing ? ` · ${t('merge.missingFile')}` : ''}
      </div>
      <RefCounts counts={item.reference_counts} />

      {!isKeeper && included && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <label style={fieldLabel}>
            {t('maintenance.dupes.kindLabel')}
            <select
              value={kind}
              disabled={busy}
              onChange={(e) => onKind(e.target.value)}
              style={input}
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {t(`variants.kind.${k}`, { defaultValue: k })}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldLabel}>
            {t('maintenance.dupes.labelLabel')}
            <input
              type="text"
              value={label}
              disabled={busy}
              onChange={(e) => onLabel(e.target.value)}
              placeholder={t('maintenance.dupes.labelPlaceholder')}
              style={input}
            />
          </label>
        </div>
      )}

      {familyNotice}
    </div>
  )
}

const kbd = {
  fontSize: 11,
  padding: '0 5px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontFamily: 'inherit',
}

const fieldLabel = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  fontSize: 12,
  color: 'var(--text-dim)',
  flex: '1 1 140px',
  minWidth: 0,
}

const input = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box' as const,
}
