import { useTranslation } from 'react-i18next'
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { LuTag } from 'react-icons/lu'

const tagPillStyle: CSSProperties = {
  fontSize: 12,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'var(--tag-bg)',
  border: '1px solid var(--tag-border)',
  color: 'var(--text-dim)',
}

/** Tag list with an optional edit button — used in the map/token detail sidebars. */
export interface TagSectionProps {
  label: ReactNode
  tags: string[]
  onEdit?: MouseEventHandler<HTMLButtonElement>
  canEdit?: boolean
  editLabel?: ReactNode
  noTagsLabel?: ReactNode
}

export default function TagSection({
  label,
  tags,
  onEdit,
  canEdit,
  editLabel,
  noTagsLabel,
}: TagSectionProps) {
  const { t } = useTranslation()
  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        {/* A heading, so each tag group is a stop in a screen reader's
            heading list; styled as the small caps caption it always was. */}
        <h3
          style={{
            margin: 0,
            fontFamily: 'inherit',
            fontWeight: 400,
            fontSize: 12,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </h3>
        {canEdit && (
          <button
            onClick={onEdit}
            // "Edit" alone, once per tag group, does not say which.
            aria-label={
              typeof label === 'string'
                ? t('a11y.mediaDetail.editNamed', { name: label })
                : undefined
            }
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            <LuTag size={11} /> {editLabel}
          </button>
        )}
      </div>
      {tags.length > 0 ? (
        <ul role="list" className="card-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {tags.map((tag) => (
            <li key={tag} style={{ display: 'block' }}>
              <span style={tagPillStyle}>{tag}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {noTagsLabel}
        </div>
      )}
    </div>
  )
}
