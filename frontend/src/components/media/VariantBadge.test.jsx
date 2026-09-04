import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VariantBadge from './VariantBadge'

describe('VariantBadge', () => {
  it('names each kind on its icon, so the glyph is not the only cue', () => {
    render(<VariantBadge item={{ variant_count: 2, variant_kinds: ['universal-vtt', 'video'] }} />)
    expect(screen.getByRole('img', { name: 'Universal VTT' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Video' })).toBeInTheDocument()
  })

  it('renders icons rather than kind text', () => {
    const { container } = render(
      <VariantBadge item={{ variant_count: 1, variant_kinds: ['universal-vtt'] }} />
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
    // The label lives on the icon for assistive tech, not as visible body text.
    expect(container.textContent).toBe('')
  })

  it('tints the kind icons with the shared variant accent', () => {
    const { container } = render(
      <VariantBadge item={{ variant_count: 1, variant_kinds: ['video'] }} />
    )
    expect(container.querySelector('span')).toHaveStyle({ color: 'var(--variant)' })
  })

  it('falls back to a muted count when no kind was recorded', () => {
    const { container } = render(<VariantBadge item={{ variant_count: 2, variant_kinds: [] }} />)
    // The count includes the item itself: 2 others = 3 versions.
    expect(screen.getByLabelText('3 versions')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(container.querySelector('span')).toHaveStyle({ color: 'var(--text-muted)' })
  })

  it('falls back when variant_kinds is absent entirely (older payload)', () => {
    render(<VariantBadge item={{ variant_count: 1 }} />)
    expect(screen.getByLabelText('2 versions')).toBeInTheDocument()
  })

  it('shows an image icon when the video or VTT export is the main version', () => {
    // The pairs are symmetric: whichever side is filed as the variant carries
    // the kind, so a still under an animated main reads "image" (the backend's
    // suggest_kind picks this from the extension alone).
    render(<VariantBadge item={{ variant_count: 1, variant_kinds: ['image'] }} />)
    expect(screen.getByRole('img', { name: 'Image' })).toBeInTheDocument()
  })

  it('collapses kinds past the icon limit into +N', () => {
    render(
      <VariantBadge
        item={{ variant_count: 4, variant_kinds: ['gridded', 'gridless', 'video', 'image'] }}
      />
    )
    expect(screen.getByRole('img', { name: 'Gridded' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Gridless' })).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Video' })).toBeNull()
  })

  it('shows a generic icon and the raw name for an unknown kind', () => {
    render(<VariantBadge item={{ variant_count: 1, variant_kinds: ['holographic'] }} />)
    expect(screen.getByRole('img', { name: 'holographic' })).toBeInTheDocument()
  })
})
