import { LuFolder, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import { toTitleCase } from '../../utils'
import RescanButton from '../RescanButton'
import FolderTagRow from '../media/FolderTagRow'
import ShelfNodeBody from './ShelfNodeBody'
import { nodeScope } from './shelfTree'

/**
 * Renders a single subfolder group within a book category section, recursing into
 * nested subfolders so arbitrarily deep hierarchies are shown (issue #189).
 *
 * Rendering follows the maps pages (issue #235 follow-up):
 *   - depth 0 (a category's direct subfolder) is a bordered panel;
 *   - deeper levels are lighter, indented rows with a faint dashed guide line on
 *     the left, so deep nesting reads clearly instead of stacking heavy panels.
 *
 * Each folder header also carries a FolderTagRow so book subfolders can be tagged
 * (persisted via /systems/{id}/book-folders). Collapse state is keyed by the full
 * folder path so each level toggles independently.
 *
 * The folder is a node of the server-built shelf tree (shelfTree.js): its count
 * comes from the server, and its books page in through ShelfNodeBody once it is
 * open (issue #221).
 *
 * Props:
 *   node              – shelfTree node ({ category, name, path, count, … })
 *   depth             – nesting depth (0 = category's direct subfolder)
 *   pages, onLoadNode – the shelf's paged lists and loader (useShelf)
 *   folderOrder       – { sort, order, placement } for ordering subfolders among books
 *   categoryDepth     – index of the category dir in a book path (rescan scopes)
 *   scopeFallback     – the system's own folder, when a scope cannot be narrower
 *   itemProps         – passed through to every CategoryBookItem
 *   bookFolderTags    – { fullPath -> string[] } tag map
 *   editingFolderKey  – full path of the folder currently being tag-edited
 *   onEditFolder      – (fullPath | null) => void
 *   onSaveBookFolderTags – (fullPath, tags) => void
 */
export default function BookFolderGroup({
  node,
  depth = 0,
  pages,
  onLoadNode,
  folderOrder,
  systemId,
  collapsed,
  onToggle,
  isEditor,
  onDownload,
  booksContainerStyle,
  itemProps,
  categoryDepth = 2,
  scopeFallback = null,
  bookFolderTags = {},
  editingFolderKey = null,
  onEditFolder,
  onSaveBookFolderTags,
}) {
  const { category, name: folder, path: folderPath } = node
  const toggleKey = `${category}::${folderPath}`
  const isCollapsed = collapsed.has(toggleKey)
  const total = node.count
  const containerStyle = booksContainerStyle || {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }
  const isPanel = depth === 0
  // Full BookFolder path used for tagging: {systemId}/{category}/{subfolder…}.
  const fullFolderPath = `${systemId}/${category}/${folderPath}`
  const folderTags = bookFolderTags[fullFolderPath] || []
  const editing = editingFolderKey === fullFolderPath

  // Shared props threaded down to nested BookFolderGroup instances.
  const childProps = {
    pages,
    onLoadNode,
    folderOrder,
    systemId,
    collapsed,
    onToggle,
    isEditor,
    onDownload,
    booksContainerStyle,
    itemProps,
    categoryDepth,
    scopeFallback,
    bookFolderTags,
    editingFolderKey,
    onEditFolder,
    onSaveBookFolderTags,
  }

  const header = (
    <div
      style={{
        padding: isPanel ? '10px 16px' : '6px 0',
        background: isPanel ? 'var(--bg-panel)' : 'transparent',
        borderBottom: isPanel && !isCollapsed ? '1px solid var(--border)' : 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <button
        onClick={() => onToggle(toggleKey)}
        aria-expanded={!isCollapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {isCollapsed ? (
          <LuChevronRight size={15} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
        ) : (
          <LuChevronDown size={15} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
        )}
        <LuFolder size={15} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
        <span
          style={{
            fontSize: isPanel ? 16 : 14,
            color: 'var(--gold-dim)',
            fontFamily: 'Cinzel, serif',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {toTitleCase(folder)}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 4 }}>
          ({total})
        </span>
      </button>

      {/* Folder tags (display + inline editor) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <FolderTagRow
          tags={folderTags}
          editing={editing}
          canTag={isEditor}
          i18n="systemDetail"
          resourceType="book"
          onEdit={() => onEditFolder?.(fullFolderPath)}
          onSave={(newTags) => onSaveBookFolderTags?.(fullFolderPath, newTags)}
          onCancel={() => onEditFolder?.(null)}
        />
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          onDownload?.({
            title: toTitleCase(folder),
            params: { type: 'book_folder', id: systemId, category, folder: folderPath },
          })
        }}
        style={zipBtnStyle}
        title={`Download all books in ${folder}`}
      >
        <LuDownload size={11} /> Download
      </button>
      {isEditor && <RescanButton scope={nodeScope(node, categoryDepth, scopeFallback)} />}
    </div>
  )

  const body = !isCollapsed && (
    <div
      style={{
        padding: isPanel ? '12px 16px' : '8px 0 8px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <ShelfNodeBody
        node={node}
        pages={pages}
        onLoadNode={onLoadNode}
        folderOrder={folderOrder}
        itemProps={itemProps}
        folderProps={childProps}
        depth={depth + 1}
        containerStyle={containerStyle}
      />
    </div>
  )

  if (isPanel) {
    return (
      <div
        style={{
          marginBottom: 8,
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {header}
        {body}
      </div>
    )
  }

  // Nested (depth ≥ 1): indent with a faint dashed guide line on the left.
  return (
    <div
      style={{
        marginLeft: 8,
        paddingLeft: 12,
        borderLeft: '1px dashed var(--border)',
      }}
    >
      {header}
      {body}
    </div>
  )
}

const zipBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 7px',
  borderRadius: 5,
  fontSize: 12,
  lineHeight: '18px',
  flexShrink: 0,
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  cursor: 'pointer',
}
