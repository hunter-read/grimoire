import { createContext, useContext } from 'react'

const UISettingsContext = createContext({
  hide_maps: false,
  hide_tokens: false,
  hide_audio: false,
  hide_campaigns: false,
  campaign_uploads_disabled: false,
  campaign_upload_max_file_mb: 0,
  campaign_upload_max_total_mb: 0,
  guest_access_enabled: false,
  // Whether the library can be written to at all. Gates the move / rename /
  // delete actions everywhere outside the file manager, which asks per folder.
  library_writable: false,
})

export const UISettingsProvider = UISettingsContext.Provider

export function useUISettings() {
  return useContext(UISettingsContext)
}
