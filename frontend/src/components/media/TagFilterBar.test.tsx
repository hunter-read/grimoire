import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagFilterBar from './TagFilterBar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) =>
      ({
        'common.tags': 'Tags:',
        'common.clear': 'Clear',
        'common.showLess': 'Show less',
        'common.showMore': `+${o?.count} more`,
      })[k] || k,
  }),
}))

describe('TagFilterBar', () => {
  it('renders nothing when there are no tags', () => {
    const { container } = render(
      <TagFilterBar tags={[]} selected={new Set()} onToggle={vi.fn()} onClear={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders capitalized tag pills and toggles one', async () => {
    const onToggle = vi.fn()
    render(
      <TagFilterBar tags={['forest']} selected={new Set()} onToggle={onToggle} onClear={vi.fn()} />
    )
    const pill = screen.getByText('Forest')
    await userEvent.click(pill)
    expect(onToggle).toHaveBeenCalledWith('forest')
  })

  it('shows a clear button only when something is selected', async () => {
    const onClear = vi.fn()
    render(
      <TagFilterBar
        tags={['forest']}
        selected={new Set(['forest'])}
        onToggle={vi.fn()}
        onClear={onClear}
      />
    )
    await userEvent.click(screen.getByText('Clear'))
    expect(onClear).toHaveBeenCalled()
  })

  it('limits visible tags and reveals the rest via show-more', async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`)
    render(<TagFilterBar tags={tags} selected={new Set()} onToggle={vi.fn()} onClear={vi.fn()} />)
    // 16th+ tags hidden until "+5 more" is clicked.
    expect(screen.queryByText('Tag19')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('+5 more'))
    expect(screen.getByText('Tag19')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Show less'))
    expect(screen.queryByText('Tag19')).not.toBeInTheDocument()
  })
})
