import { useAuth } from '../../context/AuthContext'
import { useUISettings } from '../../context/UISettingsContext'

/**
 * Whether the signed-in user may create share links right now: the instance
 * switch (SHARE_LINKS_ENABLED) and the server's answer for this user, which
 * already folds in their role, any override, and that guests never may.
 */
export default function useCanShare(): boolean {
  // Optional chaining: views are also rendered outside an AuthProvider (tests,
  // isolated previews), where nobody may share anyway.
  const user = useAuth()?.user
  const { share_links_enabled: enabled } = useUISettings()
  return enabled !== false && Boolean(user?.share_links_allowed)
}
