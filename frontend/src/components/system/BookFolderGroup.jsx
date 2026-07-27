import { LuFolder, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import { toTitleCase } from '../../utils'
import BookRow from './BookRow'
import BookEditor from './BookEditor'
import RescanButton from '../RescanButton'
import { countBooks, allBooks } from './folderTree'

/** The library-root-relative folder a group of books shares (relative_path minus filename). */
function folderScope(books) {
  const ref = (books || []).find((b) => b.relative_path)
  if (!ref) return null
  return ref.relative_path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

/**
 * Renders a single subfolder group within a book category section, recursing into
 * nested subfolders so arbitrarily deep folder hierarchies are shown (issue #189).
 * Collapse state is keyed by the full folder path so each level toggles independently.
 *
 * Props:
 *   folder           – this folder's display name (last path segment)
 *   path             – full segment path from the category dir, e.g. ["monsters","spelljammer"]
 *   node             – folder-tree node: { books: [], folders: { name -> node } }
 *   systemId         – string system id (for download scoping)
 *   category         – string category slug (for download scoping)
 *   collapsed        – Set of collapsed folder keys (`${category}::${path}`)
 *   onToggle         – (key: string) => void
 *   editingBookId    – currently-open book editor id
 *   setEditingBookId – setter
 *   onOpenBook       – (book) => void
 *   isEditor         – bool
 *   onSaveBook       – (bookId, updated) => void
 *   onDownload       – ({ title, params }) => void
 */
export default function BookFolderGroup({
  folder,
  path,
  node,
  systemId,
  category,
  collapsed,
  onToggle,
  editingBookId,
  setEditingBookId,
  onOpenBook,
  isEditor,
  onSaveBook,
  onDownload,
  bulkMode,
  selectedBookIds,
  onToggleBook,
  card,
  compact,
  list,
  booksContainerStyle,
  allTags = [],
  existingCategories = [],
  systemGenres = [],
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

  // Shared props threaded down to nested BookFolderGroup instances.
  const childProps = {
    systemId,
    category,
    collapsed,
    onToggle,
    editingBookId,
    setEditingBookId,
    onOpenBook,
    isEditor,
    onSaveBook,
    onDownload,
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
  }

  return (
    <div
      style={{
        marginBottom: 8,
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Folder header */}
      <div
        style={{
          padding: '10px 16px',
          background: 'var(--bg-panel)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
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
            flex: 1,
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
              fontSize: 16,
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

      {/* Nested folders then this folder's own books */}
      {!isCollapsed && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {childNames.map((name) => (
            <BookFolderGroup
              key={name}
              folder={name}
              path={[...path, name]}
              node={node.folders[name]}
              {...childProps}
            />
          ))}
          {node.books.length > 0 && (
            <div style={containerStyle}>
              {node.books.map((book) => (
                <div
                  key={book.id}
                  style={!list && editingBookId === book.id ? { gridColumn: '1 / -1' } : undefined}
                >
                  <BookRow
                    book={book}
                    card={card}
                    compact={compact}
                    onOpen={() => onOpenBook(book)}
                    onEdit={
                      isEditor
                        ? () => setEditingBookId((id) => (id === book.id ? null : book.id))
                        : null
                    }
                    editing={editingBookId === book.id}
                    bulkMode={bulkMode}
                    selected={selectedBookIds?.has(book.id)}
                    onToggle={(mods) => onToggleBook(book.id, mods)}
                  />
                  {editingBookId === book.id && (
                    <BookEditor
                      book={book}
                      allTags={allTags}
                      existingCategories={existingCategories}
                      systemGenres={systemGenres}
                      onSave={(updated) => {
                        onSaveBook(book.id, updated)
                        setEditingBookId(null)
                      }}
                      onClose={() => setEditingBookId(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
