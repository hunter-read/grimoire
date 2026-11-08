import type { Schema } from '../../api'

type RosterUnit = Schema<'RosterUnit'>
type RosterForce = Schema<'RosterForce'>

/** The message an API failure carries, for showing beside the form that sent it. */
export function errorMessage(err: unknown, fallback = ''): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** A unit's points in `costName`, its upgrades and models included. */
export function unitTotal(unit: RosterUnit, costName: string): number {
  const own = (unit.costs ?? [])
    .filter((c) => c.name === costName)
    .reduce((sum, c) => sum + (c.value ?? 0), 0)
  return own + (unit.children ?? []).reduce((sum, child) => sum + unitTotal(child, costName), 0)
}

/** Every force in a roster, nested ones included, in reading order. */
export function flattenForces(forces: RosterForce[] | undefined): RosterForce[] {
  const out: RosterForce[] = []
  for (const force of forces ?? []) {
    out.push(force)
    out.push(...flattenForces(force.forces))
  }
  return out
}

/** Whether an army is over its points limit (none set is never over). */
export function overLimit(army: { points?: number; points_limit?: number | null }): boolean {
  return !!army.points_limit && (army.points ?? 0) > army.points_limit
}

/** A number input's value as a number, or null when it is empty. */
export function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
