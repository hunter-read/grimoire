import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { files as filesApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { useUISettings } from '../context/UISettingsContext'
import DeleteModal from '../components/files/DeleteModal'
import MoveModal from '../components/files/MoveModal'
import RenameModal from '../components/files/RenameModal'

// Broadcast after a move, rename, or delete completes. Views showing library
// content listen for it and reload, rather than every menu having to be handed a
// refresh callback by whatever happens to be four levels above it.
export const LIBRARY_CHANGED = 'grimoire:library-changed'

/** The `{ path, name, is_dir }` shape the move / rename / delete modals work in. */
export interface FileEntry {
  path: string
  name: string
  is_dir: boolean
}

/**
 * Anything a caller can hand to an opener: a browse row, a book record, or a
 * map/token/audio row. Only a known library path makes it actionable.
 */
export interface FileActionItem {
  path?: string | null
  relative_path?: string | null
  name?: string | null
  filename?: string | null
  is_dir?: boolean | null
}

/** The detail carried by `onChanged` and the `grimoire:library-changed` event. */
export type LibraryChange =
  | { action: 'rename'; path: string; name: string }
  | { action: 'move'; path: string; destination: string; result: unknown }
  | { action: 'delete'; path: string; result: unknown }

export interface UseFileActionsOptions {
  onChanged?: (detail: LibraryChange) => void
}

export interface FileActions {
  /** Admin and a writable library: move and rename may be offered. */
  available: boolean
  /** Admin: removing from the library may be offered, even read-only. */
  canRemove: boolean
  entryFor: (item: FileActionItem | null | undefined) => FileEntry | null
  labels: { move: string; rename: string; remove: string }
  move: (item: FileActionItem | null | undefined) => void
  rename: (item: FileActionItem | null | undefined) => void
  remove: (item: FileActionItem | null | undefined) => void
  /** The dialogs; the caller must render this. */
  modals: ReactNode
}

/**
 * The move / rename / delete trio, shared by every menu that offers them.
 *
 * These actions appear in three unrelated places — the file manager's context
 * menu, the per-book kebab in the library views, and the reader's toolbar — and
 * all three need the same eligibility rules, the same modals, and the same
 * guards. Implementing them per menu would let those drift, and the one that
 * drifted would be a guard: the difference between three delete buttons is
 * exactly the kind of thing that turns into one without a confirmation.
 *
 * `available` is false unless the user is an admin *and* the library is
 * writable. The actions are hidden rather than disabled in that case, since a
 * read-only mount is a deployment choice rather than a temporary state, and a
 * permanently greyed-out row is just clutter.
 *
 * `canRemove` is the exception, and needs only the admin half. Removing an item
 * from the library is offered in two flavours, and the soft one writes nothing
 * to disk: it drops the record and lets a rescan decide. That is *most* useful
 * on a read-only mount, where the file cannot be deleted and tidying the index
 * is the only recourse available; hiding it there would withhold the one action
 * that still works. The permanent flavour is guarded inside the dialog, and the
 * API refuses it on a read-only library regardless of what the UI offered.
 *
 * Every completed action also broadcasts `grimoire:library-changed` on window,
 * carrying the same detail as `onChanged`. A book row sits four components below
 * the view that owns its data, and threading a refresh callback down that chain
 * — through three components with no other interest in it — is how a prop turns
 * into permanent scaffolding. Views that display library content listen instead.
 *
 * Returns the eligibility flag, three openers, and the `modals` element the
 * caller must render. The modals live with the caller rather than inside this
 * hook so a menu that unmounts on click (all three do) does not take its own
 * confirmation dialog down with it.
 */
export default function useFileActions({ onChanged }: UseFileActionsOptions = {}): FileActions {
  const { t } = useTranslation()
  // Both contexts are read defensively: this hook is mounted from menus that
  // appear in views tested (and rendered) without a provider above them, and a
  // missing provider must degrade to "no file actions" rather than throwing.
  const user = useAuth()?.user
  const libraryWritable = useUISettings()?.library_writable
  const [moving, setMoving] = useState<FileEntry | null>(null)
  const [renaming, setRenaming] = useState<FileEntry | null>(null)
  const [deleting, setDeleting] = useState<FileEntry | null>(null)

  const isAdmin = user?.role === 'admin'
  const available = isAdmin && libraryWritable !== false
  // Move and rename must write; removing from the library need not.
  const canRemove = isAdmin

  // Normalises the several shapes a caller can hold — a browse row, a book
  // record, a map/token/audio row — onto the { path, name, is_dir } the modals
  // work in. Returns null when the item has no known library path, which is how
  // a caller learns not to offer the actions for it.
  const entryFor = useCallback((item: FileActionItem | null | undefined): FileEntry | null => {
    if (!item) return null
    const path = item.path ?? item.relative_path
    if (!path) return null
    return {
      path,
      name: item.name ?? item.filename ?? path.split('/').pop()!,
      is_dir: !!item.is_dir,
    }
  }, [])

  // Tell the caller and the rest of the app in one place, so no call site can
  // announce a change it forgot to broadcast.
  const announce = useCallback(
    (detail: LibraryChange) => {
      onChanged?.(detail)
      window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED, { detail }))
    },
    [onChanged]
  )

  const handleRename = useCallback(
    async (path: string, newName: string) => {
      await filesApi.rename(path, newName)
      announce({ action: 'rename', path, name: newName })
    },
    [announce]
  )

  const openers = useMemo(
    () => ({
      move: (item: FileActionItem | null | undefined) => setMoving(entryFor(item)),
      rename: (item: FileActionItem | null | undefined) => setRenaming(entryFor(item)),
      remove: (item: FileActionItem | null | undefined) => setDeleting(entryFor(item)),
    }),
    [entryFor]
  )

  const modals = (
    <>
      {moving && (
        <MoveModal
          items={[moving]}
          onClose={() => setMoving(null)}
          onMoved={(res: unknown, destination: string) =>
            announce({ action: 'move', path: moving.path, destination, result: res })
          }
        />
      )}
      {renaming && (
        <RenameModal entry={renaming} onClose={() => setRenaming(null)} onRename={handleRename} />
      )}
      {deleting && (
        <DeleteModal
          entry={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(res: unknown) =>
            announce({ action: 'delete', path: deleting.path, result: res })
          }
        />
      )}
    </>
  )

  return {
    available,
    canRemove,
    entryFor,
    labels: {
      move: t('files.moveTo'),
      rename: t('files.rename'),
      remove: t('files.delete'),
    },
    ...openers,
    modals,
  }
}
