import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuTriangleAlert, LuCheck } from 'react-icons/lu'
import { characters as charactersApi } from '../api'
import Spinner from '../components/Spinner'
import CharacterSheet from '../components/characters/CharacterSheet'
import RawCharacterData from '../components/characters/RawCharacterData'
import { iconBtn, card } from '../components/characters/characterStyles'

// Edits are saved on a short debounce rather than on a Save button: a sheet is
// filled in field by field over a session, and losing a column of scores to a
// forgotten click is the kind of thing that stops people trusting the feature.
const SAVE_DELAY_MS = 600

/**
 * One character's sheet, rendered from its schema.
 *
 * The schema is fetched separately from the character because it is the same
 * for every character built on it, and because a character whose schema is no
 * longer installed must still open — it renders read-only from stored data
 * rather than 404ing.
 */
export default function CharacterDetailView() {
  const { characterId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [character, setCharacter] = useState(null)
  const [document, setDocument] = useState(null)
  const [data, setData] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  const timerRef = useRef(null)
  const pendingRef = useRef({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const loaded = await charactersApi.get(characterId)
        if (cancelled) return
        setCharacter(loaded)
        setData(loaded.data || {})

        if (!loaded.schema_missing) {
          const schema = await charactersApi.getSchema(loaded.schema_ref)
          if (!cancelled) setDocument(schema.document)
        }
        setError('')
      } catch (e) {
        if (!cancelled) setError(e.message || t('characters.loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [characterId, t])

  // Flush any pending edit on unmount, so navigating away mid-debounce does not
  // drop the last thing typed.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (Object.keys(pendingRef.current).length) {
        charactersApi.update(characterId, { data: pendingRef.current }).catch(() => {})
      }
    },
    [characterId]
  )

  const flush = useCallback(async () => {
    const payload = pendingRef.current
    pendingRef.current = {}
    if (!Object.keys(payload).length) return
    setSaving(true)
    try {
      const updated = await charactersApi.update(characterId, { data: payload })
      // The server is the authority on both coercion and computed values, so
      // take its version of the data back rather than keeping the local guess.
      setCharacter(updated)
      setData(updated.data || {})
      setSavedAt(Date.now())
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [characterId])

  const onChange = useCallback(
    (name, value) => {
      setData((prev) => ({ ...prev, [name]: value }))
      pendingRef.current = { ...pendingRef.current, [name]: value }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush]
  )

  const rename = async (name) => {
    try {
      const updated = await charactersApi.update(characterId, { name })
      setCharacter(updated)
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) return <Spinner />
  if (!character) {
    return (
      <div style={{ padding: 24 }}>
        <p role="alert">{error || t('characters.notFound')}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate('/characters')}
          aria-label={t('common.back')}
          style={iconBtn}
        >
          <LuArrowLeft size={18} />
        </button>
        <input
          value={character.name || ''}
          onChange={(e) => setCharacter((prev) => ({ ...prev, name: e.target.value }))}
          onBlur={(e) => rename(e.target.value)}
          aria-label={t('characters.name')}
          style={{
            flex: 1,
            fontSize: 20,
            fontWeight: 600,
            background: 'none',
            border: 'none',
            borderBottom: '1px solid transparent',
            color: 'var(--text)',
            padding: '2px 0',
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 60 }}>
          {saving ? (
            t('characters.saving')
          ) : savedAt ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <LuCheck size={12} />
              {t('characters.saved')}
            </span>
          ) : null}
        </span>
      </header>

      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {character.schema_missing ? (
        <div
          style={{
            ...card,
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            padding: 12,
            marginBottom: 20,
            borderColor: 'var(--warning)',
            color: 'var(--text-dim)',
            fontSize: 13,
          }}
        >
          <LuTriangleAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>{t('characters.schemaMissingHelp', { schema: character.schema_ref })}</div>
        </div>
      ) : null}

      {document ? (
        <CharacterSheet
          document={document}
          data={data}
          onChange={onChange}
          entries={character.entries || {}}
          schemaId={character.schema_ref}
        />
      ) : (
        <RawCharacterData data={data} />
      )}
    </div>
  )
}
