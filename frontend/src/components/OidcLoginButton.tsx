import { useState } from 'react'

// Matches the server's validation (backend/services/oidc_button.py). Anything
// else - e.g. a half-typed value in the settings preview - falls back to the
// theme default rather than reaching the style attribute.
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const MAX_RADIUS = 40

const validColor = (c) => (typeof c === 'string' && HEX_COLOR_RE.test(c.trim()) ? c.trim() : null)

const validRadius = (r) => {
  if (r === null || r === undefined || r === '') return null
  const n = Number(r)
  return Number.isInteger(n) && n >= 0 && n <= MAX_RADIUS ? n : null
}

/**
 * The OIDC sign-in button, styled by the admin (issue #377).
 *
 * Grimoire ships no provider-specific buttons; the admin supplies the colors,
 * corner radius and icon that reproduce their provider's standard button. Unset
 * values fall back to the theme's look. Shared by the login page and the
 * settings preview so the two can never drift apart.
 */
export default function OidcLoginButton({
  label,
  onClick,
  bgColor,
  textColor,
  borderColor,
  radius,
  iconUrl,
}) {
  // Remember which URL failed, so a replacement icon gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState(null)

  const bg = validColor(bgColor)
  const fg = validColor(textColor)
  const border = validColor(borderColor)
  const r = validRadius(radius)
  const style = {
    ...baseStyle,
    ...(bg && { background: bg }),
    ...(fg && { color: fg }),
    ...(border && { borderColor: border }),
    ...(r !== null && { borderRadius: r }),
  }

  return (
    <button type="button" onClick={onClick} style={style} aria-label={label}>
      {iconUrl && iconUrl !== failedUrl && (
        <img
          src={iconUrl}
          alt=""
          aria-hidden="true"
          width={20}
          height={20}
          onError={() => setFailedUrl(iconUrl)}
          style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }}
        />
      )}
      <span>{label}</span>
    </button>
  )
}

const baseStyle = {
  width: '100%',
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--bg-card)',
  color: 'var(--text)',
  fontSize: 15,
  fontWeight: 500,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  // Longhands, so the admin's borderColor never conflicts with a shorthand.
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}
