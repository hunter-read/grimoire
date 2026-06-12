import { createContext, useContext } from 'react'

const UISettingsContext = createContext({
  hide_maps: false,
  hide_tokens: false,
  hide_campaigns: false,
  disable_password_change: false,
})

export const UISettingsProvider = UISettingsContext.Provider

export function useUISettings() {
  return useContext(UISettingsContext)
}
