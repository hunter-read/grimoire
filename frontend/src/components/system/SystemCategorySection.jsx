import { useTranslation } from 'react-i18next'
import { LuFileText, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import { CATEGORY_ICONS, CATEGORY_LABELS, categoryLabel } from '../../constants'
import { toTitleCase } from '../../utils'
import RescanButton from '../RescanButton'
import BookFolderGroup from './BookFolderGroup'
import CategoryBookItem from './CategoryBookItem'
import { buildFolderTree, categoryDepth } from './folderTree'

/** The original (non-slugified) category folder name from a book's relative_path.
 *  Path structure: books/{SystemName}/{categoryDir}/.../book.pdf → parts[2], or
 *  one level deeper for a system nested in a container folder (see categoryDepth).
 *  Returns null when the book has no category folder (sits directly in the system dir). */
function getCategoryFolderName(book, depth = 2) {
  const parts = (book?.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > depth + 1 ? parts[depth] : null
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
  bookFolderTags,
  editingFolderKey,
  onEditFolder,
  onSaveBookFolderTags,
  editingBookId,
  setEditingBookId,
  allTags,
  existingCategories,
  systemGenres,
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
  const { t, i18n } = useTranslation()
  const CatIcon = CATEGORY_ICONS[cat] || LuFileText
  // Label resolution:
  //  - One-page RPGs are single documents with no meaningful category → "Books".
  //  - Known categories use their i18n label, then the friendly CATEGORY_LABELS
  //    value ("Core Rulebooks").
  //  - Custom folders use the original folder name from the book path verbatim
  //    (e.g. "GM Tools", not the slug "gm-tools"), falling back to a humanized
  //    slug only when the path is unavailable.
  // Books of a container child sit one folder deeper, so every path index below
  // shifts with the system rather than assuming the flat layout.
  const depth = categoryDepth(system)
  const isKnownCategory = !!CATEGORY_LABELS[cat] || i18n.exists(`categories.${cat}`)
  const customLabel = getCategoryFolderName(books?.[0], depth) || toTitleCase(cat)
  const catLabel = system?.is_one_page
    ? t('systemDetail.books')
    : isKnownCategory
      ? t(`categories.${cat}`, { defaultValue: categoryLabel(cat) })
      : customLabel

  const bookItemProps = {
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
  }

  // Build a nested folder tree from relative_path (supports arbitrary depth).
  // Books sitting directly in the category dir collect at the tree root.
  const tree = buildFolderTree(books, depth)
  const folderNames = Object.keys(tree.folders).sort((a, b) => a.localeCompare(b))
  const hasFolders = folderNames.length > 0

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
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Ungrouped books (directly in the category dir) — flat above folders */}
          {tree.books.length > 0 && (
            <div key="__ungrouped__" style={{ ...booksContainerStyle, marginBottom: 4 }}>
              {tree.books.map((book) => (
                <CategoryBookItem key={book.id} book={book} {...bookItemProps} />
              ))}
            </div>
          )}
          {folderNames.map((name) => (
            <BookFolderGroup
              key={name}
              folder={name}
              path={[name]}
              node={tree.folders[name]}
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
              allTags={allTags}
              existingCategories={existingCategories}
              systemGenres={systemGenres}
              bookFolderTags={bookFolderTags}
              editingFolderKey={editingFolderKey}
              onEditFolder={onEditFolder}
              onSaveBookFolderTags={onSaveBookFolderTags}
            />
          ))}
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
