import { ChevronDown, Copy, Download } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { CS_BTN_CSV } from './csType'

const ICON = 'text-muted-foreground h-3.5 w-3.5 flex-none'

/**
 * Download CSV (design-language §4; kit CF.csv): the small 26px button, the same on every page and
 * always last on its row. With a `menu` (Requests › Needs an offer › R1: the March File) it is a split
 * button whose 22px caret opens the menu; Esc and a press outside close it. The control and its menu
 * sit at z-50, above the screen box's sticky headers (z-40).
 */
export function AidCsvButton({
  onDownload,
  menu,
  label = 'Download CSV',
}: {
  readonly onDownload: () => void
  readonly menu?: ReactNode
  readonly label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const hasMenu = menu !== undefined
  // The menu going away (a view change) closes it, so it never reopens by itself when it returns.
  if (!hasMenu && open) setOpen(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPress = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPress)
    }
  }, [open])

  if (!hasMenu) {
    return (
      <button type="button" className={CS_BTN_CSV} onClick={onDownload}>
        <Download className={ICON} />
        {label}
      </button>
    )
  }
  return (
    <div ref={ref} className="relative z-50 inline-flex flex-none">
      <button type="button" className={`${CS_BTN_CSV} rounded-r-none`} onClick={onDownload}>
        <Download className={ICON} />
        {label}
      </button>
      <button
        type="button"
        aria-label="More downloads"
        title="More downloads"
        className={`${CS_BTN_CSV} w-[22px] justify-center rounded-l-none border-l-0 px-0 ${open ? 'bg-muted' : ''}`}
        onClick={() => setOpen((was) => !was)}
      >
        <ChevronDown className={ICON} />
      </button>
      {open && (
        <div
          data-testid="csv-menu"
          onClick={() => setOpen(false)}
          className="border-border bg-card text-card-foreground absolute top-full right-0 z-50 mt-1 min-w-72 rounded-[10px] border p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={onDownload}
            className="hover:bg-muted block w-full rounded-md px-2.5 py-1 text-left"
          >
            <span className="flex items-center gap-2 text-[12.5px] leading-[18px] font-semibold">
              <Download className={ICON} />
              {label}
            </span>
            <span className="text-muted-foreground mt-0.5 ml-[22px] block text-xs">
              This list, as filtered
            </span>
          </button>
          <hr className="border-border mx-1.5 my-1" />
          {menu}
        </div>
      )}
    </div>
  )
}

/** Copy (kit CF.copy): the same small button, for a report table's tab-separated copy. */
export function AidCopyButton({ onCopy }: { readonly onCopy: () => void }) {
  return (
    <button type="button" className={CS_BTN_CSV} onClick={onCopy}>
      <Copy className={ICON} />
      Copy
    </button>
  )
}
