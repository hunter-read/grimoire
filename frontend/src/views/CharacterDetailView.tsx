import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuTriangleAlert,
  LuCheck,
  LuDownload,
  LuListTree,
  LuEye,
  LuPencil,
} from 'react-icons/lu'
import { characters as charactersApi, content as contentApi } from '../api'
import type { Schema } from '../api'
import Spinner from '../components/Spinner'
import CharacterSheet from '../components/characters/CharacterSheet'
import ChoiceDialogJs from '../components/characters/ChoiceDialog'
import AllValuesDialog from '../components/characters/AllValuesDialog'
import { planPick, applyChoice } from '../components/characters/onPick'
import { OVERRIDES_KEY } from '../components/characters/expressions'
import RawCharacterData from '../components/characters/RawCharacterData'
import CharacterPortrait from '../components/characters/CharacterPortrait'
import PortraitDialog from '../components/characters/PortraitDialog'
import { CharacterMediaContext } from '../components/characters/characterMedia'
import type { CharacterMedia, PortraitPatch } from '../components/characters/characterMedia'
import CharacterPlacement from '../components/characters/CharacterPlacement'
import GmEditAccess from '../components/characters/GmEditAccess'
import { iconBtn, ghostBtn, card } from '../components/characters/characterStyles'
import type { SheetDocument } from '../components/characters/LayoutRenderer'

// Still JavaScript, so TypeScript reads `have` as only ever its default `[]`.
const ChoiceDialog = ChoiceDialogJs as ComponentType<{
  choice: Choice
  have: unknown[]
  sourceLabel: string
  onConfirm: (picked: unknown[]) => void
  onSkip: () => void
}>

