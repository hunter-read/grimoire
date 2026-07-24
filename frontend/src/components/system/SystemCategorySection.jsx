import { useTranslation } from 'react-i18next'
import { LuFileText, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import { CATEGORY_ICONS } from '../../constants'
import RescanButton from '../RescanButton'
import BookFolderGroup from './BookFolderGroup'
import CategoryBookItem from './CategoryBookItem'

/** Extract the subfolder name from a book's relative_path.
 *  Path structure: books/{SystemName}/{categoryDir}/{SubFolder}/book.pdf
 *  Returns the subfolder name, or null if the book sits directly in the category dir. */
function getBookSubfolder(book) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > 4 ? parts[3] : null
}

/**
 * One collapsible category section within SystemDetailView: the category header
 * (icon, label, count, download, rescan) and its books, grouped by subfolder when
 * present. Extracted from SystemDetailView (issue #152); rendering is unchanged.
 *
 * Props:
 *   cat, books           – category slug and its sorted book list
 *   system               – system object (for id/name in downloads + rescan scope)
 *   isCollapsed          – whether this category is collapsed
 *   onToggleCat          – () => void
 *   collapsedSubfolders  – Set of collapsed subfolder keys
 *   onToggleSubfolder    – (key) => void
 *   groupScope           – (books) => rescan scope for the whole category
 *   editingBookId, setEditingBookId
 *   allTags, existingCategories
 *   card, compact, list  – view-mode flags
 *   booksContainerStyle  – grid/list container style
 *   isEditor
 *   onOpenBook, onSaveBook, onDownload
 *   bulkMode, selectedBookIds, onToggleBook
 */
export default function SystemCategorySection({
  cat,
  books,
  system,
  isCollapsed,
  onToggleCat,
  collapsedSubfolders,
  onToggleSubfolder,
  groupScope,
  editingBookId,
  setEditingBookId,
  allTags,
  existingCategories,
  card,
  compact,
  list,
  booksContainerStyle,
  isEditor,
  onOpenBook,
  onSaveBook,
  onDownload,
  bulkMode,
  selectedBookIds,
  onToggleBook,
}) {
  const { t } = useTranslation()
  const CatIcon = CATEGORY_ICONS[cat] || LuFileText
  const catLabel = t(`categories.${cat}`, {
    defaultValue: cat.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  })

  const bookItemProps = {
    card,
    compact,
    list,
    editingBookId,
    setEditingBookId,
    allTags,
    existingCategories,
    isEditor,
    onOpenBook,
    onSaveBook,
    bulkMode,
    selectedBookIds,
    onToggleBook,
  }

  // Group books by subfolder (derived from relative_path).
  // Books sitting directly in the category dir have no subfolder (key='').
  const folderMap = {}
  for (const book of books) {
    const key = getBookSubfolder(book) || ''
    if (!folderMap[key]) folderMap[key] = []
    folderMap[key].push(book)
  }
  const hasFolders = Object.keys(folderMap).some((k) => k !== '')

  let body = null
  if (!isCollapsed) {
    if (!hasFolders) {
      // No subfolders — render flat list
      body = (
        <div style={booksContainerStyle}>
          {books.map((book) => (
            <CategoryBookItem key={book.id} book={book} {...bookItemProps} />
          ))}
        </div>
      )
    } else {
      const sortedFolderKeys = Object.keys(folderMap).sort((a, b) => {
        if (a === '') return -1
        if (b === '') return 1
        return a.localeCompare(b)
      })
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sortedFolderKeys.map((key) =>
            key === '' ? (
              // Ungrouped books (no subfolder) — render flat above the folder widgets
              <div key="__ungrouped__" style={{ ...booksContainerStyle, marginBottom: 4 }}>
                {folderMap[''].map((book) => (
                  <CategoryBookItem key={book.id} book={book} {...bookItemProps} />
                ))}
              </div>
            ) : (
              <BookFolderGroup
                key={key}
                folder={key}
                books={folderMap[key]}
                systemId={system.id}
                category={cat}
                card={card}
                compact={compact}
                list={list}
                booksContainerStyle={booksContainerStyle}
                collapsed={collapsedSubfolders}
                onToggle={onToggleSubfolder}
                editingBookId={editingBookId}
                setEditingBookId={setEditingBookId}
                onOpenBook={onOpenBook}
                isEditor={isEditor}
                onSaveBook={onSaveBook}
                onDownload={onDownload}
                bulkMode={bulkMode}
                selectedBookIds={selectedBookIds}
                onToggleBook={onToggleBook}
              />
            )
          )}
        </div>
      )
    }
  }

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: isCollapsed ? 0 : 16,
        }}
      >
        <button
          onClick={onToggleCat}
          aria-expanded={!isCollapsed}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            textAlign: 'left',
          }}
        >
          {isCollapsed ? (
            <LuChevronRight size={15} color="var(--gold-dim)" />
          ) : (
            <LuChevronDown size={15} color="var(--gold-dim)" />
          )}
          <CatIcon size={15} color="var(--gold-dim)" />
          <span style={{ fontSize: 17, color: 'var(--gold-dim)', fontWeight: 600 }}>
            {catLabel}
          </span>
          <span
            style={{
              fontSize: 14,
              color: 'var(--text-muted)',
              fontFamily: 'Alegreya Sans, sans-serif',
              fontWeight: 400,
            }}
          >
            ({books.length})
          </span>
        </button>
        <button
          onClick={() =>
            onDownload({
              title: `${catLabel} — ${system.name}`,
              params: { type: 'system_category', id: system.id, category: cat },
            })
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 5,
            fontSize: 12,
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title={t('systemDetail.download')}
        >
          <LuDownload size={11} /> {t('systemDetail.download')}
        </button>
        {isEditor && <RescanButton scope={groupScope(books)} />}
      </div>
      {body}
    </div>
  )
}
