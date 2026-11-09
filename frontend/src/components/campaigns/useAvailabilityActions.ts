import { campaigns } from '../../api'

/** The body for setting one availability cell.
 *
 * `user_id` goes only when a GM is editing another member's row; the backend
 * defaults to the caller when it's absent.
 */
export function availabilityBody(
  status: string,
  targetUserId: string | undefined,
  viewerId: string | undefined
): { status: string; user_id?: string } {
  return targetUserId && targetUserId !== viewerId ? { status, user_id: targetUserId } : { status }
}

/** The availability chart's set and cancel actions, shared by every view that
 * shows the chart so they can't drift apart. `reload` runs after each change. */
export default function useAvailabilityActions(
  campaignId: string,
  viewerId: string | undefined,
  reload: () => unknown
) {
  const setAvailability = async (date: string, status: string, targetUserId?: string) => {
    await campaigns.setAvailability(
      campaignId,
      date,
      availabilityBody(status, targetUserId, viewerId)
    )
    void reload()
  }
  const cancelDate = async (date: string) => {
    await campaigns.cancelDate(campaignId, date)
    void reload()
  }
  return { setAvailability, cancelDate }
}
