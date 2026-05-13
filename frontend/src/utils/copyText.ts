/**
 * Copy text to the clipboard with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is only defined on HTTPS and http://localhost — viewing
 * a dev server over a LAN IP (e.g. http://192.168.x.x:3020) leaves it undefined
 * and the modern API silently unavailable. Falls back to a hidden textarea +
 * `document.execCommand('copy')`, which still works in that context.
 *
 * Returns true on success, false if both paths fail.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to legacy path
    }
  }
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  let ok: boolean
  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(ta)
  }
  return ok
}
