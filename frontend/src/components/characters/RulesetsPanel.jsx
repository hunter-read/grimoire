import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuPlus,
  LuTrash2,
  LuPencil,
  LuDownload,
  LuPackagePlus,
  LuClipboardPaste,
} from 'react-icons/lu'
import {
  rulesets as rulesetsApi,
  characters as charactersApi,
  content as contentApi,
  campaigns as campaignsApi,
} from '../../api'
import Spinner from '../Spinner'
import RulesetEntryDialog from './RulesetEntryDialog'
import InstalledPacks from './InstalledPacks'
import {
  goldBtn,
  ghostBtn,
  disabledBtn,
  iconBtn,
  fieldInput,
  fieldLabel,
  card,
  codeArea,
  helpText,
  emptyState,
  sectionBar,
  sectionTitle,
} from './characterStyles'

/**
 * The sheet manager's Content tab: the content packs installed on the server,
 * then the rulesets a table edits.
 *
 * A pack is read-only and usable by every character as soon as it is
 * installed. A ruleset is content you edit - homebrew, house rules, a pack's
 * entries you have changed - and belongs to a campaign (everyone there reads
 * it, the GM edits it) or to the server, which every game can use. That is
 * what lets two games in the same system allow different content, so the list
 * leads with which campaign each one is for.
 *
 * Rendered inside the sheet manager, so it draws no page chrome of its own.
 */
export default function RulesetsPanel() {
  const { t } = useTranslation()

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

  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteTarget, setPasteTarget] = useState('')
  const [pasteConflict, setPasteConflict] = useState('skip')

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

  // Importing a document into a ruleset the user picks. Separate from the
  // pack import inside an open ruleset: this is "I was sent a file", which is
  // reached before choosing which ruleset it belongs in.
  const importDocument = async (event) => {
    event.preventDefault()
    try {
      const result = await rulesetsApi.import(pasteTarget, {
        text: pasteText,
        conflict: pasteConflict,
      })
      setPasting(false)
      setPasteText('')
      setError('')
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

  const sheetName = (schemaId) =>
    schemas.find((schema) => schema.schema_id === schemaId)?.name || schemaId

  // --- one ruleset, opened ------------------------------------------------
  if (open) {
    const current = rulesets.find((row) => row.id === open.id) || open
    return (
      <div>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button onClick={() => setOpen(null)} aria-label={t('common.back')} style={iconBtn}>
            <LuArrowLeft size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>{current.name}</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {current.campaign_name || t('rulesets.serverWide')} · {sheetName(current.schema_id)}
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
              style={addingType ? goldBtn : disabledBtn}
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
          <p style={emptyState}>{t('rulesets.noEntries')}</p>
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
  const anyEditable = rulesets.some((row) => row.editable)
  return (
    <div>
      <InstalledPacks schemas={schemas} onChanged={load} />

      <section aria-labelledby="rulesets-heading">
        <div style={sectionBar}>
          <h3 id="rulesets-heading" style={sectionTitle}>
            {t('rulesets.title')}
          </h3>
          <button
            type="button"
            onClick={() => setPasting((value) => !value)}
            disabled={!anyEditable}
            title={anyEditable ? undefined : t('rulesets.needRulesetFirst')}
            aria-expanded={pasting}
            style={anyEditable ? ghostBtn : disabledBtn}
          >
            <LuClipboardPaste size={14} aria-hidden="true" />
            {t('rulesets.importDocument')}
          </button>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            disabled={!schemas.length}
            title={schemas.length ? undefined : t('rulesets.needSheetFirst')}
            aria-expanded={creating}
            style={schemas.length ? goldBtn : disabledBtn}
          >
            <LuPlus size={14} aria-hidden="true" />
            {t('rulesets.create')}
          </button>
        </div>
        <p style={{ ...helpText, margin: '0 0 12px' }}>{t('rulesets.help')}</p>

        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
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

        {pasting ? (
          <form
            onSubmit={importDocument}
            style={{ ...card, marginBottom: 20, display: 'grid', gap: 12 }}
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label htmlFor="rs-target" style={fieldLabel}>
                  {t('rulesets.importInto')}
                </label>
                <select
                  id="rs-target"
                  value={pasteTarget}
                  onChange={(event) => setPasteTarget(event.target.value)}
                  style={fieldInput}
                  required
                >
                  <option value="">—</option>
                  {rulesets
                    .filter((row) => row.editable)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} ({row.campaign_name || t('rulesets.serverWide')})
                      </option>
                    ))}
                </select>
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label htmlFor="rs-conflict" style={fieldLabel}>
                  {t('rulesets.onConflict')}
                </label>
                <select
                  id="rs-conflict"
                  value={pasteConflict}
                  onChange={(event) => setPasteConflict(event.target.value)}
                  style={fieldInput}
                >
                  <option value="skip">{t('rulesets.conflictSkip')}</option>
                  <option value="rename">{t('rulesets.conflictRename')}</option>
                  <option value="overwrite">{t('rulesets.conflictOverwrite')}</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="rs-document" style={fieldLabel}>
                {t('rulesets.document')}
              </label>
              <textarea
                id="rs-document"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                rows={10}
                required
                spellCheck={false}
                style={codeArea}
              />
              <p style={helpText}>{t('rulesets.documentHelp')}</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={!pasteText.trim() || !pasteTarget} style={goldBtn}>
                {t('rulesets.import')}
              </button>
              <button type="button" onClick={() => setPasting(false)} style={ghostBtn}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : null}

        {rulesets.length === 0 ? (
          <p style={emptyState}>{t('rulesets.empty')}</p>
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
                    {ruleset.campaign_name || t('rulesets.serverWide')} ·{' '}
                    {sheetName(ruleset.schema_id)} ·{' '}
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
      </section>
    </div>
  )
}
