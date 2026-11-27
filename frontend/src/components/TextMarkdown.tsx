import type { CSSProperties } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const cell: CSSProperties = {
  border: '1px solid var(--border)',
  padding: '3px 6px',
  textAlign: 'left',
  verticalAlign: 'top',
}

// Text from a stranger: a GM screen's rules from a downloaded preset, a value a
// character sheet draws. react-markdown never renders raw HTML; an image is
// shown as its description rather than fetched, and a link opens in a new tab
// without telling the site where it came from.
const COMPONENTS: Components = {
  img: ({ alt }) => <span>{alt}</span>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', margin: '6px 0' }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => <th style={{ ...cell, fontWeight: 600 }}>{children}</th>,
  td: ({ children }) => <td style={cell}>{children}</td>,
  h1: ({ children }) => <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>{children}</h3>,
  h2: ({ children }) => <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>{children}</h3>,
  h3: ({ children }) => <h4 style={{ fontSize: 13, margin: '8px 0 4px' }}>{children}</h4>,
  h4: ({ children }) => <h4 style={{ fontSize: 13, margin: '8px 0 4px' }}>{children}</h4>,
  p: ({ children }) => <p style={{ margin: '0 0 6px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 6px', paddingLeft: 18 }}>{children}</ol>,
}

/**
 * Markdown drawn as text only: lists, emphasis and tables, never raw HTML.
 * Shared by the GM screen's reference panel and a sheet's `<g-value markdown>`.
 */
export default function TextMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className} style={{ fontSize: 13, lineHeight: 1.45 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
