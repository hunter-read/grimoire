import { Link } from 'react-router-dom'
import { LuTag } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import InlineTagEditor from '../maps/InlineTagEditor'

const tagPillStyle = {
  fontSize: 12,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'var(--tag-bg)',
  border: '1px solid var(--tag-border)',
  color: 'var(--text-dim)',
  textDecoration: 'none',
  cursor: 'pointer',
}

/**
 * The tag display/edit affordance shown on a folder header. When `editing` is
 * true it renders the InlineTagEditor; otherwise it shows the tag pills plus an
 * "add/edit tags" button (when `canTag`).
 *
 * `i18n` is the entity key prefix (e.g. "maps"); `fullLabels` selects the
 * longer "editTagsFull" copy used in the mobile layout.
 */
export default function FolderTagRow({
  tags,
  editing,
  canTag,
  i18n,
  resourceType = null,
  fullLabels = false,
  onEdit,
  onSave,
  onCancel,
}) {
  const { t } = useTranslation()
  if (editing) {
    return (
      <InlineTagEditor
        tags={tags}
        onSave={onSave}
        onCancel={onCancel}
        resourceType={resourceType}
      />
    )
  }
  return (
    <>
      {tags.map((tag) => (
        // A folder tag chip deep-links to the tags page filtered to it, the same
        // as every other tag chip in the app — matching is by internal key, i.e.
        // the lowercased label.
        <Link
          key={tag}
          to={`/tags?tag=${encodeURIComponent(String(tag).trim().toLowerCase())}`}
          onClick={(e) => e.stopPropagation()}
          style={tagPillStyle}
        >
          {tag.charAt(0).toUpperCase() + tag.slice(1)}
        </Link>
      ))}
      {canTag && (
        <button
          onClick={onEdit}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 12,
            padding: '2px 6px',
          }}
        >
          <LuTag size={11} />{' '}
          {tags.length > 0
            ? t(`${i18n}.${fullLabels ? 'editTagsFull' : 'editTags'}`)
            : t(`${i18n}.addTags`)}
        </button>
      )}
    </>
  )
}
