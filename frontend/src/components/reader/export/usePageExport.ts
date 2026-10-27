import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../../api'
import type { BodyOf } from '../../../api'
import { layoutFor } from './cutoutGeometry'
import type { PageBox, PageSize, PageSizes } from './cutoutGeometry'
import { formatPageSpec, pageLabel, safeStem } from './pageRanges'

let nextId = 1
const newId = () => `c${nextId++}`

export type CutoutShape = 'rect' | 'ellipse'
export type ExportFormat = 'pdf' | 'png' | 'jpeg' | 'webp'
export type ExportTab = 'pages' | 'cut'
export type ExportTool = 'rect' | 'square' | 'circle'

/** A cut-out as the viewer keeps it. */
export interface Cutout extends PageBox {
  id: string
  name: string
  shape: CutoutShape
  /** Kept square (or round) on the page while it is adjusted. */
  locked?: boolean
}

export type { PageUrlFor as PageUrl } from '../pageTypes'

/** A cut-out as it is listed: numbered in page order, with the name it downloads as. */
export interface NumberedCutout extends Cutout {
  number: number
  defaultName: string
}

/** What a new cut-out is made from; `name` defaults to empty. */
export type NewCutout = Omit<Cutout, 'id' | 'name'> & { name?: string }

/** The body of an export request. */
export type ExportBody = BodyOf<'/books/{book_id}/export', 'post'>

interface Options {
  /** `/books/{id}` or `/maps/{id}`. */
  basePath: string
  title: string
  visiblePages: number[]
  active?: boolean
}

/** Tool -> the shape and aspect lock a newly drawn cut-out takes. */
export const TOOLS: Record<ExportTool, { shape: CutoutShape; locked: boolean }> = {
  rect: { shape: 'rect', locked: false },
  square: { shape: 'rect', locked: true },
  circle: { shape: 'ellipse', locked: true },
}

/**
 * Everything the export panel and the cut-out stage share (issue #207).
 *
 * Owned by the viewer rather than the panel, so closing the panel or turning
 * the page never throws away twenty carefully placed token outlines - they are
 * kept until the viewer itself unmounts.
 *
 * `basePath` is `/books/{id}` or `/maps/{id}`; the export endpoints hang off it.
 * `title` names the files. `visiblePages` is what the viewer is showing: one
 * page, or a spread. Nothing is fetched until `active` (the panel is open), so a
 * reader that never exports never asks for a page size.
 *
 * Cut-outs are kept in page order and numbered in it, and each one's default
 * name is built exactly as the server builds it ("Title (p12) 2"), so the
 * placeholder in the list is the filename that will be downloaded.
 */
