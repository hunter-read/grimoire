import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuUsers, LuPlus, LuFileUp, LuSettings, LuArrowDownUp } from 'react-icons/lu'
import { characters as charactersApi, type BodyOf, type Schema } from '../api'
import Spinner from '../components/Spinner'
import SheetManager from '../components/characters/SheetManager'
import NewCharacterDialog from '../components/characters/NewCharacterDialog'
import CharacterImportDialog from '../components/characters/CharacterImportDialog'
import CharacterGrid from '../components/characters/CharacterGrid'
import PartyCharacters from '../components/characters/PartyCharacters'
import SheetUpdatesNotice from '../components/characters/SheetUpdatesNotice'
import {
  CHARACTER_SORTS,
  CHARACTER_SORT_LABELS,
  getCharacterSort,
  saveCharacterSort,
  sortCharacters,
  type CharacterSort,
} from '../components/characters/characterSort'
import { goldBtn, ghostBtn, disabledBtn } from '../components/characters/characterStyles'

/**
 * The character list — every character this user has, across every system.
 *
 * Sits under Campaigns in the sidebar and is visible to guests, who are exactly
 * the people most likely to want a character sheet: a guest account exists to
 * play in one campaign. Laid out like the Campaigns page, with each character
 * a card showing their art.
 *
 * The user's own characters come first. Other players' characters they can
 * read through a campaign follow in a section of their own, one folding group
 * per campaign.
 */
type CharacterSummary = Schema<'CharacterSummary'>
type SheetSchema = Schema<'SchemaListResponse'>['schemas'][number]
type SheetUpdate = Schema<'SheetUpdate'>

const sectionHeading = {
  margin: '0 0 16px',
  fontSize: 17,
  fontWeight: 600,
}

