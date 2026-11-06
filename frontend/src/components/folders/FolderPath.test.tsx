import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FolderPath from './FolderPath'

const CREATORS = Array.from({ length: 10 }, (_, i) => `Creator ${i}`)
const ALL = [
  ...CREATORS,
  'Tom Cartos',
  'Tom Cartos/Caverns',
  'Tom Cartos/Crypts',
  'Tom Cartos/Caverns/Lava',
]

const hrefFor = (path: string | null) =>
  path ? `/maps?folder=${encodeURIComponent(path)}` : '/maps'

const renderPath = (folder = 'Tom Cartos/Caverns') =>
  render(
    <MemoryRouter>
      <FolderPath rootLabel="Maps" folder={folder} allFolders={ALL} hrefFor={hrefFor} />
    </MemoryRouter>
  )

describe('FolderPath', () => {
  it('walks from the collection to the open folder', () => {
    renderPath()
    const nav = screen.getByRole('navigation', { name: 'Folder path' })
    expect(within(nav).getByRole('link', { name: 'Maps' })).toHaveAttribute('href', '/maps')
    expect(within(nav).getByRole('link', { name: 'Tom Cartos' })).toHaveAttribute(
      'href',
      '/maps?folder=Tom%20Cartos'
    )
    expect(within(nav).getByText('Caverns')).toHaveAttribute('aria-current', 'page')
  })

  it('lists the folders beside a step, marking the open one', () => {
    renderPath()
    const button = screen.getByRole('button', { name: 'Folders beside Caverns' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Crypts' })).toHaveAttribute(
      'href',
      '/maps?folder=Tom%20Cartos%2FCrypts'
    )
    expect(screen.getAllByRole('link', { name: 'Caverns' }).at(-1)).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('filters a long level, and says when nothing matches', () => {
    renderPath()
    fireEvent.click(screen.getByRole('button', { name: 'Folders beside Tom Cartos' }))
    const filter = screen.getByRole('textbox', { name: 'Filter folders…' })
    expect(document.activeElement).toBe(filter)
    fireEvent.change(filter, { target: { value: 'creator 3' } })
    expect(screen.getByRole('link', { name: 'Creator 3' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Creator 4' })).not.toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(screen.getByText('No folders match')).toBeInTheDocument()
  })

  it('closes on Escape, returning focus, and on a click outside', () => {
    renderPath()
    const button = screen.getByRole('button', { name: 'Folders beside Caverns' })
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByRole('link', { name: 'Crypts' }), { key: 'Escape' })
    expect(screen.queryByRole('link', { name: 'Crypts' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('link', { name: 'Crypts' })).not.toBeInTheDocument()
  })

  it('closes after a neighbour is picked', () => {
    renderPath()
    fireEvent.click(screen.getByRole('button', { name: 'Folders beside Caverns' }))
    fireEvent.click(screen.getByRole('link', { name: 'Crypts' }))
    expect(screen.queryByRole('link', { name: 'Crypts' })).not.toBeInTheDocument()
  })

  it('offers no list for a folder with no neighbours', () => {
    renderPath('Tom Cartos/Caverns/Lava')
    expect(screen.queryByRole('button', { name: 'Folders beside Lava' })).not.toBeInTheDocument()
  })
})
