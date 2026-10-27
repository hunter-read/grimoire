import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../../api'
import type { Schema } from '../../../api'
import ExportOptions from './ExportOptions'
import {
  chipStyle,
  errorStyle,
  hintStyle,
  inputStyle,
  labelStyle,
  sectionStyle,
} from './exportStyles'
import { findSection, formatPageSpec } from './pageRanges'
import type { PageSpecResult } from './pageRanges'
import type { ExportFormat, PageExporter } from './usePageExport'

interface Props {
  exporter: PageExporter
  parsed: PageSpecResult
  totalPages: number
  /** The table-of-contents endpoint; books only. */
  tocPath?: string | null
  currentPage: number
  isSpread?: boolean
}

interface Chip {
  key: string
  label: string
  title?: string
  spec: string
}

const FORMATS: ExportFormat[] = ['pdf', 'png', 'jpeg', 'webp']

/**
 * Whole pages: which pages, and in what form.
 *
 * The page field takes the same notation people already write ("12-15, 20"),
 * and the chips below it fill it with the likely answers - the page or spread
 * on screen, the table-of-contents section it sits in (a character sheet at the
 * back of a book is usually exactly one), or everything.
 */
export default function ExportPagesTab({
  exporter,
  parsed,
  totalPages,
  tocPath,
  currentPage,
  isSpread,
}: Props) {
  const { t } = useTranslation()
  const [section, setSection] = useState<ReturnType<typeof findSection>>(null)
  const visible = exporter.visiblePages

  // The section is looked up from the table of contents, which only books have.
  useEffect(() => {
    if (!tocPath) return undefined
    let live = true
    api
      .get(tocPath)
      .then(
        (r) =>
          live && setSection(findSection((r as Schema<'TocResponse'>).toc, currentPage, totalPages))
      )
      .catch(() => live && setSection(null))
    return () => {
      live = false
    }
  }, [tocPath, currentPage, totalPages])

  const chips = (
    [
      { key: 'page', label: t('pageExport.quickThisPage'), spec: String(currentPage) },
      isSpread && visible.length > 1
        ? { key: 'spread', label: t('pageExport.quickThisSpread'), spec: formatPageSpec(visible) }
        : null,
      section && section.end > section.start
        ? {
            key: 'section',
            label: t('pageExport.quickSection', { title: section.title }),
            title: t('pageExport.pageSpan', { start: section.start, end: section.end }),
            spec: `${section.start}-${section.end}`,
          }
        : null,
      totalPages > 1
        ? {
            key: 'all',
            label: t('pageExport.quickAll', { count: totalPages }),
            spec: `1-${totalPages}`,
          }
        : null,
    ] as (Chip | null)[]
  ).filter((c): c is Chip => Boolean(c))

  const size = exporter.sizes[visible[0]]
  const joined = exporter.joinSpreads && exporter.pagesFormat !== 'pdf'
  const pixelSize = size
    ? {
        width: Math.round(((size.width * exporter.pagesDpi) / 72) * (joined ? 2 : 1)),
        height: Math.round((size.height * exporter.pagesDpi) / 72),
      }
    : null
  const spec = exporter.pagesSpec.replace(/\s+/g, '')
  const error = parsed.error
    ? t(`pageExport.errors.${parsed.error.key}`, parsed.error.params || {})
    : null
  const canJoin = exporter.pagesFormat !== 'pdf' && (parsed.pages?.length || 0) > 1

  return (
    <>
      <div style={sectionStyle}>
        <label htmlFor="export-pages" style={labelStyle}>
          {t('pageExport.pagesLabel')}
        </label>
        <input
          id="export-pages"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={exporter.pagesSpec}
          onChange={(e) => exporter.setPagesSpec(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby="export-pages-hint"
          style={{
            ...inputStyle,
            fontVariantNumeric: 'tabular-nums',
            borderColor: error ? 'var(--danger)' : 'var(--border)',
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.title}
              aria-pressed={spec === c.spec}
              onClick={() => exporter.setPagesSpec(c.spec)}
              style={chipStyle(spec === c.spec)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p id="export-pages-hint" style={error ? errorStyle : hintStyle}>
          {error || t('pageExport.pagesHint')}
        </p>
      </div>

      <ExportOptions
        formats={FORMATS}
        format={exporter.pagesFormat}
        onFormatChange={exporter.setPagesFormat}
        dpi={exporter.pagesDpi}
        onDpiChange={exporter.setPagesDpi}
        pixelSize={pixelSize}
        pixelSizeKey={joined ? 'pageExport.sizePerSpread' : 'pageExport.sizePerPage'}
      />

      {canJoin && (
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            fontSize: 13,
            color: 'var(--text)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={exporter.joinSpreads}
            onChange={(e) => exporter.setJoinSpreads(e.target.checked)}
            style={{ marginTop: 2, accentColor: 'var(--gold)' }}
          />
          <span>
            {t('pageExport.joinSpreads')}
            <span style={{ ...hintStyle, display: 'block' }}>
              {t('pageExport.joinSpreadsHint')}
            </span>
          </span>
        </label>
      )}
    </>
  )
}
