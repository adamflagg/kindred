/**
 * Tests for csvExport utility.
 * TDD: Tests written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCsvContent, downloadCsv, slugify } from './csvExport'

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('removes special characters', () => {
    expect(slugify('B-6A (Boys)')).toBe('b-6a-boys')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('A  --  B')).toBe('a-b')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  hello  ')).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// escapeField — formula-injection guard
// ---------------------------------------------------------------------------
// Import the unexported escapeField indirectly via buildCsvContent:
// buildCsvContent(['H'], [[value]]).split('\n')[1] gives the escaped field.
function escape(value: string): string {
  return buildCsvContent(['H'], [[value]]).split('\n')[1] ?? ''
}

describe('escapeField — formula injection guard', () => {
  it('prefixes = with apostrophe to neutralize spreadsheet formula', () => {
    expect(escape('=SUM(A1)')).toBe("'=SUM(A1)")
  })

  it('prefixes + with apostrophe', () => {
    expect(escape('+12')).toBe("'+12")
  })

  it('prefixes - with apostrophe', () => {
    expect(escape('-Alice')).toBe("'-Alice")
  })

  it('prefixes @ with apostrophe', () => {
    expect(escape('@handle')).toBe("'@handle")
  })

  it('prefixes tab character with apostrophe', () => {
    expect(escape('\tfoo')).toBe("'\tfoo")
  })

  it('prefixes carriage-return character with apostrophe', () => {
    // \r triggers the CSV quoting too, so the result is quoted
    expect(escape('\rbar')).toBe(`"'\rbar"`)
  })

  it('does NOT prefix normal field values', () => {
    expect(escape('Alice Smith')).toBe('Alice Smith')
  })

  it('does NOT prefix empty string', () => {
    expect(escape('')).toBe('')
  })

  it('does NOT prefix a field starting with a digit', () => {
    expect(escape('12345')).toBe('12345')
  })
})

// ---------------------------------------------------------------------------
// buildCsvContent
// ---------------------------------------------------------------------------
describe('buildCsvContent', () => {
  it('puts header row first', () => {
    const csv = buildCsvContent(['Name', 'Age'], [['Emma Johnson', '12']])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Name,Age')
  })

  it('includes data rows after header', () => {
    const csv = buildCsvContent(['Name', 'Age'], [['Emma Johnson', '12']])
    const lines = csv.split('\n')
    expect(lines[1]).toBe('Emma Johnson,12')
  })

  it('escapes commas by quoting the field', () => {
    const csv = buildCsvContent(['Name'], [['Johnson, Emma']])
    const lines = csv.split('\n')
    expect(lines[1]).toBe('"Johnson, Emma"')
  })

  it('escapes double-quotes by doubling them (RFC 4180)', () => {
    const csv = buildCsvContent(['Note'], [['"quoted"']])
    const lines = csv.split('\n')
    expect(lines[1]).toBe('"""quoted"""')
  })

  it('escapes newlines inside a field', () => {
    const csv = buildCsvContent(['Note'], [['line1\nline2']])
    const lines = csv.split('\n')
    // The field containing a newline should be quoted — result has > 2 lines total
    // but the first data field must start with a quote
    expect(lines[1]).toMatch(/^"/)
  })

  it('handles empty rows list with just a header', () => {
    const csv = buildCsvContent(['Name', 'Age'], [])
    expect(csv).toBe('Name,Age')
  })

  it('produces correct row count', () => {
    const csv = buildCsvContent(['Name'], [['Emma Johnson'], ['Liam Garcia'], ['Olivia Chen']])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(4) // header + 3 rows
  })

  it('handles numeric values (converts to string)', () => {
    const csv = buildCsvContent(['Name', 'Grade'], [['Emma Johnson', '7']])
    expect(csv).toContain('7')
  })
})

// ---------------------------------------------------------------------------
// downloadCsv
// ---------------------------------------------------------------------------
describe('downloadCsv', () => {
  beforeEach(() => {
    // Mock DOM APIs that aren't available in jsdom by default
    const mockUrl = 'blob:mock-url'
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => mockUrl),
      revokeObjectURL: vi.fn(),
    })
  })

  /** Helper: returns a mock anchor + stubs body.appendChild/removeChild to accept it */
  function makeMockAnchor(clickImpl?: () => void) {
    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(clickImpl),
    }
    vi.spyOn(document.body, 'appendChild').mockReturnValue(mockAnchor as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockReturnValue(mockAnchor as unknown as Node)
    vi.spyOn(document, 'createElement').mockReturnValueOnce(
      mockAnchor as unknown as HTMLAnchorElement
    )
    return mockAnchor
  }

  it('creates an anchor element and triggers click', () => {
    const mockAnchor = makeMockAnchor()

    downloadCsv('test content', 'test-file.csv')

    expect(mockAnchor.click).toHaveBeenCalledOnce()
    expect(mockAnchor.download).toBe('test-file.csv')
  })

  it('revokes the object URL after triggering download', () => {
    makeMockAnchor()

    downloadCsv('test content', 'test-file.csv')

    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('uses text/csv MIME type', () => {
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    makeMockAnchor()

    downloadCsv('a,b', 'file.csv')

    expect(blobSpy).toHaveBeenCalledWith(['\uFEFF', 'a,b'], { type: 'text/csv;charset=utf-8;' })
  })

  // Excel-on-Windows ignores the blob MIME charset when a downloaded .csv is
  // double-clicked; it decodes with the system ANSI code page unless a UTF-8
  // BOM leads the file. Prepending U+FEFF makes accented names render correctly
  // (Excel and Google Sheets both strip the BOM on import).
  it('prepends a UTF-8 BOM as the first blob part', () => {
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    makeMockAnchor()

    downloadCsv('name\nJosé', 'file.csv')

    const parts = blobSpy.mock.calls[0]?.[0] as string[]
    expect(parts[0]).toBe('\uFEFF')
    expect(parts[1]).toBe('name\nJosé')
  })

  // #996 — Firefox requires anchor to be in the DOM before click()
  it('appends anchor to document.body before click (Firefox compatibility)', () => {
    const callOrder: string[] = []
    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(() => callOrder.push('click')),
    }
    const appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node: Node) => {
        callOrder.push('appendChild')
        return node
      })
    const removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation((node: Node) => {
        callOrder.push('removeChild')
        return node
      })
    vi.spyOn(document, 'createElement').mockReturnValueOnce(
      mockAnchor as unknown as HTMLAnchorElement
    )

    downloadCsv('test', 'file.csv')

    // appendChild must happen before click, removeChild after
    expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor)
    expect(removeChildSpy).toHaveBeenCalledWith(mockAnchor)
    expect(callOrder.indexOf('appendChild')).toBeLessThan(callOrder.indexOf('click'))
    expect(callOrder.indexOf('click')).toBeLessThan(callOrder.indexOf('removeChild'))
  })
})