export default function usePageExport({ basePath, title, visiblePages, active = true }: Options) {
  const [tab, setTab] = useState<ExportTab>('pages')
  const [pagesSpec, setPagesSpec] = useState(() => formatPageSpec(visiblePages))
  const [pagesFormat, setPagesFormat] = useState<ExportFormat>('pdf')
  const [pagesDpi, setPagesDpi] = useState(150)
  const [joinSpreads, setJoinSpreads] = useState(visiblePages.length > 1)
  const [cutFormat, setCutFormat] = useState<ExportFormat>('png')
  const [cutDpi, setCutDpi] = useState(150)
  const [tool, setTool] = useState<ExportTool>('rect')
  const [cutouts, setCutouts] = useState<Cutout[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sizes, setSizes] = useState<PageSizes>({})
  const requestedSizes = useRef(new Set<number>())

  // Fetch each page's point size once. The stage needs them to lay pages out
  // exactly as the server will, and the panel needs them for pixel estimates.
  const ensureSizes = useCallback(
    (pages: number[]) => {
      pages.forEach((p) => {
        if (requestedSizes.current.has(p)) return
        requestedSizes.current.add(p)
        api
          .get(`${basePath}/page/${p}/size`)
          .then((s) => setSizes((prev) => ({ ...prev, [p]: s as PageSize })))
          .catch(() => requestedSizes.current.delete(p))
      })
    },
    [basePath]
  )

  const visibleKey = visiblePages.join(',')
  useEffect(() => {
    if (active) ensureSizes(visiblePages)
  }, [visibleKey, active]) // eslint-disable-line react-hooks/exhaustive-deps

  const stageLayout = useMemo(
    () => layoutFor(visiblePages, sizes),
    [visibleKey, sizes] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const addCutout = useCallback((cutout: NewCutout) => {
    const id = newId()
    setCutouts((prev) => [...prev, { name: '', ...cutout, id }])
    setActiveId(id)
    return id
  }, [])

  const addCutouts = useCallback((list: NewCutout[]) => {
    setCutouts((prev) => [...prev, ...list.map((c) => ({ name: '', ...c, id: newId() }))])
  }, [])

  const updateCutout = useCallback((id: string, patch: Partial<Cutout>) => {
    setCutouts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const removeCutout = useCallback((id: string) => {
    setCutouts((prev) => prev.filter((c) => c.id !== id))
    setActiveId((a) => (a === id ? null : a))
  }, [])

  const numbered = useMemo((): NumberedCutout[] => {
    const stem = safeStem(title)
    // Stable, so pieces on one page keep the order they were drawn or found in.
    const ordered = [...cutouts].sort(
      (a, b) => a.pages[0] - b.pages[0] || a.pages.length - b.pages.length
    )
    const perPage: Record<string, number> = {}
    return ordered.map((c, i) => {
      const key = c.pages.join(',')
      perPage[key] = (perPage[key] || 0) + 1
      return { ...c, number: i + 1, defaultName: `${stem} (${pageLabel(c.pages)}) ${perPage[key]}` }
    })
  }, [cutouts, title])

  const clearCutouts = useCallback(() => {
    setCutouts([])
    setActiveId(null)
  }, [])

  // Cut-out pages feed the pixel estimates in the list.
  const cutoutPagesKey = [...new Set(cutouts.flatMap((c) => c.pages))].join(',')
  useEffect(() => {
    if (active && cutoutPagesKey) ensureSizes(cutoutPagesKey.split(',').map(Number))
  }, [active, cutoutPagesKey, ensureSizes])

  /**
   * Point the page list at what is on screen. Called each time the panel opens,
   * so "Pages" starts from where the reader is, not where it was last time.
   */
  const openAt = useCallback((pages: number[]) => {
    setPagesSpec(formatPageSpec(pages))
    setJoinSpreads(pages.length > 1)
  }, [])

  /** The request body for the current tab. */
  const requestBody = useCallback(
    (spreadOffset: number): ExportBody =>
      tab === 'pages'
        ? {
            kind: 'pages',
            pages: pagesSpec,
            format: pagesFormat,
            dpi: pagesDpi,
            join_spreads: pagesFormat !== 'pdf' && joinSpreads,
            // The reader's spread pairing is always 0 or 1.
            spread_offset: spreadOffset as 0 | 1,
          }
        : {
            kind: 'regions',
            format: cutFormat,
            dpi: cutDpi,
            regions: numbered.map(({ pages, shape, x, y, w, h, name }) => ({
              pages,
              shape,
              x,
              y,
              w,
              h,
              name: name.trim(),
            })),
          },
    [tab, pagesSpec, pagesFormat, pagesDpi, joinSpreads, cutFormat, cutDpi, numbered]
  )

  return {
    basePath,
    tab,
    setTab,
    pagesSpec,
    setPagesSpec,
    pagesFormat,
    setPagesFormat,
    pagesDpi,
    setPagesDpi,
    joinSpreads,
    setJoinSpreads,
    cutFormat,
    setCutFormat,
    cutDpi,
    setCutDpi,
    tool,
    setTool,
    cutouts: numbered,
    activeId,
    setActiveId,
    addCutout,
    addCutouts,
    updateCutout,
    removeCutout,
    clearCutouts,
    sizes,
    ensureSizes,
    stageLayout,
    visiblePages,
    openAt,
    requestBody,
  }
}

/** Everything usePageExport hands the export panel and the cut-out stage. */
export type PageExporter = ReturnType<typeof usePageExport>
