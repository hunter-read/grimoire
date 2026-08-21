import { useCallback, useMemo, useState } from 'react'
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
export default function useFileActions({ onChanged } = {}) {
  const { t } = useTranslation()
  // Both contexts are read defensively: this hook is mounted from menus that
  // appear in views tested (and rendered) without a provider above them, and a
  // missing provider must degrade to "no file actions" rather than throwing.
  const user = useAuth()?.user
  const libraryWritable = useUISettings()?.library_writable
  const [moving, setMoving] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const available = user?.role === 'admin' && libraryWritable !== false

  // Normalises the several shapes a caller can hold — a browse row, a book
  // record, a map/token/audio row — onto the { path, name, is_dir } the modals
  // work in. Returns null when the item has no known library path, which is how
  // a caller learns not to offer the actions for it.
  const entryFor = useCallback((item) => {
    if (!item) return null
    const path = item.path ?? item.relative_path
    if (!path) return null
    return {
      path,
      name: item.name ?? item.filename ?? path.split('/').pop(),
      is_dir: !!item.is_dir,
    }
  }, [])

  // Tell the caller and the rest of the app in one place, so no call site can
  // announce a change it forgot to broadcast.
  const announce = useCallback(
    (detail) => {
      onChanged?.(detail)
      window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED, { detail }))
    },
    [onChanged]
  )

  const handleRename = useCallback(
    async (path, newName) => {
      await filesApi.rename(path, newName)
      announce({ action: 'rename', path, name: newName })
    },
    [announce]
  )

  const openers = useMemo(
    () => ({
      move: (item) => setMoving(entryFor(item)),
      rename: (item) => setRenaming(entryFor(item)),
      remove: (item) => setDeleting(entryFor(item)),
    }),
    [entryFor]
  )

  const modals = (
    <>
      {moving && (
        <MoveModal
          items={[moving]}
          onClose={() => setMoving(null)}
          onMoved={(res, destination) =>
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
          onDeleted={(res) => announce({ action: 'delete', path: deleting.path, result: res })}
        />
      )}
    </>
  )

  return {
    available,
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
