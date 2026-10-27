import type { CSSProperties } from 'react'
import CategoryBookItem from './CategoryBookItem'
import type { CategoryBookItemProps } from './CategoryBookItem'
import type { BookFolderGroupProps } from './BookFolderGroup'
import type { EditableBook } from './BookEditor'
import BookFolderGroup from './BookFolderGroup'
import LoadMoreSentinel from '../LoadMoreSentinel'
import Spinner from '../Spinner'
import { entryRuns } from './folderTree'
import { nodeKey, orderedNodeEntries } from './shelfTree'
import type { ShelfNode, ShelfOrderOptions } from './shelfTree'

/** One node's paged list of books, as useShelf keeps it. */
export interface ShelfPage {
  items: EditableBook[]
  hasMore: boolean
  loading?: boolean
}

/** The shelf's paged lists (useShelf's `pages`), as the shelf reads them. */
export interface ShelfPages {
  get: (key: string) => ShelfPage | undefined
}

/** How folders are ordered among books: the sort, its order, and the placement. */
export type FolderOrder = Omit<ShelfOrderOptions, 'hasMore'>

/** The props every CategoryBookItem on the shelf shares. */
export type ShelfItemProps = Omit<CategoryBookItemProps, 'book'>

/** The props every nested BookFolderGroup shares. */
export type ShelfFolderProps = Omit<BookFolderGroupProps, 'node' | 'depth'>

export interface ShelfNodeBodyProps {
  node: ShelfNode
  pages: ShelfPages
  onLoadNode: (key: string) => void
  folderOrder: FolderOrder
  itemProps: ShelfItemProps
  folderProps: ShelfFolderProps
  depth?: number
  containerStyle?: CSSProperties
}

/**
 * The inside of one shelf node - a category, or a folder within it: its
 * subfolders and its own books, in display order (issue #221).
 *
 * The books arrive a page at a time. The node asks for its first page, and
 * each one after, when its end scrolls near; a node with no books of its own
 * (only subfolders) never asks at all. Folders take their places among the
 * books per `folderOrder` (see shelfTree's orderedNodeEntries).
 *
 * Props:
 *   node         - shelfTree node
 *   pages        - the shelf's paged lists (useShelf)
 *   onLoadNode   - (key) => load the node's next page
 *   folderOrder  - { sort, order, placement }
 *   itemProps    - passed to every CategoryBookItem
 *   folderProps  - passed to every nested BookFolderGroup
 *   depth        - nesting depth of the folders rendered here
 *   containerStyle - grid/list style for a run of books
 */
export default function ShelfNodeBody({
  node,
  pages,
  onLoadNode,
  folderOrder,
  itemProps,
  folderProps,
  depth = 0,
  containerStyle,
}: ShelfNodeBodyProps) {
  const key = nodeKey(node.category, node.path)
  const list = node.direct > 0 ? pages.get(key) : undefined
  const books = list ? list.items : []
  const hasMore = node.direct > 0 && (!list || list.hasMore)
  const loading = !!list?.loading
  const runs = entryRuns(orderedNodeEntries(node, books, { ...folderOrder, hasMore }))

  return (
    <>
      {runs.map((run) =>
        run.type === 'folder' ? (
          <BookFolderGroup
            key={`folder:${run.name}`}
            node={run.node}
            depth={depth}
            {...folderProps}
          />
        ) : (
          <div key={`books:${run.books[0].id}`} style={{ ...containerStyle, marginBottom: 4 }}>
            {run.books.map((book) => (
              <CategoryBookItem key={book.id} book={book} {...itemProps} />
            ))}
          </div>
        )
      )}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <Spinner size={18} />
        </div>
      )}
      {node.direct > 0 && (
        <LoadMoreSentinel
          active={hasMore && !loading}
          count={books.length}
          onVisible={() => onLoadNode(key)}
        />
      )}
    </>
  )
}
