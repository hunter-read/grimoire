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
    expect(formatIndexUrl('https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml'))
      .toBe('grimoire-codex/community-add-ons')
  })

  it('formats non-main branch github urls as owner/repo (branch)', () => {
    expect(formatIndexUrl('https://raw.githubusercontent.com/user/my-repo/panda/themes/index.json'))
      .toBe('user/my-repo (panda)')
  })

  it('handles refs/heads/branch in github raw urls', () => {
    expect(formatIndexUrl('https://raw.githubusercontent.com/user/my-repo/refs/heads/feature-1/themes/index.json'))
      .toBe('user/my-repo (feature-1)')
  })

  it('returns hostname for non-github urls', () => {
    expect(formatIndexUrl('https://example.com/custom/path/dog.yml')).toBe('example.com')
  })
})

describe('PluginSourcePill', () => {
  it('renders nothing when url is missing', () => {
    const { container } = render(<PluginSourcePill />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders formatted pill text for main branch source', () => {
    render(<PluginSourcePill url="https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml" />)
    expect(screen.getByText('grimoire-codex/community-add-ons')).toBeInTheDocument()
  })

  it('renders branch name in pill text for custom branch source', () => {
    render(<PluginSourcePill url="https://raw.githubusercontent.com/user/my-repo/panda/themes/index.json" />)
    expect(screen.getByText('user/my-repo (panda)')).toBeInTheDocument()
  })
})
