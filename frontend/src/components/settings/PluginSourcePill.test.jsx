import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PluginSourcePill, { formatIndexUrl } from './PluginSourcePill'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, fallback) => fallback || k,
  }),
}))

describe('formatIndexUrl', () => {
  it('returns empty string when url is empty or falsy', () => {
    expect(formatIndexUrl('')).toBe('')
    expect(formatIndexUrl(null)).toBe('')
  })

  it('formats main branch github urls as owner/repo', () => {
    expect(
      formatIndexUrl(
        'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml'
      )
    ).toBe('grimoire-codex/community-add-ons')
  })

  it('formats non-main branch github urls as owner/repo (branch)', () => {
    expect(
      formatIndexUrl('https://raw.githubusercontent.com/user/my-repo/panda/themes/index.json')
    ).toBe('user/my-repo (panda)')
  })

  it('handles refs/heads/branch in github raw urls', () => {
    expect(
      formatIndexUrl(
        'https://raw.githubusercontent.com/user/my-repo/refs/heads/feature-1/themes/index.json'
      )
    ).toBe('user/my-repo (feature-1)')
  })

  it('formats github.com raw, tree, and blob urls', () => {
    expect(formatIndexUrl('https://github.com/user/repo/raw/dev/index.json')).toBe(
      'user/repo (dev)'
    )
    expect(formatIndexUrl('https://github.com/user/repo/tree/main/path')).toBe('user/repo')
    expect(formatIndexUrl('https://github.com/user/repo')).toBe('user/repo')
  })

  it('returns hostname for spoofed github hostnames', () => {
    expect(formatIndexUrl('https://fakegithubusercontent.com/user/repo/main')).toBe(
      'fakegithubusercontent.com'
    )
    expect(formatIndexUrl('https://github.com.attacker.com/user/repo/main')).toBe(
      'github.com.attacker.com'
    )
  })

  it('returns raw url string if URL parsing throws', () => {
    expect(formatIndexUrl('ht tp://invalid url')).toBe('ht tp://invalid url')
  })

  it('returns hostname if path has less than 2 parts', () => {
    expect(formatIndexUrl('https://github.com/')).toBe('github.com')
  })
})

describe('PluginSourcePill', () => {
  it('renders nothing when url is missing', () => {
    const { container } = render(<PluginSourcePill />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders formatted pill text for main branch source', () => {
    render(
      <PluginSourcePill url="https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml" />
    )
    expect(screen.getByText('grimoire-codex/community-add-ons')).toBeInTheDocument()
  })

  it('renders branch name in pill text for custom branch source', () => {
    render(
      <PluginSourcePill url="https://raw.githubusercontent.com/user/my-repo/panda/themes/index.json" />
    )
    expect(screen.getByText('user/my-repo (panda)')).toBeInTheDocument()
  })

  it('renders verified icon when isVerified is explicitly true', () => {
    const { container } = render(
      <PluginSourcePill url="https://example.com/index.json" isVerified={true} />
    )
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
