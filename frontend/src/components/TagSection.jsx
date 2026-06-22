import { LuTag } from 'react-icons/lu'

const tagPillStyle = {
  fontSize: 12,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'var(--tag-bg)',
  border: '1px solid var(--tag-border)',
  color: 'var(--text-dim)',
}

/** Tag list with an optional edit button — used in the map/token detail sidebars. */
export default function TagSection({ label, tags, onEdit, canEdit, editLabel, noTagsLabel }) {
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
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </div>
        {canEdit && (
          <button
            onClick={onEdit}
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {tags.map((tag) => (
            <span key={tag} style={tagPillStyle}>
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {noTagsLabel}
        </div>
      )}
    </div>
  )
}
