/**
 * SQLite FTS5 snippet() output contains only <mark>…</mark> tags around matched
 * terms. Render those tags as real <mark> elements without using innerHTML so that
 * any < > & characters in the PDF text cannot be interpreted as HTML.
 */
export default function SnippetText({ snippet }) {
  if (!snippet) return null
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g)
  return parts.map((part, i) => {
    const m = part.match(/^<mark>(.*)<\/mark>$/)
    return m ? <mark key={i}>{m[1]}</mark> : part
  })
}
