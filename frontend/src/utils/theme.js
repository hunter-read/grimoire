/**
 * Theme mode and custom-token application.
 *
 * There are two independent axes:
 *
 *   - **colour mode** — light / dark / system, stamped on `<html data-theme>`.
 *   - **app mode** — which side of the product is in use, stamped on
 *     `<html data-app-mode>`. Grimoire (TTRPG) today; Codex (wargaming) is
 *     built but not yet surfaced.
 *
 * They multiply: each app mode has a light and a dark palette in index.css, and
 * a user's theme choice is remembered *per app mode*, so switching modes
 * restores the colours they picked there rather than carrying one over.
 *
 * This module runs from the entry bundle (main.jsx) rather than an inline
 * <script> in index.html, because the CSP is `script-src 'self'` — an inline
 * bootstrap would be blocked in production, and loosening the CSP to avoid a
 * brief flash is a bad trade. Applying it as the first statement of the bundle
 * is early enough in practice: the stylesheet is already parsed and no app
 * content has rendered.
 */

const MODE_KEY = 'grimoire:theme-mode'
const TOKENS_KEY = 'grimoire:theme-tokens'
const VARIANTS_KEY = 'grimoire:theme-variants'
const APP_MODE_KEY = 'grimoire:app-mode'

export const THEME_MODES = ['light', 'dark', 'system']
export const DEFAULT_MODE = 'dark'

/**
 * App modes — which side of the product you are in.
 *
 * `codex` is a wargaming skin that is finished as a palette but has no UI to
 * reach it yet: no toggle is rendered, and nothing selects it by default. It
 * ships now so themes can declare which mode they are built for without the
 * format changing later. Anyone reading the source will find it; that is fine,
 * it is a colour scheme, not a secret.
 */
export const APP_MODES = ['grimoire', 'codex']
export const DEFAULT_APP_MODE = 'grimoire'

/** Themes that ship with the app, per app mode. Keyed by theme id. */
export const BUILT_IN_THEMES = {
  grimoire: { id: '', name: 'Grimoire', app_mode: 'grimoire' },
  codex: { id: 'codex', name: 'Codex', app_mode: 'codex' },
}

/**
 * Token names a theme is allowed to set.
 *
 * A closed allowlist, not a filter: an installed theme is untrusted input, and
 * these values are written into the CSSOM. Restricting *which* properties a
 * theme can touch means a hostile definition cannot introduce, say, a
 * `background-image` pointing at a tracking URL.
 */
export const THEME_TOKENS = [
  'bg-deep',
  'bg-panel',
  'bg-card',
  'bg-card-hover',
  'bg-input',
  'border',
  'border-light',
  'accent',
  'accent-dim',
  'accent-bright',
  'accent-alt',
  'on-accent',
  'text',
  'text-dim',
  'text-muted',
  'red',
  'green',
  'blue',
  'danger',
  'danger-fill',
  'on-danger',
  'on-media',
  'on-media-border',
  'warning',
  'success',
  'tag-bg',
  'tag-border',
  'mark-bg',
  'invite-bg',
  'overlay',
  'shadow',
  'scrim',
  'scrim-strong',
  'type-book',
  'type-map',
  'type-token',
  'type-audio',
  'type-file',
  // The accent marking an item that has other versions (the version picker, the
  // gallery badge, the duplicate compare view). Wired through `--p-variant` like
  // every other token, but originally left out of this list, which left it as
  // the one accent a theme could not restyle — so a custom palette inherited the
  // built-in teal whether or not it clashed.
  'variant',
]

/**
 * Colour values a theme may use.
 *
 * Deliberately narrow: hex, rgb/rgba, hsl/hsla, and a few keywords. This is the
 * second half of the injection defence — without it a value like
 * `red; background: url(https://evil/)` would break out of the declaration it
 * was meant to fill. Anything not matching is dropped rather than sanitised,
 * since a half-understood colour is not worth guessing at.
 */
const COLOR_RE =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%/]+\)|hsla?\(\s*[\d.\s,%/deg]+\)|transparent|currentcolor|inherit)$/i

/** True when `value` is a colour this app will write into the CSSOM. */
export function isSafeColor(value) {
  return typeof value === 'string' && value.length <= 64 && COLOR_RE.test(value.trim())
}

/**
 * Drop any entry whose name is not in the allowlist or whose value is not a
 * plain colour. Returns a `{ token: value }` map safe to apply.
 */
export function sanitizeTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return {}
  const safe = {}
  for (const name of THEME_TOKENS) {
    const value = tokens[name]
    if (isSafeColor(value)) safe[name] = value.trim()
  }
  return safe
}

function read(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* Private-browsing quota errors must not break theming. */
  }
}

/** The active app mode, or the default when unset or unrecognised. */
export function getAppMode() {
  const stored = read(APP_MODE_KEY, DEFAULT_APP_MODE)
  return APP_MODES.includes(stored) ? stored : DEFAULT_APP_MODE
}

/** Write the app mode onto <html> so the CSS palette switches. */
export function applyAppMode(appMode) {
  const next = APP_MODES.includes(appMode) ? appMode : DEFAULT_APP_MODE
  document.documentElement.setAttribute('data-app-mode', next)
  return next
}

