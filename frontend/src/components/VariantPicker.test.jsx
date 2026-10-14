import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import VariantPicker from './VariantPicker'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

let role = 'player'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

const describeVariant = vi.fn()
vi.mock('../api', () => ({ duplicates: { describe: (...a) => describeVariant(...a) } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'variants.badge') return `${o.count} versions`
      if (k === 'variants.renameNamed') return `Rename ${o.name}`
      if (k === 'variants.renameKind') return 'Type'
      if (k === 'variants.renameLabel') return 'Label'
      if (k === 'common.save') return 'Save'
      if (k === 'common.cancel') return 'Cancel'
      if (k === 'variants.mainVersion') return 'Main version'
      if (k === 'variants.switchLabel') return 'Switch version'
      if (k.startsWith('variants.kind.')) return k.replace('variants.kind.', '')
      return k
    },
  }),
}))

const renderPicker = (item, props = {}) =>
  render(
    <MemoryRouter>
      <VariantPicker item={item} detailPath={(id) => `/maps/${id}`} {...props} />
    </MemoryRouter>
  )

const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'Switch version' }))

describe('VariantPicker', () => {
  it('renders nothing when there are no other versions', () => {
    const { container } = renderPicker({ id: 'a', variants: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the main entry plus every variant once opened', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    expect(screen.getByText('2 versions')).toBeInTheDocument()
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /Main version/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /gridless/ })).toBeInTheDocument()
  })

  it('keeps the menu closed until the trigger is clicked', () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('names the current version on the trigger, without its filename', async () => {
    // The trigger sits inline beside the title, so a long filename there is what
    // pushed the rest of the header off screen.
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      filename: 'main.webp',
      variants: [{ id: 'b', kind: 'universal-vtt', label: '', filename: 'a-very-long-name.uvtt' }],
    })
    const trigger = screen.getByRole('button', { name: 'Switch version' })
    expect(trigger).toHaveTextContent('universal-vtt')
    expect(trigger).not.toHaveTextContent('a-very-long-name.uvtt')
  })

  it('shows the filename under the name, once', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      filename: 'main.webp',
      variants: [{ id: 'b', kind: 'universal-vtt', label: '', filename: 'export.uvtt' }],
    })
    await openMenu()
    const row = screen.getByRole('menuitem', { name: /universal-vtt/ })
    expect(row).toHaveTextContent('export.uvtt')
    // Once, not twice: the label repeating the filename is the bug this guards.
    expect(row.textContent.match(/export\.uvtt/g)).toHaveLength(1)
  })

  it('does not repeat the filename when the label is the filename', async () => {
    // The indexer fills the label with the filename for an auto-detected pair.
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      filename: 'main.webp',
      variants: [{ id: 'b', kind: 'universal-vtt', label: 'export.uvtt', filename: 'export.uvtt' }],
    })
    await openMenu()
    const row = screen.getByRole('menuitem', { name: /universal-vtt/ })
    expect(row.textContent.match(/export\.uvtt/g)).toHaveLength(1)
  })

  it('prefers a free-text label over a generic kind', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'version', label: 'v1.0.1' }],
    })
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /v1\.0\.1/ })).toBeInTheDocument()
  })

  it('navigates when a different version is picked', async () => {
    mockNavigate.mockClear()
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /gridless/ }))
    expect(mockNavigate).toHaveBeenCalledWith('/maps/b')
  })

  it('closes without navigating when the current version is picked', async () => {
    mockNavigate.mockClear()
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /Main version/ }))
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('marks the version currently being viewed', async () => {
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /gridless/ })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.getByRole('menuitem', { name: /Main version/ })).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('shows the family when viewing a variant, not just the main entry', async () => {
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /Main version/ })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on a click outside', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('names a described main entry, even from a variant (issue #556)', async () => {
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      variant_main_kind: 'gridless',
      variant_main_filename: 'Tavern_nogrid.png',
      filename: 'Tavern_grid.png',
      variants: [{ id: 'b', kind: 'gridded', label: '', filename: 'Tavern_grid.png' }],
    })
    await openMenu()
    const main = screen.getByRole('menuitem', { name: /gridless/ })
    expect(main).toHaveTextContent('Tavern_nogrid.png')
    expect(screen.queryByRole('menuitem', { name: /Main version/ })).not.toBeInTheDocument()
  })

  describe('renaming', () => {
    const family = {
      id: 'a',
      variant_main_id: 'a',
      filename: 'Tavern_nogrid.png',
      variant_main_filename: 'Tavern_nogrid.png',
      variants: [{ id: 'b', kind: 'gridded', label: '', filename: 'Tavern_grid.png' }],
    }

    beforeEach(() => {
      role = 'admin'
      describeVariant
        .mockReset()
        .mockImplementation((_t, id, desc) => Promise.resolve({ id, ...desc }))
    })
    afterEach(() => {
      role = 'player'
    })

    it('is offered to an admin when the collection is known', async () => {
      renderPicker(family, { resourceType: 'map' })
      await openMenu()
      expect(screen.getByRole('button', { name: 'Rename Main version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rename gridded' })).toBeInTheDocument()
    })

    it('is not offered without a collection', async () => {
      renderPicker(family)
      await openMenu()
      expect(screen.queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument()
    })

    it('is not offered to a non-admin', async () => {
      role = 'gm'
      renderPicker(family, { resourceType: 'map' })
      await openMenu()
      expect(screen.queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument()
    })

    it('renames the main entry in place', async () => {
      renderPicker(family, { resourceType: 'map' })
      await openMenu()
      await userEvent.click(screen.getByRole('button', { name: 'Rename Main version' }))
      await userEvent.selectOptions(screen.getByLabelText('Type'), 'gridless')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(describeVariant).toHaveBeenCalledWith('map', 'a', { kind: 'gridless', label: '' })
      )
      // Applied straight away, and the menu stays open on the list.
      expect(await screen.findByRole('menuitem', { name: /gridless/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Switch version' })).toHaveTextContent('gridless')
      expect(mockNavigate).not.toHaveBeenCalledWith('/maps/a')
    })

    it('goes back to the list on cancel', async () => {
      renderPicker(family, { resourceType: 'map' })
      await openMenu()
      await userEvent.click(screen.getByRole('button', { name: 'Rename gridded' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /gridded/ })).toBeInTheDocument()
    })

    it('drops an open rename when the menu closes', async () => {
      renderPicker(family, { resourceType: 'map' })
      await openMenu()
      await userEvent.click(screen.getByRole('button', { name: 'Rename gridded' }))
      await userEvent.keyboard('{Escape}')
      await openMenu()
      expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
    })

    it('drops an open rename on a click outside', async () => {
      renderPicker(family, { resourceType: 'map' })
      await openMenu()
      await userEvent.click(screen.getByRole('button', { name: 'Rename gridded' }))
      await userEvent.click(document.body)
      await openMenu()
      expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
    })

    it('drops an open rename when the trigger is clicked again', async () => {
      renderPicker(family, { resourceType: 'map' })
      await openMenu()
      await userEvent.click(screen.getByRole('button', { name: 'Rename gridded' }))
      await openMenu()
      await openMenu()
      expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
    })
  })
})
