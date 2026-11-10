import { memo, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import useColorMode from '../../hooks/useColorMode'
import useInViewOnce from '../../hooks/useInViewOnce'
import { mermaidTheme, renderMermaid } from '../../lib/mermaid'
import { CODE_BLOCK_STYLE, mermaidSource } from './wikiFences'

type RenderState =
  { status: 'pending' } | { status: 'ok'; svg: string } | { status: 'error'; message: string }

// Each render needs an id no other SVG on the page has, a re-render of the same
// diagram included: Mermaid looks its working element up by id.
let renderCount = 0

/**
 * A ```mermaid fence in a wiki page, rendered as a diagram.
 *
 * Renders once the block nears the viewport, so a long page of diagrams doesn't
 * load Mermaid or lay them all out up front, and again when the light/dark mode
 * changes. Until it has rendered - and for good if the diagram is invalid - the
 * source shows in the normal code style, so the block is never blank.
 *
 * Memoised on `source`: WikiMarkdown rebuilds its tree on every keystroke in the
 * editor preview, and only an edit to this diagram should re-render it.
 */
function MermaidDiagram({ source }: { source: string }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(ref)
  const theme = mermaidTheme(useColorMode())
  const baseId = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [state, setState] = useState<RenderState>({ status: 'pending' })

  useEffect(() => {
    if (!inView) return undefined
    let cancelled = false
    renderCount += 1
    renderMermaid(`${baseId}-${renderCount}`, mermaidSource(source), theme).then(
      (svg) => {
        if (!cancelled) setState({ status: 'ok', svg })
      },
      (err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ status: 'error', message })
      }
    )
    return () => {
      cancelled = true
    }
  }, [inView, source, theme, baseId])

  if (state.status === 'ok') {
    return (
      <div
        ref={ref}
        className="wiki-mermaid"
        style={diagramStyle}
        // Mermaid's own output under securityLevel 'strict', with labels as
        // SVG text and links tidied (see renderMermaid). The source never
        // reaches the DOM as HTML.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }

  return (
    <div ref={ref} aria-busy={state.status === 'pending' || undefined}>
      {state.status === 'error' && (
        <div role="note" style={errorNoteStyle}>
          <LuTriangleAlert size={14} aria-hidden="true" />
          <span title={state.message}>{t('wiki.diagramError')}</span>
        </div>
      )}
      <pre style={CODE_BLOCK_STYLE}>
        <code className="language-mermaid">{source}</code>
      </pre>
      {state.status === 'error' && (
        <details style={{ fontSize: 13, color: 'var(--text-dim)', margin: '-4px 0 8px' }}>
          <summary style={{ cursor: 'pointer' }}>{t('wiki.diagramErrorDetails')}</summary>
          <pre style={{ ...CODE_BLOCK_STYLE, whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {state.message}
          </pre>
        </details>
      )}
    </div>
  )
}

export default memo(MermaidDiagram)

const diagramStyle: CSSProperties = {
  margin: '8px 0',
  overflowX: 'auto',
  textAlign: 'center',
}

const errorNoteStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: 'var(--danger)',
  margin: '8px 0 -4px',
}
