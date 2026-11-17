import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'
import InstantToggle from './InstantToggle'
import RichTextEditor from './RichTextEditor'
import SettingsLoadError from './SettingsLoadError'
import { failureMessage, useInstantSettings } from './useInstantSettings'
import { useUnsavedChanges } from './settingsDirty'

const KEYS = ['custom_login_message_enabled'] as const

/**
 * A message shown above the sign-in form. The switch saves at once; the text
 * has its own Save, and Settings asks before leaving with it unsaved.
 */
export default function LoginMessageSection() {
  const { t } = useTranslation()
  const { data, values, loadError, reload, saving, saved, error, toggle } = useInstantSettings(KEYS)
  // The text as last saved here, then the one being edited (null: no edits).
  const [savedText, setSavedText] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [messageSaving, setMessageSaving] = useState(false)
  const [messageSaved, setMessageSaved] = useState(false)
  const [messageError, setMessageError] = useState<unknown>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const base = savedText ?? data?.custom_login_message ?? ''
  const text = draft ?? base
  const dirty = draft !== null && draft !== base
  useUnsavedChanges('login-message', dirty)

  useEffect(() => () => clearTimeout(savedTimer.current), [])

  const saveMessage = async () => {
    if (draft === null) return
    setMessageSaving(true)
    setMessageSaved(false)
    setMessageError(null)
    try {
      await settingsApi.patch({ custom_login_message: draft })
      setSavedText(draft)
      setDraft(null)
      setMessageSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setMessageSaved(false), 2500)
    } catch (e) {
      // Keep the draft: the person can try again without retyping it.
      setMessageError(e ?? new Error())
    } finally {
      setMessageSaving(false)
    }
  }

  const enabled = !!values?.custom_login_message_enabled

  return (
    <div>
      <h3 className="settings-section-title">{t('authSettings.customMessage.title')}</h3>
      <p className="settings-section-description">{t('authSettings.customMessage.description')}</p>

      {loadError ? (
        <SettingsLoadError message={loadError} onRetry={reload} />
      ) : !values ? (
        <Spinner size={20} />
      ) : (
        <>
          <InstantToggle
            id="custom_login_message_enabled"
            label={t('authSettings.customMessage.enable')}
            checked={enabled}
            onChange={() => void toggle('custom_login_message_enabled')}
            saving={saving === 'custom_login_message_enabled'}
            saved={saved === 'custom_login_message_enabled'}
            error={error?.message}
          />

          {enabled && (
            <div style={{ marginTop: 16 }}>
              <RichTextEditor
                value={text}
                onChange={(html) => {
                  setDraft(html)
                  setMessageSaved(false)
                }}
                ariaLabel={t('authSettings.customMessage.editorLabel')}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <button
                  type="button"
                  onClick={() => void saveMessage()}
                  disabled={!dirty || messageSaving}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 500,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: dirty ? 'var(--gold)' : 'var(--text-muted)',
                    cursor: dirty && !messageSaving ? 'pointer' : 'default',
                    opacity: dirty ? 1 : 0.7,
                  }}
                >
                  {messageSaving ? t('common.saving') : t('common.save')}
                </button>
                <span
                  role="status"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--green)',
                    fontSize: 13,
                  }}
                >
                  {messageSaved && (
                    <>
                      <LuCircleCheck size={14} aria-hidden="true" /> {t('common.saved')}
                    </>
                  )}
                </span>
              </div>
              {messageError !== null && (
                <div
                  role="alert"
                  style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--danger)' }}
                >
                  {failureMessage(messageError, t)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
