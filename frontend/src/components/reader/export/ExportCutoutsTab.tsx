import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircle, LuRectangleHorizontal, LuSparkles, LuSquare } from 'react-icons/lu'
import api from '../../../api'
import type { Schema } from '../../../api'
import Spinner from '../../Spinner'
import CutoutListRow from './CutoutListRow'
import ExportOptions from './ExportOptions'
import ExportSegmented from './ExportSegmented'
import { overlap, pixelSize } from './cutoutGeometry'
import type { Box, PageSize } from './cutoutGeometry'
import type {
  ExportFormat,
  ExportTool,
  NumberedCutout,
  PageExporter,
  PageUrl,
} from './usePageExport'
import type { SegmentOption } from './ExportSegmented'
import { buttonStyle, errorStyle, hintStyle, labelStyle, sectionStyle } from './exportStyles'

const FORMATS: ExportFormat[] = ['png', 'webp', 'jpeg', 'pdf']

// A detected box this close to an existing cut-out on the same page is the
// same piece, found again; it is not added twice.
const SAME_PIECE = 0.7

// Width/height of a detected rectangle (in points) this close to 1 is a
// square token, so it is kept square while being adjusted.
const isSquarish = (shape: Box, size: PageSize | undefined) => {
  if (!size) return false
  const r = (shape.w * size.width) / (shape.h * size.height)
  return r > 0.93 && r < 1.07
}

/**
 * Cut-outs: the shape to draw with, a way to find the pieces automatically, and
 * the list of what will be exported.
 *
 * Drawing happens on the page itself (CutoutStage); this panel is where each
 * piece is named, checked and removed. Rows are grouped by page, because a
 * token sheet is worked through a page at a time.
 */
