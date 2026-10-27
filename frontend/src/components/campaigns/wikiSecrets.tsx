// Inline ||GM secrets|| for the wiki renderer.
//
// An inline secret can't be carried as a markdown link (the old approach): a
// link may not contain another link, so a [[wiki link]] inside the secret broke
// and leaked its brackets. Instead WikiMarkdown escapes the secret's pipes
// (`\|\|`, which also keeps them from splitting a GFM table cell) and leaves
// the inner markdown alone, so bold, links and embeds inside parse normally.
// This rehype plugin then finds the `||` pairs in the rendered tree and wraps
// everything between them in a <mark>, which WikiMarkdown renders as the tinted
// span. Markdown never produces a <mark> itself (raw HTML isn't enabled).

import type { Element, ElementContent, Root, RootContent } from 'hast'

const MARK = '||'

// Elements whose text is literal; a `||` in code is not a secret.
const LITERAL_TAGS = new Set<string>(['code', 'pre'])

function wrapSecrets(node: Root | RootContent): void {
  // Only roots and elements have children; tagName is undefined on the root.
  const parent = node as Root | Element
  if (!parent.children || LITERAL_TAGS.has((node as Element).tagName)) return
  parent.children.forEach(wrapSecrets)

  // Split text children on the marker so each `||` becomes its own token.
  const tokens: (RootContent | null)[] = []
  for (const child of parent.children) {
    if (child.type === 'text' && child.value.includes(MARK)) {
      child.value.split(MARK).forEach((part, i) => {
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
    n === null ? { type: 'text', value: MARK } : n
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
