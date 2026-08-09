// Shared styles and hover handlers for the favorites cards/rows. Each favorite
// type renders the same card/row chrome with type-specific thumbnail + metadata.

export const cardWrapperStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  overflow: 'hidden',
  cursor: 'pointer',
  position: 'relative',
}

export const rowWrapperStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '10px 14px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  cursor: 'pointer',
  position: 'relative',
}

// Grid column sizing per view mode, matching the library/maps/tokens grids.
export const gridStyle = (mode) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${mode === 'compact' ? '140px' : '160px'}, 1fr))`,
  gap: 12,
})

export const ROW_LIST_STYLE = { display: 'flex', flexDirection: 'column', gap: 8 }

// Border-color hover handlers for the card/row wrappers.
export const hoverIn = (e) => (e.currentTarget.style.borderColor = 'var(--border-light)')
export const hoverOut = (e) => (e.currentTarget.style.borderColor = 'var(--border)')

// Standard in-flow placement for the FavoriteButton in row layouts. Positioned
// (not static) so the button paints above the row's CardLink overlay.
export const rowFavoriteButtonStyle = {
  position: 'relative',
  top: 'auto',
  right: 'auto',
  background: 'none',
  width: 'auto',
  height: 'auto',
  borderRadius: 0,
}
