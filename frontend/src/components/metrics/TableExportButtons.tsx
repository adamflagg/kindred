import { useState } from 'react'
import { buildCsvContent, downloadCsv } from '../../utils/csvExport'
import { AidCopyButton, AidCsvButton } from '../camperships/kit/CsvButton'

export type ExportCell = string | number | null | undefined

/** One cell as the file holds it: numbers stay numbers, an empty value is an empty cell. */
function cellText(cell: ExportCell): string {
  return cell === null || cell === undefined ? '' : String(cell)
}

/**
 * Copy beside Download CSV on an Analytics table (#3207 PR 10, rulings #63-#64; decision 8's pair).
 * `rows` are the rows in the order on screen, Total last. Copy is the same table tab-separated, for
 * pasting into a spreadsheet. Both are hidden on paper (data-app-chrome).
 */
export function TableExportButtons({
  filename,
  headers,
  rows,
}: {
  readonly filename: string
  readonly headers: readonly string[]
  readonly rows: ReadonlyArray<readonly ExportCell[]>
}) {
  const [copied, setCopied] = useState(false)
  const body = rows.map((row) => row.map(cellText))

  const copy = async () => {
    const tsv = [headers, ...body]
      .map((row) => row.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t'))
      .join('\n')
    try {
      await navigator.clipboard.writeText(tsv)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div data-app-chrome className="flex flex-none items-center gap-2">
      <AidCopyButton
        copied={copied}
        onCopy={() => void copy()}
        title="Copy this table for a spreadsheet"
      />
      <AidCsvButton onDownload={() => downloadCsv(buildCsvContent([...headers], body), filename)} />
    </div>
  )
}
