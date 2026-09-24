import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuFileUp, LuFolderUp } from 'react-icons/lu'
import { campaigns } from '../../api'

const ACCEPT = '.zip,.json,.md,.markdown,.txt,.lk'
// Only markdown is read out of a picked folder, so there is no point opening
// the rest — a vault's images and attachments would just be uploaded and
// discarded server-side.
const FOLDER_ACCEPT = '.md,.markdown,.txt'

// Imports wiki pages from a markdown / JSON / LegendKeeper file, or from a
// whole picked folder. On success it reports how many pages were created and
// lets the caller refresh the list.
export default function WikiImportModal({ campaignId, onClose, onImported }) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const folderRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Shared tail of both pickers: run the import, report what came back.
  const run = async (send) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await send()
      setResult(res)
      onImported?.(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await run(() => campaigns.importWiki(campaignId, file))
  }

  const pickFolder = async (e) => {
    // `webkitRelativePath` is the file's path inside the folder the user picked;
    // it is the only place the browser reports the structure, and it is why the
    // folder input carries `webkitdirectory`.
    const entries = [...(e.target.files || [])]
      .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
      .filter(({ path }) => {
        const segments = path.split('/')
        // A picked vault brings its dot-directories along (`.obsidian/`), whose
        // templates are markdown too. The server skips these as well; filtering
        // here keeps them off the wire in the first place.
        if (segments.some((seg) => seg.startsWith('.'))) return false
        return /\.(md|markdown|txt)$/i.test(segments[segments.length - 1])
      })
    e.target.value = ''
    if (!entries.length) {
      setError(t('wiki.importFolderEmpty'))
      return
    }
    await run(() => campaigns.importWikiFolder(campaignId, entries))
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 460,
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <LuX size={18} />
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>
          {t('wiki.importTitle')}
        </h3>

        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 6px', lineHeight: 1.6 }}>
          {t('wiki.importHint')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
          {t('wiki.importFormats')}
        </p>

        {result && (
          <p style={{ fontSize: 13, color: 'var(--gold)', margin: '0 0 14px' }}>
            {t('wiki.imported', { count: result.imported })}
          </p>
        )}
        {error && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 14px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {result ? (
            <button onClick={onClose} style={goldBtn}>
              {t('common.close')}
            </button>
          ) : (
            <>
              <button onClick={() => folderRef.current?.click()} disabled={busy} style={plainBtn}>
                <LuFolderUp size={14} /> {t('wiki.chooseFolder')}
              </button>
              <button onClick={() => inputRef.current?.click()} disabled={busy} style={goldBtn}>
                <LuFileUp size={14} /> {busy ? t('wiki.importing') : t('wiki.chooseFile')}
              </button>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={pick}
          style={{ display: 'none' }}
        />
        {/* A second input, because `webkitdirectory` is what makes the browser
            report each file's path within the picked folder and it cannot be
            toggled on one input reliably across browsers - the same two-input
            split the file manager uses. */}
        <input
          ref={folderRef}
          type="file"
          multiple
          webkitdirectory=""
          directory=""
          accept={FOLDER_ACCEPT}
          data-testid="wiki-folder-input"
          onChange={pickFolder}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}

const plainBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