type Character = Schema<'CharacterDetail'>
type Values = Record<string, unknown>
// A choice a pick asked for - "choose 2 skills" - as onPick plans it.
interface Choice {
  source: string
  target: string
  [key: string]: unknown
}
// A picked entry's own properties, or a freeform entry's values.
type Entry = Record<string, unknown> | null | undefined

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
  const { characterId = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [character, setCharacter] = useState<Character | null>(null)
  const [document, setDocument] = useState<SheetDocument | null>(null)
  const [data, setData] = useState<Values>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Choices a pick asked for - "choose 2 skills" - shown one at a time.
  const [choices, setChoices] = useState<Choice[]>([])
  // Entries the player just picked, overlaid on the resolved ones until the
  // next save brings them back from the server. Without it a derived value -
  // "a wizard casts spells" - would lag the pick by a round trip.
  const [pickedEntries, setPickedEntries] = useState<Record<string, Entry>>({})
  // Every value, whatever the sheet's layout chooses to show.
  const [showingAll, setShowingAll] = useState(false)
  // The art, large: where it is seen properly, and where the owner frames it.
  const [showingPortrait, setShowingPortrait] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Values>({})
  // Fields to hand back to their automatic value on the next save.
  const unsetRef = useRef(new Set<string>())
  // The latest data, for the pick planner: it runs after an await, when the
  // `data` a callback closed over may already be stale.
  const dataRef = useRef<Values>({})
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
          if (!cancelled) setDocument(schema.document as SheetDocument)
        }
        setError('')
      } catch (e) {
        if (!cancelled) setError((e as Error).message || t('characters.loadFailed'))
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
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [characterId])

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS)
  }, [flush])

  const applyPatch = useCallback(
    (patch: Values) => {
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
    async (ids: string[]) =>
      (await contentApi.resolve(character?.schema_ref || '', ids))?.entries || {},
    [character?.schema_ref]
  )

  const onChange = useCallback(
    async (name: string, value: unknown, meta?: unknown) => {
      applyPatch({ [name]: value })

      const definition = document?.fields?.[name]
      if (definition?.type !== 'content_ref') return

      // The picked entry's own properties: from the browser that picked it,
      // from the value itself for a freeform entry, or fetched as a last resort.
      const picked = value as { _inline?: boolean; _ref?: string } | null | undefined
      let entry: Entry =
        meta && typeof meta === 'object' && 'entry' in meta
          ? ((meta as { entry: Entry }).entry ?? null)
          : undefined
      if (entry === undefined) {
        if (!picked) entry = null
        else if (picked._inline) entry = picked as Record<string, unknown>
        else if (picked._ref) {
          const resolved: Record<string, { missing?: boolean; data?: Values; name?: string }> =
            await lookup([picked._ref]).catch(() => ({}))
          const found = resolved[picked._ref]
          entry = found && !found.missing ? { ...(found.data || {}), name: found.name } : null
        }
      }
      const ref = picked?._ref
      if (entry && ref) setPickedEntries((prev) => ({ ...prev, [ref]: entry }))

      const rules = definition.on_pick
      if (!Array.isArray(rules) || !rules.length) return
      try {
        const plan = await planPick({
          document: document ?? {},
          data: dataRef.current,
          field: name,
          entry: entry ?? null,
          lookup,
        })
        if (Object.keys(plan.patch).length) applyPatch(plan.patch as Values)
        if (plan.choices.length) setChoices((prev) => [...prev, ...(plan.choices as Choice[])])
      } catch (e) {
        // A pick that could not be followed up is still a pick: the value is
        // saved, and the player can add what it would have granted by hand.
        setError((e as Error).message)
      }
    },
    [applyPatch, document, lookup]
  )

  // Hand a field back to its `default_from` value.
  const onReset = useCallback(
    (name: string) => {
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
    (name: string, value: unknown) => {
      const overrides: Values = { ...((dataRef.current?.[OVERRIDES_KEY] as Values) || {}) }
      if (value === undefined || value === null || value === '') delete overrides[name]
      else overrides[name] = value
      applyPatch({ [OVERRIDES_KEY]: overrides })
    },
    [applyPatch]
  )

  // An image field's picture changed on the server. Taken into the local data
  // only: the value names a file the upload already stored, so there is
  // nothing to save, and saving it would be refused anyway.
  const onImageChanged = useCallback((field: string, value: string | null) => {
    const next = { ...dataRef.current }
    if (value) next[field] = value
    else delete next[field]
    dataRef.current = next
    setData(next)
  }, [])

  const onPortraitChanged = useCallback(
    (patch: PortraitPatch) => setCharacter((prev) => (prev ? { ...prev, ...patch } : prev)),
    []
  )

  // `owned` is false only for a sheet shared through a campaign; such a sheet
  // is still `editable` by the campaign's GM when its player lets them in.
  const owned = character?.owned !== false
  const readOnly = !(character?.editable ?? owned)
  const media = useMemo<CharacterMedia | null>(
    () =>
      character
        ? {
            character,
            readOnly,
            onPortraitChanged,
            onImageChanged,
            onError: setError,
            openPortrait: () => setShowingPortrait(true),
          }
        : null,
    [character, readOnly, onPortraitChanged, onImageChanged]
  )

  // Placement and edit access change only these; the sheet's values stay as
  // they are on screen, where an edit may still be waiting to save.
  const onPlacementChanged = (updated: Character) =>
    setCharacter((prev) =>
      prev
        ? {
            ...prev,
            campaign_id: updated.campaign_id,
            campaign_name: updated.campaign_name,
            campaign_has_gm: updated.campaign_has_gm,
            status: updated.status,
            gm_can_edit: updated.gm_can_edit,
          }
        : prev
    )

  const confirmChoice = (picked: unknown[]) => {
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
      setError((e as Error).message)
    }
  }

  const rename = async (name: string) => {
    try {
      const updated = await charactersApi.update(characterId, { name })
      setCharacter(updated)
    } catch (e) {
      setError((e as Error).message)
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

  const sheetName = document?.name || character.schema_name || character.schema_ref
  const actionBtn = { ...ghostBtn, padding: 8 }

  return (
    <CharacterMediaContext.Provider value={media}>
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
            onChanged={onPortraitChanged}
            onError={setError}
            onOpen={() => setShowingPortrait(true)}
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
                onChange={(e) =>
                  setCharacter((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                }
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
              <CharacterPlacement
                character={character}
                // Where the character is played stays the player's, even when
                // they have let the GM edit the sheet itself.
                readOnly={!owned}
                onChanged={onPlacementChanged}
                onError={setError}
              />
              <GmEditAccess
                character={character}
                onChanged={onPlacementChanged}
                onError={setError}
              />
              {readOnly ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  · <LuEye size={13} aria-hidden="true" /> {t('characters.readOnlyParty')}
                </span>
              ) : !owned ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  · <LuPencil size={13} aria-hidden="true" /> {t('characters.gmEditing')}
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
            have={
              Array.isArray(data?.[choices[0].target]) ? (data[choices[0].target] as unknown[]) : []
            }
            sourceLabel={document?.fields?.[choices[0].source]?.label || choices[0].source}
            onConfirm={confirmChoice}
            onSkip={() => setChoices((prev) => prev.slice(1))}
          />
        ) : null}

        {showingPortrait ? (
          <PortraitDialog
            character={character}
            readOnly={readOnly}
            onChanged={onPortraitChanged}
            onError={setError}
            onClose={() => setShowingPortrait(false)}
          />
        ) : null}
      </div>
    </CharacterMediaContext.Provider>
  )
}
