import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import ThumbIndexPeek from './ThumbIndexPeek'
import scrollParent from '../../utils/scrollParent'
import {
  MAX_TAB,
  MIN_TAB,
  mergeTabs,
  sectionId,
  tabHeight,
  tabMatches,
  type IndexEntry,
  type RailTab,
} from '../../utils/thumbIndex'

// Where the rail sticks, below the list's sticky sort/filter bar.
export const RAIL_TOP = 72
// Room kept free under the rail.
const RAIL_BOTTOM = 16
// The rail's own padding and border, top and bottom together.
const RAIL_CHROME = 10
// Hover delays: open quickly, close slowly enough to move onto the preview.
const OPEN_DELAY = 120
const CLOSE_DELAY = 200

export interface ThumbIndexProps {
  /** The list's runs, in display order. */
  entries: readonly IndexEntry[]
  /** The run the reader is scrolled to. */
  current: string | null
  /** Jump to a tab's run (its first entry). */
  onJump: (tab: RailTab) => void
  /** The navigation landmark's name: "Jump to maps by letter". */
  label: string
  /** What a tab holds, for its accessible name and preview: "9 folders". */
  describe: (tab: RailTab) => string
  /** A tab's label as shown (a month key as "Nov 2026"); defaults to the label. */
  formatLabel?: (label: string) => string
  /** Prefix for the section heading ids the tabs link to. */
  scope: string
}

