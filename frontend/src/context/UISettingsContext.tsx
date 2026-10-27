import { createContext, useContext } from 'react'
import type { Schema } from '../api'

const DEFAULT_UI_SETTINGS: UISettings = {
  hide_maps: false,
  hide_tokens: false,
  hide_audio: false,
  hide_models: false,
  hide_campaigns: false,
  campaign_uploads_disabled: false,
  campaign_upload_max_file_mb: 0,
  campaign_upload_max_total_mb: 0,
  guest_access_enabled: false,
  // Whether API keys exist on this instance at all (API_KEYS_ENABLED).
  api_keys_enabled: true,
  // Whether share links exist on this instance at all (SHARE_LINKS_ENABLED).
  share_links_enabled: true,
  // Whether the MCP server for AI assistants is served at /mcp (MCP_ENABLED).
  mcp_enabled: false,
  // Whether the library can be written to at all. Gates the move / rename /
  // delete actions everywhere outside the file manager, which asks per folder.
  library_writable: false,
}

/**
 * The instance-wide UI flags from /settings/ui. Every key is optional: until the
 * response lands the provider holds partial defaults, and a key still missing
 * reads as undefined, which every consumer treats as off.
 */
export type UISettings = Partial<Schema<'UISettingsResponse'>>

const UISettingsContext = createContext<UISettings>(DEFAULT_UI_SETTINGS)

export const UISettingsProvider = UISettingsContext.Provider

export function useUISettings(): UISettings {
  return useContext(UISettingsContext)
}
