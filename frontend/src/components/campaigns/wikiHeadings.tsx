import { normalizeHeading } from './wikiLinkTarget'

// Heading anchors for [[Page Title:#Heading]] links (issue #279).
//
// We don't use rehype-slug: its slugs strip punctuation, so "# # of coin" and
// "# of coin" would collide, and the anchor would stop matching the literal
// heading text the link syntax uses. Keying on the normalized heading text keeps
// the anchor and the link spelled the same way.

/** DOM id for a heading anchor, derived from its normalized text. */
export function headingDomId(text) {
  return `wiki-h-${encodeURIComponent(normalizeHeading(text))}`
}

/** Flatten a react-markdown heading's children to plain text for anchor keying. */
export function childrenToText(children) {
  if (children == null || typeof children === 'boolean') return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (children.props) return childrenToText(children.props.children)
  return ''
}

/**
 * Build react-markdown renderers for h1..h6 that attach the anchor id.
 *
 * Only the first heading with a given text keeps the id — duplicates would
 * otherwise yield several elements sharing an id and `getElementById` would pick
 * an arbitrary one. Which heading a link *prefers* (H1 over H2, then document
 * order) is decided when the link is resolved, so first-wins here is enough.
 *
 * The `seen` set is per-call, so callers rebuild this per render pass to keep the
 * first-wins bookkeeping from leaking across renders.
 */
export function buildHeadingComponents() {
  const seen = new Set()
  const make = (Tag) =>
    function WikiHeading({ children, ...props }) {
      const id = headingDomId(childrenToText(children))
      const first = !seen.has(id)
      if (first) seen.add(id)
      return (
        <Tag id={first ? id : undefined} {...props}>
          {children}
        </Tag>
      )
    }
  return {
    h1: make('h1'),
    h2: make('h2'),
    h3: make('h3'),
    h4: make('h4'),
    h5: make('h5'),
    h6: make('h6'),
  }
}
