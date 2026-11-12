// Inline ||GM secrets|| for the wiki renderer.
//
// An inline secret can't be carried as a markdown link (the old approach): a
// link may not contain another link, so a [[wiki link]] inside the secret broke
// and leaked its brackets. Instead WikiMarkdown swaps the secret's pipes for
// SECRET_MARK (which also keeps them from splitting a GFM table cell) and leaves
// the inner markdown alone, so bold, links and embeds inside parse normally.
// This rehype plugin then finds the marker pairs in the rendered tree and wraps
// everything between them in a <mark>, which WikiMarkdown renders as the tinted
// span. Markdown never produces a <mark> itself (raw HTML isn't enabled).
//
// The marker is a Private Use character rather than the pipes themselves: a
// player's pipes are stored escaped (`\|\|`) and render as the same `||` text,
// so pairing on `||` would tint them, or pair one with a GM secret's marker.

import type { Element, ElementContent, Root, RootContent } from 'hast'

// Not the fence placeholders' U+E000/U+E001 (wikiFences.ts).
export const SECRET_MARK = '\uE002'
const PIPES = '||'

// Elements whose text is literal; a `||` in code is not a secret.
const LITERAL_TAGS = new Set<string>(['code', 'pre'])

// Put the pipes back where a marker can't be wrapped: in an element's
// attributes (an image's alt text), and anywhere inside code.
function unmarkProperties(el: Element): void {
  for (const [key, value] of Object.entries(el.properties)) {
    if (typeof value === 'string') el.properties[key] = value.replaceAll(SECRET_MARK, PIPES)
  }
}

function unmarkAll(node: ElementContent): void {
  if (node.type === 'text') node.value = node.value.replaceAll(SECRET_MARK, PIPES)
  if (node.type !== 'element') return
  unmarkProperties(node)
  node.children.forEach(unmarkAll)
}

function wrapSecrets(node: Root | RootContent): void {
  if (node.type === 'element') {
    if (LITERAL_TAGS.has(node.tagName)) {
      unmarkAll(node)
      return
    }
    unmarkProperties(node)
  }
  // Only roots and elements have children.
  const parent = node as Root | Element
  if (!parent.children) return
  parent.children.forEach(wrapSecrets)

  // Split text children on the marker so each one becomes its own token.
  const tokens: (RootContent | null)[] = []
  for (const child of parent.children) {
    if (child.type === 'text' && child.value.includes(SECRET_MARK)) {
      child.value.split(SECRET_MARK).forEach((part, i) => {
        if (i > 0) tokens.push(null)
        if (part) tokens.push({ type: 'text', value: part })
      })
    } else {
      tokens.push(child)
    }
  }
  if (!tokens.includes(null)) return

  // Pair markers left to right among siblings. A secret that opens and closes
  // at different nesting depths (`**a ||b** c||`) has no single wrapper, so its
  // markers stay as literal text rather than producing broken markup.
  const out: (RootContent | null)[] = []
  let open = -1
  for (const token of tokens) {
    if (token !== null) {
      out.push(token)
    } else if (open === -1) {
      open = out.length
      out.push(null)
    } else {
      const inner = out.splice(open)
      inner.shift()
      out.push({
        type: 'element',
        tagName: 'mark',
        properties: {},
        children: inner as ElementContent[],
      })
      open = -1
    }
  }
  parent.children = out.map((n) =>
    n === null ? { type: 'text', value: PIPES } : n
  ) as ElementContent[]
}

export function rehypeInlineSecrets() {
  return (tree: Root) => wrapSecrets(tree)
}

// True when the match at [start, end) is the only thing on its line(s), e.g. a
// whole paragraph of GM notes. Such a secret renders as a block, not an inline
// span that wraps line after line.
export function standsAlone(src: string, start: number, end: number): boolean {
  const lineStart = src.lastIndexOf('\n', start - 1) + 1
  const nextNewline = src.indexOf('\n', end)
  const lineEnd = nextNewline === -1 ? src.length : nextNewline
  return !src.slice(lineStart, start).trim() && !src.slice(end, lineEnd).trim()
}
