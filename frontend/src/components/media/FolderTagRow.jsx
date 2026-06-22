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
  fullLabels = false,
  onEdit,
  onSave,
  onCancel,
}) {
  const { t } = useTranslation()
  if (editing) {
    return <InlineTagEditor tags={tags} onSave={onSave} onCancel={onCancel} />
  }
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} style={tagPillStyle}>
          {tag.charAt(0).toUpperCase() + tag.slice(1)}
        </span>
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
