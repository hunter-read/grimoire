import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuUsers, LuPlus, LuFileUp, LuSettings } from 'react-icons/lu'
import { characters as charactersApi } from '../api'
import Spinner from '../components/Spinner'
import SheetManager from '../components/characters/SheetManager'
import NewCharacterDialog from '../components/characters/NewCharacterDialog'
import CharacterCard from '../components/characters/CharacterCard'
import { isActive } from '../components/characters/characterStatus'
import { goldBtn, ghostBtn, disabledBtn } from '../components/characters/characterStyles'

/**
 * The character list — every character this user has, across every system.
 *
 * Sits under Campaigns in the sidebar and is visible to guests, who are exactly
 * the people most likely to want a character sheet: a guest account exists to
 * play in one campaign. Laid out like the Campaigns page, with each character
 * a card showing their art.
 */
export default function CharactersView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // `?manage=rulesets` opens the manager straight onto its content tab, which
  // is where the old /characters/rulesets route now lands.
  const [searchParams, setSearchParams] = useSearchParams()
  const manageParam = searchParams.get('manage')
  const importRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [characters, setCharacters] = useState([])
  const [schemas, setSchemas] = useState([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState(Boolean(manageParam))

  const load = useCallback(async () => {
    try {
      const [list, schemaList] = await Promise.all([
        charactersApi.list(),
        charactersApi.listSchemas(),
      ])
      // Characters still being played lead; retired and fallen ones follow,
      // each group keeping the server's most-recently-edited order.
      const all = list.characters || []
      setCharacters([...all.filter(isActive), ...all.filter((c) => !isActive(c))])
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

  const create = async (body) => {
    const created = await charactersApi.create(body)
    setCreating(false)
    navigate(`/characters/${created.id}`)
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
    } finally {
      // Cleared, so choosing the same file again after fixing it still fires.
      if (importRef.current) importRef.current.value = ''
    }
  }

  const remove = async (character) => {
    const name = character.name || t('characters.untitled')
    if (!window.confirm(t('characters.confirmDelete', { name }))) return
    try {
      await charactersApi.remove(character.id)
      setCharacters((prev) => prev.filter((c) => c.id !== character.id))
    } catch (err) {
      setError(err.message)
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
          <button type="button" onClick={() => importRef.current?.click()} style={ghostBtn}>
            <LuFileUp size={14} aria-hidden="true" />
            {t('characters.importCharacter')}
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json,.yaml,.yml"
            aria-label={t('characters.importCharacter')}
            onChange={(e) => importCharacter(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
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
        <ul
          aria-label={t('characters.title')}
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: 16,
          }}
        >
          {characters.map((character) => (
            <CharacterCard key={character.id} character={character} onDelete={remove} />
          ))}
        </ul>
      )}

      {creating ? (
        <NewCharacterDialog
          schemas={schemas}
          onCreate={create}
          onClose={() => setCreating(false)}
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
