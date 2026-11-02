/**
 * Hands focus back to the soundboard launcher when the panel closes.
 *
 * The launcher and the panel replace each other (AppShell renders one or the
 * other), so the button that opened the panel no longer exists when it closes
 * and cannot simply be refocused. The panel marks the hand-off here as it goes;
 * the launcher takes focus on mount only if that happened a moment ago, so it
 * never steals focus when it first appears on page load.
 */
export const soundboardFocus = { returnUntil: 0 }

/** How long after the panel closes the launcher may still claim focus. */
export const RETURN_WINDOW_MS = 1000
