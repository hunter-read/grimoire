import { useEffect, useState } from 'react'
import type { LayoutNode, SheetDocument } from './LayoutRenderer'

/**
 * A sheet may ship a second, phone-specific layout: `mobile_layout_html` with
 * its own `mobile_styles`, which the server parses and scopes into
 * `mobile_layout_ast` / `mobile_styles_css` exactly as it does the desktop
 * pair. On a phone-sized screen that pair replaces the desktop one; anywhere
 * else, or for a sheet without one, nothing changes.
 */
export const PHONE_SHEET_QUERY = '(max-width: 640px)'

function phoneMatches(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_SHEET_QUERY).matches
}

/** Whether the viewport is phone-sized, kept current as it changes (a rotation, say). */
export function usePhoneViewport(): boolean {
  const [phone, setPhone] = useState(phoneMatches)

  useEffect(() => {
    const media = window.matchMedia?.(PHONE_SHEET_QUERY)
    if (!media) return undefined
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches)
    // Sync in case the viewport changed between the first render and now.
    setPhone(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return phone
}

/** Whether a schema document ships a phone layout worth drawing. */
export function hasPhoneLayout(document: SheetDocument | null | undefined): boolean {
  const ast = document?.mobile_layout_ast
  return Array.isArray(ast) && ast.length > 0
}

/**
 * The document to draw with: on a phone, the phone layout and its stylesheet
 * stand in for the desktop ones. Only one stylesheet is ever handed on, so the
 * desktop and phone CSS never apply together - a phone layout without its own
 * stylesheet gets none rather than the desktop one, which was written for
 * different markup.
 */
export function forViewport<T extends SheetDocument | null | undefined>(
  document: T,
  phone: boolean
): T {
  if (!phone || !document || !hasPhoneLayout(document)) return document
  return {
    ...document,
    layout_ast: document.mobile_layout_ast as LayoutNode[],
    styles_css: typeof document.mobile_styles_css === 'string' ? document.mobile_styles_css : '',
  }
}
