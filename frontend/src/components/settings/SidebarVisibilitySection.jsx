import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'

export default function SidebarVisibilitySection() {
  const { t } = useTranslation()
  const [values, setValues] = useState(null)
  const [saving, setSaving] = useState(null)
  const [saved, setSaved] = useState(null)

  const VISIBILITY_ITEMS = [
    { key: 'hide_maps', label: t('appSettings.sidebarVisibility.hideMaps') },
    { key: 'hide_tokens', label: t('appSettings.sidebarVisibility.hideTokens') },
    { key: 'hide_campaigns', label: t('appSettings.sidebarVisibility.hideCampaigns') },
  ]

  useEffect(() => {
    settingsApi
      .get()
      .then((d) =>
        setValues({
          hide_maps: d.hide_maps,
          hide_tokens: d.hide_tokens,
          hide_campaigns: d.hide_campaigns,
        })
      )
      .catch(() => setValues({ hide_maps: false, hide_tokens: false, hide_campaigns: false }))
  }, [])

  const toggle = async (key) => {
    const next = !values[key]
    setValues((v) => ({ ...v, [key]: next }))
    setSaving(key)
    try {
      await settingsApi.patch({ [key]: next })
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
      window.dispatchEvent(new CustomEvent('grimoire:settings-changed'))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('appSettings.sidebarVisibility.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.sidebarVisibility.description')}
      </p>

      {values === null ? (
        <Spinner size={20} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {VISIBILITY_ITEMS.map(({ key, label }) => (
            <label
              key={key}
              htmlFor={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
                width: 'fit-content',
              }}
            >
              <input
                id={key}
                type="checkbox"
                checked={values[key]}
                onChange={() => toggle(key)}
                disabled={saving === key}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              <span style={{ fontSize: 14, color: 'var(--text)' }}>{label}</span>
              {saving === key && <Spinner size={13} />}
              {saved === key && <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
