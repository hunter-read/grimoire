// The server HTML-escapes snippets for dangerouslySetInnerHTML (Python's
// html.escape emits exactly these five entities). React escapes text nodes
// itself, so decode them back before rendering or they show up literally.
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
}

// A single pass, so an escaped entity such as `&amp;lt;` decodes to `&lt;`
// rather than `<`.
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity])
}

interface SnippetTextProps {
  snippet?: string | null
}

/**
 * SQLite FTS5 snippet() output contains only <mark>…</mark> tags around matched
 * terms. Render those tags as real <mark> elements without using innerHTML so that
 * any < > & characters in the PDF text cannot be interpreted as HTML.
 */
export default function SnippetText({ snippet }: SnippetTextProps) {
  if (!snippet) return null
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g)
  return parts.map((part, i) => {
    const m = part.match(/^<mark>(.*)<\/mark>$/)
    return m ? <mark key={i}>{decodeEntities(m[1])}</mark> : decodeEntities(part)
  })
}
