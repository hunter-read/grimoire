import { useTranslation } from 'react-i18next'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'

import type { CSSProperties } from 'react'

export interface SiblingNavButtonsProps {
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  prevLabel: string
  nextLabel: string
  /** The neighbours' names, so the button says where it goes ("Previous map: Crypt"). */
  prevName?: string
  nextName?: string
}

const navButtonStyle: CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 2,
  width: 44,
  height: 44,
  borderRadius: '50%',
  border: '1px solid var(--border)',
  background: 'var(--scrim)',
  color: 'var(--text)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

/**
 * The prev/next overlay arrows for a media detail pane. Absolutely positioned,
 * so the pane it sits in needs `position: relative`.
 *
 * Labels are passed in rather than derived: each collection names its own item
 * ("Previous map", "Previous token"), which is what a screen reader reads out.
 * Given the neighbours' names, the button names its destination too.
 */
export default function SiblingNavButtons({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  prevName,
  nextName,
}: SiblingNavButtonsProps) {
  const { t } = useTranslation()
  const named = (label: string, name?: string) =>
    name ? t('a11y.mediaDetail.labelledValue', { label, value: name }) : label
  const prev = named(prevLabel, prevName)
  const next = named(nextLabel, nextName)
  return (
    <>
      {hasPrev && (
        <button
          onClick={onPrev}
          aria-label={prev}
          title={prev}
          style={{ ...navButtonStyle, left: 12 }}
        >
          <LuChevronLeft size={26} />
        </button>
      )}
      {hasNext && (
        <button
          onClick={onNext}
          aria-label={next}
          title={next}
          style={{ ...navButtonStyle, right: 12 }}
        >
          <LuChevronRight size={26} />
        </button>
      )}
    </>
  )
}
