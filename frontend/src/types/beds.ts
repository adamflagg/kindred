/**
 * Bed inventory vocabulary.
 *
 * This is POLICY, not site reality, so it lives in code — unlike the unit,
 * area and alias lists, which are rows (spec §3.8). "How many people does a
 * queen sleep" does not change when a yurt gets a bathroom.
 *
 * The arithmetic produces a SUGGESTION only. `sleeps` on the unit row stays
 * the authoritative number every consumer reads (the roster's fit note, the
 * `units_capacity_unknown` count), because real capacity depends on bed size
 * AND on who can share a bed — a judgement staff make, not a sum.
 */

export interface BedTypeDef {
  id: string
  label: string
  /** People this bed is assumed to sleep. */
  sleeps: number
}

export const BED_TYPES: readonly BedTypeDef[] = [
  { id: 'twin', label: 'Twin', sleeps: 1 },
  { id: 'twin_bunk', label: 'Bunk (twin over twin)', sleeps: 2 },
  { id: 'full', label: 'Full', sleeps: 2 },
  { id: 'queen', label: 'Queen', sleeps: 2 },
  { id: 'king', label: 'King', sleeps: 2 },
  { id: 'futon', label: 'Futon', sleeps: 2 },
  { id: 'cot', label: 'Cot', sleeps: 1 },
  { id: 'trundle', label: 'Trundle', sleeps: 1 },
] as const

export type BedType = (typeof BED_TYPES)[number]['id']

export interface BedEntry {
  type: BedType
  count: number
}

export type BedInventory = BedEntry[]

const BY_ID = new Map(BED_TYPES.map((b) => [b.id, b]))

export function bedTypeLabel(type: string): string {
  return BY_ID.get(type)?.label ?? type
}

/**
 * People the inventory suggests, ignoring types it does not recognise.
 *
 * Returns 0 for an empty inventory. Callers must treat 0 as UNKNOWN, matching
 * `sleeps` — it never means "sleeps nobody".
 */
export function suggestedSleeps(beds: BedInventory): number {
  return beds.reduce((total, entry) => {
    const def = BY_ID.get(entry.type)
    return def ? total + def.sleeps * entry.count : total
  }, 0)
}

/** Physical beds, not sleepers. A bunk is one bed that sleeps two. */
export function totalBedCount(beds: BedInventory): number {
  return beds.reduce((total, entry) => total + entry.count, 0)
}

/**
 * Coerce whatever PocketBase returns into a usable inventory.
 *
 * The column is JSON and was added after rows already existed, so a row can
 * carry null. Some PocketBase clients also hand back a JSON column as a
 * string. Neither should reach a render as a crash.
 */
export function normaliseBeds(value: unknown): BedInventory {
  let raw = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []

  const out: BedInventory = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const type = record['type']
    const count = record['count']
    if (typeof type !== 'string' || !BY_ID.has(type)) continue
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue
    out.push({ type, count: Math.floor(count) })
  }
  return out
}
