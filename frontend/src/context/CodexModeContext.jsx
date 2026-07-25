import { createContext, useContext, useCallback, useEffect, useState } from 'react'

/**
 * Codex mode — an alternate, wargaming-focused skin for Grimoire.
 *
 * This is a front-end-only experiment: it reuses the existing library / audio
 * API and data, but swaps the palette (see the `[data-mode='codex']` block in
 * index.css), the logo, and the product name, and surfaces a few
 * wargaming-oriented views. The toggle lives in the sidebar and persists in
 * localStorage so the choice survives reloads.
 *
 * Nothing here changes Grimoire's default behavior — with the flag off the app
 * renders exactly as before.
 */

const STORAGE_KEY = 'grimoire_codex_mode'

const CodexModeContext = createContext({
  codex: false,
  toggleCodex: () => {},
  setCodex: () => {},
})

export function CodexModeProvider({ children }) {
  const [codex, setCodexState] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true')

  // Drive the palette swap by tagging the document root. CSS in index.css keys
  // off `[data-mode='codex']`, so a single attribute recolors the whole app.
  useEffect(() => {
    const root = document.documentElement
    if (codex) {
      root.setAttribute('data-mode', 'codex')
    } else {
      root.removeAttribute('data-mode')
    }
  }, [codex])

  const setCodex = useCallback((value) => {
    setCodexState(value)
    localStorage.setItem(STORAGE_KEY, String(value))
  }, [])

  const toggleCodex = useCallback(() => {
    setCodexState((c) => {
      const next = !c
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return (
    <CodexModeContext.Provider value={{ codex, toggleCodex, setCodex }}>
      {children}
    </CodexModeContext.Provider>
  )
}

export function useCodexMode() {
  return useContext(CodexModeContext)
}
