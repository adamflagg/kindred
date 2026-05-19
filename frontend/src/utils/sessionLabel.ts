/** Short display label for a session cm_id: last 4 digits.
 *
 * Examples:
 *   '1000001' → '0001'
 *   '1000003' → '0003'
 *   '42'      → '42'   (already short)
 *   undefined → ''     (defensive: missing session_cm_id from legacy data)
 */
export function sessionShortLabel(sessionId: string | undefined | null): string {
  if (!sessionId) return ''
  return sessionId.length > 4 ? sessionId.slice(-4) : sessionId
}
