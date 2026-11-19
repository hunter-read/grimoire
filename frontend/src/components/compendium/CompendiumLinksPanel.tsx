import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBookOpen } from 'react-icons/lu'
import {
  characters as charactersApi,
  compendium as compendiumApi,
  content as contentApi,
  type Schema,
} from '../../api'
import { REGULAR } from '../codex/codexPanelStyles'

type Summary = Schema<'CompendiumSummary'>

interface Option {
  id: string
  name: string
  detail: string
}

export interface CompendiumLinksPanelProps {
  systemId: string
  onChange?: (summary: Summary) => void
}

/**
 * The content packs and character sheets a system is linked to.
 *
 * Part of the system's edit form, but like the cover upload and the Codex link
 * each change applies at once rather than waiting for Save: a link is its own
 * record, not a field of the system. Packs are the installed ones; sheets are
 * the editor's own and the ones installed for everyone. A link whose pack or
 * sheet has since gone stays listed, so it can be seen and removed.
 */
export default function CompendiumLinksPanel({ systemId, onChange }: CompendiumLinksPanelProps) {
  const { t } = useTranslation()
  const s = REGULAR
  const [packs, setPacks] = useState<Option[]>([])
  const [sheets, setSheets] = useState<Option[]>([])
  const [linkedPacks, setLinkedPacks] = useState<string[]>([])
  const [linkedSheets, setLinkedSheets] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([compendiumApi.get(systemId), contentApi.packs(), charactersApi.listSchemas()])
      .then(([summary, packList, schemaList]) => {
        if (cancelled) return
        setLinkedPacks((summary.packs || []).map((pack) => pack.pack_id))
        setLinkedSheets((summary.sheets || []).map((sheet) => sheet.schema_id))
        const installedPacks = (packList.packs || []).map((pack) => ({
          id: pack.pack_id,
          name: pack.name,
          detail: t('compendium.entryCount', { count: pack.entry_count || 0 }),
        }))
        // A linked pack no longer installed is still shown, to be unlinked.
        const gonePacks = (summary.packs || [])
          .filter((pack) => !pack.installed)
          .map((pack) => ({
            id: pack.pack_id,
            name: pack.pack_id,
            detail: t('compendium.notInstalled'),
          }))
        setPacks([...installedPacks, ...gonePacks])
        const usable = (schemaList.schemas || []).map((schema) => ({
          id: schema.schema_id,
          name: schema.name || schema.schema_id,
          detail: [schema.system, schema.server_wide ? t('characters.forEveryone') : '']
            .filter(Boolean)
            .join(' · '),
        }))
        const goneSheets = (summary.sheets || [])
          .filter((sheet) => !usable.some((option) => option.id === sheet.schema_id))
          .map((sheet) => ({
            id: sheet.schema_id,
            name: sheet.name,
            detail: t('compendium.notInstalled'),
          }))
        setSheets([...usable, ...goneSheets])
        setLoaded(true)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [systemId, t])

  const save = async (body: { pack_ids?: string[]; sheet_ids?: string[] }) => {
    setSaving(true)
    try {
      const summary = await compendiumApi.setLinks(systemId, body)
      setLinkedPacks((summary.packs || []).map((pack) => pack.pack_id))
      setLinkedSheets((summary.sheets || []).map((sheet) => sheet.schema_id))
      setError('')
      onChange?.(summary)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id]

  const group = (
    legend: string,
    help: string,
    options: Option[],
    linked: string[],
    onToggle: (id: string) => void,
    empty: string
  ) => (
    <fieldset style={{ border: 'none', padding: 0, margin: '10px 0 0' }}>
      <legend style={s.label}>{legend}</legend>
      <p style={{ ...s.text, color: 'var(--text-muted)', margin: '0 0 6px' }}>{help}</p>
      {options.length ? (
        <div style={{ display: 'grid', gap: 4 }}>
          {options.map((option) => (
            <label
              key={option.id}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14 }}
            >
              <input
                type="checkbox"
                checked={linked.includes(option.id)}
                disabled={saving}
                onChange={() => onToggle(option.id)}
              />
              <span>
                {option.name}
                {option.detail ? (
                  <>
                    {' '}
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      · {option.detail}
                    </span>
                  </>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p style={{ ...s.text, color: 'var(--text-muted)', margin: 0 }}>{empty}</p>
      )}
    </fieldset>
  )

  return (
    <section aria-labelledby={`compendium-links-${systemId}`} style={s.section}>
      <h4 id={`compendium-links-${systemId}`} style={s.heading}>
        <LuBookOpen size={14} aria-hidden="true" /> {t('compendium.linksHeading')}
      </h4>
      <p style={{ ...s.text, color: 'var(--text-muted)', margin: 0 }}>
        {t('compendium.linksHelp')}
      </p>
      {!loaded && !error ? null : (
        <>
          {group(
            t('compendium.packsLegend'),
            t('compendium.packsHelp'),
            packs,
            linkedPacks,
            (id) => void save({ pack_ids: toggle(linkedPacks, id) }),
            t('compendium.noPacks')
          )}
          {group(
            t('compendium.sheetsLegend'),
            t('compendium.sheetsHelp'),
            sheets,
            linkedSheets,
            (id) => void save({ sheet_ids: toggle(linkedSheets, id) }),
            t('compendium.noSheets')
          )}
        </>
      )}
      {error ? (
        <p role="alert" style={{ ...s.text, color: 'var(--danger)', margin: '10px 0 0' }}>
          {error}
        </p>
      ) : null}
    </section>
  )
}
