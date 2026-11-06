import type { CSSProperties } from 'react'

// Fenced code blocks in a wiki body.
//
// WikiMarkdown rewrites `[[links]]` and splits out `||GM secrets||` with plain
// string passes before the markdown parser runs. Inside a fence both are wrong:
// code is literal, and Mermaid's own syntax uses both shapes - `A[[Subroutine]]`
// is a node shape and `A ||--o{ B` an ER cardinality. A multi-line secret
// inside a fence also used to tear the fence in two. So the fences are masked
// out first, the passes run over the rest, and the fences are put back as they
// were.
//
// FENCE_RE mirrors `FENCE_RE` in backend/text/wikilinks.py, which keeps the same
// fences out of the link graph; the two must agree on what a fence is.

// An opening run of 3+ backticks or tildes and its info string, then everything
// up to a closing run of the same character at least as long - or the end of
// the body, as CommonMark treats an unclosed fence. Either line may start with
// list or blockquote markers (`- ```js`, `> ~~~`) and any indent: missing a
// fence in a list item would leave its indented closing line looking like an
// opener that swallows the rest of the page. A backtick fence's info string has
// no backtick, so a line that is ```inline code``` is not a fence.
const FENCE_RE =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*((`|~)\2{2,})(?:(?<=`)[^`\n]*|(?<=~)[^\n]*)(?:\n|(?![\s\S]))[\s\S]*?(?:^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*\1\2*[ \t]*$|(?![\s\S]))/gm

// Placeholders from the Private Use Area, which nothing types by accident and
// which no string pass here gives any meaning to.
const OPEN = '\uE000'
const CLOSE = '\uE001'
const TOKEN_RE = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g')

export interface MaskedFences {
  /** The body with every fence swapped for a placeholder. */
  text: string
  /** Put the fences back into any slice of `text`. */
  restore: (s: string) => string
}

export function maskFences(body: string): MaskedFences {
  const fences: string[] = []
  const text = body.replace(FENCE_RE, (fence) => {
    fences.push(fence)
    return `${OPEN}${fences.length - 1}${CLOSE}`
  })
  return {
    text,
    restore: (s) => (fences.length ? s.replace(TOKEN_RE, (_m, i) => fences[Number(i)]) : s),
  }
}

// An unescaped `||...||` pair, the shape the backend strips as a GM secret.
const SECRET_PAIR_RE = /(?<!\\)\|\|([\s\S]*?)(?<!\\)\|\|/g

/**
 * The diagram source to hand Mermaid, from a ```mermaid fence's contents.
 *
 * The backend's secret strip reaches inside fences, so a player already gets
 * the source with every `||secret||` removed. The GM gets it whole, and sees the
 * whole diagram: the markers are dropped and the text between them kept, since
 * an SVG has no way to tint the GM-only part. A player's own `||` is stored
 * escaped (`\|\|`, see escape_player_pipes) and is unescaped here, so a player's
 * ER diagram still parses.
 */
export function mermaidSource(code: string): string {
  return code.replace(SECRET_PAIR_RE, '$1').replace(/\\\|/g, '|')
}

/** The wiki's fenced-code style: a plain fence, and a diagram's fallback. */
export const CODE_BLOCK_STYLE: CSSProperties = {
  background: 'var(--bg-deep)',
  borderRadius: 8,
  padding: 12,
  overflowX: 'auto',
}
