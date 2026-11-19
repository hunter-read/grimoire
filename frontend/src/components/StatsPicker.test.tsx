import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatsPicker from './StatsPicker'
import { STAT_IDS, type StatId } from '../lib/sidebarStats'

function renderPicker(value: StatId[], disabled = false) {
  const onChange = vi.fn()
  render(<StatsPicker value={value} onChange={onChange} disabled={disabled} />)
  return onChange
}

// Each row reads "1.Maps": its place, then its name.
const chosenNames = () =>
  within(screen.getByRole('list', { name: 'Stats in the sidebar' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent?.replace(/^\d+\./, ''))

describe('StatsPicker', () => {
  it('lists the ticked stats in order, numbered, above every stat in its group', () => {
    renderPicker(['maps', 'ttrpg_books'])
    expect(chosenNames()).toEqual(['Maps', 'TTRPG Books'])
    expect(screen.getByRole('list', { name: 'Stats in the sidebar' })).toHaveTextContent('1.Maps')
    expect(screen.getAllByRole('checkbox')).toHaveLength(STAT_IDS.length)
    const collections = screen.getByRole('group', { name: 'Collections' })
    expect(within(collections).getByLabelText('Maps')).toBeChecked()
    expect(within(collections).getByLabelText('Tokens')).not.toBeChecked()
    const books = screen.getByRole('group', { name: 'Books' })
    expect(within(books).getByLabelText('TTRPG Books')).toBeChecked()
    expect(screen.getByText('2 of 10 chosen')).toBeInTheDocument()
  })

  it('groups the stats into Systems, Books, Pages, Collections, Variants and Sizes', () => {
    renderPicker([])
    expect(
      screen.getAllByRole('group').map((group) => group.querySelector('legend')?.textContent)
    ).toEqual(['Systems', 'Books', 'Pages', 'Collections', 'Variants', 'Sizes'])
    const sizes = screen.getByRole('group', { name: 'Sizes' })
    expect(within(sizes).getByLabelText('Library Size')).toBeInTheDocument()
  })

  it('ticking a stat adds it at the end, unticking removes it', async () => {
    const onChange = renderPicker(['maps', 'tokens'])
    await userEvent.click(screen.getByLabelText('Wargame Pages'))
    expect(onChange).toHaveBeenLastCalledWith(['maps', 'tokens', 'wargame_pages'])
    await userEvent.click(screen.getByLabelText('Maps'))
    expect(onChange).toHaveBeenLastCalledWith(['tokens'])
  })

  it('drags a ticked stat by its handle to a new place', () => {
    const onChange = renderPicker(['maps', 'tokens', 'audio'])
    const handle = screen.getByRole('button', { name: 'Reorder Audio' })
    const firstRow = screen.getByRole('button', { name: 'Reorder Maps' }).closest('li')!
    fireEvent.dragStart(handle)
    fireEvent.dragOver(firstRow)
    fireEvent.drop(firstRow)
    expect(onChange).toHaveBeenCalledWith(['audio', 'maps', 'tokens'])
  })

  it('ignores a drop on its own row, and a drag that did not start on a handle', () => {
    const onChange = renderPicker(['maps', 'tokens'])
    const row = screen.getByRole('button', { name: 'Reorder Maps' }).closest('li')!
    fireEvent.dragOver(row)
    fireEvent.drop(row)
    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder Maps' }))
    fireEvent.drop(row)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves a stat with the arrow keys on its handle, and says where it went', () => {
    const onChange = renderPicker(['maps', 'tokens', 'audio'])
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Tokens' }), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(['tokens', 'maps', 'audio'])
    expect(screen.getByRole('status')).toHaveTextContent('Moved to position 1 of 3')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Audio' }), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Maps' }), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('stops ticking more at ten', () => {
    renderPicker(STAT_IDS.slice(0, 10) as StatId[])
    expect(screen.getByText(/10 of 10 chosen - untick one to choose another/)).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    for (const box of boxes.filter((b) => !b.checked)) expect(box).toBeDisabled()
    for (const box of boxes.filter((b) => b.checked)) expect(box).toBeEnabled()
  })

  it('says when nothing is ticked', () => {
    renderPicker([])
    expect(screen.getByText('No stats chosen - the sidebar shows none.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Stats in the sidebar' })).toBeNull()
  })

  it('locks every control while disabled', () => {
    renderPicker(['maps'], true)
    expect(screen.getByRole('button', { name: 'Reorder Maps' })).toBeDisabled()
    expect(screen.getByLabelText('Maps')).toBeDisabled()
    expect(screen.getByLabelText('Books')).toBeDisabled()
  })
})
