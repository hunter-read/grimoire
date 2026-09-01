import { LuFolder, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import { toTitleCase } from '../../utils'
import CategoryBookItem from './CategoryBookItem'
import RescanButton from '../RescanButton'
import FolderTagRow from '../media/FolderTagRow'
import { countBooks, allBooks } from './folderTree'

/** The library-root-relative folder a group of books shares (relative_path minus filename). */
function folderScope(books) {
  const ref = (books || []).find((b) => b.relative_path)
  if (!ref) return null
  return ref.relative_path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

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
 * Props (besides those documented on SystemCategorySection):
 *   folder            – this folder's display name (last path segment)
 *   path              – segments from the category dir, e.g. ["monsters","spelljammer"]
 *   node              – folder-tree node: { books: [], folders: { name -> node } }
 *   depth             – nesting depth (0 = category's direct subfolder)
 *   bookFolderTags    – { fullPath -> string[] } tag map
 *   editingFolderKey  – full path of the folder currently being tag-edited
 *   onEditFolder      – (fullPath | null) => void
 *   onSaveBookFolderTags – (fullPath, tags) => void
 */
export default function BookFolderGroup({
  folder,
  path,
  node,
  depth = 0,
  systemId,
  category,
  collapsed,
  onToggle,
  editingBookId,
  setEditingBookId,
  isEditor,
  onSaveBook,
  onDownload,
  bulkMode,
  selectedBookIds,
  onToggleBook,
  onVariantsChanged,
  card,
  compact,
  list,
  booksContainerStyle,
  allTags = [],
  existingCategories = [],
  systemGenres = [],
  bookFolderTags = {},
  editingFolderKey = null,
  onEditFolder,
  onSaveBookFolderTags,
}) {
  const folderPath = path.join('/')
  const toggleKey = `${category}::${folderPath}`
  const isCollapsed = collapsed.has(toggleKey)
  const total = countBooks(node)
  const childNames = Object.keys(node.folders).sort((a, b) => a.localeCompare(b))
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
    systemId,
    category,
    collapsed,
    onToggle,
    editingBookId,
    setEditingBookId,
    isEditor,
    onSaveBook,
    onDownload,
    onVariantsChanged,
    bulkMode,
    selectedBookIds,
    onToggleBook,
    card,
    compact,
    list,
    booksContainerStyle,
    allTags,
    existingCategories,
    systemGenres,
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
      {isEditor && <RescanButton scope={folderScope(allBooks(node))} />}
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
      {childNames.map((name) => (
        <BookFolderGroup
          key={name}
          folder={name}
          path={[...path, name]}
          node={node.folders[name]}
          depth={depth + 1}
          {...childProps}
        />
      ))}
      {node.books.length > 0 && (
        <div style={containerStyle}>
          {node.books.map((book) => (
            // Same row+editor+details block as the ungrouped layouts. Sharing
            // CategoryBookItem is what keeps a book in a subfolder from
            // silently losing the "View details" action.
            <CategoryBookItem
              key={book.id}
              book={book}
              card={card}
              compact={compact}
              list={list}
              editingBookId={editingBookId}
              setEditingBookId={setEditingBookId}
              allTags={allTags}
              existingCategories={existingCategories}
              systemGenres={systemGenres}
              isEditor={isEditor}
              onSaveBook={onSaveBook}
              bulkMode={bulkMode}
              selectedBookIds={selectedBookIds}
              onToggleBook={onToggleBook}
              onVariantsChanged={onVariantsChanged}
            />
          ))}
        </div>
      )}
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
