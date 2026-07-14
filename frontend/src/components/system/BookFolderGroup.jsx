import { LuFolder, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import { toTitleCase } from '../../utils'
import BookRow from './BookRow'
import BookEditor from './BookEditor'
import RescanButton from '../RescanButton'

/** The library-root-relative folder a group of books shares (relative_path minus filename). */
function folderScope(books) {
  const ref = (books || []).find((b) => b.relative_path)
  if (!ref) return null
  return ref.relative_path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

/**
 * Renders a single subfolder group within a book category section.
 * Used in SystemDetailView whenever a category has books organised into subfolders.
 *
 * Props:
 *   folder           – string folder name (e.g. "Monsters", "Curse of Strahd")
 *   books            – sorted array of book objects in this folder
 *   systemId         – string system id (for download scoping)
 *   category         – string category slug (for download scoping)
 *   collapsed        – Set of collapsed folder keys
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
  books,
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
}) {
  const isCollapsed = collapsed.has(`${category}::${folder}`)
  const toggleKey = `${category}::${folder}`
  const containerStyle = booksContainerStyle || {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
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
            ({books.length})
          </span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDownload?.({
              title: toTitleCase(folder),
              params: { type: 'book_folder', id: systemId, category, folder },
            })
          }}
          style={zipBtnStyle}
          title={`Download all books in ${folder}`}
        >
          <LuDownload size={11} /> Download
        </button>
        {isEditor && <RescanButton scope={folderScope(books)} />}
      </div>

      {/* Book list */}
      {!isCollapsed && (
        <div style={{ padding: '12px 16px', ...containerStyle }}>
          {books.map((book) => (
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
