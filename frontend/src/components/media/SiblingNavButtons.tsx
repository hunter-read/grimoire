import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'

const navButtonStyle = {
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
 */
export default function SiblingNavButtons({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}) {
  return (
    <>
      {hasPrev && (
        <button
          onClick={onPrev}
          aria-label={prevLabel}
          title={prevLabel}
          style={{ ...navButtonStyle, left: 12 }}
        >
          <LuChevronLeft size={26} />
        </button>
      )}
      {hasNext && (
        <button
          onClick={onNext}
          aria-label={nextLabel}
          title={nextLabel}
          style={{ ...navButtonStyle, right: 12 }}
        >
          <LuChevronRight size={26} />
        </button>
      )}
    </>
  )
}
