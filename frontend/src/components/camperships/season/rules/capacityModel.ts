/** Reading a typed session capacity (spec §6.3; `CapacitySet`: a whole number, 0 to 5,000). Pure. */

/** The server's limit (api/schemas/financial_aid_intake.py `CapacitySet`). */
const MAX_CAPACITY = 5000

export type CapacityRead =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string }

/** A whole number of places, 0 to 5,000, or why not; commas group thousands. */
export function readCapacity(raw: string): CapacityRead {
  const text = raw.trim()
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(text))
    return { ok: false, reason: 'A whole number of places' }
  const value = Number(text.replaceAll(',', ''))
  return value > MAX_CAPACITY ? { ok: false, reason: 'At most 5,000' } : { ok: true, value }
}
