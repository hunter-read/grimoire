import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const modules = import.meta.glob('./locales/*.json', { eager: true })

const resources = {}
export const AVAILABLE_LANGUAGES = []

for (const path in modules) {
  const code = path.match(/\/([a-zA-Z-]+)\.json$/)[1]
  const data = modules[path].default ?? modules[path]
  resources[code] = { translation: data }
  AVAILABLE_LANGUAGES.push({ value: code, label: data._meta?.nativeName ?? code })
}

AVAILABLE_LANGUAGES.sort((a, b) => a.label.localeCompare(b.label))

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: (typeof localStorage !== 'undefined' && localStorage.getItem?.('grimoire:language')) || 'en-US',
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
