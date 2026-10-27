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

const MARK = '||'

// Elements whose text is literal; a `||` in code is not a secret.
const LITERAL_TAGS = new Set(['code', 'pre'])

function wrapSecrets(node) {
  if (!node.children || LITERAL_TAGS.has(node.tagName)) return
  node.children.forEach(wrapSecrets)

  // Split text children on the marker so each `||` becomes its own token.
  const tokens = []
  for (const child of node.children) {
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
  const out = []
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
      out.push({ type: 'element', tagName: 'mark', properties: {}, children: inner })
      open = -1
    }
  }
  node.children = out.map((n) => (n === null ? { type: 'text', value: MARK } : n))
}

export function rehypeInlineSecrets() {
  return (tree) => wrapSecrets(tree)
}

// True when the match at [start, end) is the only thing on its line(s), e.g. a
// whole paragraph of GM notes. Such a secret renders as a block, not an inline
// span that wraps line after line.
export function standsAlone(src, start, end) {
  const lineStart = src.lastIndexOf('\n', start - 1) + 1
  const nextNewline = src.indexOf('\n', end)
  const lineEnd = nextNewline === -1 ? src.length : nextNewline
  return !src.slice(lineStart, start).trim() && !src.slice(end, lineEnd).trim()
}
