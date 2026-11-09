import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AccessArea from './AccessArea'
import type { SettingsVisibility } from '../registry'

// Share links by role, category access and campaign uploads have tests of
// their own; the all-keys audit runs for real, since which view of the keys
// this page asks for is the point.
vi.mock('../ShareLinkRolesSection', () => ({ default: () => <div>share-link-roles</div> }))
vi.mock('../CategoryAccessSection', () => ({ default: () => <div>category-access</div> }))
vi.mock('../FolderAccessSection', () => ({ default: () => <div>folder-access</div> }))
vi.mock('../CampaignUploadsSection', () => ({ default: () => <div>campaign-uploads</div> }))

vi.mock('../../../api', () => ({
  apiKeys: {
    list: vi.fn(),
    permissions: vi.fn(),
  },
}))

import { apiKeys as apiKeysApi } from '../../../api'

const ALL: SettingsVisibility = {
  isAdmin: true,
  apiKeys: true,
  apiKeysOnInstance: true,
  shareLinks: true,
  codex: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(apiKeysApi.list).mockResolvedValue([] as never)
  vi.mocked(apiKeysApi.permissions).mockResolvedValue([] as never)
})

describe('AccessArea', () => {
  it('holds the server-wide access settings', () => {
    render(<AccessArea visibility={{ ...ALL, apiKeysOnInstance: false }} />)
    for (const label of [
      'share-link-roles',
      'category-access',
      'folder-access',
      'campaign-uploads',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it("shows every user's keys, with no create button", async () => {
    render(<AccessArea visibility={ALL} />)
    expect(await screen.findByText('All API Keys')).toBeInTheDocument()
    expect(apiKeysApi.list).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('button', { name: /create api key/i })).toBeNull()
  })

  // An admin who may not hold keys personally still audits everyone's.
  it('shows the keys audit whenever the instance has keys', async () => {
    render(<AccessArea visibility={{ ...ALL, apiKeys: false }} />)
    expect(await screen.findByText('All API Keys')).toBeInTheDocument()
  })

  it('hides the keys view when keys are off for the instance', () => {
    render(<AccessArea visibility={{ ...ALL, apiKeysOnInstance: false }} />)
    expect(screen.queryByText('All API Keys')).toBeNull()
    expect(apiKeysApi.list).not.toHaveBeenCalled()
  })

  it('leaves share links by role out when the instance has no share links', () => {
    render(<AccessArea visibility={{ ...ALL, shareLinks: false, apiKeysOnInstance: false }} />)
    expect(screen.queryByText('share-link-roles')).toBeNull()
  })
})
