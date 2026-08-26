import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  LuArrowLeft,
  LuArrowLeftRight,
  LuFolderPlus,
  LuPencil,
  LuTrash2,
  LuTriangleAlert,
  LuRefreshCw,
  LuPanelRight,
  LuPanelLeft,
  LuPanelTop,
  LuPanelBottom,
  LuTags,
  LuBoxes,
  LuLayoutGrid,
  LuUpload,
  LuFolderUp,
  LuEye,
  LuFolderInput,
  LuDownload,
} from 'react-icons/lu'
import { files as filesApi } from '../api'
import { useAuth } from '../context/AuthContext'
import useLibraryPane from '../hooks/useLibraryPane'
import FilePane from '../components/files/FilePane'
import NewFolderModal from '../components/files/NewFolderModal'
import RenameModal from '../components/files/RenameModal'
import MenuSubmenu from '../components/files/MenuSubmenu'
import UploadPanel from '../components/files/UploadPanel'
import useUploadQueue from '../hooks/useUploadQueue'
import BulkEditModal from '../components/BulkEditModal'
import RescanButton from '../components/RescanButton'
import RescanModal from '../components/RescanModal'
import PreviewModal from '../components/files/PreviewModal'
import DeleteModal from '../components/files/DeleteModal'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import MoveModal from '../components/files/MoveModal'
import useScanStatus from '../hooks/useScanStatus'

// Where a pinned second pane sits relative to the first. Side-by-side splits
// read as two columns; top/bottom stack them.
const SPLIT_ICONS = {
  right: LuPanelRight,
  left: LuPanelLeft,
  top: LuPanelTop,
  bottom: LuPanelBottom,
}

// Every container kind the UI can set, in menu order. '' clears the kind.
const CONTAINER_KINDS = ['', 'parent', 'one-page', 'agnostic', 'family', 'publisher', 'generic']

// The browse API names collections by their library folder (plural), while the
// metadata editor and the bulk API key everything by singular resource type.
// Mapping here rather than assuming they match: they do not, and treating
// "books" as a type gave the editor an unknown key, which it dereferenced and
// crashed on — a blank page instead of a form.
const EDITOR_TYPES = {
  books: 'book',
  maps: 'map',
  tokens: 'token',
  audio: 'audio',
  // Folders that resolve to a GameSystem report this directly.
  system: 'system',
}

// Kinds that name *the* collection of their sort. The backend enforces this too;
// hiding them here means the user is never offered a choice that would be
// refused.
const SINGLETON_KINDS = new Set(['one-page', 'agnostic'])

/**
 * Library file manager (issue #302).
 *
 * Opens as a **single** tree. Two panes are a tool for a specific job — moving
 * things between two distant places — not the default way to look at a library,
 * and forcing a second pane on arrival splits the screen before there is
 * anything to compare. Pinning a folder opens the second pane on the side the
 * user chooses, and closing it returns to one.
 *
 * Everything here is admin-only and mirrors the backend's guarantees: a move
 * relinks the record in place, so tags, favorites, progress, and campaign links
 * survive; the panes show which files are indexed so the stakes of each move are
 * visible.
 */
