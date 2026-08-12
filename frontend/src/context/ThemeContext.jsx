import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api'
import {
  DEFAULT_MODE,
  DEFAULT_APP_MODE,
  applyAppMode,
  applyTokens,
  getAppMode,
  getStoredVariants,
  getThemeMode,
  resolveMode,
  setAppMode as persistAppMode,
  setThemeMode as persistMode,
  setThemeVariants as persistVariants,
  variantFor,
} from '../utils/theme'

const ThemeContext = createContext(null)

/**
 * The user's appearance across two axes: colour mode (light/dark/system) and
 * app mode (Grimoire today, Codex when the mode toggle lands).
 *
 * Both live in localStorage *and* on the server. localStorage is what the entry
 * bundle reads before the first paint, so the app never flashes the wrong
 * colours; the server copy is what makes the choice follow the user to another
 * browser. On load the server wins, since it is the durable record.
 *
 * A built-in theme (Codex, or an app mode's own default) has no tokens: its
 * colours are stylesheet rules keyed off `data-app-mode`. Selecting one clears
 * any custom tokens and switches that attribute instead.
 */
export function ThemeProvider({ children }) {
  const [appMode, setAppModeState] = useState(getAppMode)
  const [mode, setModeState] = useState(() => getThemeMode(getAppMode()))
  const [themeId, setThemeId] = useState('')
  const [installed, setInstalled] = useState([])
  const [builtIn, setBuiltIn] = useState([])
  const [loaded, setLoaded] = useState(false)

  /**
   * Apply a selection: a built-in id switches the app-mode palette, an installed
   * id applies its tokens. An id we do not recognise means the theme was
   * uninstalled elsewhere, so fall back to the app mode's own default rather
   * than leaving stale colours applied.
   */
  const applySelection = useCallback((list, builtInList, id, activeAppMode, colourMode) => {
    const custom = list.find((t) => t.id === id)
    if (custom) {
      applyAppMode(custom.app_mode || activeAppMode)
      // A theme may ship both palettes; apply the one matching the mode we
      // actually resolved to, so System follows the OS within one theme.
      const variants = custom.variants || { [custom.mode || 'dark']: custom.tokens }
      persistVariants(variants, activeAppMode)
      applyTokens(variantFor(variants, resolveMode(colourMode)))
      return
    }

    // An empty id is "this app mode's own palette", so it must not drag the
    // mode back to whatever the built-in list happens to declare first — only a
    // named built-in (Codex picked from inside Grimoire) switches modes.
    const bundled = id ? builtInList.find((t) => t.id === id) : null
    applyAppMode(bundled?.app_mode || activeAppMode)
    applyTokens({})
    persistVariants({}, activeAppMode)
  }, [])

  const reload = useCallback(
    async (nextAppMode = appMode) => {
      try {
        const data = await api.get(`/themes?app_mode=${encodeURIComponent(nextAppMode)}`)
        const list = data.installed || []
        const bundled = data.built_in || []
        const colourMode = data.mode || getThemeMode(nextAppMode)
        setInstalled(list)
        setBuiltIn(bundled)
        setThemeId(data.theme_id || '')
        if (data.mode) {
          setModeState(data.mode)
          persistMode(data.mode, nextAppMode)
        }
        applySelection(list, bundled, data.theme_id || '', nextAppMode, colourMode)
      } catch {
        // Offline, or not logged in yet. The locally stored theme is already
        // applied, so there is nothing to correct.
      } finally {
        setLoaded(true)
      }
    },
    [applySelection, appMode]
  )

  useEffect(() => {
    reload()
    // Only on mount: switching app mode calls reload itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-apply on mount so a stored theme survives a hard reload even before the
  // server responds.
  useEffect(() => {
    const active = getAppMode()
    applyAppMode(active)
    applyTokens(variantFor(getStoredVariants(active), resolveMode(getThemeMode(active))))
  }, [])

  const setMode = useCallback(
    async (next) => {
      setModeState(persistMode(next, appMode))
      // The active theme may have a palette for each mode, so switching light
      // to dark has to re-pick the variant, not just the built-in palette.
      applyTokens(variantFor(getStoredVariants(appMode), resolveMode(next)))
      try {
        await api.put('/themes/selection', { mode: next, app_mode: appMode })
      } catch {
        // Keep the local change: the user asked for it, and it will be pushed
        // again next time something succeeds.
      }
    },
    [appMode]
  )

  const selectTheme = useCallback(
    async (id) => {
      setThemeId(id)
      applySelection(installed, builtIn, id, appMode, mode)
      try {
        await api.put('/themes/selection', { theme_id: id, app_mode: appMode })
      } catch {
        /* local change stands */
      }
    },
    [applySelection, builtIn, installed, appMode, mode]
  )

  /**
   * Switch app mode. Reloads that mode's own saved selection rather than
   * carrying the current one across — the point of per-mode themes.
   */
  const switchAppMode = useCallback(
    async (next) => {
      const applied = persistAppMode(next)
      setAppModeState(applied)
      setModeState(getThemeMode(applied))
      await reload(applied)
    },
    [reload]
  )

  const value = {
    mode,
    appMode,
    themeId,
    installed,
    builtIn,
    loaded,
    setMode,
    selectTheme,
    switchAppMode,
    reload,
    defaultMode: DEFAULT_MODE,
    defaultAppMode: DEFAULT_APP_MODE,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return (
    useContext(ThemeContext) || {
      mode: DEFAULT_MODE,
      appMode: DEFAULT_APP_MODE,
      themeId: '',
      installed: [],
      builtIn: [],
      loaded: false,
      setMode: () => {},
      selectTheme: () => {},
      switchAppMode: () => {},
      reload: () => {},
      defaultMode: DEFAULT_MODE,
      defaultAppMode: DEFAULT_APP_MODE,
    }
  )
}
