// Allowlist sanitizer for the custom login message HTML.
// The server already sanitizes on save, but we sanitize again here as
// defense in depth before passing the string to dangerouslySetInnerHTML.

const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  's',
  'strike',
  'del',
  'u',
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'a',
])
const ALLOWED_ATTRS = { a: new Set(['href', 'title']) }
const SAFE_URL_RE = /^(https?:|mailto:|\/|#)/i
// Tags whose contents must be dropped entirely (rather than kept as text).
const DANGEROUS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'])

export function sanitizeLoginMessage(html) {
  if (!html) return ''
  // Use the browser parser to robustly walk the tree.
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstChild
  if (!root) return ''
  walk(root)
  return root.innerHTML
}

function walk(node) {
  const children = Array.from(node.childNodes)
  for (const child of children) {
    if (child.nodeType === 1) {
      // Element
      const tag = child.tagName.toLowerCase()
      if (DANGEROUS_TAGS.has(tag)) {
        // Drop the element and all its contents entirely.
        node.removeChild(child)
        continue
      }
      if (!ALLOWED_TAGS.has(tag)) {
        // Replace with its sanitized text content
        const text = document.createTextNode(child.textContent || '')
        node.replaceChild(text, child)
        continue
      }
      // Strip disallowed attributes
      const allowed = ALLOWED_ATTRS[tag] || new Set()
      for (const attr of Array.from(child.attributes)) {
        if (!allowed.has(attr.name.toLowerCase())) {
          child.removeAttribute(attr.name)
        }
      }
      if (tag === 'a') {
        const href = child.getAttribute('href') || ''
        if (!SAFE_URL_RE.test(href)) {
          child.removeAttribute('href')
        }
        child.setAttribute('rel', 'noopener noreferrer nofollow')
        child.setAttribute('target', '_blank')
      }
      walk(child)
    } else if (child.nodeType !== 3) {
      // Drop comments and anything else that isn't a text node
      node.removeChild(child)
    }
  }
}
