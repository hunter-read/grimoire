import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemContainerView from './SystemContainerView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'systemContainer.subtitle') return `${o.count} systems in this collection`
      if (k === 'library.bookCount') return `${o.count} books`
      return k
    },
  }),
}))

vi.mock('../../api', () => ({
  default: { upload: vi.fn(), delete: vi.fn() },
  mediaUrl: (p) => p,
}))

vi.mock('../FavoriteButton', () => ({ default: () => null }))
vi.mock('../LazyImg', () => ({ default: () => null }))

const child = (over = {}) => ({
  id: 'c1',
  name: 'Honey Heist',
  book_count: 1,
  ...over,
})

const makeContainer = (over = {}) => ({
  id: 'container-1',
  name: 'one-page-rpgs',
  is_one_page: true,
  container_kind: 'one-page',
  book_count: 0,
  children: [child()],
  ...over,
})

describe('SystemContainerView', () => {
  it('prettifies the container name in the heading', () => {
    render(<SystemContainerView system={makeContainer()} onOpenChild={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'One Page RPGs' })).toBeInTheDocument()
  })

  it('renders each child system as a card', () => {
    render(
      <SystemContainerView
        system={makeContainer({
          children: [child(), child({ id: 'c2', name: 'Lasers And Feelings' })],
        })}
        onOpenChild={vi.fn()}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText('Honey Heist')).toBeInTheDocument()
    expect(screen.getByText('Lasers And Feelings')).toBeInTheDocument()
  })

  it('summarises how many systems the collection holds', () => {
    render(<SystemContainerView system={makeContainer()} onOpenChild={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText('1 systems in this collection')).toBeInTheDocument()
  })

  it('prefers the container description over the generated summary', () => {
    render(
      <SystemContainerView
        system={makeContainer({ description: 'My tiny games shelf.' })}
        onOpenChild={vi.fn()}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText('My tiny games shelf.')).toBeInTheDocument()
  })

  it('opens a child when its card is clicked', async () => {
    const onOpenChild = vi.fn()
    render(
      <SystemContainerView system={makeContainer()} onOpenChild={onOpenChild} onBack={vi.fn()} />
    )
    await userEvent.click(screen.getByText('Honey Heist'))
    expect(onOpenChild).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
  })

  it('goes back to the library', async () => {
    const onBack = vi.fn()
    render(<SystemContainerView system={makeContainer()} onOpenChild={vi.fn()} onBack={onBack} />)
    await userEvent.click(screen.getByText('systemDetail.backToLibrary'))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows an empty state when the container has no children', () => {
    render(
      <SystemContainerView
        system={makeContainer({ children: [] })}
        onOpenChild={vi.fn()}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText('systemContainer.empty')).toBeInTheDocument()
  })

  it('renders parent-system containers with their real name', () => {
    render(
      <SystemContainerView
        system={makeContainer({
          name: 'Dungeons & Dragons',
          is_one_page: false,
          container_kind: 'parent',
          children: [child({ id: 'e1', name: 'Dungeons & Dragons 5e' })],
        })}
        onOpenChild={vi.fn()}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: 'Dungeons & Dragons' })).toBeInTheDocument()
    expect(screen.getByText('Dungeons & Dragons 5e')).toBeInTheDocument()
  })

  it('renders headerExtra content', () => {
    render(
      <SystemContainerView
        system={makeContainer()}
        onOpenChild={vi.fn()}
        onBack={vi.fn()}
        headerExtra={<span>toggle-here</span>}
      />
    )
    expect(screen.getByText('toggle-here')).toBeInTheDocument()
  })
  describe('cover art', () => {
    it('shows the container cover when it has one', () => {
      render(
        <SystemContainerView
          system={makeContainer({ has_cover: true })}
          onOpenChild={vi.fn()}
          onBack={vi.fn()}
        />
      )
      const img = document.querySelector('img')
      expect(img).toHaveAttribute('src', '/systems/container-1/cover')
    })

    it('renders no cover image when the container has none', () => {
      render(
        <SystemContainerView system={makeContainer()} onOpenChild={vi.fn()} onBack={vi.fn()} />
      )
      expect(document.querySelector('img')).toBeNull()
    })

    it('hides the cover control from non-editors', () => {
      render(
        <SystemContainerView system={makeContainer()} onOpenChild={vi.fn()} onBack={vi.fn()} />
      )
      expect(screen.queryByText('systemEditor.uploadCover')).not.toBeInTheDocument()
    })

    it('lets an editor open the cover uploader', async () => {
      render(
        <SystemContainerView
          system={makeContainer()}
          canEdit
          onOpenChild={vi.fn()}
          onBack={vi.fn()}
        />
      )
      await userEvent.click(screen.getByText('systemEditor.uploadCover'))
      expect(screen.getByTestId('cover-upload-input')).toBeInTheDocument()
    })
  })
})
