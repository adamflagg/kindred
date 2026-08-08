/**
 * A domain API failure that still knows its HTTP status.
 *
 * Shared by every fetch-based API client in this codebase (`lodgingApi.ts`,
 * `scenariosApi.ts`, ...). The lodging seed's 409 ("this scenario already
 * holds placements") is the reason `.status` matters: it's a normal thing
 * for staff to bump into, not a fault, and the UI has to say "already
 * seeded" rather than "failed" — `detail` is prose the server is free to
 * reword, so status is the only reliable way to tell the two apart.
 *
 * Each domain keeps its OWN named subclass (`LodgingApiError`,
 * `ScenarioApiError`) rather than callers using this class directly:
 * narrowing by `instanceof` can go silently false across a duplicate
 * module instance, so callers narrow on `.status` instead — the subclass
 * name is for stack traces and DevTools, not for narrowing.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Turn a non-ok `Response` into an `ApiError` (of the caller's own
 * subclass) carrying FastAPI's `detail` when it has one, so a 404 reads as
 * a sentence rather than a bare status code.
 */
export async function toApiError<E extends ApiError>(
  response: Response,
  fallback: string,
  ErrorClass: new (message: string, status: number) => E
): Promise<E> {
  let detail: unknown
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      detail = body.detail
    }
  } catch {
    detail = undefined
  }
  if (typeof detail === 'string' && detail.length > 0) {
    return new ErrorClass(detail, response.status)
  }
  return new ErrorClass(`${fallback} (HTTP ${String(response.status)})`, response.status)
}
