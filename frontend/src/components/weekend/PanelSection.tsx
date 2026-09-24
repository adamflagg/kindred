/** A slide-in panel section: an uppercase heading over its rows. Moved out of FamilyDetailsPanel (kindred#2759). */
import type { ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}
