import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuUser, LuX, LuTag, LuSearch } from 'react-icons/lu'
import api from '../api'
import Spinner from '../components/Spinner'
import TokenFolderGroup from '../components/tokens/TokenFolderGroup'
import { getUserPrefs } from '../hooks/useUserPrefs'
import { useAuth } from '../context/AuthContext'

const getFolderPath = (t) => {
  const parts = (t.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(1, -1).join('/')
}

const getTopFolder = (t) => {
  const parts = (t.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > 2 ? parts[1] : '(Root)'
}

const getSubPath = (t) => {
  const parts = (t.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(2, -1).join('/')
}


export default function TokensView() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isPlayer = user?.role === 'player'
  const [tokens, setTokens] = useState(null)
  const [folderTags, setFolderTags] = useState({})
  const [filter, setFilter] = useState('')
  const [selectedTags, setSelectedTags] = useState(new Set())
  const [collapsed, setCollapsed] = useState(new Set())
  const [editingFolder, setEditingFolder] = useState(null)
  const [showAllTags, setShowAllTags] = useState(false)

  // Bulk tagging
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedTokenIds, setSelectedTokenIds] = useState(new Set())
  const [selectedFolderPaths, setSelectedFolderPaths] = useState(new Set())
  const [bulkInput, setBulkInput] = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)
  const bulkInputRef = useRef(null)

  useEffect(() => {
    Promise.all([api.get('/tokens'), api.get('/token-folders')]).then(([tokensData, foldersData]) => {
      setTokens(tokensData)
      const ft = {}
      for (const f of foldersData.folders) ft[f.path] = f.tags
      setFolderTags(ft)
      const keys = new Set()
      tokensData.tokens.forEach(t => {
        const folder = getTopFolder(t)
        const subPath = getSubPath(t)
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
    await api.patch('/token-folders', { path, tags })
    setFolderTags(prev => ({ ...prev, [path]: tags }))
  }

  const enterBulkMode = () => {
    setBulkMode(true)
    setTimeout(() => bulkInputRef.current?.focus(), 50)
  }

  const exitBulkMode = () => {
    setBulkMode(false)
    setSelectedTokenIds(new Set())
    setSelectedFolderPaths(new Set())
    setBulkInput('')
  }

  const toggleTokenSelect = (id) =>
    setSelectedTokenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleFolderSelect = (folderPath, tokensInFolder) => {
    const tokenIds = tokensInFolder.map(t => t.id)
    const allSel = selectedFolderPaths.has(folderPath) && tokenIds.every(id => selectedTokenIds.has(id))
    setSelectedFolderPaths(prev => {
      const next = new Set(prev)
      allSel ? next.delete(folderPath) : next.add(folderPath)
      return next
    })
    setSelectedTokenIds(prev => {
      const next = new Set(prev)
      if (allSel) tokenIds.forEach(id => next.delete(id))
      else tokenIds.forEach(id => next.add(id))
      return next
    })
  }

  const applyBulkTags = async () => {
    const newTags = bulkInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    const totalSel = selectedTokenIds.size + selectedFolderPaths.size
    if (!newTags.length || totalSel === 0 || bulkApplying) return

    setBulkApplying(true)
    const promises = []

    for (const id of selectedTokenIds) {
      const token = tokens.tokens.find(t => t.id === id)
      if (!token) continue
      const merged = [...new Set([...(token.tags || []), ...newTags])]
      promises.push(api.patch(`/tokens/${id}`, { tags: merged }))
    }

    for (const path of selectedFolderPaths) {
      const existing = folderTags[path] || []
      const merged = [...new Set([...existing, ...newTags])]
      promises.push(
        api.patch('/token-folders', { path, tags: merged })
          .then(() => setFolderTags(prev => ({ ...prev, [path]: merged })))
      )
    }

    await Promise.all(promises)

    setTokens(prev => ({
      ...prev,
      tokens: prev.tokens.map(t => {
        if (!selectedTokenIds.has(t.id)) return t
        return { ...t, tags: [...new Set([...(t.tags || []), ...newTags])] }
      }),
    }))

    setBulkInput('')
    setSelectedTokenIds(new Set())
    setSelectedFolderPaths(new Set())
    setBulkApplying(false)
    bulkInputRef.current?.focus()
  }

  if (!tokens) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={32} /></div>

  const allTags = [...new Set(tokens.tokens.flatMap(t => [
    ...(t.tags || []),
    ...(folderTags[getFolderPath(t)] || []),
  ]))].sort()

  const toggleTag = (t) =>
    setSelectedTags(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })

  const filtered = tokens.tokens.filter(t => {
    const q = filter.toLowerCase()
    const textMatch = !filter || (
      t.filename.toLowerCase().includes(q) ||
      getTopFolder(t).toLowerCase().includes(q) ||
      getSubPath(t).toLowerCase().includes(q) ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(q)) ||
      (folderTags[getFolderPath(t)] || []).some(tag => tag.toLowerCase().includes(q))
    )
    const tagMatch = selectedTags.size === 0 || (() => {
      const tokenTagSet = new Set(t.tags || [])
      const folderTagSet = new Set(folderTags[getFolderPath(t)] || [])
      return [...selectedTags].some(tag => tokenTagSet.has(tag) || folderTagSet.has(tag))
    })()
    return textMatch && tagMatch
  })

  const byFolder = {}
  filtered.forEach(t => {
    const folder = getTopFolder(t)
    const subPath = getSubPath(t)
    if (!byFolder[folder]) byFolder[folder] = {}
    if (!byFolder[folder][subPath]) byFolder[folder][subPath] = []
    byFolder[folder][subPath].push(t)
  })

  const prefs    = getUserPrefs()
  const cardSize = prefs.cardSize    || 'comfortable'
  const sort     = prefs.librarySort || 'az'
  const folderEntries = Object.entries(byFolder).sort(([a], [b]) =>
    sort === 'za' ? b.localeCompare(a) : a.localeCompare(b)
  )
  const totalSelected = selectedTokenIds.size + selectedFolderPaths.size

  return (
    <div className="fade-in" style={{ padding: '32px 40px', maxWidth: 1400, width: '100%', margin: '0 auto', boxSizing: 'border-box', paddingBottom: bulkMode ? 80 : undefined }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 28, marginBottom: 8 }}>Tokens</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 17, fontFamily: 'Alegreya, serif', fontStyle: 'italic' }}>
          {tokens.total} token{tokens.total !== 1 ? 's' : ''} in your collection
        </p>
      </div>

      {/* Toolbar */}
      {!bulkMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
            <LuSearch size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Filter tokens…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              aria-label="Filter tokens"
              style={{ width: '100%', fontSize: 13, padding: '6px 28px 6px 30px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', boxSizing: 'border-box' }}
            />
            {filter && (
              <button onClick={() => setFilter('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}>
                <LuX size={12} />
              </button>
            )}
          </div>
          {folderEntries.length > 0 && (
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
              onClick={enterBulkMode}
              style={{ ...toolBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <LuTag size={13} />
              Bulk Tag
            </button>
          )}
        </div>
      )}
      {bulkMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button
            onClick={exitBulkMode}
            style={{ ...toolBtnStyle, color: 'var(--gold)', outline: '1px solid var(--gold-dim)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <LuTag size={13} />
            Cancel Bulk Tag
          </button>
        </div>
      )}

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
          Click folder headers or token cards to select them, then add tags below.
        </p>
      )}

      {folderEntries.map(([folder, subfolders]) => (
        <TokenFolderGroup
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
          onSelectToken={(id) => navigate(`/tokens/${id}`)}
          bulkMode={bulkMode}
          selectedTokenIds={selectedTokenIds}
          selectedFolderPaths={selectedFolderPaths}
          onToggleToken={toggleTokenSelect}
          onToggleFolder={toggleFolderSelect}
        />
      ))}

      {folderEntries.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <LuUser size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
          <p>{filter ? 'No tokens match your filter.' : 'No tokens found. Add token images to /library/tokens/ and rescan.'}</p>
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
