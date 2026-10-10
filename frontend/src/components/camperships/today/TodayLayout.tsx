import type { ReactNode } from 'react'

/** Spec §3.3: the heading in its own grid row, so the first table and the right column start level (owner feedback). */
export function TodayLayout({
  head,
  left,
  right,
}: {
  head: ReactNode
  left: ReactNode
  right: ReactNode | null
}) {
  if (right === null)
    return (
      <div className="space-y-2.5">
        {head}
        {left}
      </div>
    )
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-x-3">
      <div className="mb-1.5">{head}</div>
      <div />
      <div className="flex min-w-0 flex-col gap-2.5">{left}</div>
      <div className="flex min-w-0 flex-col gap-2.5">{right}</div>
    </div>
  )
}
