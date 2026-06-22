import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'

export default function CampaignUploadsSection() {
  const { t } = useTranslation()
  const [values, setValues] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    settingsApi
      .get()
      .then((d) =>
        setValues({
          campaign_uploads_disabled: !!d.campaign_uploads_disabled,
          campaign_upload_max_file_mb: d.campaign_upload_max_file_mb ?? 0,
          campaign_upload_max_total_mb: d.campaign_upload_max_total_mb ?? 0,
        })
      )
      .catch(() =>
        setValues({
          campaign_uploads_disabled: false,
          campaign_upload_max_file_mb: 0,
          campaign_upload_max_total_mb: 0,
        })
      )
  }, [])

  const save = async (patch) => {
    setValues((v) => ({ ...v, ...patch }))
    setSaving(true)
    try {
      await settingsApi.patch(patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      window.dispatchEvent(new CustomEvent('grimoire:settings-changed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('appSettings.campaignUploads.title')}
        {saving && <Spinner size={13} style={{ marginLeft: 8 }} />}
        {saved && <LuCircleCheck size={14} style={{ color: 'var(--green)', marginLeft: 8 }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.campaignUploads.description')}
      </p>

      {values === null ? (
        <Spinner size={20} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label
            htmlFor="campaign_uploads_disabled"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              width: 'fit-content',
            }}
          >
            <input
              id="campaign_uploads_disabled"
              type="checkbox"
              checked={values.campaign_uploads_disabled}
              onChange={(e) => save({ campaign_uploads_disabled: e.target.checked })}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
            />
            <span style={{ fontSize: 14, color: 'var(--text)' }}>
              {t('appSettings.campaignUploads.disable')}
            </span>
          </label>

          {[
            { key: 'campaign_upload_max_file_mb', label: t('appSettings.campaignUploads.perFile') },
            {
              key: 'campaign_upload_max_total_mb',
              label: t('appSettings.campaignUploads.perCampaign'),
            },
          ].map(({ key, label }) => (
            <label
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}
            >
              <input
                type="number"
                min="0"
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                onBlur={(e) => save({ [key]: parseInt(e.target.value) || 0 })}
                style={{
                  width: 90,
                  padding: '6px 8px',
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  fontSize: 14,
                }}
              />
              <span style={{ color: 'var(--text)' }}>{label}</span>
            </label>
          ))}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            {t('appSettings.campaignUploads.hint')}
          </p>
        </div>
      )}
    </div>
  )
}
