import { useState } from 'react'

/**
 * Image wrapper that defaults to lazy loading and async decoding so dense
 * grids/lists (library covers, favorites, campaign resources, …) only fetch
 * images as they scroll into view — see issue #220.
 *
 * Pass `eager` for images that should load immediately (reader pages, an
 * above-the-fold hero, a persistently-visible logo), which sets
 * loading="eager" and lets the browser decode synchronously.
 *
 * Pass `placeholder` to hold the image's space while it loads: a tinted block
 * sits behind the image and fades out once it arrives, so a grid of covers
 * doesn't collapse to nothing and shove the surrounding UI around as thumbnails
 * stream in. This needs a known size — it only applies when the caller has
 * given both a width and a height (via `width`/`height` props or `style`), and
 * is otherwise ignored, since a placeholder of unknown size can't reserve
 * anything and would only add a wrapper element.
 *
 * All other props (src, alt, style, className, …) pass straight through to the
 * underlying <img>. Callers may still override `loading`/`decoding` explicitly.
 */
export default function LazyImg({
  eager = false,
  loading,
  decoding,
  placeholder = false,
  style,
  onLoad,
  onError,
  ...props
}) {
  const [settled, setSettled] = useState(false)

  const img = (
    <img
      loading={loading ?? (eager ? 'eager' : 'lazy')}
      decoding={decoding ?? (eager ? 'auto' : 'async')}
      style={style}
      onLoad={(e) => {
        setSettled(true)
        onLoad?.(e)
      }}
      // A broken image must clear the placeholder too, or the tint sits there
      // forever looking like an image that never finished loading.
      onError={(e) => {
        setSettled(true)
        onError?.(e)
      }}
      {...props}
    />
  )

  // Only reserve space when the size is actually known — see the note above.
  const width = props.width ?? style?.width
  const height = props.height ?? style?.height
  if (!placeholder || width == null || height == null) return img

  return (
    <span
      style={{
        display: 'block',
        position: 'relative',
        width,
        height,
        // The tint is the reserved box: it is what occupies the space before
        // the image paints, and it stays put underneath afterwards.
        background: settled ? 'none' : 'var(--bg-deep)',
        borderRadius: 'inherit',
        overflow: 'hidden',
      }}
    >
      {img}
    </span>
  )
}
