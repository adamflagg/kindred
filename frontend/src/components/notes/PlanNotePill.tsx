import { FlaskConical } from 'lucide-react'

/**
 * A plan-only note's label: the scenario's name in the app's own Draft
 * language (`ModeBadge`: emerald, FlaskConical). A standard note has no pill
 * at all (owner, 2026-09-25).
 */
export function PlanNotePill({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-px font-semibold whitespace-nowrap text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 ${
        small ? 'text-[10px]' : 'text-[10.5px]'
      }`}
    >
      <FlaskConical className="h-3 w-3 flex-shrink-0" />
      {name}
    </span>
  )
}