/** Persist and apply an app mode. */
export function setAppMode(appMode) {
  const next = APP_MODES.includes(appMode) ? appMode : DEFAULT_APP_MODE
  write(APP_MODE_KEY, next)
  applyAppMode(next)
  return next
}

/**
 * Storage keys are scoped per app mode, so a theme picked in one is remembered
 * separately from the other. `grimoire` keeps the unscoped key it has always
 * used, so an existing user's choice is not lost on upgrade.
 */
function scoped(key, appMode) {
  return appMode === DEFAULT_APP_MODE ? key : `${key}:${appMode}`
}

/** The stored colour mode for an app mode, or the default. */
export function getThemeMode(appMode = getAppMode()) {
  const stored = read(scoped(MODE_KEY, appMode), DEFAULT_MODE)
  return THEME_MODES.includes(stored) ? stored : DEFAULT_MODE
}

function prefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

/** Resolve `system` to the OS preference; other modes pass through. */
export function resolveMode(mode) {
  if (mode === 'system') return prefersDark() ? 'dark' : 'light'
  return THEME_MODES.includes(mode) ? mode : DEFAULT_MODE
}

/** Write the resolved mode onto <html> so the CSS palette switches. */
export function applyMode(mode) {
  document.documentElement.setAttribute('data-theme', resolveMode(mode))
}

/** Persist and apply a colour mode for an app mode. */
export function setThemeMode(mode, appMode = getAppMode()) {
  const next = THEME_MODES.includes(mode) ? mode : DEFAULT_MODE
  write(scoped(MODE_KEY, appMode), next)
  applyMode(next)
  return next
}

/** The stored custom-theme tokens for an app mode, already sanitized. */
export function getStoredTokens(appMode = getAppMode()) {
  try {
    return sanitizeTokens(JSON.parse(read(scoped(TOKENS_KEY, appMode), '') || '{}'))
  } catch {
    return {}
  }
}

/**
 * Apply a custom theme's tokens by setting the palette variables directly.
 *
 * Uses `setProperty` rather than building a CSS string, so a value can never be
 * parsed as anything but a single declaration.
 */
export function applyTokens(tokens) {
  const safe = sanitizeTokens(tokens)
  const root = document.documentElement
  for (const name of THEME_TOKENS) {
    if (safe[name]) root.style.setProperty(`--p-${name}`, safe[name])
    else root.style.removeProperty(`--p-${name}`)
  }
  return safe
}

/** Persist and apply a custom theme (pass null/{} to revert to the built-ins). */
export function setThemeTokens(tokens, appMode = getAppMode()) {
  const safe = sanitizeTokens(tokens)
  write(scoped(TOKENS_KEY, appMode), Object.keys(safe).length ? JSON.stringify(safe) : null)
  applyTokens(safe)
  return safe
}

/**
 * Keep only the light/dark variants that hold usable colours.
 *
 * A theme may ship both palettes so one entry covers System mode; a
 * single-mode theme has one. An empty variant is dropped rather than kept,
 * since it would render as "theme applied, nothing changed".
 */
export function sanitizeVariants(variants) {
  if (!variants || typeof variants !== 'object') return {}
  const safe = {}
  for (const mode of ['light', 'dark']) {
    const tokens = sanitizeTokens(variants[mode])
    if (Object.keys(tokens).length) safe[mode] = tokens
  }
  return safe
}

/**
 * The token set to apply for a resolved colour mode.
 *
 * Falls back to whichever variant the theme does ship, so a light-only theme
 * stays visible in dark mode rather than silently switching itself off.
 */
export function variantFor(variants, mode) {
  const safe = sanitizeVariants(variants)
  if (safe[mode]) return safe[mode]
  const [first] = Object.values(safe)
  return first || {}
}

/** The stored variants for an app mode. */
export function getStoredVariants(appMode = getAppMode()) {
  try {
    return sanitizeVariants(JSON.parse(read(scoped(VARIANTS_KEY, appMode), '') || '{}'))
  } catch {
    return {}
  }
}

/**
 * Persist a theme's variants and apply the one matching the current colour
 * mode. Pass null/{} to revert to the built-in palette.
 */
export function setThemeVariants(variants, appMode = getAppMode()) {
  const safe = sanitizeVariants(variants)
  write(scoped(VARIANTS_KEY, appMode), Object.keys(safe).length ? JSON.stringify(safe) : null)
  applyTokens(variantFor(safe, resolveMode(getThemeMode(appMode))))
  return safe
}

/**
 * Apply the stored app mode, colour mode, and tokens, and keep `system` mode in
 * step with the OS. Returns an unsubscribe function.
 */
export function initTheme() {
  const appMode = getAppMode()
  applyAppMode(appMode)

  const mode = getThemeMode(appMode)
  applyMode(mode)
  applyTokens(variantFor(getStoredVariants(appMode), resolveMode(mode)))

  let media
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)')
  } catch {
    return () => {}
  }
  const onChange = () => {
    // The OS flipped. In `system` mode that changes both the built-in palette
    // and which variant of an installed theme applies, so re-apply both.
    if (getThemeMode() !== 'system') return
    const active = getAppMode()
    applyMode('system')
    applyTokens(variantFor(getStoredVariants(active), resolveMode('system')))
  }
  media.addEventListener?.('change', onChange)
  return () => media.removeEventListener?.('change', onChange)
}
