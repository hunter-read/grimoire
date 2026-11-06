import { useEffect, useState } from 'react'

const read = (): string | null =>
  typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme')

/**
 * The resolved colour mode (`light` / `dark`) on `<html data-theme>`, kept live.
 *
 * utils/theme.tsx stamps the attribute wherever the mode changes - the settings
 * toggle, or the OS flipping while the mode is `system` - so watching the
 * attribute follows every path without each one having to announce itself.
 * For code that can't follow the palette through CSS variables, such as a
 * rendered Mermaid diagram.
 */
export default function useColorMode(): string | null {
  const [mode, setMode] = useState(read)

  useEffect(() => {
    setMode(read())
    if (typeof MutationObserver === 'undefined') return undefined
    const observer = new MutationObserver(() => setMode(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return mode
}
