import { useEffect, useState } from 'react'
import { campaigns as campaignsApi } from '../../api'

/**
 * The campaigns a character can be placed in: every campaign the user owns -
 * a GM campaign or a personal one kept for their own notes - plus every one
 * they have joined.
 *
 * The campaign list also carries invitations still waiting for an answer.
 * Those are left out, because the server refuses a character in a game the
 * player has not joined yet, and offering it here would only lead to that
 * refusal.
 */
export function placeableCampaigns(list) {
  const rows = Array.isArray(list) ? list : list?.campaigns || []
  return rows.filter((campaign) => campaign.invitation_status !== 'invited')
}

export default function useCharacterCampaigns({ enabled = true } = {}) {
  const [campaigns, setCampaigns] = useState([])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    campaignsApi
      .list()
      .then((list) => {
        if (!cancelled) setCampaigns(placeableCampaigns(list))
      })
      // The campaign is optional; a list that will not load just leaves it out.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled])

  return campaigns
}
