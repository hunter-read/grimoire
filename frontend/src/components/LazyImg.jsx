/**
 * Image wrapper that defaults to lazy loading and async decoding so dense
 * grids/lists (library covers, favorites, campaign resources, …) only fetch
 * images as they scroll into view — see issue #220.
 *
 * Pass `eager` for images that should load immediately (reader pages, an
 * above-the-fold hero, a persistently-visible logo), which sets
 * loading="eager" and lets the browser decode synchronously.
 *
 * All other props (src, alt, style, className, …) pass straight through to the
 * underlying <img>. Callers may still override `loading`/`decoding` explicitly.
 */
export default function LazyImg({ eager = false, loading, decoding, ...props }) {
  return (
    <img
      loading={loading ?? (eager ? 'eager' : 'lazy')}
      decoding={decoding ?? (eager ? 'auto' : 'async')}
      {...props}
    />
  )
}
