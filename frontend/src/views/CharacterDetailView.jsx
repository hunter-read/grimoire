import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuTriangleAlert,
  LuCheck,
  LuDownload,
  LuListTree,
  LuEye,
} from 'react-icons/lu'
import { characters as charactersApi, content as contentApi } from '../api'
import Spinner from '../components/Spinner'
import CharacterSheet from '../components/characters/CharacterSheet'
import ChoiceDialog from '../components/characters/ChoiceDialog'
import AllValuesDialog from '../components/characters/AllValuesDialog'
import { planPick, applyChoice } from '../components/characters/onPick'
import { OVERRIDES_KEY } from '../components/characters/expressions'
import RawCharacterData from '../components/characters/RawCharacterData'
import CharacterPortrait from '../components/characters/CharacterPortrait'
import { iconBtn, ghostBtn, card } from '../components/characters/characterStyles'

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

  // Choices a pick asked for - "choose 2 skills" - shown one at a time.
  const [choices, setChoices] = useState([])
  // Entries the player just picked, overlaid on the resolved ones until the
  // next save brings them back from the server. Without it a derived value -
  // "a wizard casts spells" - would lag the pick by a round trip.
  const [pickedEntries, setPickedEntries] = useState({})
  // Every value, whatever the sheet's layout chooses to show.
  const [showingAll, setShowingAll] = useState(false)

  const timerRef = useRef(null)
  const pendingRef = useRef({})
  // Fields to hand back to their automatic value on the next save.
  const unsetRef = useRef(new Set())
  // The latest data, for the pick planner: it runs after an await, when the
  // `data` a callback closed over may already be stale.
  const dataRef = useRef({})
  useEffect(() => {
    dataRef.current = data
  }, [data])

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
      if (Object.keys(pendingRef.current).length || unsetRef.current.size) {
        charactersApi
          .update(characterId, { data: pendingRef.current, unset: [...unsetRef.current] })
          .catch(() => {})
      }
    },
    [characterId]
  )

  const flush = useCallback(async () => {
    const payload = pendingRef.current
    const unset = [...unsetRef.current]
    pendingRef.current = {}
    unsetRef.current = new Set()
    if (!Object.keys(payload).length && !unset.length) return
    setSaving(true)
    try {
      const updated = await charactersApi.update(characterId, {
        data: payload,
        ...(unset.length ? { unset } : {}),
      })
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

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS)
  }, [flush])

  const applyPatch = useCallback(
    (patch) => {
      dataRef.current = { ...dataRef.current, ...patch }
      setData((prev) => ({ ...prev, ...patch }))
      pendingRef.current = { ...pendingRef.current, ...patch }
      // Setting a field again cancels a reset still waiting to be saved.
      for (const name of Object.keys(patch)) unsetRef.current.delete(name)
      schedule()
    },
    [schedule]
  )

  // Resolve entry ids against the catalog, for a grant that should become a
  // reference only when the content is really installed.
  const lookup = useCallback(
    async (ids) => (await contentApi.resolve(character?.schema_ref, ids))?.entries || {},
    [character?.schema_ref]
  )

  const onChange = useCallback(
    async (name, value, meta) => {
      applyPatch({ [name]: value })

      const definition = document?.fields?.[name]
      if (definition?.type !== 'content_ref') return

      // The picked entry's own properties: from the browser that picked it,
      // from the value itself for a freeform entry, or fetched as a last resort.
      let entry = meta && 'entry' in meta ? meta.entry : undefined
      if (entry === undefined) {
        if (!value) entry = null
        else if (value._inline) entry = value
        else if (value._ref) {
          const found = (await lookup([value._ref]).catch(() => ({})))[value._ref]
          entry = found && !found.missing ? { ...(found.data || {}), name: found.name } : null
        }
      }
      if (entry && value?._ref) setPickedEntries((prev) => ({ ...prev, [value._ref]: entry }))

      if (!definition.on_pick?.length) return
      try {
        const plan = await planPick({
          document,
          data: dataRef.current,
          field: name,
          entry,
          lookup,
        })
        if (Object.keys(plan.patch).length) applyPatch(plan.patch)
        if (plan.choices.length) setChoices((prev) => [...prev, ...plan.choices])
      } catch (e) {
        // A pick that could not be followed up is still a pick: the value is
        // saved, and the player can add what it would have granted by hand.
        setError(e.message)
      }
    },
    [applyPatch, document, lookup]
  )

  // Hand a field back to its `default_from` value.
  const onReset = useCallback(
    (name) => {
      const next = { ...dataRef.current }
      delete next[name]
      dataRef.current = next
      setData(next)
      const pending = { ...pendingRef.current }
      delete pending[name]
      pendingRef.current = pending
      unsetRef.current.add(name)
      schedule()
    },
    [schedule]
  )

  // Overrule a computed value, or with `undefined` return it to its formula.
  // Saved whole, the way the server expects it: leaving a name out is the reset.
  const onOverride = useCallback(
    (name, value) => {
      const overrides = { ...(dataRef.current?.[OVERRIDES_KEY] || {}) }
      if (value === undefined || value === null || value === '') delete overrides[name]
      else overrides[name] = value
      applyPatch({ [OVERRIDES_KEY]: overrides })
    },
    [applyPatch]
  )

  const confirmChoice = (picked) => {
    const [choice, ...rest] = choices
    applyPatch(applyChoice({ data: dataRef.current, choice, picked }))
    setChoices(rest)
  }

  const exportCharacter = async () => {
    try {
      const payload = await charactersApi.export(characterId)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      // `window.document`, not `document`: this component has a `document`
      // state holding the schema, which shadows the global one.
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${(character?.name || 'character').replace(/[^\w-]+/g, '-')}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message)
    }
  }

  const rename = async (name) => {
    try {
      const updated = await charactersApi.update(characterId, { name })
      setCharacter(updated)
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) return <Spinner />

  // `owned` is false only for a sheet shared through a campaign.
  const readOnly = character?.owned === false
  if (!character) {
    return (
      <div style={{ padding: 24 }}>
        <p role="alert">{error || t('characters.notFound')}</p>
      </div>
    )
  }

  const sheetName = document?.name || character.schema_name || character.schema_ref
  const actionBtn = { ...ghostBtn, padding: 8 }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/characters')}
          aria-label={t('characters.backToList')}
          title={t('characters.backToList')}
          style={iconBtn}
        >
          <LuArrowLeft size={18} />
        </button>
        <CharacterPortrait
          character={character}
          readOnly={readOnly}
          onChanged={(patch) => setCharacter((prev) => ({ ...prev, ...patch }))}
          onError={setError}
        />
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          {readOnly ? (
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
              {character.name || t('characters.untitled')}
            </h1>
          ) : (
            <input
              value={character.name || ''}
              placeholder={t('characters.untitled')}
              onChange={(e) => setCharacter((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={(e) => rename(e.target.value)}
              aria-label={t('characters.name')}
              style={{
                width: '100%',
                fontSize: 22,
                fontWeight: 600,
                background: 'none',
                border: 'none',
                borderBottom: '1px solid transparent',
                borderRadius: 0,
                color: 'var(--text)',
                padding: '2px 0',
              }}
            />
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 2,
            }}
          >
            <span>{sheetName}</span>
            {readOnly ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                · <LuEye size={13} aria-hidden="true" /> {t('characters.readOnlyParty')}
              </span>
            ) : null}
          </div>
        </div>
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: 'var(--text-muted)', minWidth: 64, textAlign: 'right' }}
        >
          {saving ? (
            t('characters.saving')
          ) : savedAt ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <LuCheck size={13} aria-hidden="true" />
              {t('characters.saved')}
            </span>
          ) : null}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {document ? (
            <button
              type="button"
              onClick={() => setShowingAll(true)}
              aria-label={t('characters.allValues')}
              title={t('characters.allValues')}
              style={actionBtn}
            >
              <LuListTree size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={exportCharacter}
            aria-label={t('characters.export')}
            title={t('characters.export')}
            style={actionBtn}
          >
            <LuDownload size={16} />
          </button>
        </div>
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
          // A party member may read another player's sheet but not edit it; the
          // server refuses the write, so the controls should not be offered.
          readOnly={readOnly}
          onChange={onChange}
          onReset={onReset}
          onOverride={onOverride}
          entries={{ ...(character.entries || {}), ...pickedEntries }}
          schemaId={character.schema_ref}
        />
      ) : (
        <RawCharacterData data={data} />
      )}

      {showingAll ? (
        <AllValuesDialog
          document={document}
          data={data}
          entries={{ ...(character.entries || {}), ...pickedEntries }}
          schemaId={character.schema_ref}
          onChange={onChange}
          onReset={onReset}
          onOverride={onOverride}
          readOnly={readOnly}
          onClose={() => setShowingAll(false)}
        />
      ) : null}

      {choices.length ? (
        <ChoiceDialog
          // Keyed so a second choice starts with nothing ticked.
          key={`${choices[0].source}:${choices[0].target}:${choices.length}`}
          choice={choices[0]}
          have={Array.isArray(data?.[choices[0].target]) ? data[choices[0].target] : []}
          sourceLabel={document?.fields?.[choices[0].source]?.label || choices[0].source}
          onConfirm={confirmChoice}
          onSkip={() => setChoices((prev) => prev.slice(1))}
        />
      ) : null}
    </div>
  )
}
