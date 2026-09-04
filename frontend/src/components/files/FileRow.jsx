import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronRight, LuChevronDown } from 'react-icons/lu'
import Chip from './Chip'
import EntryIcon from './EntryIcon'

function formatSize(bytes) {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

/**
 * One row of the file tree.
 *
 * Split out and memoised because the tree is virtualised: scrolling changes
 * which rows exist, and without memoisation every surviving row would re-render
 * on each scroll frame. The props are deliberately flat primitives and stable
 * callbacks so the comparison is cheap and actually holds.
 */
function FileRow({
  id,
  entry,
  depth,
  isOpen,
  isSelected,
  isCursor,
  isDropTarget,
  height,
  onToggleExpand,
  onOpenFolder,
  onSelect,
  onContext,
  onDragStart,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
}) {
  const { t } = useTranslation()

  return (
    <div
      id={id}
      role="option"
      aria-selected={!!isSelected}
      draggable
      onDragStart={(e) => onDragStart(e, entry)}
      onDragOver={(e) => onDragOverRow(e, entry, isOpen)}
      onDragLeave={() => onDragLeaveRow(entry)}
      onDrop={(e) => onDropRow(e, entry)}
      onClick={(e) => onSelect(e, entry)}
      // Double-click *enters* the folder, re-anchoring the pane to it; the
      // twisty expands in place. Two distinct intents, two distinct targets —
      // double-clicking to expand left the user with no way to drill in.
      onDoubleClick={() => entry.is_dir && onOpenFolder(entry.path)}
      onContextMenu={(e) => onContext(e, entry)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height,
        boxSizing: 'border-box',
        padding: '0 10px',
        paddingLeft: 10 + depth * 16,
        fontSize: 13,
        cursor: 'grab',
        userSelect: 'none',
        background: isDropTarget || isSelected ? 'var(--bg-card-hover)' : 'transparent',
        // Three states share one outline slot. A drop target wins while a drag
        // is live; otherwise the cursor is drawn solid, so a row that is the
        // cursor but *not* selected — the result of Cmd+arrow — is still
        // visibly where the next keystroke will land.
        outline: isDropTarget
          ? '1px dashed var(--gold)'
          : isCursor
            ? '1px solid var(--gold)'
            : 'none',
        outlineOffset: -1,
        borderBottom: '1px solid var(--border-light)',
      }}
      title={entry.path}
      data-testid={`entry-${entry.name}`}
    >
      {/* Twisty. Folders get a real toggle; files get a spacer so names stay
          aligned with their siblings. */}
      {entry.is_dir ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand(entry.path)
          }}
          aria-label={isOpen ? t('files.collapse') : t('files.expand')}
          aria-expanded={isOpen}
          data-testid={`twisty-${entry.name}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {isOpen ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        </button>
      ) : (
        <span style={{ width: 18, flexShrink: 0 }} />
      )}

      <span
        style={{
          color: entry.is_dir ? 'var(--gold)' : 'var(--text-muted)',
          display: 'flex',
          flexShrink: 0,
        }}
      >
        <EntryIcon entry={entry} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: entry.is_missing ? 'var(--text-muted)' : 'var(--text)',
        }}
      >
        {entry.name}
      </span>

      {entry.container_kind && <Chip>{t(`files.kind.${entry.container_kind}`)}</Chip>}
      {entry.nsfw && <Chip tone="danger">{t('files.nsfw')}</Chip>}
      {/* An indexed file carries metadata that a move must preserve; an
          unindexed one is invisible to the rest of the app. */}
      {!entry.is_dir && entry.record_id && <Chip tone="accent">{t('files.indexed')}</Chip>}
      {entry.is_missing && <Chip tone="danger">{t('files.missing')}</Chip>}

      <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
        {entry.is_dir
          ? t('files.itemCount', { count: entry.child_count ?? 0 })
          : formatSize(entry.size)}
      </span>
    </div>
  )
}

export default memo(FileRow)
