import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuUsers,
  LuPlus,
  LuTrash2,
  LuUpload,
  LuTriangleAlert,
  LuFileUp,
  LuStore,
} from 'react-icons/lu'
import { characters as charactersApi } from '../api'
import Spinner from '../components/Spinner'
import SheetCatalogue from '../components/characters/SheetCatalogue'
import {
  goldBtn,
  ghostBtn,
  disabledBtn,
  iconBtn,
  fieldInput,
  fieldLabel,
  card,
} from '../components/characters/characterStyles'

/**
 * The character list — every character this user has, across every system.
 *
 * Sits under Campaigns in the sidebar and is visible to guests, who are exactly
 * the people most likely to want a character sheet: a guest account exists to
 * play in one campaign. Campaign-scoped party views come in Phase 5 (#133);
 * this is the personal list.
 */
export default function CharactersView() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [characters, setCharacters] = useState([])
  const [schemas, setSchemas] = useState([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [importText, setImportText] = useState('')
  const [newName, setNewName] = useState('')
  const [newSchema, setNewSchema] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, schemaList] = await Promise.all([
        charactersApi.list(),
        charactersApi.listSchemas(),
      ])
      setCharacters(list.characters || [])
      setSchemas(schemaList.schemas || [])
      setError('')
    } catch (e) {
      setError(e.message || t('characters.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const create = async (e) => {
    e.preventDefault()
    if (!newSchema) return
    try {
      const created = await charactersApi.create({
        schema_ref: newSchema,
        name: newName.trim() || t('characters.untitled'),
      })
      setCreating(false)
      setNewName('')
      navigate(`/characters/${created.id}`)
    } catch (err) {
      setError(err.message)
    }
  }

  const importSchema = async (e) => {
    e.preventDefault()
    let parsed
    try {
      parsed = JSON.parse(importText)
    } catch {
      setError(t('characters.importInvalidJson'))
      return
    }
    try {
      await charactersApi.importSchema({ document: parsed })
      setImporting(false)
      setImportText('')
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const importCharacter = async (file) => {
    if (!file) return
    try {
      const payload = JSON.parse(await file.text())
      const created = await charactersApi.import(payload)
      navigate(`/characters/${created.id}`)
    } catch (e) {
      // A bad file and a rejected import both land here; the message says which.
      setError(e instanceof SyntaxError ? t('characters.importInvalidJson') : e.message)
    }
  }

  const remove = async (id, name) => {
    if (!window.confirm(t('characters.confirmDelete', { name }))) return
    try {
      await charactersApi.remove(id)
      setCharacters((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <Spinner />

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <LuUsers size={22} color="var(--gold)" style={{ flexShrink: 0 }} />
        <h1 style={{ margin: 0, fontSize: 22, flex: 1 }}>{t('characters.title')}</h1>
        <label title={t('characters.importCharacter')} style={{ ...ghostBtn, cursor: 'pointer' }}>
          <LuFileUp size={14} />
          {t('characters.importCharacter')}
          <input
            type="file"
            accept="application/json,.json"
            aria-label={t('characters.importCharacter')}
            onChange={(e) => importCharacter(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
        </label>
        <button onClick={() => setBrowsing(true)} style={ghostBtn}>
          <LuStore size={14} />
          {t('characters.browseSheets')}
        </button>
        <button onClick={() => setImporting((v) => !v)} style={ghostBtn}>
          <LuUpload size={14} />
          {t('characters.importSchema')}
        </button>
        <button
          onClick={() => setCreating((v) => !v)}
          disabled={!schemas.length}
          title={schemas.length ? undefined : t('characters.needSchemaFirst')}
          style={schemas.length ? goldBtn : disabledBtn}
        >
          <LuPlus size={14} />
          {t('characters.newCharacter')}
        </button>
      </header>

      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {importing ? (
        <form onSubmit={importSchema} style={{ ...card, marginBottom: 24 }}>
          <label htmlFor="schema-json" style={fieldLabel}>
            {t('characters.pasteSchema')}
          </label>
          <textarea
            id="schema-json"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            style={{ ...fieldInput, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />
          <button type="submit" style={{ ...goldBtn, marginTop: 12 }}>
            {t('characters.install')}
          </button>
        </form>
      ) : null}

      {creating ? (
        <form
          onSubmit={create}
          style={{
            ...card,
            marginBottom: 24,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="new-name" style={fieldLabel}>
              {t('characters.name')}
            </label>
            <input
              id="new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={fieldInput}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="new-schema" style={fieldLabel}>
              {t('characters.system')}
            </label>
            <select
              id="new-schema"
              value={newSchema}
              onChange={(e) => setNewSchema(e.target.value)}
              style={fieldInput}
              required
            >
              <option value="">—</option>
              {schemas.map((s) => (
                <option key={s.schema_id} value={s.schema_id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" style={goldBtn}>
            {t('characters.create')}
          </button>
        </form>
      ) : null}

      {characters.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>
          {schemas.length ? t('characters.emptyNoCharacters') : t('characters.emptyBrowseFirst')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {characters.map((character) => (
            <li
              key={character.id}
              style={{
                ...card,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
              }}
            >
              <button
                onClick={() => navigate(`/characters/${character.id}`)}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <div style={{ fontWeight: 600 }}>{character.name || t('characters.untitled')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {character.schema_missing ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        color: 'var(--warning)',
                      }}
                    >
                      <LuTriangleAlert size={12} />
                      {t('characters.schemaMissing', { schema: character.schema_ref })}
                    </span>
                  ) : (
                    <>
                      {character.schema_name || character.schema_ref}
                      {character.owned === false ? ` · ${t('characters.partyMember')}` : ''}
                    </>
                  )}
                </div>
              </button>
              <button
                onClick={() => remove(character.id, character.name)}
                aria-label={t('characters.delete')}
                title={t('characters.delete')}
                style={iconBtn}
              >
                <LuTrash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {browsing ? <SheetCatalogue onInstalled={load} onClose={() => setBrowsing(false)} /> : null}

      {schemas.length > 0 ? (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
            {t('characters.installedSheets')}
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {schemas.map((schema) => (
              <li
                key={schema.schema_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ flex: 1 }}>
                  {schema.name}
                  {schema.version ? ` · v${schema.version}` : ''}
                  {schema.character_count
                    ? ` · ${t('characters.usedByCount', { count: schema.character_count })}`
                    : ''}
                </span>
                <button
                  onClick={async () => {
                    if (!window.confirm(t('characters.confirmRemoveSchema', { name: schema.name })))
                      return
                    await charactersApi.deleteSchema(schema.schema_id)
                    load()
                  }}
                  aria-label={t('characters.removeSchema')}
                  title={t('characters.removeSchema')}
                  style={iconBtn}
                >
                  <LuTrash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
