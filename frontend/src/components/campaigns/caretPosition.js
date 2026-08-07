// Pixel position of a textarea's caret, for anchoring the [[link]] autocomplete.
//
// A textarea gives no way to ask where its caret is on screen, so we mirror it:
// copy the text up to the caret into an off-screen div styled identically, put a
// marker span at the end, and read the marker's offset. This is the standard
// approach (same idea as textarea-caret-position) kept minimal for our one use.

// Properties that affect text layout and so must be copied to the mirror.
const MIRRORED = [
  'boxSizing',
  'width',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'tabSize',
]

/**
 * Return { top, left } of the caret in `textarea`, relative to the element's own
 * top-left (scroll already subtracted), or null when the DOM isn't available.
 */
export function caretCoordinates(textarea, position) {
  if (!textarea || typeof window === 'undefined' || typeof document === 'undefined') return null
  // jsdom (and any environment without real layout) reports zeroes here; the
  // caller falls back to a fixed offset rather than showing the popup at 0,0.
  if (typeof window.getComputedStyle !== 'function') return null

  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const ms = mirror.style
  ms.position = 'absolute'
  ms.visibility = 'hidden'
  ms.whiteSpace = 'pre-wrap'
  ms.overflowWrap = 'break-word'
  for (const prop of MIRRORED) ms[prop] = style[prop]
  // The mirror grows with content; the textarea scrolls instead.
  ms.height = 'auto'
  ms.overflow = 'hidden'

  mirror.textContent = textarea.value.slice(0, position)
  const marker = document.createElement('span')
  // A non-empty marker so it has a box even at a line start.
  marker.textContent = textarea.value.slice(position) || '.'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const top = marker.offsetTop - textarea.scrollTop
  const left = marker.offsetLeft - textarea.scrollLeft
  document.body.removeChild(mirror)

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16
  // Drop the popup just below the caret's line.
  return { top: top + lineHeight, left }
}
