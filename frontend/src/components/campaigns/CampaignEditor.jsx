import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import api, { campaigns } from '../../api'

export default function CampaignEditor({ campaign, isGmOrAdmin, onClose, onSaved }) {
  const { t } = useTranslation()
  const isEdit = !!campaign

  const [form, setForm] = useState({
    name: campaign?.name ?? '',
    description: campaign?.description ?? '',
    is_gm_campaign: campaign?.is_gm_campaign ?? false,
    gm_title: campaign?.gm_title ?? 'Game Master',
    system_id: campaign?.system_id ?? '',
    parent_campaign_id: campaign?.parent_campaign_id ?? '',
  })
  const [systems, setSystems] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/systems').then(data => setSystems(data || [])).catch(() => {})
  }, [])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError(t('campaignEditor.nameRequired')); return }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        gm_title: form.gm_title || 'Game Master',
        system_id: form.system_id || null,
        parent_campaign_id: form.parent_campaign_id || null,
      }
      if (!isEdit) payload.is_gm_campaign = form.is_gm_campaign

      const result = isEdit
        ? await campaigns.update(campaign.id, payload)
        : await campaigns.create(payload)
      onSaved(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 28, width: '100%', maxWidth: 480, position: 'relative',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          <LuX size={18} />
        </button>

        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>
          {isEdit ? t('campaignEditor.titleEdit') : t('campaignEditor.titleNew')}
        </h3>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{t('campaignEditor.nameLabel')}</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder={t('campaignEditor.namePlaceholder')}
              style={inputStyle}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{t('campaignEditor.descriptionLabel')}</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder={t('campaignEditor.descriptionPlaceholder')}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{t('campaignEditor.systemLabel')}</label>
            <select
              value={form.system_id}
              onChange={e => set('system_id', e.target.value)}
              style={{ ...inputStyle, appearance: 'auto' }}
            >
              <option value="">{t('campaignEditor.systemNone')}</option>
              {systems.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {(form.is_gm_campaign || (isEdit && campaign?.is_gm_campaign)) && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{t('campaignEditor.gmTitleLabel')}</label>
              <input
                value={form.gm_title}
                onChange={e => set('gm_title', e.target.value)}
                placeholder={t('campaignEditor.gmTitlePlaceholder')}
                style={inputStyle}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {t('campaignEditor.gmTitleHint')}
              </div>
            </div>
          )}

          {!isEdit && isGmOrAdmin && (
            <div style={{ marginBottom: 16, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={form.is_gm_campaign}
                  onChange={e => set('is_gm_campaign', e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                {t('campaignEditor.gmCampaignCheckbox')}
              </label>
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('campaignEditor.cancel')}</button>
            <button type="submit" disabled={saving} style={submitBtn}>
              {saving ? t('campaignEditor.saving') : isEdit ? t('campaignEditor.saveChanges') : t('campaignEditor.createCampaign')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const labelStyle = { fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, display: 'block', marginBottom: 6 }
const inputStyle = {
  width: '100%', padding: '9px 12px', background: 'var(--bg-deep)',
  border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
  fontSize: 14, boxSizing: 'border-box',
}
const cancelBtn = {
  padding: '9px 18px', background: 'var(--bg-deep)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14,
}
const submitBtn = {
  padding: '9px 18px', background: 'var(--gold)', border: 'none',
  borderRadius: 8, color: '#1a1209', cursor: 'pointer', fontSize: 14, fontWeight: 600,
}
