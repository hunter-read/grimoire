import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MultiSelectDropdown from './MultiSelectDropdown'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) =>
      ({
        'sortFilter.multiAny': 'Any',
        'sortFilter.multiSelected': `${o?.count} selected`,
        'sortFilter.clear': 'Clear',
        'common.search': 'Search',
        'common.noResults': 'No results',
      })[k] || k,
  }),
}))

const options = [
  { value: 'osr', label: 'osr' },
  { value: 'fantasy', label: 'fantasy' },
  { value: 'grim', label: 'grim' },
]

const specialOptions = [
  { value: '__none__', label: 'No tags' },
  { value: '__any__', label: 'Any tags' },
]

function Harness({ initial = [], ...rest }) {
  const [selected, setSelected] = useState(initial)
  return (
    <div>
      <MultiSelectDropdown
        label="Tags"
        options={options}
        selected={selected}
        onChange={setSelected}
        {...rest}
      />
      <output data-testid="sel">{JSON.stringify(selected)}</output>
    </div>
  )
}

describe('MultiSelectDropdown', () => {
  it('shows "Any" when nothing is selected', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent('Any')
  })

  it('opens and toggles a value', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))
    expect(screen.getByTestId('sel').textContent).toBe('["osr"]')
  })

  it('filters options by the search box', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.type(screen.getByLabelText('Search'), 'gr')
    expect(screen.getByRole('checkbox', { name: 'grim' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'osr' })).not.toBeInTheDocument()
  })

  it('shows a selected count and clears all', async () => {
    render(<Harness initial={['osr', 'grim']} />)
    const trigger = screen.getByRole('button', { name: 'Tags' })
    expect(trigger).toHaveTextContent('2 selected')
    // The clear (X) affordance inside the trigger resets the selection.
    await userEvent.click(screen.getByLabelText('Clear'))
    expect(screen.getByTestId('sel').textContent).toBe('[]')
  })

  it('renders an empty label when there are no options', () => {
    render(
      <MultiSelectDropdown
        label="Tags"
        options={[]}
        selected={[]}
        onChange={() => {}}
        emptyLabel="No tags"
      />
    )
    expect(screen.getByText('No tags')).toBeInTheDocument()
  })

  describe('specialOptions', () => {
    it('pins them above the regular options', async () => {
      render(<Harness specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      const none = screen.getByRole('checkbox', { name: 'No tags' })
      const osr = screen.getByRole('checkbox', { name: 'osr' })
      expect(none.compareDocumentPosition(osr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('keeps them visible while the search box filters the rest', async () => {
      render(<Harness specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.type(screen.getByLabelText('Search'), 'zzz')
      expect(screen.getByRole('checkbox', { name: 'No tags' })).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'osr' })).not.toBeInTheDocument()
    })

    it('toggles a special value into the selection', async () => {
      render(<Harness specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Any tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('["__any__"]')
    })

    it('still renders the dropdown when only special options exist', async () => {
      render(<Harness options={[]} specialOptions={specialOptions} emptyLabel="No tags at all" />)
      expect(screen.queryByText('No tags at all')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('checkbox', { name: 'No tags' })).toBeInTheDocument()
    })

    it('replaces an existing selection when a special value is picked', async () => {
      render(<Harness initial={['osr', 'grim']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'No tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('["__none__"]')
    })

    it('replaces the other special value rather than combining the two', async () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Any tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('["__any__"]')
    })

    it('disables the regular options while a special value is active', async () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('checkbox', { name: 'osr' })).toBeDisabled()
      // The active sentinel stays clickable so it can be turned back off.
      expect(screen.getByRole('checkbox', { name: 'No tags' })).not.toBeDisabled()
    })

    it('frees the regular options again once the special value is cleared', async () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'No tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('[]')
      await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))
      expect(screen.getByTestId('sel').textContent).toBe('["osr"]')
    })

    it('names the active special filter on the trigger', () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent('No tags')
    })
  })

  it('closes when clicking outside', async () => {
    render(
      <div>
        <Harness />
        <button>outside</button>
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    expect(screen.getByRole('checkbox', { name: 'osr' })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('checkbox', { name: 'osr' })).not.toBeInTheDocument()
  })
  // --- Placement (issue: the tag list was cut off by the filter modal's edge) ---
  //
  // The panel is portalled to <body> and positioned `fixed`, so the modal's
  // `overflow-y: auto` cannot clip it and the list is free to extend past the
  // modal's edge. jsdom reports every rect as zero, so the trigger geometry and
  // viewport height are stubbed to drive the placement maths.
  describe('placement', () => {
    const stub = ({ triggerTop, viewport = 800 }) => {
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewport)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        return this.dataset?.modal
          ? { top: 0, bottom: 500, left: 0, width: 460 }
          : { top: triggerTop, bottom: triggerTop + 30, left: 20, width: 200 }
      })
    }

    // A stand-in for FilterModal's scrolling panel: the thing that used to clip
    // the dropdown.
    const renderInModal = () =>
      render(
        <div data-modal="true" style={{ overflowY: 'auto', maxHeight: 500 }}>
          <Harness />
        </div>
      )

    const panel = () => screen.getByTestId('multiselect-panel')
    const list = () => screen.getByRole('checkbox', { name: 'osr' }).closest('div')

    afterEach(() => vi.restoreAllMocks())

    // The fix: the panel escapes the modal subtree entirely, so no ancestor
    // overflow can cut the list off.
    it('renders the panel outside the modal, on document.body', async () => {
      stub({ triggerTop: 100 })
      const { container } = renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      const modal = container.querySelector('[data-modal]')
      expect(modal.contains(panel())).toBe(false)
      expect(document.body.contains(panel())).toBe(true)
    })

    it('positions the panel in viewport coordinates under the trigger', async () => {
      stub({ triggerTop: 100 })
      renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      expect(panel()).toHaveStyle({ position: 'fixed', left: '20px', width: '200px' })
      // Trigger bottom (130) plus the 4px offset.
      expect(panel()).toHaveStyle({ top: '134px' })
    })

    // The list may be taller than the 500px modal it was opened from — that is
    // the whole point of the portal.
    it('lets the list grow past the height of the modal', async () => {
      stub({ triggerTop: 100 })
      renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      expect(list()).toHaveStyle({ maxHeight: '320px' })
    })

    it('caps the list at a readable maximum rather than filling a tall viewport', async () => {
      stub({ triggerTop: 100, viewport: 2000 })
      renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      expect(list()).toHaveStyle({ maxHeight: '320px' })
    })

    it('flips upward when the trigger sits near the bottom of the viewport', async () => {
      stub({ triggerTop: 700 })
      renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      // Anchored to the bottom: viewport (800) - trigger top (700) + 4.
      expect(panel()).toHaveStyle({ bottom: '104px' })
      expect(panel().style.top).toBe('')
    })

    it('shrinks the list to the room actually available', async () => {
      // A short viewport: ~318px below the trigger, so it drops down but cannot
      // fit the full 320 list plus the search box above it.
      stub({ triggerTop: 60, viewport: 420 })
      renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      const maxHeight = parseInt(list().style.maxHeight, 10)
      expect(maxHeight).toBeLessThan(320)
      expect(maxHeight).toBeGreaterThanOrEqual(140)
    })

    it('keeps a usable minimum height in a very cramped slot', async () => {
      stub({ triggerTop: 80, viewport: 300 })
      renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      // Neither side fits much, so the list holds at the floor and scrolls.
      expect(list()).toHaveStyle({ maxHeight: '140px' })
    })

    it('re-measures when the page scrolls under an open list', async () => {
      stub({ triggerTop: 100 })
      renderInModal()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(panel()).toHaveStyle({ top: '134px' })

      stub({ triggerTop: 60 })
      fireEvent.scroll(document, {})

      await waitFor(() => expect(panel()).toHaveStyle({ top: '94px' }))
    })
  })

  // With the list floating over the page rather than nested in the modal,
  // dismissal has to work without relying on DOM containment.
  describe('dismissal with a portalled panel', () => {
    beforeEach(() => {
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 130,
        left: 20,
        width: 200,
      })
    })
    afterEach(() => vi.restoreAllMocks())

    // Regression: the outside-click check tested the trigger wrapper only, and
    // the portalled panel is not inside it — so every click on an option would
    // have closed the list before the click registered.
    it('stays open when clicking inside the panel', async () => {
      render(<Harness />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      fireEvent.mouseDown(screen.getByRole('checkbox', { name: 'osr' }))

      expect(screen.getByRole('checkbox', { name: 'osr' })).toBeInTheDocument()
    })

    it('still selects a value through the portal', async () => {
      render(<Harness />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))

      expect(screen.getByTestId('sel').textContent).toBe('["osr"]')
    })

    it('closes on Escape', async () => {
      render(<Harness />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('checkbox', { name: 'osr' })).toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(screen.queryByRole('checkbox', { name: 'osr' })).not.toBeInTheDocument()
    })

    it('unmounts the panel from the body when closed', async () => {
      render(<Harness />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByTestId('multiselect-panel')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

      expect(screen.queryByTestId('multiselect-panel')).not.toBeInTheDocument()
    })
  })
})