/** Whether `el` has keyboard focus (`:focus-visible`), where the browser can say. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/** Room for the rail inside the scroller the list sits in, kept current. */
function useRailSpace(railRef: RefObject<HTMLElement | null>): number {
  const [space, setSpace] = useState(MAX_TAB * 26)
  useLayoutEffect(() => {
    const scroller = scrollParent(railRef.current)
    const measure = () => {
      const height = scroller ? scroller.clientHeight : window.innerHeight
      // <main> pads its bottom for the phone tab bar and the audio player.
      const padding = scroller ? parseFloat(getComputedStyle(scroller).paddingBottom) || 0 : 0
      setSpace(Math.max(MIN_TAB * 3, height - padding - RAIL_TOP - RAIL_BOTTOM - RAIL_CHROME))
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || !scroller) {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [railRef])
  return space
}

/**
 * The thumb index: a slim rail of letters beside a long list.
 *
 * At rest it is the familiar A–Z rail, listing only the letters the list holds,
 * with the one the reader has scrolled to filled in. Hovering or focusing a
 * letter opens a preview of what it holds; activating it jumps there. When the
 * rail is too short for every letter, quiet neighbours merge into ranges
 * ("U–Z") so each tab stays a usable target.
 *
 * Keyboard: the rail is one tab stop. Up/Down move between letters, Home/End go
 * to the ends, typing a letter moves to it, Enter jumps, Escape closes the
 * preview. Touch: tap a letter, or drag along the rail and lift to jump.
 */
export default function ThumbIndex({
  entries,
  current,
  onJump,
  label,
  describe,
  formatLabel = (l) => l,
  scope,
}: ThumbIndexProps) {
  const { t, i18n } = useTranslation()
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const space = useRailSpace(navRef)

  const maxTabs = Math.max(1, Math.floor(space / MIN_TAB))
  const tabs = useMemo(() => mergeTabs(entries, maxTabs), [entries, maxTabs])
  const height = tabHeight(space, tabs.length)
  const currentIndex = current ? tabs.findIndex((tab) => tab.keys.includes(current)) : -1

  // Roving tab stop: the rail is one stop, landing on the current letter.
  const [focusIndex, setFocusIndex] = useState(0)
  const railFocused = useRef(false)
  useEffect(() => {
    if (!railFocused.current) setFocusIndex(Math.max(0, currentIndex))
  }, [currentIndex])
  const stop = Math.min(focusIndex, tabs.length - 1)

  // The preview: which tab, how it opened, and whether Escape closed it.
  const [peek, setPeek] = useState<{ index: number; keyboard: boolean } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClick = useRef(false)
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])

  const openSoon = (index: number) => {
    clearTimer()
    timer.current = setTimeout(() => setPeek({ index, keyboard: false }), OPEN_DELAY)
  }
  const closeSoon = () => {
    clearTimer()
    timer.current = setTimeout(() => setPeek((p) => (p && !p.keyboard ? null : p)), CLOSE_DELAY)
  }

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(tabs.length - 1, index))
    setFocusIndex(next)
    tabRefs.current[next]?.focus()
  }

  const jump = (index: number) => {
    const tab = tabs[index]
    if (!tab) return
    setPeek(null)
    onJump(tab)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(stop + 1),
      ArrowUp: () => moveTo(stop - 1),
      Home: () => moveTo(0),
      End: () => moveTo(tabs.length - 1),
      Escape: () => setPeek(null),
    }
    if (keys[e.key]) {
      // Escape only claims the key when there is a preview to close.
      if (e.key === 'Escape' && !peek) return
      e.preventDefault()
      keys[e.key]()
      return
    }
    if (e.key.length === 1 && /[\p{L}\p{N}#]/u.test(e.key)) {
      const found = tabs.findIndex((tab) => tabMatches(tab, e.key, i18n?.language))
      if (found >= 0) {
        e.preventDefault()
        moveTo(found)
      }
    }
  }

  // Touch and pen: drag along the rail to scrub, lift to jump. A mouse uses the
  // links as links.
  const indexAt = (clientY: number) => {
    const rect = listRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(tabs.length - 1, Math.floor((clientY - rect.top - 4) / height)))
  }
  const onPointerDown = (e: PointerEvent<HTMLUListElement>) => {
    if (e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setScrub(indexAt(e.clientY))
  }
  const onPointerMove = (e: PointerEvent<HTMLUListElement>) => {
    if (scrub === null) return
    setScrub(indexAt(e.clientY))
  }
  const onPointerUp = (e: PointerEvent<HTMLUListElement>) => {
    if (scrub === null) return
    const index = indexAt(e.clientY)
    setScrub(null)
    suppressClick.current = true
    // The click that follows a tap lands on the same link; this jump replaces it.
    setTimeout(() => {
      suppressClick.current = false
    }, 400)
    jump(index)
  }

  const shown = scrub ?? peek?.index ?? null
  const shownTab = shown === null ? null : tabs[shown]
  const peekTop = shown === null ? 0 : 5 + shown * height + height / 2

  if (!tabs.length) return null

  return (
    <nav ref={navRef} aria-label={label} className="thumb-index">
      <p className="sr-only">{t('thumbIndex.hint')}</p>
      <ul
        ref={listRef}
        role="list"
        className="thumb-index__list"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrub(null)}
        onFocus={() => {
          railFocused.current = true
        }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          railFocused.current = false
          setPeek(null)
        }}
        onPointerLeave={closeSoon}
      >
        {tabs.map((tab, i) => {
          const shownLabel = formatLabel(tab.label)
          return (
            <li key={tab.key}>
              <a
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                href={`#${sectionId(scope, tab.key)}`}
                className="thumb-index__tab"
                style={{ height }}
                tabIndex={i === stop ? 0 : -1}
                aria-current={i === currentIndex ? 'location' : undefined}
                aria-label={`${shownLabel}, ${describe(tab)}`}
                onClick={(e) => {
                  e.preventDefault()
                  if (suppressClick.current) return
                  jump(i)
                }}
                onFocus={(e) => {
                  clearTimer()
                  setFocusIndex(i)
                  // A mouse press focuses the link too; only a keyboard focus
                  // opens the preview, the pointer has its own hover for that.
                  if (focusVisible(e.currentTarget)) setPeek({ index: i, keyboard: true })
                }}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') openSoon(i)
                }}
              >
                {shownLabel}
              </a>
            </li>
          )
        })}
      </ul>
      {shownTab && (
        <ThumbIndexPeek
          tab={shownTab}
          label={formatLabel(shownTab.label)}
          summary={describe(shownTab)}
          top={peekTop}
          keyboard={scrub === null && !!peek?.keyboard}
          scrubbing={scrub !== null}
          onPointerEnter={clearTimer}
          onPointerLeave={closeSoon}
        />
      )}
    </nav>
  )
}
