import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SystemLinks from './SystemLinks'

const many = {
  character_builder_urls: [
    { label: 'Demiplane', url: 'https://demiplane.example' },
    { label: 'Daggerstack', url: 'https://daggerstack.example' },
    { label: 'Third Builder', url: 'https://third.example' },
  ],
  urls: [
    { label: 'Official site', url: 'https://official.example' },
    { label: 'Free downloads', url: 'https://free.example' },
    { label: 'TTRPG Wiki', url: 'https://wiki.example' },
  ],
}

describe('SystemLinks', () => {
  it('renders nothing without links', () => {
    const { container } = render(<SystemLinks system={{ urls: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows every link as a button, marked with its kind, when they fit', () => {
    render(
      <SystemLinks
        system={{
          character_builder_url: 'https://www.builder.example/x',
          urls: [{ label: 'Site', url: 'https://site.example' }],
        }}
      />
    )
    const builder = screen.getByRole('link', { name: 'Character builder: builder.example' })
    expect(builder).toHaveAttribute('href', 'https://www.builder.example/x')
    expect(builder).toHaveAttribute('data-kind', 'builder')
    expect(screen.getByRole('link', { name: 'Link: Site' })).toHaveAttribute('data-kind', 'link')
    expect(screen.queryByRole('button', { name: /More links/ })).not.toBeInTheDocument()
  })

  it('moves the rest into a grouped More menu', () => {
    render(<SystemLinks system={many} />)
    const visible = within(screen.getByTestId('system-links')).getAllByRole('link')
    expect(visible.map((a) => a.textContent)).toEqual(['Demiplane', 'Daggerstack', 'Official site'])

    const more = screen.getByRole('button', { name: 'More links (3)' })
    expect(more).toHaveTextContent('More (3)')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')

    const menu = screen.getByRole('menu')
    const builders = within(menu).getByRole('group', { name: 'Character Builders' })
    expect(within(builders).getByRole('menuitem')).toHaveTextContent('Third Builder')
    expect(within(builders).getByRole('menuitem')).toHaveAttribute('data-kind', 'builder')
    const links = within(menu).getByRole('group', { name: 'Links' })
    expect(
      within(links)
        .getAllByRole('menuitem')
        .map((a) => a.textContent)
    ).toEqual(['Free downloads', 'TTRPG Wiki'])
    expect(within(links).getAllByRole('menuitem')[0]).toHaveAttribute(
      'title',
      'Link: Free downloads'
    )
  })

  it('omits a group heading when no links of that kind overflow', () => {
    render(
      <SystemLinks
        system={{
          urls: [1, 2, 3, 4].map((n) => ({ label: `L${n}`, url: `https://l${n}.example` })),
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'More links (1)' }))
    expect(screen.queryByRole('group', { name: 'Character Builders' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Links' })).toBeInTheDocument()
  })

  it('closes on an outside click, Escape, or picking a link', () => {
    render(<SystemLinks system={many} />)
    const more = screen.getByRole('button', { name: 'More links (3)' })

    fireEvent.click(more)
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(more)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(more).toHaveFocus()

    fireEvent.click(more)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('menuitem')[0])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
