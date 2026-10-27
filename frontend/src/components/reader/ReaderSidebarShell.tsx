import useIsMobile from '../../hooks/useIsMobile'

/**
 * The frame every reader sidebar sits in — contents, bookmarks, search and
 * details all shared the same panel chrome, so it lives here once.
 *
 * On a phone the panel takes the whole viewport rather than a 280px column
 * beside the page. At that width a column leaves neither the panel nor the
 * page usable, and the page behind it is not what you are looking at while
 * picking a chapter or a bookmark.
 *
 * `width` is the desktop width; details asks for a wider one than the rest.
 *
 * `sheet` is the exception to the full-viewport rule: a panel that works *on*
 * the page (drawing cut-outs) sits under it as a bottom sheet instead, since
 * hiding the page would leave nothing to draw on.
 */
export default function ReaderSidebarShell({
  width = 280,
  overflowHidden = false,
  sheet = false,
  children,
}) {
  const isMobilePhone = useIsMobile(640)

  if (isMobilePhone && sheet) {
    return (
      <div
        data-testid="reader-sidebar"
        style={{
          width: '100%',
          flex: '0 0 auto',
          maxHeight: '48%',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 -6px 18px var(--shadow)',
          ...(overflowHidden ? { overflow: 'hidden' } : null),
        }}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      data-testid="reader-sidebar"
      style={{
        // flexBasis rather than a bare width: as a flex child the panel would
        // otherwise be shrunk back down by the page content beside it.
        width: isMobilePhone ? '100%' : width,
        flex: isMobilePhone ? '1 1 100%' : `0 0 ${width}px`,
        borderLeft: isMobilePhone ? 'none' : '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        ...(overflowHidden ? { overflow: 'hidden' } : null),
      }}
    >
      {children}
    </div>
  )
}
