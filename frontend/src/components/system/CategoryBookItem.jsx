import { useState } from 'react'
import BookRow from './BookRow'
import BookEditor from './BookEditor'
import BookDetailsModal from './BookDetailsModal'

/**
 * A single book in a category grid: its BookRow plus the inline BookEditor when
 * it's the one being edited. Extracted from SystemDetailView (issue #152) where
 * this exact row+editor block was repeated for the flat and ungrouped layouts.
 *
 * Props:
 *   book               – book object
 *   card, compact, list– view-mode layout flags
 *   editingBookId      – id of the book whose editor is open (or null)
 *   setEditingBookId   – state setter (accepts an updater fn)
 *   allTags            – tag suggestions passed to BookEditor
 *   existingCategories – category suggestions passed to BookEditor
 *   isEditor           – whether the current user may edit
 *   onOpenBook         – (book) => void
 *   onSaveBook         – (bookId, updated) => void
 *   bulkMode           – bulk-select mode active
 *   selectedBookIds    – Set of selected book ids
 *   onToggleBook       – (bookId, mods) => void
 */
export default function CategoryBookItem({
  book,
  card,
  compact,
  list,
  editingBookId,
  setEditingBookId,
  allTags,
  existingCategories,
  systemGenres,
  isEditor,
  onOpenBook,
  onSaveBook,
  bulkMode,
  selectedBookIds,
  onToggleBook,
}) {
  const editing = editingBookId === book.id
  // Read-only metadata view, available to every user (editing is gm/admin only).
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div style={!list && editing ? { gridColumn: '1 / -1' } : undefined}>
      <BookRow
        book={book}
        card={card}
        compact={compact}
        onOpen={() => onOpenBook(book)}
        onEdit={isEditor ? () => setEditingBookId((id) => (id === book.id ? null : book.id)) : null}
        onDetails={() => setShowDetails(true)}
        editing={editing}
        bulkMode={bulkMode}
        selected={selectedBookIds.has(book.id)}
        onToggle={(mods) => onToggleBook(book.id, mods)}
      />
      {showDetails && <BookDetailsModal book={book} onClose={() => setShowDetails(false)} />}
      {editing && (
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
  )
}
