/**
 * The Audit Log tab's visual grammar, lifted from the approved mockup v8 and the
 * real components it cites: the toolbar is SyncTab.tsx's (:455-491), the table
 * SheetsTab.tsx's (:199-233), buttons lodgingStyles.ts's. Every colour is a
 * semantic token or is paired with its `dark:` counterpart; auditStyles.test.ts
 * holds that line. `text-xs` is the floor (lodgingStyles.ts).
 */
import type { AuditType } from '../../../types/auditLog'

/** SyncTab's toolbar card. */
export const TOOLBAR =
  'bg-card border-border shadow-lodge-sm flex flex-wrap items-center gap-2.5 rounded-xl border p-3'
export const SEARCH_INPUT =
  'bg-muted/40 border-border focus:ring-primary/20 w-full rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none'
/** SyncTab's segmented group, and its buttons. */
export const GROUP =
  'bg-muted/55 dark:bg-muted/30 border-border flex flex-wrap gap-0.5 rounded-xl border p-1'
const GROUP_BUTTON = 'rounded-md px-3 py-1.5 text-xs font-medium transition-colors'
export const GROUP_BUTTON_ON = `${GROUP_BUTTON} bg-primary text-primary-foreground`
export const GROUP_BUTTON_OFF = `${GROUP_BUTTON} text-muted-foreground hover:text-foreground`
export const PERSON_SELECT =
  'bg-background border-border rounded-lg border px-3 py-2 text-sm font-medium focus:outline-none'

/** SheetsTab's table. */
export const TABLE_CARD = 'bg-card border-border shadow-lodge-sm overflow-hidden rounded-xl border'
export const TH =
  'text-muted-foreground border-border border-b px-3 py-2 text-left text-sm font-medium'
export const ROW = 'border-border hover:bg-muted/30 border-b transition-colors last:border-0'
export const TD = 'px-3 py-2.5 align-top'

/** The type pill, one colour per type (mockup v8 .c-*). */
const PILL =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'
export const TYPE_PILL: Record<AuditType, string> = {
  access: `${PILL} bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400`,
  roles: `${PILL} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300`,
  view_as: `${PILL} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`,
  settings: `${PILL} bg-sky-100 text-sky-700 dark:bg-sky-900/35 dark:text-sky-300`,
  pb_admin: `${PILL} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`,
  sign_in: `${PILL} bg-muted text-muted-foreground`,
}

/** A role or persona name inside a sentence. */
export const CHIP = 'bg-primary/12 text-primary rounded-md px-1.5 py-px text-xs font-medium'
/** Collection and record id under a PB Admin sentence; field names in Before/After. */
export const MONO_NOTE = 'text-muted-foreground font-mono text-xs'
/** A Before value, and an After value. */
export const OLD_VALUE = 'rounded bg-red-100 px-1.5 py-px dark:bg-red-900/35'
export const NEW_VALUE = 'rounded bg-emerald-100 px-1.5 py-px dark:bg-emerald-900/35'
