import { useEffect, useRef, type ReactNode } from 'react'
import useIsMobile from '../../hooks/useIsMobile'

export interface ReaderSidebarShellProps {
  width?: number
  overflowHidden?: boolean
  /** On a phone, a sheet under the page rather than a full-screen panel. */
  sheet?: boolean
  /** The panel's name, announced as a landmark ("Contents, complementary"). */
  label?: string
  children?: ReactNode
}

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
 *
 * Opening a panel moves focus into it (unless a field inside already took it),
 * so a keyboard or screen reader user is taken to what they opened rather than
 * left on the toolbar; closing it hands focus back to where it came from.
 */
export default function ReaderSidebarShell({
  width = 280,
  overflowHidden = false,
  sheet = false,
  label,
  children,
}: ReaderSidebarShellProps) {
  const isMobilePhone = useIsMobile(640)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const panel = ref.current
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
    return () => {
      // The panel's own close button went with it, leaving focus nowhere.
      const lost = !document.activeElement || document.activeElement === document.body
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  const landmark = {
    ref,
    'aria-label': label,
    tabIndex: -1,
    className: 'focus-target',
  }

  if (isMobilePhone && sheet) {
    return (
      <aside
        {...landmark}
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
      </aside>
    )
  }

  return (
    <aside
      {...landmark}
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
    </aside>
  )
}
