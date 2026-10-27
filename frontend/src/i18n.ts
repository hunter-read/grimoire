import i18n from 'i18next'
import type { BackendModule, ReadCallback, ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US.json'
import { LANGUAGE_NAMES } from './locales/languages'

// Only the fallback language ships in the main bundle. Every other locale is its
// own chunk, fetched when it is first used (issue #708): all twelve together were
// nearly half the app's JavaScript, and nobody reads more than one.
const loaders = import.meta.glob<ResourceKey>(['./locales/*.json', '!./locales/en-US.json'], {
  import: 'default',
})

/**
 * The slice of i18next's `t` that plain helpers need. Both react-i18next's `t`
 * and a test's stub translate fit it, unlike the full overloaded `TFunction`.
 */
export type Translate = (key: string, opts?: Record<string, unknown>) => string

export const AVAILABLE_LANGUAGES = Object.entries(LANGUAGE_NAMES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label))

const available = AVAILABLE_LANGUAGES.map((l) => l.value)

// An i18next backend over the lazy chunks above. i18next calls it for a language
// it has no resources for, on startup and on changeLanguage, and waits for it.
export const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(language: string, _namespace: string, callback: ReadCallback) {
    const load = loaders[`./locales/${language}.json`]
    // en-US is bundled, and anything else unknown has nothing to load.
    if (!load) return callback(null, {})
    load().then(
      (data) => callback(null, data),
      (err: Error) => callback(err, null)
    )
  },
}

function detectLanguage(): string {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem?.('grimoire:language')
    if (saved) return saved
  }
  for (const lang of typeof navigator !== 'undefined'
    ? (navigator.languages ?? [navigator.language])
    : []) {
    const exact = available.find((a) => a === lang)
    const prefix = available.find((a) => a.startsWith(lang.split('-')[0]))
    const match = exact ?? prefix
    if (match) return match
  }
  return 'en-US'
}

/** Settles once the starting language is ready, loaded or failed. */
export const languageReady = i18n
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    resources: { 'en-US': { translation: enUS } },
    // The bundled en-US counts as loaded; the rest come from the backend.
    partialBundledLanguages: true,
    lng: detectLanguage(),
    fallbackLng: 'en-US',
    // Exactly the bundle names, so i18next never asks for a bare "de" as well.
    load: 'currentOnly',
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
    react: {
      // The first render waits for languageReady, and changeLanguage switches
      // only once the new locale has loaded, so nothing ever has to suspend.
      useSuspense: false,
    },
  })

export default i18n
