/**
 * The GM screen (issue #764): a campaign's board of tools, for its GM alone.
 *
 * Panels are written one at a time, so ticking a countdown on one device does
 * not undo a panel moved on another. Moving panels sends every cell a drag
 * changed in one `saveLayout`.
 */
import { client, type BodyOf } from './client'

const campaign = (campaignId: string) => ({ campaign_id: campaignId })
const panel = (campaignId: string, panelId: string) => ({
  campaign_id: campaignId,
  panel_id: panelId,
})

export const gmScreen = {
  get: (campaignId: string) =>
    client.get('/campaigns/{campaign_id}/gm-screen', { path: campaign(campaignId) }),
  addPanel: (
    campaignId: string,
    body: BodyOf<'/campaigns/{campaign_id}/gm-screen/panels', 'post'>
  ) =>
    client.post('/campaigns/{campaign_id}/gm-screen/panels', { path: campaign(campaignId), body }),
  updatePanel: (
    campaignId: string,
    panelId: string,
    body: BodyOf<'/campaigns/{campaign_id}/gm-screen/panels/{panel_id}', 'patch'>
  ) =>
    client.patch('/campaigns/{campaign_id}/gm-screen/panels/{panel_id}', {
      path: panel(campaignId, panelId),
      body,
    }),
  removePanel: (campaignId: string, panelId: string) =>
    client.delete('/campaigns/{campaign_id}/gm-screen/panels/{panel_id}', {
      path: panel(campaignId, panelId),
    }),
  saveLayout: (
    campaignId: string,
    panels: BodyOf<'/campaigns/{campaign_id}/gm-screen/layout', 'put'>['panels']
  ) =>
    client.put('/campaigns/{campaign_id}/gm-screen/layout', {
      path: campaign(campaignId),
      body: { panels },
    }),
  reset: (campaignId: string, scope: 'scene' | 'session' | 'rest') =>
    client.post('/campaigns/{campaign_id}/gm-screen/reset', {
      path: campaign(campaignId),
      body: { scope },
    }),
  sources: (campaignId: string) =>
    client.get('/campaigns/{campaign_id}/gm-screen/sources', { path: campaign(campaignId) }),
  copy: (campaignId: string, sourceCampaignId: string, replace: boolean) =>
    client.post('/campaigns/{campaign_id}/gm-screen/copy', {
      path: campaign(campaignId),
      body: { source_campaign_id: sourceCampaignId, replace },
    }),
  exportBoard: (campaignId: string) =>
    client.get('/campaigns/{campaign_id}/gm-screen/export', { path: campaign(campaignId) }),
  importBoard: (campaignId: string, document: Record<string, unknown>, replace: boolean) =>
    client.post('/campaigns/{campaign_id}/gm-screen/import', {
      path: campaign(campaignId),
      body: { document, replace },
    }),
  presets: (campaignId: string) =>
    client.get('/campaigns/{campaign_id}/gm-screen/presets', { path: campaign(campaignId) }),
  applyPreset: (campaignId: string, presetId: string, indexUrl: string | null, replace: boolean) =>
    client.post('/campaigns/{campaign_id}/gm-screen/presets/apply', {
      path: campaign(campaignId),
      body: { preset_id: presetId, index_url: indexUrl, replace },
    }),
  party: (campaignId: string) =>
    client.get('/campaigns/{campaign_id}/gm-screen/party', { path: campaign(campaignId) }),
}
