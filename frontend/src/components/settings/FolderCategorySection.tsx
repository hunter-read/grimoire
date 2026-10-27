import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'

export default function FolderCategorySection() {
  const { t } = useTranslation()
  const [disabled, setDisabled] = useState(null)
  const [envLocked, setEnvLocked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    settingsApi
      .get()
      .then((d) => {
        setDisabled(!!d.disable_folder_category_inference)
        setEnvLocked(!!d.disable_folder_category_inference_env_locked)
      })
      .catch(() => {
        setDisabled(false)
        setEnvLocked(false)
      })
  }, [])

  const toggle = async () => {
    const next = !disabled
    setDisabled(next)
    setSaving(true)
    try {
      await settingsApi.patch({ disable_folder_category_inference: next })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (disabled === null) return <Spinner size={20} />

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('appSettings.folderCategory.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.folderCategory.description')}
      </p>

      <label
        htmlFor="disable_folder_category_inference"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: envLocked ? 'not-allowed' : 'pointer',
          width: 'fit-content',
          opacity: envLocked ? 0.7 : 1,
        }}
      >
        <input
          id="disable_folder_category_inference"
          type="checkbox"
          checked={disabled}
          onChange={toggle}
          disabled={envLocked || saving}
          style={{
            width: 16,
            height: 16,
            cursor: envLocked ? 'not-allowed' : 'pointer',
            accentColor: 'var(--gold)',
          }}
        />
        <span style={{ fontSize: 14, color: 'var(--text)' }}>
          {t('appSettings.folderCategory.disable')}
        </span>
        {saving && <Spinner size={13} />}
        {saved && <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />}
      </label>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
        {t('appSettings.folderCategory.perSystemHint')}
      </p>

      {envLocked && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 6,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            fontSize: 13,
            color: 'var(--text-dim)',
            lineHeight: 1.5,
          }}
        >
          {t('appSettings.folderCategory.envLocked', {
            value: disabled ? 'true' : 'false',
          })}
        </div>
      )}
    </div>
  )
}