export default function ExportCutoutsTab({
  exporter,
  pageUrl,
  onShowPage,
}: {
  exporter: PageExporter
  pageUrl: PageUrl
  onShowPage: (page: number) => void
}) {
  const { t } = useTranslation()
  const [finding, setFinding] = useState(false)
  const [note, setNote] = useState<{ tone: 'muted' | 'ok' | 'error'; text: string } | null>(null)
  const { cutouts, visiblePages, sizes } = exporter

  const findShapes = async () => {
    setFinding(true)
    setNote(null)
    try {
      const results = await Promise.all(
        visiblePages.map((p) =>
          api
            .get(`${exporter.basePath}/page/${p}/shapes`)
            .then((r) =>
              (r as Schema<'DetectShapesResponse'>).shapes.map((s) => ({ ...s, pages: [p] }))
            )
        )
      )
      const found = results.flat()
      const fresh = found.filter(
        (f) =>
          !cutouts.some(
            (c) => c.pages.join(',') === f.pages.join(',') && overlap(c, f) > SAME_PIECE
          )
      )
      exporter.addCutouts(
        fresh.map((f) => ({
          ...f,
          locked: f.shape === 'ellipse' || isSquarish(f, sizes[f.pages[0]]),
        }))
      )
      setNote(
        !found.length
          ? { tone: 'muted', text: t('pageExport.foundNone') }
          : !fresh.length
            ? { tone: 'muted', text: t('pageExport.foundAlready') }
            : { tone: 'ok', text: t('pageExport.foundSome', { count: fresh.length }) }
      )
    } catch (e) {
      setNote({ tone: 'error', text: (e as Error).message || t('pageExport.findFailed') })
    } finally {
      setFinding(false)
    }
  }

  const hasRound = cutouts.some((c) => c.shape === 'ellipse')
  const active = cutouts.find((c) => c.id === exporter.activeId)
  const sample = active || cutouts[0]

  // Group rows by the page (or spread) they belong to, in page order.
  const groups: { key: string; pages: number[]; items: NumberedCutout[] }[] = []
  for (const c of cutouts) {
    const key = c.pages.join(',')
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(c)
    else groups.push({ key, pages: c.pages, items: [c] })
  }

  const tools: SegmentOption<ExportTool>[] = [
    { value: 'rect', label: t('pageExport.tool.rect'), Icon: LuRectangleHorizontal },
    { value: 'square', label: t('pageExport.tool.square'), Icon: LuSquare },
    { value: 'circle', label: t('pageExport.tool.circle'), Icon: LuCircle },
  ]

  return (
    <>
      <div style={sectionStyle}>
        <span style={labelStyle}>{t('pageExport.toolLabel')}</span>
        <ExportSegmented
          ariaLabel={t('pageExport.toolLabel')}
          value={exporter.tool}
          onChange={exporter.setTool}
          options={tools}
        />
        <p style={hintStyle}>{t('pageExport.drawHint')}</p>
      </div>

      <div style={sectionStyle}>
        <button
          type="button"
          onClick={findShapes}
          disabled={finding}
          style={{ ...buttonStyle(false, finding), width: '100%' }}
        >
          {finding ? <Spinner size={13} /> : <LuSparkles size={14} aria-hidden="true" />}
          {finding
            ? t('pageExport.finding')
            : visiblePages.length > 1
              ? t('pageExport.findShapesSpread')
              : t('pageExport.findShapes')}
        </button>
        <p
          aria-live="polite"
          style={
            note?.tone === 'error'
              ? errorStyle
              : note?.tone === 'ok'
                ? { ...hintStyle, color: 'var(--success)' }
                : hintStyle
          }
        >
          {note?.text || t('pageExport.findHint')}
        </p>
      </div>

      <ExportOptions
        formats={FORMATS}
        format={exporter.cutFormat}
        onFormatChange={exporter.setCutFormat}
        dpi={exporter.cutDpi}
        onDpiChange={exporter.setCutDpi}
        pixelSize={sample ? pixelSize(sample, sizes, exporter.cutDpi) : null}
        pixelSizeKey={sample ? 'pageExport.sizeForCutout' : undefined}
        pixelSizeParams={sample ? { n: sample.number } : undefined}
        disabledFormats={hasRound ? { pdf: t('pageExport.circlesNoPdf') } : {}}
      />

      <div style={{ ...sectionStyle, gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={labelStyle}>{t('pageExport.listTitle', { count: cutouts.length })}</span>
          {cutouts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                exporter.clearCutouts()
                setNote(null)
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {t('pageExport.clearAll')}
            </button>
          )}
        </div>

        {cutouts.length === 0 ? (
          <div
            style={{
              border: '1px dashed var(--border)',
              borderRadius: 8,
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
              {t('pageExport.emptyTitle')}
            </span>
            <span style={hintStyle}>{t('pageExport.emptyBody')}</span>
          </div>
        ) : (
          groups.map((g) => (
            <div
              key={`${g.key}-${g.items[0].id}`}
              style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <button
                type="button"
                onClick={() => onShowPage(g.pages[0])}
                title={t('pageExport.showPage')}
                style={{
                  alignSelf: 'flex-start',
                  background: 'none',
                  border: 'none',
                  padding: '4px 0',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: visiblePages.includes(g.pages[0]) ? 'var(--gold)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {g.pages.length > 1
                  ? t('pageExport.spreadGroup', { first: g.pages[0], last: g.pages[1] })
                  : t('pageExport.pageGroup', { page: g.pages[0] })}
              </button>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {g.items.map((c) => (
                  <CutoutListRow
                    key={c.id}
                    cutout={c}
                    number={c.number}
                    defaultName={c.defaultName}
                    active={c.id === exporter.activeId}
                    sizes={sizes}
                    dpi={exporter.cutDpi}
                    pageUrl={pageUrl}
                    onSelect={() => {
                      exporter.setActiveId(c.id)
                      if (!c.pages.every((p) => visiblePages.includes(p))) onShowPage(c.pages[0])
                    }}
                    onRename={(name) => exporter.updateCutout(c.id, { name })}
                    onRemove={() => exporter.removeCutout(c.id)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </>
  )
}
