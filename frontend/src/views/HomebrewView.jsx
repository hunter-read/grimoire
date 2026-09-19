import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFlaskConical, LuPlus, LuTrash2, LuPencil, LuDownload, LuUpload } from 'react-icons/lu'
import { homebrew as homebrewApi, characters as charactersApi, content as contentApi } from '../api'
import Spinner from '../components/Spinner'
import HomebrewDialog from '../components/characters/HomebrewDialog'
import {
  goldBtn,
  ghostBtn,
  iconBtn,
  fieldInput,
  fieldLabel,
  card,
} from '../components/characters/characterStyles'

/**
 * The homebrew manager: everything this user has written, plus anything shared
 * with them.
 *
 * Shared entries appear alongside their own but are read-only — sharing grants
 * reading, and the server enforces that regardless of what this view shows.
 */
export default function HomebrewView() {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [schemas, setSchemas] = useState([])
  const [types, setTypes] = useState([])
  const [schemaId, setSchemaId] = useState('')
  const [contentType, setContentType] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, schemaList] = await Promise.all([
        homebrewApi.list({ schema_id: schemaId, content_type: contentType }),
        charactersApi.listSchemas(),
      ])
      setEntries(list.entries || [])
      setSchemas(schemaList.schemas || [])
      setError('')
    } catch (e) {
      setError(e.message || t('homebrew.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [schemaId, contentType, t])

  useEffect(() => {
    load()
  }, [load])

  // The content types come from whichever schema is in play — the filter, or
  // the entry being edited, which may belong to a different one — so the picker
  // only ever offers catalogs that exist for it.
  const typesFor = editing?.schema_id || schemaId

  useEffect(() => {
    if (!typesFor) {
      setTypes([])
      return
    }
    let cancelled = false
    contentApi
      .types(typesFor)
      .then((result) => {
        if (!cancelled) setTypes(result.content_types || [])
      })
      .catch(() => {
        if (!cancelled) setTypes([])
      })
    return () => {
      cancelled = true
    }
  }, [typesFor])

  const remove = async (entry) => {
    const message = entry.used_by
      ? t('homebrew.confirmDeleteUsed', { name: entry.name, count: entry.used_by })
      : t('homebrew.confirmDelete', { name: entry.name })
    if (!window.confirm(message)) return
    try {
      await homebrewApi.remove(entry.id)
      setEntries((prev) => prev.filter((row) => row.id !== entry.id))
    } catch (e) {
      setError(e.message)
    }
  }

  const share = async (entry, visibility) => {
    try {
      const updated = await homebrewApi.share(entry.id, { visibility })
      setEntries((prev) => prev.map((row) => (row.id === entry.id ? { ...row, ...updated } : row)))
    } catch (e) {
      setError(e.message)
    }
  }

  const exportPack = async () => {
    if (!schemaId) return
    try {
      const pack = await homebrewApi.export(schemaId)
      // A pack is a file the user keeps, so it downloads rather than being
      // shown — they are meant to send it to someone.
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${schemaId}-homebrew.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message)
    }
  }

  const importPack = async (event) => {
    event.preventDefault()
    let parsed
    try {
      parsed = JSON.parse(importText)
    } catch {
      setError(t('characters.importInvalidJson'))
      return
    }
    try {
      const result = await homebrewApi.import(parsed)
      setImporting(false)
      setImportText('')
      setError('')
      load()
      window.alert(t('homebrew.importResult', result))
    } catch (e) {
      setError(e.message)
    }
  }

  const activeType = types.find((type) => type.name === contentType)

  if (loading) return <Spinner />

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <LuFlaskConical size={22} color="var(--gold)" style={{ flexShrink: 0 }} />
        <h1 style={{ margin: 0, fontSize: 22, flex: 1 }}>{t('homebrew.title')}</h1>
        <button onClick={() => setImporting((v) => !v)} style={ghostBtn}>
          <LuUpload size={14} />
          {t('homebrew.import')}
        </button>
        <button onClick={exportPack} disabled={!schemaId} style={ghostBtn}>
          <LuDownload size={14} />
          {t('homebrew.export')}
        </button>
        <button
          onClick={() => setCreating(true)}
          disabled={!schemaId || !contentType}
          title={schemaId && contentType ? undefined : t('homebrew.pickTypeFirst')}
          style={schemaId && contentType ? goldBtn : { ...ghostBtn, opacity: 0.55 }}
        >
          <LuPlus size={14} />
          {t('homebrew.create')}
        </button>
      </header>

      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {importing ? (
        <form onSubmit={importPack} style={{ ...card, marginBottom: 20 }}>
          <label htmlFor="pack-json" style={fieldLabel}>
            {t('homebrew.pastePack')}
          </label>
          <textarea
            id="pack-json"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            style={{ ...fieldInput, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />
          <button type="submit" style={{ ...goldBtn, marginTop: 12 }}>
            {t('homebrew.import')}
          </button>
        </form>
      ) : null}

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="hb-schema" style={fieldLabel}>
            {t('characters.system')}
          </label>
          <select
            id="hb-schema"
            value={schemaId}
            onChange={(e) => {
              setSchemaId(e.target.value)
              setContentType('')
            }}
            style={fieldInput}
          >
            <option value="">{t('homebrew.allSystems')}</option>
            {schemas.map((schema) => (
              <option key={schema.schema_id} value={schema.schema_id}>
                {schema.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="hb-type" style={fieldLabel}>
            {t('homebrew.contentType')}
          </label>
          <select
            id="hb-type"
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            disabled={!types.length}
            style={fieldInput}
          >
            <option value="">{t('homebrew.allTypes')}</option>
            {types.map((type) => (
              <option key={type.name} value={type.name}>
                {type.label_plural || type.label || type.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('homebrew.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {entries.map((entry) => (
            <li
              key={entry.id}
              style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
            >
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{entry.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {entry.content_type}
                  {entry.owned ? '' : ` · ${t('homebrew.by', { name: entry.owner_name })}`}
                  {entry.used_by ? ` · ${t('homebrew.usedBy', { count: entry.used_by })}` : ''}
                  {entry.forked_from ? ` · ${t('homebrew.forked')}` : ''}
                </div>
              </div>

              {entry.owned ? (
                <>
                  <select
                    value={entry.visibility}
                    onChange={(e) => share(entry, e.target.value)}
                    aria-label={t('homebrew.visibility')}
                    style={{ ...fieldInput, width: 'auto' }}
                  >
                    <option value="private">{t('homebrew.private')}</option>
                    <option value="public">{t('homebrew.public')}</option>
                  </select>
                  <button
                    onClick={() => setEditing(entry)}
                    aria-label={t('common.edit')}
                    title={t('common.edit')}
                    style={iconBtn}
                  >
                    <LuPencil size={15} />
                  </button>
                  <button
                    onClick={() => remove(entry)}
                    aria-label={t('homebrew.delete')}
                    title={t('homebrew.delete')}
                    style={iconBtn}
                  >
                    <LuTrash2 size={15} />
                  </button>
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('homebrew.sharedWithYou')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating || editing ? (
        <HomebrewDialog
          schemaId={editing?.schema_id || schemaId}
          contentType={editing?.content_type || contentType}
          typeDefinition={
            editing
              ? types.find((type) => type.name === editing.content_type) || {}
              : activeType || {}
          }
          entry={editing}
          onSaved={load}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}
