/**
 * Tiny CSV export utility.
 * No external deps — builds a CSV string and triggers a browser download.
 * Follows RFC 4180: fields containing commas, double-quotes, or newlines are
 * wrapped in double-quotes; internal double-quotes are escaped by doubling.
 */

/**
 * Escape a single CSV field value per RFC 4180.
 * Returns the field (possibly quoted) as a string.
 */
function escapeField(value: string): string {
  // OWASP formula-injection guard: neutralize leading =, +, -, @, \t, \r
  // by prefixing with a literal apostrophe so spreadsheets treat it as text.
  if (value.length > 0 && /^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`
  }
  // RFC 4180: wrap in double-quotes if the value contains commas, double-quotes,
  // newlines, or carriage-returns; double any existing double-quotes.
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Build a CSV string from a header row and data rows.
 * All values must already be strings; convert numbers before calling.
 *
 * @param headers - Column header names
 * @param rows    - Array of string arrays; each inner array is one data row
 * @returns       - Full CSV string (no trailing newline)
 */
export function buildCsvContent(headers: string[], rows: string[][]): string {
  const lines: string[] = [headers.map(escapeField).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeField).join(','))
  }
  return lines.join('\n')
}

/**
 * Trigger a browser download of the given CSV string.
 *
 * @param csvContent - The full CSV string to download
 * @param filename   - The filename to suggest (e.g. "bunk-B-6A-2025-04-23.csv")
 */
export function downloadCsv(csvContent: string, filename: string): void {
  // Prepend a UTF-8 BOM (U+FEFF). Excel-on-Windows ignores the blob MIME
  // charset when a downloaded .csv is double-clicked and decodes with the
  // system ANSI code page unless a BOM leads the file — without it, accented
  // names (José, Núñez) render as mojibake. Excel and Google Sheets both strip
  // the BOM on import.
  const blob = new Blob(['\uFEFF', csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  // Firefox requires the anchor to be attached to the DOM before click()
  // triggers a file download. Chrome/Safari work without it, masking this bug.
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Convert an arbitrary string into a URL-safe slug.
 * Lowercases, replaces non-alphanumeric sequences with a single hyphen,
 * and trims leading/trailing hyphens.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Return today's date as YYYY-MM-DD.
 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
