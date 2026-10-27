import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import SystemContainerView from './SystemContainerView'
import { bulk as bulkApi } from '../../api'

// SystemCard renders CardLink (<Link>) so every render needs a Router.
const render = (ui, opts) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>, opts)

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
  default: {
    get: vi.fn(() => Promise.resolve({ filters: [] })),
    upload: vi.fn(),
    delete: vi.fn(),
  },
  bulk: { addTags: vi.fn() },
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
  mediaUrl: (p) => p,
  // The cover is set through the shared image picker (issue #286).
  imageSources: {
    setSystemCover: vi.fn(),
    search: vi.fn(() => Promise.resolve([])),
    thumbUrl: (type, id) => `/api/${type}s/${id}/thumbnail`,
  },
}))

vi.mock('../FavoriteButton', () => ({ default: () => null }))

vi.mock('../BulkEditModal', () => ({
  default: ({ items }) => <div role="dialog">{items.map((i) => i.id).join(',')}</div>,
}))

const mockIsFavorite = vi.fn(() => false)
vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite }),
}))
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
    render(<SystemContainerView system={makeContainer()} onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'One Page RPGs' })).toBeInTheDocument()
  })

  it('renders each child system as a card', () => {
    render(
      <SystemContainerView
        system={makeContainer({
          children: [child(), child({ id: 'c2', name: 'Lasers And Feelings' })],
        })}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText('Honey Heist')).toBeInTheDocument()
    expect(screen.getByText('Lasers And Feelings')).toBeInTheDocument()
  })

  it('each child card is a real link to the child system route', () => {
    render(<SystemContainerView system={makeContainer()} onBack={vi.fn()} />)
    // Child cards use CardLink; navigation is native — no onOpenChild callback needed.
    const link = screen.getByRole('link', { name: 'Honey Heist' })
    expect(link).toHaveAttribute('href', '/library/system/c1')
  })

  it('summarises how many systems the collection holds', () => {
    render(<SystemContainerView system={makeContainer()} onBack={vi.fn()} />)
    expect(screen.getByText('1 systems in this collection')).toBeInTheDocument()
  })

  it('prefers the container description over the generated summary', () => {
    render(
      <SystemContainerView
        system={makeContainer({ description: 'My tiny games shelf.' })}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText('My tiny games shelf.')).toBeInTheDocument()
  })

  it('goes back to the library', async () => {
    const onBack = vi.fn()
    render(<SystemContainerView system={makeContainer()} onBack={onBack} />)
    await userEvent.click(screen.getByText('systemDetail.backToLibrary'))
    expect(onBack).toHaveBeenCalled()
  })

  it('labels the back button with the given target', () => {
    render(
      <SystemContainerView
        system={makeContainer()}
        backLabel="Back to Dungeons & Dragons"
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText('Back to Dungeons & Dragons')).toBeInTheDocument()
    expect(screen.queryByText('systemDetail.backToLibrary')).not.toBeInTheDocument()
  })

  it('shows an empty state when the container has no children', () => {
    render(<SystemContainerView system={makeContainer({ children: [] })} onBack={vi.fn()} />)
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
        onBack={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: 'Dungeons & Dragons' })).toBeInTheDocument()
    expect(screen.getByText('Dungeons & Dragons 5e')).toBeInTheDocument()
  })

  // Issue #500: a container gets the main library's toolbar for its children.
  describe('toolbar', () => {
    beforeEach(() => {
      sessionStorage.clear()
      mockIsFavorite.mockReturnValue(false)
    })

    const twoChildren = () =>
      makeContainer({
        children: [
          child({ id: 'c1', name: 'Honey Heist', tags: ['heist'] }),
          child({ id: 'c2', name: 'Lasers And Feelings', tags: [] }),
        ],
      })

    it('shows sort, filters and the view toggle', () => {
      const onCycle = vi.fn()
      render(
        <SystemContainerView
          system={twoChildren()}
          viewMode="card"
          onCycleViewMode={onCycle}
          onBack={vi.fn()}
        />
      )
      expect(screen.getByLabelText('sortFilter.sort')).toBeInTheDocument()
      expect(screen.getByLabelText('sortFilter.filters')).toBeInTheDocument()
    })

    it('has no toolbar for an empty container', () => {
      render(<SystemContainerView system={makeContainer({ children: [] })} onBack={vi.fn()} />)
      expect(screen.queryByLabelText('sortFilter.filters')).not.toBeInTheDocument()
    })

    it('searches the children by name', async () => {
      render(<SystemContainerView system={twoChildren()} onBack={vi.fn()} />)
      await userEvent.click(screen.getByLabelText('sortFilter.filters'))
      await userEvent.type(screen.getByLabelText('sortFilter.searchLabel'), 'laser')
      expect(screen.queryByText('Honey Heist')).not.toBeInTheDocument()
      expect(screen.getByText('Lasers And Feelings')).toBeInTheDocument()
    })

    it('sorts the children', async () => {
      render(<SystemContainerView system={twoChildren()} onBack={vi.fn()} />)
      const names = () =>
        screen
          .getAllByRole('link')
          .map((a) => a.getAttribute('href'))
          .filter((h) => h.startsWith('/library/system/'))
          .map((h) => h.split('/').pop())
      expect(names()).toEqual(['c1', 'c2'])
      await userEvent.click(screen.getByTitle('sortFilter.ascending'))
      expect(names()).toEqual(['c2', 'c1'])
    })

    it('says so when the filters match no children', async () => {
      render(<SystemContainerView system={twoChildren()} onBack={vi.fn()} />)
      await userEvent.click(screen.getByLabelText('sortFilter.filters'))
      await userEvent.type(screen.getByLabelText('sortFilter.searchLabel'), 'zzz')
      expect(screen.getByText('systemContainer.noMatch')).toBeInTheDocument()
    })

    it('only offers multi-select to editors', () => {
      render(<SystemContainerView system={twoChildren()} onBack={vi.fn()} />)
      expect(screen.queryByText('common.select')).not.toBeInTheDocument()
    })

    it('bulk tags the selected children and patches them in place', async () => {
      bulkApi.addTags.mockResolvedValue({ tags: { c2: ['tiny'] } })
      const onChildrenChange = vi.fn()
      render(
        <SystemContainerView
          system={twoChildren()}
          canEdit
          onBack={vi.fn()}
          onChildrenChange={onChildrenChange}
        />
      )
      await userEvent.click(screen.getByText('common.select'))
      await userEvent.click(screen.getByText('Lasers And Feelings'))
      await userEvent.type(screen.getByLabelText('bulk.tagsPlaceholder'), 'tiny')
      await userEvent.click(screen.getByText('bulk.addTags'))

      await waitFor(() => expect(bulkApi.addTags).toHaveBeenCalledWith('system', ['c2'], ['tiny']))
      const update = onChildrenChange.mock.calls[0][0]
      expect(update(twoChildren().children).find((c) => c.id === 'c2').tags).toEqual(['tiny'])
    })

    it('opens bulk edit for the selection and leaves nested containers out', async () => {
      render(
        <SystemContainerView
          system={makeContainer({
            children: [
              child({ id: 'c1', name: 'Alpha' }),
              child({ id: 'n1', name: 'Nested', container_kind: 'generic' }),
              child({ id: 'c2', name: 'Beta' }),
            ],
          })}
          canEdit
          onBack={vi.fn()}
          onChildrenChange={vi.fn()}
        />
      )
      await userEvent.click(screen.getByText('common.select'))
      await userEvent.click(screen.getByText('Alpha'))
      await userEvent.click(screen.getByText('Beta'), { shiftKey: true })
      await userEvent.click(screen.getByText('bulk.edit'))
      // Both ordinary children, and only those two: the range skips the nested one.
      expect(screen.getByRole('dialog')).toHaveTextContent('c1,c2')
    })
  })

  describe('cover art', () => {
    it('shows the container cover when it has one', () => {
      render(<SystemContainerView system={makeContainer({ has_cover: true })} onBack={vi.fn()} />)
      const img = document.querySelector('img')
      expect(img).toHaveAttribute('src', '/systems/container-1/cover')
    })

    it('renders no cover image when the container has none', () => {
      render(<SystemContainerView system={makeContainer()} onBack={vi.fn()} />)
      expect(document.querySelector('img')).toBeNull()
    })

    it('hides the cover control from non-editors', () => {
      render(<SystemContainerView system={makeContainer()} onBack={vi.fn()} />)
      expect(screen.queryByText('systemEditor.uploadCover')).not.toBeInTheDocument()
    })

    it('lets an editor open the cover picker', async () => {
      render(<SystemContainerView system={makeContainer()} canEdit onBack={vi.fn()} />)
      // The container view reveals CoverUpload, whose button opens the picker.
      await userEvent.click(screen.getByTitle('systemEditor.uploadCover'))
      await userEvent.click(screen.getByText('systemEditor.chooseImage'))
      expect(screen.getByTestId('image-picker-input')).toBeInTheDocument()
    })
  })
})
