import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuBookOpen,
  LuPlus,
  LuTrash2,
  LuPencil,
  LuDownload,
  LuPackagePlus,
} from 'react-icons/lu'
import {
  rulesets as rulesetsApi,
  characters as charactersApi,
  content as contentApi,
  campaigns as campaignsApi,
} from '../api'
import Spinner from '../components/Spinner'
import RulesetEntryDialog from '../components/characters/RulesetEntryDialog'
import {
  goldBtn,
  ghostBtn,
  iconBtn,
  fieldInput,
  fieldLabel,
  card,
} from '../components/characters/characterStyles'

/**
 * Rulesets: the content a table plays with.
 *
 * A ruleset belongs to a campaign — everyone there reads it, the GM edits it —
 * or to the server, which every game can use. This is what lets two games in
 * the same system allow different content, so the list leads with which
 * campaign each one is for.
 */
export default function RulesetsView() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [rulesets, setRulesets] = useState([])
  const [schemas, setSchemas] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [packs, setPacks] = useState([])
  const [error, setError] = useState('')

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSchema, setNewSchema] = useState('')
  const [newCampaign, setNewCampaign] = useState('')

  const [open, setOpen] = useState(null)
  const [entries, setEntries] = useState([])
  const [types, setTypes] = useState([])
  const [editing, setEditing] = useState(null)
  const [addingType, setAddingType] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, schemaList, campaignList] = await Promise.all([
        rulesetsApi.list(),
        charactersApi.listSchemas(),
        campaignsApi.list().catch(() => []),
      ])
      setRulesets(list.rulesets || [])
      setSchemas(schemaList.schemas || [])
      setCampaigns(Array.isArray(campaignList) ? campaignList : campaignList?.campaigns || [])
      setError('')
    } catch (e) {
      setError(e.message || t('rulesets.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  // Opening a ruleset loads its entries and the content types its system
  // declares, so the "add entry" picker only offers catalogues that exist.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([
      rulesetsApi.entries(open.id),
      contentApi.types(open.schema_id).catch(() => ({ content_types: [] })),
      rulesetsApi.installable(open.schema_id).catch(() => ({ packs: [] })),
    ])
      .then(([entryList, typeList, packList]) => {
        if (cancelled) return
        setEntries(entryList.entries || [])
        setTypes(typeList.content_types || [])
        setPacks(packList.packs || [])
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const create = async (event) => {
    event.preventDefault()
    try {
      const created = await rulesetsApi.create({
        schema_id: newSchema,
        name: newName.trim(),
        // "" means the server, which only an admin may choose.
        campaign_id: newCampaign || null,
      })
      setCreating(false)
      setNewName('')
      load()
      setOpen(created)
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (ruleset) => {
    if (!window.confirm(t('rulesets.confirmDelete', { name: ruleset.name }))) return
    try {
      await rulesetsApi.remove(ruleset.id)
      setOpen(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const importPack = async (packId) => {
    try {
      const result = await rulesetsApi.import(open.id, { pack_id: packId })
      const refreshed = await rulesetsApi.entries(open.id)
      setEntries(refreshed.entries || [])
      load()
      window.alert(t('rulesets.importResult', result))
    } catch (e) {
      setError(e.message)
    }
  }

  const removeEntry = async (entry) => {
    if (!window.confirm(t('rulesets.confirmDeleteEntry', { name: entry.name }))) return
    try {
      await rulesetsApi.removeEntry(open.id, entry.id)
      setEntries((prev) => prev.filter((row) => row.id !== entry.id))
    } catch (e) {
      setError(e.message)
    }
  }

  const refreshEntries = async () => {
    const refreshed = await rulesetsApi.entries(open.id)
    setEntries(refreshed.entries || [])
    load()
  }

  if (loading) return <Spinner />

  // --- one ruleset, opened ------------------------------------------------
  if (open) {
    const current = rulesets.find((row) => row.id === open.id) || open
    return (
      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button onClick={() => setOpen(null)} aria-label={t('common.back')} style={iconBtn}>
            <LuArrowLeft size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>{current.name}</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {current.campaign_name || t('rulesets.serverWide')} · {current.schema_id}
            </div>
          </div>
          {current.editable ? (
            <button onClick={() => remove(current)} style={ghostBtn}>
              <LuTrash2 size={14} />
              {t('rulesets.delete')}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('rulesets.readOnly')}
            </span>
          )}
        </header>

        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', marginBottom: 16 }}>
            {error}
          </div>
        ) : null}

        {current.attribution ? (
          <p style={{ ...card, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            {current.attribution}
          </p>
        ) : null}

        {current.editable ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <select
              value={addingType}
              onChange={(event) => setAddingType(event.target.value)}
              aria-label={t('rulesets.contentType')}
              style={{ ...fieldInput, width: 'auto' }}
            >
              <option value="">{t('rulesets.pickType')}</option>
              {types.map((type) => (
                <option key={type.name} value={type.name}>
                  {type.label_plural || type.label || type.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setEditing({ contentType: addingType })}
              disabled={!addingType}
              style={addingType ? goldBtn : { ...ghostBtn, opacity: 0.55 }}
            >
              <LuPlus size={14} />
              {t('rulesets.newEntry')}
            </button>
            {packs.map((pack) => (
              <button key={pack.pack_id} onClick={() => importPack(pack.pack_id)} style={ghostBtn}>
                <LuPackagePlus size={14} />
                {t('rulesets.importPack', { name: pack.name, count: pack.entry_count })}
              </button>
            ))}
          </div>
        ) : null}

        {entries.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('rulesets.noEntries')}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {entries.map((entry) => (
              <li
                key={entry.id}
                style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: 10 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {entry.content_type}
                    {entry.forked_from ? ` · ${t('rulesets.forked')}` : ''}
                  </div>
                </div>
                {entry.editable ? (
                  <>
                    <button
                      onClick={() => setEditing({ contentType: entry.content_type, entry })}
                      aria-label={t('common.edit')}
                      title={t('common.edit')}
                      style={iconBtn}
                    >
                      <LuPencil size={15} />
                    </button>
                    <button
                      onClick={() => removeEntry(entry)}
                      aria-label={t('rulesets.deleteEntry')}
                      title={t('rulesets.deleteEntry')}
                      style={iconBtn}
                    >
                      <LuTrash2 size={15} />
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {editing ? (
          <RulesetEntryDialog
            rulesetId={open.id}
            contentType={editing.contentType}
            typeDefinition={types.find((type) => type.name === editing.contentType) || {}}
            entry={editing.entry}
            onSaved={refreshEntries}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </div>
    )
  }

  // --- the list -----------------------------------------------------------
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
        <button
          onClick={() => navigate('/characters')}
          aria-label={t('common.back')}
          style={iconBtn}
        >
          <LuArrowLeft size={18} />
        </button>
        <LuBookOpen size={20} color="var(--gold)" style={{ flexShrink: 0 }} />
        <h1 style={{ margin: 0, fontSize: 22, flex: 1 }}>{t('rulesets.title')}</h1>
        <button
          onClick={() => setCreating((value) => !value)}
          disabled={!schemas.length}
          title={schemas.length ? undefined : t('rulesets.needSheetFirst')}
          style={schemas.length ? goldBtn : { ...ghostBtn, opacity: 0.55 }}
        >
          <LuPlus size={14} />
          {t('rulesets.create')}
        </button>
      </header>

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>{t('rulesets.help')}</p>

      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {creating ? (
        <form
          onSubmit={create}
          style={{
            ...card,
            marginBottom: 20,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ flex: '1 1 180px' }}>
            <label htmlFor="rs-name" style={fieldLabel}>
              {t('rulesets.name')}
            </label>
            <input
              id="rs-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              style={fieldInput}
              required
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label htmlFor="rs-schema" style={fieldLabel}>
              {t('characters.system')}
            </label>
            <select
              id="rs-schema"
              value={newSchema}
              onChange={(event) => setNewSchema(event.target.value)}
              style={fieldInput}
              required
            >
              <option value="">—</option>
              {schemas.map((schema) => (
                <option key={schema.schema_id} value={schema.schema_id}>
                  {schema.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label htmlFor="rs-campaign" style={fieldLabel}>
              {t('rulesets.forCampaign')}
            </label>
            <select
              id="rs-campaign"
              value={newCampaign}
              onChange={(event) => setNewCampaign(event.target.value)}
              style={fieldInput}
            >
              <option value="">{t('rulesets.serverWide')}</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" style={goldBtn}>
            {t('rulesets.create')}
          </button>
        </form>
      ) : null}

      {rulesets.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('rulesets.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rulesets.map((ruleset) => (
            <li
              key={ruleset.id}
              style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <button
                onClick={() => setOpen(ruleset)}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  font: 'inherit',
                  minWidth: 0,
                }}
              >
                <div style={{ fontWeight: 600 }}>{ruleset.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {ruleset.campaign_name || t('rulesets.serverWide')} · {ruleset.schema_id} ·{' '}
                  {t('rulesets.entryCount', { count: ruleset.entry_count })}
                </div>
              </button>
              <a
                href={`/api/rulesets/${ruleset.id}/export`}
                aria-label={t('rulesets.export')}
                title={t('rulesets.export')}
                style={{ ...iconBtn, color: 'var(--text-muted)' }}
              >
                <LuDownload size={15} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
