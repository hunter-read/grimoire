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

function detectLanguage() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem?.('grimoire:language')
    if (saved) return saved
  }
  const available = Object.keys(resources)
  for (const lang of typeof navigator !== 'undefined'
    ? (navigator.languages ?? [navigator.language])
    : []) {
    const exact = available.find((a) => a === lang)
    const prefix = available.find((a) => a.startsWith(lang.split('-')[0]))
    if (exact || prefix) return exact ?? prefix
  }
  return 'en-US'
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
})

export default i18n
