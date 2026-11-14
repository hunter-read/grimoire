import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, isLanguage, languageLabel } from '../utils/languages'

/**
 * A book's language, picked from the fixed list (utils/languages.ts). Stores the lowercase name
 * ("english") and shows it with a capital. A value from before the list existed is still offered,
 * so opening an old record does not silently change it.
 */
export default function LanguageSelect({
  id,
  value,
  onChange,
  style,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  style?: CSSProperties
}) {
  const { t } = useTranslation()
  const legacy = value && !isLanguage(value) ? value : ''
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      <option value="">{t('bookEditor.languageNotSet')}</option>
      {legacy && <option value={legacy}>{legacy}</option>}
      {LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {languageLabel(lang)}
        </option>
      ))}
    </select>
  )
}
