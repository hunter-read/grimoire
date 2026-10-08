import { useTranslation } from 'react-i18next'
import { LuFileText, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import { CATEGORY_ICONS, CATEGORY_LABELS, categoryLabel } from '../../constants'
import { toTitleCase } from '../../utils'
import RescanButton from '../RescanButton'
import ShelfNodeBody from './ShelfNodeBody'
import { categoryDepth } from './folderTree'
import { categoryFolderName, nodeScope } from './shelfTree'

/**
 * One collapsible category section within SystemDetailView: the category header
 * (icon, label, count, download, rescan) and its books, grouped by subfolder when
 * present. Extracted from SystemDetailView (issue #152).
 *
 * The category is the root node of the server-built shelf tree (shelfTree.js):
 * its count and subfolders come from `/book-groups`, and its books page in
 * through ShelfNodeBody while it is open (issue #221).
 *
 * Props:
 *   cat, node            – category slug and its shelf-tree root
 *   pages, onLoadNode    – the shelf's paged lists and loader (useShelf)
 *   folderOrder          – { sort, order, placement } for ordering folders among
 *                          books (see shelfTree's orderedNodeEntries)
 *   system               – system object (id/name for downloads, rescan scopes)
 *   isCollapsed          – whether this category is collapsed
 *   onToggleCat          – () => void
 *   collapsedSubfolders  – Set of collapsed subfolder keys
 *   onToggleSubfolder    – (key) => void
 *   editingBookId, setEditingBookId
 *   allTags, existingCategories
 *   card, compact, list  – view-mode flags
 *   booksContainerStyle  – grid/list container style
 *   isEditor
 *   onSaveBook, onDownload
 *   bulkMode, selectedBookIds, onToggleBook
 */
export default function SystemCategorySection({
  cat,
  node,
  pages,
  onLoadNode,
  folderOrder,
  system,
  isCollapsed,
  onToggleCat,
  collapsedSubfolders,
  onToggleSubfolder,
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
  onSaveBook,
  onDownload,
  bulkMode,
  selectedBookIds,
  onToggleBook,
  onVariantsChanged,
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
  const customLabel = categoryFolderName(node, depth) || toTitleCase(cat)
  const catLabel = system?.is_one_page
    ? t('systemDetail.books')
    : isKnownCategory
      ? t(`categories.${cat}`, { defaultValue: categoryLabel(cat) })
      : customLabel

  const itemProps = {
    card,
    compact,
    list,
    editingBookId,
    setEditingBookId,
    allTags,
    existingCategories,
    systemGenres,
    isEditor,
    onSaveBook,
    bulkMode,
    selectedBookIds,
    onToggleBook,
    onVariantsChanged,
  }
  const folderProps = {
    pages,
    onLoadNode,
    folderOrder,
    systemId: system.id,
    collapsed: collapsedSubfolders,
    onToggle: onToggleSubfolder,
    isEditor,
    onDownload,
    booksContainerStyle,
    itemProps,
    categoryDepth: depth,
    scopeFallback: system.scope_path || null,
    bookFolderTags,
    editingFolderKey,
    onEditFolder,
    onSaveBookFolderTags,
  }

  const body = !isCollapsed && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ShelfNodeBody
        node={node}
        pages={pages}
        onLoadNode={onLoadNode}
        folderOrder={folderOrder}
        itemProps={itemProps}
        folderProps={folderProps}
        depth={0}
        containerStyle={booksContainerStyle}
      />
    </div>
  )

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
            ({node.count})
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
        {isEditor && <RescanButton scope={nodeScope(node, depth, system.scope_path || null)} />}
      </div>
      {body}
    </div>
  )
}
