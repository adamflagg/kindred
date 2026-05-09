/**
 * Tiny JSON export utility tests.
 *
 * Mirrors the pattern in csvExport.ts: build a Blob, attach an anchor to the
 * DOM, click it, then revoke the object URL.
 */
import { describe, expect, it, vi } from 'vitest'

import { downloadJson } from './jsonExport'

describe('downloadJson', () => {
  it('creates an object URL, triggers anchor click, and revokes the URL', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url')
    const revokeObjectURL = vi.fn()
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    try {
      downloadJson({ foo: 'bar', n: 42 }, 'sample.json')

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0]?.[0] as Blob
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('application/json')
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      clickSpy.mockRestore()
    }
  })

  it('serializes the payload as pretty-printed JSON', async () => {
    const createObjectURL = vi
      .fn()
      .mockImplementation((blob: Blob) => `blob:${blob.size}-${blob.type}`)
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = vi.fn()

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    try {
      const payload = [{ id: 'a', n: 1 }]
      downloadJson(payload, 'rows.json')
      const blob = createObjectURL.mock.calls[0]?.[0] as Blob
      const text = await blob.text()
      expect(JSON.parse(text)).toEqual(payload)
      // Pretty-printed: contains a newline, not a single-line minified blob.
      expect(text).toContain('\n')
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      clickSpy.mockRestore()
    }
  })
})