export default function FileManagerView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const primary = useLibraryPane('books')
  const secondary = useLibraryPane('')
  // null when only one pane is open; otherwise the edge the second pane is
  // pinned to ('right' | 'left' | 'top' | 'bottom').
  const [split, setSplit] = useState(null)

  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null) // { tone, text }
  const [context, setContext] = useState(null) // right-click menu
  const [creatingIn, setCreatingIn] = useState(null) // parent path for the new folder
  const [renaming, setRenaming] = useState(null) // entry
  const [deleting, setDeleting] = useState(null) // entry pending delete confirmation
  const [movingEntries, setMovingEntries] = useState(null) // entries pending a destination
  const [editing, setEditing] = useState(null) // { type, item } for the metadata editor
  // Where a file picker will drop its files, set just before the input opens.
  const uploadTarget = useRef('')
  const fileInput = useRef(null)
  const folderInput = useRef(null)
  const [showUploads, setShowUploads] = useState(false)
  // Path a context-menu rescan will be scoped to, while its mode modal is open.
  const [rescanning, setRescanning] = useState(null)
  // Folder path whose download-format picker is open, or null.
  const [downloading, setDownloading] = useState(null)
  // { type, item } for the quick-look preview, once its record has loaded.
  const [previewing, setPreviewing] = useState(null)
  const { status: scanStatus, startRescan } = useScanStatus()

  useEffect(() => {
    if (!context) return
    const close = () => setContext(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [context])

  // Refresh whatever is open. A move changes the source *and* the destination,
  // and with one pane both ends are frequently in the same tree.
  const refreshAll = useCallback(() => {
    primary.refresh()
    if (split) secondary.refresh()
  }, [primary, secondary, split])

  const runMove = useCallback(
    async (paths, destination) => {
      setBusy(true)
      setFlash(null)
      try {
        const res = await filesApi.move(paths, destination)
        refreshAll()
        if (res.count && !res.skipped.length) {
          setFlash({ tone: 'ok', text: t('files.movedCount', { count: res.count }) })
        } else if (res.count) {
          setFlash({
            tone: 'warn',
            text: t('files.movedWithSkips', { count: res.count, skipped: res.skipped.length }),
          })
        } else {
          // Every item was refused. Surface the first reason rather than a bare
          // "0 moved", which gives the user nothing to act on.
          setFlash({ tone: 'warn', text: res.skipped[0]?.reason || t('files.nothingMoved') })
        }
      } catch (e) {
        setFlash({ tone: 'error', text: e.message || t('files.moveFailed') })
      } finally {
        setBusy(false)
      }
    },
    [refreshAll, t]
  )

  const handleCreate = useCallback(
    async (parent, name, opts) => {
      await filesApi.createFolder(parent, name, opts)
      // Reload the folder it landed in *and* open it, rather than only
      // re-reading what was already on screen: a folder created inside a
      // collapsed parent is otherwise invisible until a manual refresh.
      primary.refreshPath(parent)
      if (split) secondary.refreshPath(parent)
      setFlash({ tone: 'ok', text: t('files.folderCreated', { name }) })
    },
    [primary, secondary, split, t]
  )

  const handleRename = useCallback(
    async (path, newName) => {
      await filesApi.rename(path, newName)
      refreshAll()
      setFlash({ tone: 'ok', text: t('files.renamed', { name: newName }) })
    },
    [refreshAll, t]
  )

  // The confirmation, the typed-name guard for a non-empty folder, and the call
  // itself all live in DeleteModal; this only reports what came back. Counts are
  // worth surfacing because a folder delete can take far more with it than the
  // one row that was clicked.
  //
  // Which of the two deletes ran is read from the response rather than from what
  // the dialog was asked to do, so the message describes what actually happened.
  // A soft remove counts records, not files: no file was touched, and reporting
  // "and 0 file(s)" would read as a failure.
  const handleDeleted = useCallback(
    (res, entry) => {
      refreshAll()
      const removedFiles = res.files_deleted !== false
      let text
      if (!entry.is_dir) {
        text = removedFiles
          ? t('files.fileDeleted', { name: entry.name })
          : t('files.fileRemoved', { name: entry.name })
      } else if (removedFiles) {
        text = t('files.folderDeletedCount', { name: entry.name, count: res.files || 0 })
      } else {
        text = t('files.folderRemovedCount', { name: entry.name, count: res.records || 0 })
      }
      setFlash({ tone: 'ok', text })
    },
    [refreshAll, t]
  )

  const toggleMarker = useCallback(
    async (entry, patch) => {
      setBusy(true)
      try {
        await filesApi.setMarkers(entry.path, patch)
        refreshAll()
        setFlash({ tone: 'ok', text: t('files.markersUpdated') })
      } catch (e) {
        setFlash({ tone: 'error', text: e.message || t('files.markersFailed') })
      } finally {
        setBusy(false)
      }
    },
    [refreshAll, t]
  )

  const scaffold = useCallback(
    async (path) => {
      setBusy(true)
      try {
        const res = await filesApi.scaffold(path)
        refreshAll()
        setFlash(
          res.created.length
            ? { tone: 'ok', text: t('files.scaffolded', { count: res.created.length }) }
            : { tone: 'warn', text: t('files.scaffoldNothingToDo') }
        )
      } catch (e) {
        setFlash({ tone: 'error', text: e.message || t('files.scaffoldFailed') })
      } finally {
        setBusy(false)
      }
    },
    [refreshAll, t]
  )

  /** Re-index just this folder (or file). Scopes are library-relative paths,
   * which is exactly what a browse entry's `path` already is.
   */
  const runRescan = useCallback(
    (scope, metadataMode) => {
      startRescan({ scope, metadata_mode: metadataMode })
        .then(() => setFlash({ tone: 'ok', text: t('files.rescanStarted', { path: scope }) }))
        .catch((e) => setFlash({ tone: 'error', text: e.message || t('files.rescanFailed') }))
    },
    [startRescan, t]
  )

  /** Load the full record behind a row and open the shared metadata editor.
   *
   * The listing carries only what a row renders, so the record is fetched on
   * demand rather than bloating every browse response with fields almost no row
   * will ever need.
   */
  const openMetadata = useCallback(
    async (entry) => {
      // The editor is configured per resource type and renders nothing sensible
      // for one it does not know — it read `CONFIG[type].fields` and threw,
      // blanking the page. Refuse up front with a message instead.
      const type = EDITOR_TYPES[entry.collection]
      if (!type) {
        setFlash({ tone: 'warn', text: t('files.metadataUnsupported') })
        return
      }
      setBusy(true)
      try {
        const item = await filesApi.record(type, entry.record_id)
        if (!item?.id) throw new Error(t('files.metadataLoadFailed'))
        setEditing({ type, item })
      } catch (e) {
        setFlash({ tone: 'error', text: e.message || t('files.metadataLoadFailed') })
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  /** Load the record behind a row and open the quick-look preview.
   *
   * Same fetch as the metadata editor: the listing carries only what a row
   * renders, and a book preview needs the page count and content token to
   * address its pages at all.
   */
  const openPreview = useCallback(
    async (entry) => {
      const type = EDITOR_TYPES[entry.collection]
      if (!type || type === 'system') {
        setFlash({ tone: 'warn', text: t('files.previewUnsupported') })
        return
      }
      setBusy(true)
      try {
        const item = await filesApi.record(type, entry.record_id)
        if (!item?.id) throw new Error(t('files.previewFailed'))
        setPreviewing({ type, item })
      } catch (e) {
        setFlash({ tone: 'error', text: e.message || t('files.previewFailed') })
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  // Refresh once an upload finishes so the new file appears without a manual
  // reload. Debounced by the queue calling this per completed file — a refresh
  // is cheap next to the upload that triggered it.
  const uploads = useUploadQueue({ onFileDone: () => refreshAll() })

  /** Queue a FileList for upload into `destination`. */
  const startUpload = useCallback(
    (fileList, destination) => {
      // Fall back to the pane's own folder. The picker sets a target before it
      // opens, but a drop or a stray change event can arrive without one, and
      // "no destination" should mean "here" rather than an error.
      destination = destination || primary.path || 'books'
      const entries = [...fileList].map((file) => {
        // A folder pick reports each file's path within the dropped folder;
        // strip the file name to get the sub-directory to recreate.
        const rel = file.webkitRelativePath || ''
        const relativeDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        return { file, relativeDir }
      })
      if (!entries.length) return
      setShowUploads(true)
      uploads.enqueue(entries, destination)
    },
    [uploads, primary.path]
  )

  /** Open the OS picker, remembering which folder the files belong in. */
  const pickFiles = useCallback((destination, kind) => {
    uploadTarget.current = destination
    const input = kind === 'folder' ? folderInput.current : fileInput.current
    if (input) {
      input.value = ''
      input.click()
    }
  }, [])

  /** Files dragged in from the desktop, dropped onto a pane. */
  const handleExternalDrop = useCallback(
    (fileList, destination) => startUpload(fileList, destination),
    [startUpload]
  )

  /** Open the second pane at `edge`, anchored on `folderPath`. */
  const pinTo = useCallback(
    (folderPath, edge) => {
      secondary.navigate(folderPath)
      setSplit(edge)
    },
    [secondary]
  )

  /** Close one of the two panes, keeping the other.
   *
   * Closing the *primary* can't just drop it — the secondary is the pane the
   * user wants to keep, so its folder is adopted by the primary and the
   * secondary is the one that goes away. Either × therefore leaves a single
   * tree showing the folder the user kept.
   */
  const closePane = useCallback(
    (which) => {
      if (which === 'primary') {
        primary.navigate(secondary.path)
      }
      setSplit(null)
      secondary.clearSelection()
    },
    [primary, secondary]
  )

  // Move the selection into the other pane's folder — the fallback for a
  // selection too large to drag comfortably.
  const sendAcross = (from, to) => {
    if (!from.selected.size) return
    runMove([...from.selected], to.path)
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        {t('files.adminOnly')}
      </div>
    )
  }

  // A system folder is a direct child of books/ — the only place category
  // folders make sense.
  const isSystemFolder = (path) => {
    const parts = (path || '').split('/')
    return parts[0] === 'books' && parts.length === 2
  }

  // The kinds this folder can be changed *to*. Two exclusions:
  //
  //  * its current kind, since the submenu is a list of changes to make and
  //    picking the kind it already has does nothing;
  //  * singleton kinds another folder already claims, so the menu never offers
  //    a second "one-page RPGs" collection the API would then refuse.
  const takenSingletons = primary.singletonsTaken || {}
  const availableKinds = (entry) => {
    const current = entry.container_kind || ''
    return CONTAINER_KINDS.filter((k) => {
      if (k === current) return false
      if (!k || !SINGLETON_KINDS.has(k)) return true
      const holder = takenSingletons[k]
      return !holder || holder === entry.path
    })
  }

  const stacked = split === 'top' || split === 'bottom'
  // The second pane comes first in DOM order for 'left' and 'top' so the pinned
  // folder actually appears on that side.
  const secondFirst = split === 'left' || split === 'top'

  const renderPane = (pane, side) => (
    <FilePane
      key={side}
      pane={pane}
      side={side}
      onDropPaths={runMove}
      onDropFiles={handleExternalDrop}
      onOpenContext={setContext}
      onNewFolder={setCreatingIn}
      onPin={pinTo}
      // Both panes are closable once split: the user may want to keep either
      // one, and only offering it on the second forces a re-pin to get there.
      onClose={split ? () => closePane(side) : undefined}
      canPin={!split}
      // Each pane owns its own scroll region, so one tree never drags the
      // other — or the page — along with it.
      fill
    />
  )

  const panes = split
    ? secondFirst
      ? [renderPane(secondary, 'secondary'), renderPane(primary, 'primary')]
      : [renderPane(primary, 'primary'), renderPane(secondary, 'secondary')]
    : [renderPane(primary, 'primary')]

  return (
    // A fixed-height column: the page itself never scrolls, so the trees keep
    // their own scrollbars and the toolbar stays put.
    // Claims whatever vertical space the shell has left and never scrolls
    // itself, so the trees inside divide that space and scroll independently —
    // the same however the split is oriented.
    <div
      style={{
        padding: '16px 24px 20px',
        maxWidth: 1600,
        width: '100%',
        margin: '0 auto',
        flex: '1 1 0',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <button onClick={() => navigate('/settings/maintenance')} style={ghostBtn}>
          <LuArrowLeft size={14} /> {t('files.backToSettings')}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 4,
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{t('files.title')}</h2>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {primary.selected.size > 0 && split && (
            <button
              onClick={() => sendAcross(primary, secondary)}
              disabled={busy}
              style={ghostBtn}
              title={t('files.moveAcrossHint')}
            >
              <LuArrowLeftRight size={14} />{' '}
              {t('files.moveAcross', { count: primary.selected.size })}
            </button>
          )}
          {split && secondary.selected.size > 0 && (
            <button
              onClick={() => sendAcross(secondary, primary)}
              disabled={busy}
              style={ghostBtn}
              title={t('files.moveAcrossHint')}
            >
              <LuArrowLeftRight size={14} />{' '}
              {t('files.moveAcross', { count: secondary.selected.size })}
            </button>
          )}
          <button onClick={refreshAll} style={ghostBtn} disabled={busy} title={t('files.refresh')}>
            <LuRefreshCw size={14} /> {t('files.refresh')}
          </button>
          {/* Refresh re-reads the folder listing; a rescan re-indexes what is on
              disk. Reorganising files is exactly when the index goes stale, so
              the two belong side by side. */}
          <RescanButton compact={false} label={t('files.rescanLibrary')} />
        </div>
      </div>

      <p
        style={{
          fontSize: 13,
          color: 'var(--text-dim)',
          margin: '0 0 12px',
          lineHeight: 1.6,
          maxWidth: 900,
          flexShrink: 0,
        }}
      >
        {t('files.description')}
      </p>

      {flash && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            background: flash.tone === 'error' ? 'var(--danger-fill)' : 'var(--bg-card)',
            color:
              flash.tone === 'error'
                ? 'var(--danger)'
                : flash.tone === 'warn'
                  ? 'var(--warning)'
                  : 'var(--success)',
          }}
        >
          {flash.tone !== 'ok' && <LuTriangleAlert size={14} />}
          {flash.text}
        </div>
      )}

      {showUploads && <UploadPanel queue={uploads} onClose={() => setShowUploads(false)} />}

      {/* One input for files, one for folders: `webkitdirectory` is what makes
          the browser report each file's path within the picked folder, and it
          cannot be toggled on a single input reliably across browsers. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        data-testid="file-input"
        style={{ display: 'none' }}
        onChange={(e) => startUpload(e.target.files, uploadTarget.current)}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        data-testid="folder-input"
        style={{ display: 'none' }}
        onChange={(e) => startUpload(e.target.files, uploadTarget.current)}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: stacked ? 'column' : 'row',
          gap: 12,
        }}
        data-testid={`split-${split || 'none'}`}
      >
        {panes}
      </div>

      <p
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          margin: '10px 0 0',
          lineHeight: 1.6,
          flexShrink: 0,
        }}
      >
        {t('files.dragHint')}
      </p>

      {context && (
        <div
          style={{
            position: 'fixed',
            top: Math.min(context.y, window.innerHeight - 320),
            left: Math.min(context.x, window.innerWidth - 240),
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            zIndex: 900,
            minWidth: 220,
            boxShadow: '0 8px 24px var(--overlay)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Only indexed *files* can be previewed — a system folder has a
              record but nothing to show. */}
          {context.entry.record_id && !context.entry.is_dir && (
            <button
              style={menuItem}
              {...menuHover}
              data-testid="preview-entry"
              onClick={() => {
                openPreview(context.entry)
                setContext(null)
              }}
            >
              <LuEye size={13} /> {t('files.preview')}
            </button>
          )}

          {/* Anything Grimoire has a record for — an indexed file, or a system
              folder — carries editable metadata. The same editor the item pages
              use is reused here rather than a second, diverging form. */}
          {context.entry.record_id && context.entry.collection && (
            <button
              style={menuItem}
              {...menuHover}
              data-testid="edit-metadata"
              onClick={() => {
                openMetadata(context.entry)
                setContext(null)
              }}
            >
              <LuTags size={13} /> {t('files.editMetadata')}
            </button>
          )}

          {/* Scoped rescan. Offered for files as well as folders: the scope is a
              path either way, and re-indexing the one book you just replaced
              beats re-walking the whole library. Disabled while a scan runs,
              since the backend takes one at a time. */}
          <button
            style={{ ...menuItem, opacity: scanStatus.running ? 0.5 : 1 }}
            {...menuHover}
            disabled={scanStatus.running}
            data-testid="rescan-entry"
            onClick={() => {
              setRescanning(context.entry.path)
              setContext(null)
            }}
          >
            <LuRefreshCw size={13} /> {t('files.rescanHere')}
          </button>

          {context.entry.is_dir && (
            <>
              {/* Downloads the folder *as it sits on disk* — every file under
                  it, indexed or not — rather than the subset Grimoire has rows
                  for. That is the whole point of asking for it from the file
                  manager, which browses the filesystem rather than the index. */}
              <button
                style={menuItem}
                {...menuHover}
                data-testid="download-folder"
                onClick={() => {
                  setDownloading(context.entry)
                  setContext(null)
                }}
              >
                <LuDownload size={13} /> {t('files.downloadFolder')}
              </button>

              {/* Creating a folder is a property of the place you clicked, so it
                  belongs here rather than in a toolbar that has no idea which
                  folder you meant. */}
              <button
                style={menuItem}
                {...menuHover}
                onClick={() => {
                  setCreatingIn(context.entry.path)
                  setContext(null)
                }}
              >
                <LuFolderPlus size={13} /> {t('files.newFolderInside')}
              </button>

              <button
                style={menuItem}
                {...menuHover}
                data-testid="upload-files"
                onClick={() => {
                  pickFiles(context.entry.path, 'files')
                  setContext(null)
                }}
              >
                <LuUpload size={13} /> {t('files.uploadFiles')}
              </button>
              <button
                style={menuItem}
                {...menuHover}
                data-testid="upload-folder"
                onClick={() => {
                  pickFiles(context.entry.path, 'folder')
                  setContext(null)
                }}
              >
                <LuFolderUp size={13} /> {t('files.uploadFolder')}
              </button>

              {/* Only under books/, and not on books/ itself: categories are a
                  books-tree concept and belong to a system folder. */}
              {isSystemFolder(context.entry.path) && (
                <button
                  style={menuItem}
                  {...menuHover}
                  data-testid="scaffold-categories"
                  onClick={() => {
                    scaffold(context.entry.path)
                    setContext(null)
                  }}
                >
                  <LuLayoutGrid size={13} /> {t('files.scaffoldCategories')}
                </button>
              )}

              {!split && (
                <MenuSubmenu
                  label={t('files.pinFolder')}
                  icon={<LuPanelRight size={13} />}
                  itemStyle={menuItem}
                  hoverProps={menuHover}
                  testId="pin-submenu"
                >
                  {['right', 'left', 'top', 'bottom'].map((edge) => {
                    const Icon = SPLIT_ICONS[edge]
                    return (
                      <button
                        key={edge}
                        style={menuItem}
                        {...menuHover}
                        data-testid={`pin-${edge}`}
                        onClick={() => {
                          pinTo(context.entry.path, edge)
                          setContext(null)
                        }}
                      >
                        <Icon size={13} /> {t(`files.pin.${edge}`)}
                      </button>
                    )
                  })}
                </MenuSubmenu>
              )}

              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />

              <MenuSubmenu
                label={t('files.changeContainerKind')}
                icon={<LuBoxes size={13} />}
                itemStyle={menuItem}
                hoverProps={menuHover}
                testId="container-submenu"
              >
                {availableKinds(context.entry).map((k) => (
                  <button
                    key={k || 'none'}
                    {...menuHover}
                    data-testid={`kind-${k || 'none'}`}
                    style={menuItem}
                    onClick={() => {
                      toggleMarker(context.entry, { containerKind: k })
                      setContext(null)
                    }}
                  >
                    {k ? t(`files.kind.${k}`) : t('files.kind.none')}
                  </button>
                ))}
              </MenuSubmenu>

              <button
                style={menuItem}
                {...menuHover}
                onClick={() => {
                  toggleMarker(context.entry, { nsfw: !context.entry.nsfw })
                  setContext(null)
                }}
              >
                {context.entry.nsfw ? t('files.markSfw') : t('files.markNsfw')}
              </button>
            </>
          )}

          {/* Move / rename / delete last, behind a divider: they change the
              bytes on disk rather than the record, and one of them cannot be
              undone. Rename appears here too rather than at the top, so the
              three file operations read as one group. */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <button
            style={menuItem}
            {...menuHover}
            data-testid="move-entry"
            onClick={() => {
              setMovingEntries([context.entry])
              setContext(null)
            }}
          >
            <LuFolderInput size={13} /> {t('files.moveTo')}
          </button>
          <button
            style={menuItem}
            {...menuHover}
            data-testid="rename-entry"
            onClick={() => {
              setRenaming(context.entry)
              setContext(null)
            }}
          >
            <LuPencil size={13} /> {t('files.rename')}
          </button>
          <button
            style={{ ...menuItem, color: 'var(--danger)' }}
            {...menuHover}
            data-testid="delete-entry"
            onClick={() => {
              setDeleting(context.entry)
              setContext(null)
            }}
          >
            <LuTrash2 size={13} /> {t('files.delete')}
          </button>
        </div>
      )}

      {creatingIn !== null && (
        <NewFolderModal
          parent={creatingIn}
          onClose={() => setCreatingIn(null)}
          onCreate={(name, opts) => handleCreate(creatingIn, name, opts)}
        />
      )}

      {renaming && (
        <RenameModal entry={renaming} onClose={() => setRenaming(null)} onRename={handleRename} />
      )}

      {downloading && (
        <DownloadArchiveModal
          title={downloading.path}
          params={{ type: 'library_folder', folder: downloading.path }}
          onClose={() => setDownloading(null)}
        />
      )}

      {deleting && (
        <DeleteModal entry={deleting} onClose={() => setDeleting(null)} onDeleted={handleDeleted} />
      )}

      {movingEntries && (
        <MoveModal
          items={movingEntries}
          onClose={() => setMovingEntries(null)}
          onMoved={(res) => {
            refreshAll()
            setFlash({ tone: 'ok', text: t('files.movedCount', { count: res.count }) })
          }}
        />
      )}

      {previewing && (
        <PreviewModal
          type={previewing.type}
          item={previewing.item}
          onClose={() => setPreviewing(null)}
        />
      )}

      {rescanning !== null && (
        <RescanModal
          scope={rescanning}
          onConfirm={(mode) => runRescan(rescanning, mode)}
          onClose={() => setRescanning(null)}
        />
      )}

      {editing && (
        <BulkEditModal
          type={editing.type}
          items={[editing.item]}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refreshAll()
            setFlash({ tone: 'ok', text: t('files.metadataSaved') })
          }}
        />
      )}
    </div>
  )
}

const ghostBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-dim)',
}

const menuItem = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 5,
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
}

// Hover feedback for context-menu rows. Applied as handlers rather than CSS
// because the menu is inline-styled like the rest of this view.
const menuHover = {
  onMouseEnter: (e) => {
    e.currentTarget.style.background = 'var(--bg-card-hover)'
  },
  onMouseLeave: (e) => {
    e.currentTarget.style.background = 'transparent'
  },
}
