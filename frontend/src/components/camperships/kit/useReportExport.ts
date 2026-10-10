import { useCallback, useMemo, useState } from 'react'

import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { copyText, csvLines, type ReportColumn, type ReportHeading, type ReportRow } from './report'

const COPY_FAILED = "Couldn't copy here: use Download CSV."

/**
 * Copy and Download CSV for one Reports table, as hooks, so the buttons can sit anywhere: on the
 * table's own heading row, or on a page's controls row (Statistics' first table has no heading row of
 * its own). Both take exactly the rows given: what the table shows, in its order (RPT-33).
 * Success is `copied` (the Copy button itself reads "✓ Copied" in place); a failure is `failed`, the words
 * for the status slot, because it has to say why.
 */
export function useReportExport({
  heading,
  columns,
  rows,
  csvFilename,
  link,
}: {
  readonly heading: ReportHeading
  readonly columns: readonly ReportColumn[]
  readonly rows: readonly ReportRow[]
  readonly csvFilename: string
  /** The view's link, for the CSV's last line (D15). */
  readonly link: string
}) {
  // The status belongs to the table it copied: a new choice (new rows or heading) clears it, so "✓ Copied"
  // never sits beside a table nobody copied and never hides the status that table would show.
  const text = useMemo(() => copyText(heading, columns, rows), [heading, columns, rows])
  const [status, setStatus] = useState<{
    readonly failed: string | null
    readonly text: string
  } | null>(null)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ failed: null, text })
    } catch {
      setStatus({ failed: COPY_FAILED, text })
    }
  }, [text])
  const current = status !== null && status.text === text ? status : null
  const copied = current !== null && current.failed === null
  const failed = current?.failed ?? null
  const download = useCallback(() => {
    const [first = [], ...rest] = csvLines(heading, columns, rows, link)
    downloadCsv(buildCsvContent(first, rest), csvFilename)
  }, [heading, columns, rows, link, csvFilename])
  return { copy, download, copied, failed }
}
