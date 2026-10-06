import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFileText, LuCheck } from 'react-icons/lu'
import { campaigns as campaignsApi } from '../../api'
import CharacterDialog from './CharacterDialog'
import { goldBtn, ghostBtn, disabledBtn, fieldInput, fieldLabel, helpText } from './characterStyles'

/**
 * Creating a character: a name, the sheet it is built on, and optionally the
 * campaign it is played in.
 *
 * The sheets are a list of choices rather than a dropdown, because which sheet
 * to use is the one decision here that matters, and a system's name alone does
 * not tell two versions of it apart.
 */
export default function NewCharacterDialog({ schemas, onCreate, onClose }) {
  const { t } = useTranslation()
  const nameRef = useRef(null)
  const [name, setName] = useState('')
  const [schemaRef, setSchemaRef] = useState(schemas.length === 1 ? schemas[0].schema_id : '')
  const [campaignId, setCampaignId] = useState('')
  const [campaigns, setCampaigns] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    campaignsApi
      .list()
      .then((list) => {
        if (!cancelled) setCampaigns(Array.isArray(list) ? list : list?.campaigns || [])
      })
      // The campaign is optional; a list that will not load just leaves it out.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (!schemaRef || saving) return
    setSaving(true)
    try {
      await onCreate({
        schema_ref: schemaRef,
        name: name.trim() || t('characters.untitled'),
        ...(campaignId ? { campaign_id: campaignId } : {}),
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const canCreate = Boolean(schemaRef) && !saving

  return (
    <CharacterDialog
      title={t('characters.newCharacter')}
      description={t('characters.newCharacterHelp')}
      onClose={onClose}
      maxWidth={560}
      initialFocusRef={nameRef}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="new-character-form"
            disabled={!canCreate}
            style={canCreate ? goldBtn : disabledBtn}
          >
            {saving ? t('characters.creating') : t('characters.create')}
          </button>
        </>
      }
    >
      <form id="new-character-form" onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        <div>
          <label htmlFor="new-character-name" style={fieldLabel}>
            {t('characters.name')}
          </label>
          <input
            id="new-character-name"
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('characters.untitled')}
            style={{ ...fieldInput, fontSize: 14, padding: '9px 12px' }}
          />
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={fieldLabel}>{t('characters.sheet')}</legend>
          <div style={{ display: 'grid', gap: 8 }}>
            {schemas.map((schema) => {
              const selected = schemaRef === schema.schema_id
              return (
                <label
                  key={schema.schema_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: `1px solid ${selected ? 'var(--gold)' : 'var(--border)'}`,
                    background: selected ? 'var(--bg-deep)' : 'var(--bg-card)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="new-character-sheet"
                    value={schema.schema_id}
                    checked={selected}
                    onChange={() => setSchemaRef(schema.schema_id)}
                    style={{ accentColor: 'var(--gold)', width: 16, height: 16, margin: 0 }}
                  />
                  <LuFileText
                    size={18}
                    aria-hidden="true"
                    color={selected ? 'var(--gold)' : 'var(--text-muted)'}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                      {schema.name || schema.schema_id}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                      {[
                        schema.system !== schema.name ? schema.system : '',
                        schema.version ? `v${schema.version}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {selected ? <LuCheck size={16} aria-hidden="true" color="var(--gold)" /> : null}
                </label>
              )
            })}
          </div>
        </fieldset>

        <div>
          <label htmlFor="new-character-campaign" style={fieldLabel}>
            {t('characters.campaignOptional')}
          </label>
          <select
            id="new-character-campaign"
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
            style={{ ...fieldInput, fontSize: 14, padding: '9px 12px' }}
          >
            <option value="">{t('characters.noCampaign')}</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <p style={helpText}>{t('characters.campaignHelp')}</p>
        </div>
      </form>
    </CharacterDialog>
  )
}
