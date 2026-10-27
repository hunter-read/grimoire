import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuMusic, LuGrid2X2, LuPencil, LuTrash2, LuPlay, LuListPlus } from 'react-icons/lu'
import Spinner from '../Spinner'
import { useAudioPlayer } from '../../context/AudioPlayerContext'
import { useSoundboard } from '../../context/SoundboardContext'
import useAudioSets from '../../hooks/useAudioSets'

/** A saved entry as the player/board wants it. */
const toTrack = (e) => ({
  id: e.audio_id,
  title: e.title || '',
  artist: e.artist || '',
  artwork: !!e.has_artwork,
  loop: !!e.loop,
  // Titles arrive resolved from the server, so nothing needs a lookup.
  _hydrated: true,
})

/**
 * The saved-sets shelf: everything the user has saved, with load, rename, and
 * delete.
 *
 * Loading replaces what is live, so a set with content already loaded confirms
 * first. A playlist additionally offers "add to queue" as the non-destructive
 * alternative — appending is what you usually want mid-session, when the point
 * is to queue the next scene without cutting the current track.
 *
 * A set whose tracks have since left the library loads the rest and says how
 * many were skipped, rather than failing or leaving dead pads.
 */
export default function AudioSetsModal({ onClose }) {
  const { t } = useTranslation()
  const { sets, loading, error, load, rename, remove } = useAudioSets()
  const { queue, playQueue, addToQueue } = useAudioPlayer()
  const { pads, replacePads, updateLayout } = useSoundboard()

  // The row awaiting a confirm, as { set, mode }: mode 'replace' | 'append'.
  const [confirming, setConfirming] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const liveCount = (kind) => (kind === 'soundboard' ? pads.length : queue.length)

  const applyPlaylist = (entries, append) => {
    const tracks = entries.map(toTrack)
    if (append) tracks.forEach((track) => addToQueue(track))
    else playQueue(tracks)
  }

  const applyBoard = (entries, layout) => {
    // replacePads, not clear-then-add: the two read the same committed pad list,
    // so adding after a clear would drop every track the outgoing board shared
    // with this one. It carries loop flags and opens the panel itself.
    if (layout) updateLayout(layout)
    replacePads(entries.map(toTrack))
  }

  const doLoad = async (set, append = false) => {
    setBusyId(set.id)
    setNotice(null)
    setLoadError(null)
    try {
      const full = await load(set.id)
      const entries = full.entries || []
      if (set.kind === 'soundboard') applyBoard(entries, full.layout)
      else applyPlaylist(entries, append)

      if (full.missing > 0) {
        setNotice(t('audioSets.someMissing', { name: set.name, count: full.missing }))
      } else if (entries.length === 0) {
        setNotice(t('audioSets.allMissing', { name: set.name }))
      } else {
        onClose()
      }
    } catch (err) {
      // Nothing was applied, so the live queue/board is untouched.
      setLoadError(err.message || t('audioSets.loadFailed'))
    } finally {
      setBusyId(null)
      setConfirming(null)
    }
  }

  // Loading over live content asks first; loading into an empty player doesn't.
  const requestLoad = (set, append = false) => {
    if (append || liveCount(set.kind) === 0) doLoad(set, append)
    else setConfirming({ set, append })
  }

  const submitRename = async (set) => {
    const value = renameValue.trim()
    if (!value || value === set.name) {
      setRenaming(null)
      return
    }
    setBusyId(set.id)
    await rename(set.id, value)
    setBusyId(null)
    setRenaming(null)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('audioSets.title')}
      style={overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={panel}>
        <div style={header}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('audioSets.title')}</span>
          <button onClick={onClose} style={closeBtn} aria-label={t('common.close')}>
            <LuX size={16} />
          </button>
        </div>

        {(error || loadError) && (
          <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>
            {loadError || error}
          </div>
        )}
        {notice && (
          <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 10 }}>{notice}</div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spinner size={20} />
          </div>
        ) : sets.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0 12px' }}>
            {t('audioSets.empty')}
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              maxHeight: '55vh',
              overflowY: 'auto',
            }}
          >
            {sets.map((set) => {
              const isBoard = set.kind === 'soundboard'
              const Icon = isBoard ? LuGrid2X2 : LuMusic
              const pending = confirming?.set.id === set.id
              return (
                <li key={set.id} style={row}>
                  <Icon
                    size={15}
                    color="var(--text-muted)"
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  />

                  {renaming === set.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(set)
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={() => submitRename(set)}
                      aria-label={t('audioSets.renameLabel', { name: set.name })}
                      style={{ ...inlineInput, flex: 1 }}
                    />
                  ) : (
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={rowName}>{set.name}</span>
                      <span style={rowMeta}>
                        {isBoard
                          ? t('audioSets.padCount', { count: set.count })
                          : t('audioSets.trackCount', { count: set.count })}
                      </span>
                    </span>
                  )}

                  {busyId === set.id ? (
                    <Spinner size={14} />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => requestLoad(set)}
                        aria-label={t('audioSets.load', { name: set.name })}
                        title={t('audioSets.load', { name: set.name })}
                        style={iconBtn}
                      >
                        <LuPlay size={14} />
                      </button>
                      {!isBoard && (
                        <button
                          type="button"
                          onClick={() => requestLoad(set, true)}
                          aria-label={t('audioSets.append', { name: set.name })}
                          title={t('audioSets.append', { name: set.name })}
                          style={iconBtn}
                        >
                          <LuListPlus size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRenameValue(set.name)
                          setRenaming(set.id)
                        }}
                        aria-label={t('audioSets.rename', { name: set.name })}
                        title={t('audioSets.rename', { name: set.name })}
                        style={iconBtn}
                      >
                        <LuPencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(set.id)}
                        aria-label={t('audioSets.delete', { name: set.name })}
                        title={t('audioSets.delete', { name: set.name })}
                        style={{ ...iconBtn, color: 'var(--danger)' }}
                      >
                        <LuTrash2 size={14} />
                      </button>
                    </>
                  )}

                  {pending && (
                    <div style={confirmRow}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {isBoard
                          ? t('audioSets.confirmReplaceBoard')
                          : t('audioSets.confirmReplaceQueue')}
                      </span>
                      <button type="button" onClick={() => setConfirming(null)} style={cancelBtn}>
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => doLoad(confirming.set, confirming.append)}
                        style={goldBtn}
                      >
                        {t('audioSets.replace')}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0' }}>
          {t('audioSets.saveHint')}
        </p>
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
  padding: 16,
}
const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 24,
  width: 440,
  maxWidth: '92vw',
  boxSizing: 'border-box',
}
const header = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  padding: '8px 0',
  borderBottom: '1px solid var(--border)',
}
const rowName = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 14,
  color: 'var(--text)',
}
const rowMeta = { display: 'block', fontSize: 12, color: 'var(--text-muted)' }
const iconBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  padding: 4,
  display: 'flex',
  flexShrink: 0,
}
const inlineInput = {
  padding: '5px 8px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 14,
  minWidth: 0,
}
const confirmRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexBasis: '100%',
  fontSize: 12,
  color: 'var(--text-dim)',
  padding: '6px 0 2px',
}
const cancelBtn = {
  padding: '4px 10px',
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 12,
  cursor: 'pointer',
}
const goldBtn = {
  padding: '4px 12px',
  borderRadius: 6,
  background: 'var(--gold-dim)',
  border: 'none',
  color: 'var(--bg-deep)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
