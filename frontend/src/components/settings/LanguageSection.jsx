import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import i18n, { AVAILABLE_LANGUAGES } from '../../i18n'

export default function LanguageSection() {
  const { t } = useTranslation()
  const [lang, setLang] = useState(localStorage.getItem('grimoire:language') || 'en-US')
  const [saved, setSaved] = useState(false)

  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const handleLang = (e) => {
    const v = e.target.value
    setLang(v)
    localStorage.setItem('grimoire:language', v)
    i18n.changeLanguage(v)
    flash()
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 15,
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {t('userSettings.language.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.6 }}>
        {t('userSettings.language.description')}
      </p>
      <select
        id="language-select"
        aria-label={t('userSettings.language.title')}
        value={lang}
        onChange={handleLang}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text)',
          fontSize: 14,
          padding: '7px 12px',
          cursor: 'pointer',
          minWidth: 180,
        }}
      >
        {AVAILABLE_LANGUAGES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
