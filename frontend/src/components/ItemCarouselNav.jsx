import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'

/**
 * The bar for stepping through a selection one item at a time: a chevron
 * button either side of the current item's name and its position.
 *
 * Shared by the bulk editor and the metadata fetch dialog it opens (issue
 * #466), so moving between items looks and sits the same in both. A side with
 * no handler renders disabled rather than disappearing, which keeps the name
 * from shifting at either end of the selection.
 *
 * Props:
 *   title     – the current item's name
 *   subtitle  – where it sits, e.g. "3 of 40"
 *   onPrev    – () => void, or undefined on the first item
 *   onNext    – () => void, or undefined on the last item
 *   prevLabel – accessible name (and tooltip) for the left button
 *   nextLabel – accessible name (and tooltip) for the right button
 *   shortcuts – advertise ArrowLeft / ArrowRight, for callers that bind them
 *   nextRef   – ref for the right button, for callers that move focus to it
 */
export default function ItemCarouselNav({
  title,
  subtitle,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  shortcuts = false,
  nextRef,
}) {
  return (
    <div style={bar}>
      <button
        onClick={onPrev}
        disabled={!onPrev}
        aria-label={prevLabel}
        title={prevLabel}
        aria-keyshortcuts={shortcuts ? 'ArrowLeft' : undefined}
        style={navBtn(!onPrev)}
      >
        <LuChevronLeft size={16} />
      </button>
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, ...ellipsis }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</div>
      </div>
      <button
        ref={nextRef}
        onClick={onNext}
        disabled={!onNext}
        aria-label={nextLabel}
        title={nextLabel}
        aria-keyshortcuts={shortcuts ? 'ArrowRight' : undefined}
        style={navBtn(!onNext)}
      >
        <LuChevronRight size={16} />
      </button>
    </div>
  )
}

const bar = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}
const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const navBtn = (disabled) => ({
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: disabled ? 'var(--text-muted)' : 'var(--text-dim)',
  cursor: disabled ? 'default' : 'pointer',
  display: 'flex',
  padding: 6,
  opacity: disabled ? 0.5 : 1,
})
