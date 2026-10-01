type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

/**
 * The sentence worth showing for a failed PocketBase call, with one trailing
 * period stripped so the caller's own punctuation never doubles it.
 *
 * A refused batch is a 400 "Batch transaction failed." whose real reason (a
 * rule or hook message such as "You can't change your own roles. Ask an
 * admin.") sits at data.requests[i].response.message, and a validation failure
 * (a duplicate slug) at data.<field>.message. Both beat the generic top-level
 * message.
 */
export function pbErrorText(err: unknown): string {
  const raw = describe(err)
  return raw.endsWith('.') ? raw.slice(0, -1) : raw
}

const at = (o: unknown, key: string): unknown => (isObj(o) ? o[key] : undefined)

function describe(err: unknown): string {
  if (!isObj(err)) return 'Unknown error'
  const data = at(at(err, 'response'), 'data')
  if (isObj(data)) {
    const requests = at(data, 'requests')
    if (isObj(requests)) {
      for (const sub of Object.values(requests)) {
        const m = text(at(at(sub, 'response'), 'message'))
        if (m) return m
      }
    }
    for (const [key, field] of Object.entries(data)) {
      if (key === 'requests') continue
      const m = text(at(field, 'message'))
      if (m) return m
    }
  }
  return text(at(err, 'message')) ?? 'Unknown error'
}