export default function CharactersView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // `?manage=rulesets` opens the manager straight onto its content tab, which
  // is where the old /characters/rulesets route now lands.
  const [searchParams, setSearchParams] = useSearchParams()
  const manageParam = searchParams.get('manage')

  const [loading, setLoading] = useState(true)
  const [characters, setCharacters] = useState<CharacterSummary[]>([])
  const [schemas, setSchemas] = useState<SheetSchema[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [managing, setManaging] = useState(Boolean(manageParam))
  const [updates, setUpdates] = useState<SheetUpdate[]>([])
  const [sort, setSort] = useState<CharacterSort>(() => getCharacterSort())
  const own = useMemo(
    () =>
      sortCharacters(
        characters.filter((c) => c.owned !== false),
        sort
      ),
    [characters, sort]
  )
  const party = useMemo(() => characters.filter((c) => c.owned === false), [characters])

  const changeSort = (next: CharacterSort) => {
    setSort(next)
    saveCharacterSort(next)
  }

  const load = useCallback(async () => {
    try {
      const [list, schemaList] = await Promise.all([
        charactersApi.list(),
        charactersApi.listSchemas(),
      ])
      // Kept in the server's most-recently-edited order; sortCharacters
      // works from it and falls back on it for ties.
      setCharacters(list.characters || [])
      setSchemas(schemaList.schemas || [])
      setError('')
    } catch (e) {
      setError((e as Error).message || t('characters.loadFailed'))
    } finally {
      setLoading(false)
    }
    // A hint, fetched after the list so a slow catalogue never holds it up.
    charactersApi
      .sheetUpdates()
      .then((result) => setUpdates(result.updates || []))
      .catch(() => setUpdates([]))
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const create = async (body: BodyOf<'/characters', 'post'>) => {
    const created = await charactersApi.create(body)
    setCreating(false)
    navigate(`/characters/${created.id}`)
  }

  const remove = async (character: CharacterSummary) => {
    const name = character.name || t('characters.untitled')
    if (!window.confirm(t('characters.confirmDelete', { name }))) return
    try {
      await charactersApi.remove(character.id)
      setCharacters((prev) => prev.filter((c) => c.id !== character.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const canCreate = schemas.length > 0

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 28,
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <LuUsers size={20} color="var(--gold)" aria-hidden="true" style={{ flexShrink: 0 }} />
          {t('characters.title')}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setManaging(true)} style={ghostBtn}>
            <LuSettings size={14} aria-hidden="true" />
            {t('characters.manageSheets')}
          </button>
          <button type="button" onClick={() => setImporting(true)} style={ghostBtn}>
            <LuFileUp size={14} aria-hidden="true" />
            {t('characters.importCharacter')}
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!canCreate}
            title={canCreate ? undefined : t('characters.needSchemaFirst')}
            style={canCreate ? goldBtn : disabledBtn}
          >
            <LuPlus size={14} aria-hidden="true" />
            {t('characters.newCharacter')}
          </button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          style={{
            color: 'var(--danger)',
            background: 'var(--bg-card)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spinner size={28} />
        </div>
      ) : characters.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--text-muted)' }}>
          <LuUsers size={40} aria-hidden="true" style={{ marginBottom: 16, opacity: 0.4 }} />
          <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8, color: 'var(--text-dim)' }}>
            {t('characters.emptyTitle')}
          </div>
          <div style={{ fontSize: 14, marginBottom: 20 }}>
            {canCreate ? t('characters.emptyNoCharacters') : t('characters.emptyBrowseFirst')}
          </div>
          <button
            type="button"
            onClick={() => (canCreate ? setCreating(true) : setManaging(true))}
            style={goldBtn}
          >
            {canCreate ? (
              <>
                <LuPlus size={14} aria-hidden="true" />
                {t('characters.newCharacter')}
              </>
            ) : (
              <>
                <LuSettings size={14} aria-hidden="true" />
                {t('characters.manageSheets')}
              </>
            )}
          </button>
        </div>
      ) : (
        <>
          <SheetUpdatesNotice updates={updates} onUpdated={load} onError={setError} />
          {characters.length > 1 ? (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}
            >
              <LuArrowDownUp size={12} aria-hidden="true" />
              {t('sortFilter.sort')}
              <select
                value={sort}
                onChange={(e) => changeSort(e.target.value as CharacterSort)}
                style={{
                  fontSize: 13,
                  padding: '5px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  textTransform: 'none',
                  letterSpacing: 'normal',
                  fontWeight: 400,
                }}
              >
                {CHARACTER_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {t(CHARACTER_SORT_LABELS[option])}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {party.length ? (
            // Headed only when there are two sections to tell apart.
            <h2 style={sectionHeading}>{t('characters.yourCharacters')}</h2>
          ) : null}
          {own.length ? (
            <CharacterGrid
              characters={own}
              sort={sort}
              label={t('characters.yourCharacters')}
              onDelete={remove}
            />
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>
              {canCreate ? t('characters.emptyNoCharacters') : t('characters.emptyBrowseFirst')}
            </p>
          )}
          {party.length ? (
            <section aria-labelledby="party-characters" style={{ marginTop: 36 }}>
              <h2 id="party-characters" style={sectionHeading}>
                {t('characters.partyMembers')}
              </h2>
              <PartyCharacters characters={party} sort={sort} />
            </section>
          ) : null}
        </>
      )}

      {creating ? (
        <NewCharacterDialog
          schemas={schemas}
          onCreate={create}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {importing ? (
        <CharacterImportDialog
          onImported={(created: { id: string }) => navigate(`/characters/${created.id}`)}
          onClose={() => setImporting(false)}
        />
      ) : null}

      {managing ? (
        <SheetManager
          schemas={schemas}
          onChanged={load}
          initialTab={manageParam === 'rulesets' ? 'content' : 'sheets'}
          onClose={() => {
            setManaging(false)
            // Drop the param so closing and reopening does not jump back to
            // the tab a stale URL named.
            if (manageParam) setSearchParams({}, { replace: true })
          }}
        />
      ) : null}
    </div>
  )
}
