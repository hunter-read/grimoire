import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuMap, LuX, LuTag } from 'react-icons/lu'
import api from '../api'
import Spinner from '../components/Spinner'
import MapFolderGroup from '../components/maps/MapCreatorGroup'
import { getUserPrefs } from '../hooks/useUserPrefs'
import { useAuth } from '../context/AuthContext'

const getFolderPath = (m) => {
  const parts = (m.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(1, -1).join('/')
}

const getTopFolder = (m) => {
  const parts = (m.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > 2 ? parts[1] : '(Root)'
}

const getSubPath = (m) => {
  const parts = (m.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(2, -1).join('/')
}


export default function MapsView() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isPlayer = user?.role === 'player'
  const [maps, setMaps] = useState(null)
  const [folderTags, setFolderTags] = useState({})
  const [filter, setFilter] = useState('')
  const [selectedTags, setSelectedTags] = useState(new Set())
  const [collapsed, setCollapsed] = useState(new Set())
  const [editingFolder, setEditingFolder] = useState(null)
  const [showAllTags, setShowAllTags] = useState(false)

  // Bulk tagging
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedMapIds, setSelectedMapIds] = useState(new Set())
  const [selectedFolderPaths, setSelectedFolderPaths] = useState(new Set())
  const [bulkInput, setBulkInput] = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)
  const bulkInputRef = useRef(null)

  useEffect(() => {
    Promise.all([api.get('/maps'), api.get('/map-folders')]).then(([mapsData, foldersData]) => {
      setMaps(mapsData)
      const ft = {}
      for (const f of foldersData.folders) ft[f.path] = f.tags
      setFolderTags(ft)
      const keys = new Set()
      mapsData.maps.forEach(m => {
        const folder = getTopFolder(m)
        const subPath = getSubPath(m)
        keys.add(folder)
        if (subPath) keys.add(`${folder}::${subPath}`)
      })
      setCollapsed(keys)
    })
  }, [])

  const toggle = (key) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const saveFolderTags = async (path, tags) => {
    await api.patch('/map-folders', { path, tags })
    setFolderTags(prev => ({ ...prev, [path]: tags }))
  }

  // Bulk mode handlers
  const enterBulkMode = () => {
    setBulkMode(true)
    setTimeout(() => bulkInputRef.current?.focus(), 50)
  }

  const exitBulkMode = () => {
    setBulkMode(false)
    setSelectedMapIds(new Set())
    setSelectedFolderPaths(new Set())
    setBulkInput('')
  }

  const toggleMapSelect = (id) =>
    setSelectedMapIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleFolderSelect = (folderPath, mapsInFolder) => {
    const mapIds = mapsInFolder.map(m => m.id)
    const allSel = selectedFolderPaths.has(folderPath) && mapIds.every(id => selectedMapIds.has(id))
    setSelectedFolderPaths(prev => {
      const next = new Set(prev)
      allSel ? next.delete(folderPath) : next.add(folderPath)
      return next
    })
    setSelectedMapIds(prev => {
      const next = new Set(prev)
      if (allSel) mapIds.forEach(id => next.delete(id))
      else mapIds.forEach(id => next.add(id))
      return next
    })
  }

  const applyBulkTags = async () => {
    const newTags = bulkInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    const totalSel = selectedMapIds.size + selectedFolderPaths.size
    if (!newTags.length || totalSel === 0 || bulkApplying) return

    setBulkApplying(true)
    const promises = []

    for (const id of selectedMapIds) {
      const map = maps.maps.find(m => m.id === id)
      if (!map) continue
      const merged = [...new Set([...(map.tags || []), ...newTags])]
      promises.push(api.patch(`/maps/${id}`, { tags: merged }))
    }

    for (const path of selectedFolderPaths) {
      const existing = folderTags[path] || []
      const merged = [...new Set([...existing, ...newTags])]
      promises.push(
        api.patch('/map-folders', { path, tags: merged })
          .then(() => setFolderTags(prev => ({ ...prev, [path]: merged })))
      )
    }

    await Promise.all(promises)

    setMaps(prev => ({
      ...prev,
      maps: prev.maps.map(m => {
        if (!selectedMapIds.has(m.id)) return m
        return { ...m, tags: [...new Set([...(m.tags || []), ...newTags])] }
      }),
    }))

    setBulkInput('')
    setSelectedMapIds(new Set())
    setSelectedFolderPaths(new Set())
    setBulkApplying(false)
    bulkInputRef.current?.focus()
  }

  if (!maps) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={32} /></div>

  const allTags = [...new Set(maps.maps.flatMap(m => [
    ...(m.tags || []),
    ...(folderTags[getFolderPath(m)] || []),
  ]))].sort()

  const toggleTag = (t) =>
    setSelectedTags(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })

  const filtered = maps.maps.filter(m => {
    const q = filter.toLowerCase()
    const textMatch = !filter || (
      m.filename.toLowerCase().includes(q) ||
      getTopFolder(m).toLowerCase().includes(q) ||
      getSubPath(m).toLowerCase().includes(q) ||
      (m.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (folderTags[getFolderPath(m)] || []).some(t => t.toLowerCase().includes(q))
    )
    const tagMatch = selectedTags.size === 0 || (() => {
      const mapTagSet = new Set(m.tags || [])
      const folderTagSet = new Set(folderTags[getFolderPath(m)] || [])
      return [...selectedTags].some(t => mapTagSet.has(t) || folderTagSet.has(t))
    })()
    return textMatch && tagMatch
  })

  const byFolder = {}
  filtered.forEach(m => {
    const folder = getTopFolder(m)
    const subPath = getSubPath(m)
    if (!byFolder[folder]) byFolder[folder] = {}
    if (!byFolder[folder][subPath]) byFolder[folder][subPath] = []
    byFolder[folder][subPath].push(m)
  })

  const prefs    = getUserPrefs()
  const cardSize = prefs.cardSize    || 'comfortable'
  const sort     = prefs.librarySort || 'az'
  const folderEntries = Object.entries(byFolder).sort(([a], [b]) =>
    sort === 'za' ? b.localeCompare(a) : a.localeCompare(b)
  )
  const totalSelected = selectedMapIds.size + selectedFolderPaths.size

  return (
    <div className="fade-in" style={{ padding: '32px 40px', maxWidth: 1400, width: '100%', margin: '0 auto', boxSizing: 'border-box', paddingBottom: bulkMode ? 80 : undefined }}>
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 28, marginBottom: 8 }}>Maps</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 17, fontFamily: 'Alegreya, serif', fontStyle: 'italic' }}>
            {maps.total} map{maps.total !== 1 ? 's' : ''} in your collection
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, minWidth: 0 }}>
          {!bulkMode && (
            <input
              type="text"
              placeholder="Filter maps..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              aria-label="Filter maps"
              style={{ width: '100%', minWidth: 220, fontSize: 15, boxSizing: 'border-box' }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {folderEntries.length > 0 && !bulkMode && (
              <>
                <button onClick={() => {
                  const keys = new Set()
                  folderEntries.forEach(([folder, subfolders]) => {
                    keys.add(folder)
                    Object.keys(subfolders).filter(s => s).forEach(s => keys.add(`${folder}::${s}`))
                  })
                  setCollapsed(keys)
                }} style={toolBtnStyle}>
                  Collapse All
                </button>
                <button onClick={() => setCollapsed(new Set())} style={toolBtnStyle}>
                  Expand All
                </button>
              </>
            )}
            {!isPlayer && (
              <button
                onClick={bulkMode ? exitBulkMode : enterBulkMode}
                style={{
                  ...toolBtnStyle,
                  color: bulkMode ? 'var(--gold)' : 'var(--text-dim)',
                  outline: bulkMode ? '1px solid var(--gold-dim)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <LuTag size={13} />
                {bulkMode ? 'Cancel' : 'Bulk Tag'}
              </button>
            )}
          </div>
        </div>
      </div>

      {!bulkMode && allTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: 4 }}>Tags:</span>
          {(showAllTags ? allTags : allTags.slice(0, 15)).map(t => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              style={{
                fontSize: 13, padding: '3px 10px', borderRadius: 10, cursor: 'pointer', border: 'none',
                background: selectedTags.has(t) ? 'rgba(201,168,76,0.2)' : 'var(--tag-bg)',
                color: selectedTags.has(t) ? 'var(--gold)' : 'var(--text-dim)',
                outline: selectedTags.has(t) ? '1px solid var(--gold-dim)' : '1px solid var(--tag-border)',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          {allTags.length > 15 && (
            <button
              onClick={() => setShowAllTags(v => !v)}
              style={{ fontSize: 12, padding: '3px 8px', borderRadius: 10, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              {showAllTags ? 'Show less' : `+${allTags.length - 15} more`}
            </button>
          )}
          {selectedTags.size > 0 && (
            <button
              onClick={() => setSelectedTags(new Set())}
              style={{ fontSize: 12, padding: '3px 8px', borderRadius: 10, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              <LuX size={11} /> Clear
            </button>
          )}
        </div>
      )}

      {bulkMode && (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
          Click folder headers or map cards to select them, then add tags below.
        </p>
      )}

      {folderEntries.map(([folder, subfolders]) => (
        <MapFolderGroup
          key={folder}
          folder={folder}
          subfolders={subfolders}
          cardSize={cardSize}
          collapsed={collapsed}
          onToggle={toggle}
          folderTags={folderTags}
          editingFolder={isPlayer ? null : editingFolder}
          onSetEditingFolder={isPlayer ? () => {} : setEditingFolder}
          onSaveFolderTags={isPlayer ? () => {} : saveFolderTags}
          canTag={!isPlayer}
          onSelectMap={(id) => navigate(`/maps/${id}`)}
          bulkMode={bulkMode}
          selectedMapIds={selectedMapIds}
          selectedFolderPaths={selectedFolderPaths}
          onToggleMap={toggleMapSelect}
          onToggleFolder={toggleFolderSelect}
        />
      ))}

      {folderEntries.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <LuMap size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
          <p>{filter ? 'No maps match your filter.' : 'No maps found. Add maps to /library/maps/ and rescan.'}</p>
        </div>
      )}

      {/* Bulk action bar */}
      {bulkMode && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: 'var(--bg-panel)', borderTop: '1px solid var(--border)',
          padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 14, color: totalSelected > 0 ? 'var(--text)' : 'var(--text-muted)', minWidth: 100, flexShrink: 0 }}>
            {totalSelected > 0 ? `${totalSelected} selected` : 'Nothing selected'}
          </span>
          <input
            ref={bulkInputRef}
            type="text"
            value={bulkInput}
            onChange={e => setBulkInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyBulkTags()}
            placeholder="Tags to add, comma-separated…"
            style={{ flex: 1, maxWidth: 400, fontSize: 14 }}
          />
          <button
            onClick={applyBulkTags}
            disabled={!bulkInput.trim() || totalSelected === 0 || bulkApplying}
            style={{
              padding: '7px 18px', borderRadius: 6, fontSize: 14, cursor: 'pointer',
              background: 'var(--gold-dim)', color: 'var(--bg-deep)', border: 'none',
              opacity: (!bulkInput.trim() || totalSelected === 0 || bulkApplying) ? 0.5 : 1,
            }}
          >
            {bulkApplying ? 'Applying…' : 'Add Tags'}
          </button>
          <button onClick={exitBulkMode} style={toolBtnStyle}>
            Done
          </button>
        </div>
      )}
    </div>
  )
}

const toolBtnStyle = {
  padding: '6px 12px', borderRadius: 6, fontSize: 13,
  background: 'var(--bg-card)', color: 'var(--text-dim)',
  border: '1px solid var(--border)', cursor: 'pointer',
}
