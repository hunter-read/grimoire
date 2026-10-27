import { LuColumns2 } from 'react-icons/lu'
import type { CSSProperties } from 'react'
import { PAGE_WIDTH } from '../pageRender'
import type { PageSizes } from './cutoutGeometry'
import type { Cutout, PageUrl } from './usePageExport'

const THUMB = 44

const thumbFrame: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
}

/**
 * The picture a cut-out will produce, cropped out of the reader's own page
 * render with CSS rather than fetched: the list updates as a box is dragged,
 * and twenty tokens must not mean twenty requests. Requested at the stage's
 * own width, so it is the image the browser already holds.
 */
export default function CutoutThumb({
  cutout,
  sizes,
  pageUrl,
}: {
  cutout: Cutout
  sizes: PageSizes
  pageUrl: PageUrl
}) {
  const page = sizes[cutout.pages[0]]
  if (cutout.pages.length > 1 || !page) {
    return (
      <span style={{ ...thumbFrame, width: THUMB, height: THUMB }} aria-hidden="true">
        <LuColumns2 size={16} color="var(--text-muted)" />
      </span>
    )
  }
  const aspect = (cutout.w * page.width) / (cutout.h * page.height)
  const width = aspect >= 1 ? THUMB : Math.max(8, THUMB * aspect)
  const height = aspect >= 1 ? Math.max(8, THUMB / aspect) : THUMB
  const pos = (v: number, size: number) => (size >= 1 ? 0 : (v / (1 - size)) * 100)
  return (
    <span style={{ ...thumbFrame, width: THUMB, height: THUMB }} aria-hidden="true">
      <span
        style={{
          width,
          height,
          borderRadius: cutout.shape === 'ellipse' ? '50%' : 2,
          backgroundImage: `url("${pageUrl(cutout.pages[0], PAGE_WIDTH)}")`,
          backgroundSize: `${100 / cutout.w}% ${100 / cutout.h}%`,
          backgroundPosition: `${pos(cutout.x, cutout.w)}% ${pos(cutout.y, cutout.h)}%`,
          backgroundColor: 'var(--on-media)',
        }}
      />
    </span>
  )
}
