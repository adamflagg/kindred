import {
  FolderTree,
  Calendar,
  Users,
  User,
  Layout,
  UserCheck,
  UserX,
  FileText,
  Brain,
  Tag,
  FileSpreadsheet,
  BedDouble,
  Globe,
  Layers,
  Tent,
  ClipboardList,
  DollarSign,
  Receipt,
  Home,
  Sparkles,
  HandCoins,
  Heart,
  Database,
  GitBranch,
  Bus,
  Utensils,
  Mountain,
  Car,
  MapPin,
  Camera,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'

// Sync phase definitions
export type SyncPhase = 'source' | 'expensive' | 'transform' | 'process' | 'export'

export const SYNC_PHASES: Array<{
  id: SyncPhase
  name: string
  description: string
  icon: LucideIcon
}> = [
  {
    id: 'source',
    name: 'CampMinder',
    description: 'Sync from CampMinder API',
    icon: Database,
  },
  {
    id: 'expensive',
    name: 'Custom Values',
    description: '1 API call per entity',
    icon: Sparkles,
  },
  {
    id: 'transform',
    name: 'Transform',
    description: 'Compute derived tables',
    icon: GitBranch,
  },
  {
    id: 'process',
    name: 'Process',
    description: 'CSV import + AI',
    icon: Brain,
  },
  {
    id: 'export',
    name: 'Export',
    description: 'Google Sheets',
    icon: FileSpreadsheet,
  },
]

// Global sync types - cross-year data not tied to a specific season
// These should NOT be included in historical year imports
export const GLOBAL_SYNC_TYPES = [
  {
    id: 'person_tag_defs',
    name: 'Tag Definitions',
    icon: Tag,
    color: 'text-pink-600',
  },
  {
    id: 'custom_field_defs',
    name: 'Field Definitions',
    icon: FileSpreadsheet,
    color: 'text-lime-600',
  },
  {
    id: 'staff_lookups',
    name: 'Staff Lookups',
    icon: ClipboardList,
    color: 'text-stone-600',
  }, // positions, org_categories, program_areas
  {
    id: 'financial_lookups',
    name: 'Financial Lookups',
    icon: DollarSign,
    color: 'text-emerald-600',
  }, // financial_categories, payment_methods
  {
    id: 'divisions',
    name: 'Divisions',
    icon: Layers,
    color: 'text-purple-600',
  }, // Global: division definitions (no year field)
] as const

// Year-specific sync types - data that follows the sync chain
// Note: "persons" is a combined sync that populates persons and households tables
// from a single API call (tags are stored as multi-select relation on persons)
// Types with currentYearOnly: true are only available for current year syncs
export const YEAR_SYNC_TYPES = [
  // Source phase - CampMinder API calls
  {
    id: 'session_groups',
    name: 'Session Groups',
    icon: FolderTree,
    color: 'text-cyan-600',
    phase: 'source' as SyncPhase,
  },
  {
    id: 'sessions',
    name: 'Sessions',
    icon: Calendar,
    color: 'text-sky-600',
    phase: 'source' as SyncPhase,
  },
  {
    id: 'attendees',
    name: 'Attendees',
    icon: Users,
    color: 'text-emerald-600',
    phase: 'source' as SyncPhase,
  },
  {
    id: 'persons',
    name: 'Persons',
    icon: User,
    color: 'text-violet-600',
    phase: 'source' as SyncPhase,
  }, // Combined: persons + households (includes division)
  {
    id: 'bunks',
    name: 'Bunks',
    icon: BedDouble,
    color: 'text-amber-600',
    phase: 'source' as SyncPhase,
  },
  {
    id: 'bunk_plans',
    name: 'Bunk Plans',
    icon: Layout,
    color: 'text-rose-600',
    phase: 'source' as SyncPhase,
  },
  {
    id: 'bunk_assignments',
    name: 'Assignments',
    icon: UserCheck,
    color: 'text-indigo-600',
    phase: 'source' as SyncPhase,
  },
  {
    id: 'staff',
    name: 'Staff',
    icon: Tent,
    color: 'text-slate-600',
    phase: 'source' as SyncPhase,
  },
  {
    id: 'financial_transactions',
    name: 'Transactions',
    icon: Receipt,
    color: 'text-green-600',
    phase: 'source' as SyncPhase,
  },
  // Expensive phase - Custom values (1 API call per entity)
  {
    id: 'person_custom_values',
    name: 'Person CV',
    icon: User,
    color: 'text-violet-500',
    phase: 'expensive' as SyncPhase,
  },
  {
    id: 'household_custom_values',
    name: 'Household CV',
    icon: Home,
    color: 'text-orange-500',
    phase: 'expensive' as SyncPhase,
  },
  // The bounded daily family-camp custom-values pass (kindred#2482/#2489), published on the
  // status payload by #2591 but never given a card until #2593. No manualTrigger: the
  // backend registers no individual POST route for either -- they run only inside
  // getDailySyncJobs, always covered minutes earlier by the daily cron, so there is nothing
  // for a Run button to call (phaseExecutionJobs deliberately excludes them from an
  // admin-triggered PhaseExpensive run too, to avoid re-fetching a cohort already fresh).
  // currentYearOnly: the daily cron always targets the configured season, never a historical
  // year, matching bunk_requests/process_requests below.
  {
    id: 'person_custom_values_family_camp',
    name: 'Person CV (FC)',
    description: 'Daily cron only',
    icon: User,
    color: 'text-violet-500',
    phase: 'expensive' as SyncPhase,
    manualTrigger: false,
    currentYearOnly: true,
  },
  {
    id: 'household_custom_values_family_camp',
    name: 'Household CV (FC)',
    description: 'Daily cron only',
    icon: Home,
    color: 'text-orange-500',
    phase: 'expensive' as SyncPhase,
    manualTrigger: false,
    currentYearOnly: true,
  },
  // Transform phase - derived tables
  {
    id: 'family_camp_derived',
    name: 'Weekend Programs',
    icon: Home,
    color: 'text-orange-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'lodging_assignments',
    name: 'Lodging Assignments',
    icon: BedDouble,
    color: 'text-amber-600',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'staff_skills',
    name: 'Staff Skills',
    icon: Sparkles,
    color: 'text-purple-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'financial_aid_applications',
    name: 'FA Applications',
    icon: HandCoins,
    color: 'text-green-600',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'household_demographics',
    name: 'Demographics',
    icon: Heart,
    color: 'text-pink-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'camper_transportation',
    name: 'Transportation',
    icon: Bus,
    color: 'text-blue-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'camper_dietary',
    name: 'Dietary',
    icon: Utensils,
    color: 'text-orange-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'quest_registrations',
    name: 'Quest Regs',
    icon: Mountain,
    color: 'text-amber-600',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'staff_applications',
    name: 'Staff Apps',
    icon: ClipboardList,
    color: 'text-indigo-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'staff_vehicle_info',
    name: 'Staff Vehicles',
    icon: Car,
    color: 'text-slate-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'normalize_geographic',
    name: 'Normalize Geo',
    icon: MapPin,
    color: 'text-emerald-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'enrollment_snapshots',
    name: 'Enrollment Snapshots',
    icon: Camera,
    color: 'text-teal-500',
    phase: 'transform' as SyncPhase,
  },
  {
    id: 'stranded_assignment_cleanup',
    name: 'Stranded Assignment Cleanup',
    description: 'PB-only · no CampMinder fetch',
    icon: UserX,
    color: 'text-orange-500',
    phase: 'transform' as SyncPhase,
  },
  // Process phase - CSV + AI (current year only)
  // No POST route registered (published on the status payload by #2591, carded by #2593):
  // it runs only inside getDailySyncJobs/ResolveUnifiedSyncServices' current-year branch,
  // immediately before bunk_requests -- the same position it holds here.
  {
    id: 'reconcile_request_lifecycle',
    name: 'Reconcile Lifecycle',
    // Not "daily cron only" like the bounded pair above: it has no individual POST route
    // either, but GetJobsForPhase classifies it PhaseProcess and phaseExecutionJobs filters
    // only PhaseExpensive, so this section's Run Phase button really does start it.
    description: 'Daily cron · Process phase',
    icon: RefreshCw,
    color: 'text-teal-500',
    phase: 'process' as SyncPhase,
    manualTrigger: false,
    currentYearOnly: true,
  },
  {
    id: 'bunk_requests',
    name: 'Intake Requests',
    icon: FileText,
    color: 'text-orange-600',
    phase: 'process' as SyncPhase,
    currentYearOnly: true,
  },
  {
    id: 'process_requests',
    name: 'Process Requests',
    icon: Brain,
    color: 'text-teal-600',
    phase: 'process' as SyncPhase,
    currentYearOnly: true,
  },
  // Export phase - Google Sheets. Was published on the status payload and had toast +
  // invalidation coverage the whole time; it just had no card, because YEAR_SYNC_TYPES had
  // zero entries with `phase: 'export'`, so getSyncTypesByPhase('export', ...) always
  // returned [] and the phase section silently rendered nothing at all (#2593).
  {
    id: 'multi_workbook_export',
    name: 'Sheets Export',
    icon: FileSpreadsheet,
    color: 'text-fuchsia-600',
    phase: 'export' as SyncPhase,
  },
] as const

// Combined sync types for backward compatibility
export const SYNC_TYPES = [...GLOBAL_SYNC_TYPES, ...YEAR_SYNC_TYPES] as const

// Backward compatibility alias
export const CURRENT_YEAR_SYNC_TYPES = YEAR_SYNC_TYPES

// The two optional flags a GLOBAL_SYNC_TYPES/YEAR_SYNC_TYPES entry may carry, plus the `id`
// every entry has. `id` is required so TypeScript's weak-type check still applies: a bare
// `{ manualTrigger?: ... }` parameter shares no property with the entries that omit the flag,
// and TS rejects the call rather than reading it as `undefined`.
interface SyncTypeFlags {
  readonly id: string
  readonly manualTrigger?: boolean
  readonly currentYearOnly?: boolean
}

// True when the backend registers no individual POST route for this job, so the admin UI must
// not offer any way to trigger it on its own (kindred#2593). Read in two places -- the card's
// Run button and the Full-mode service dropdown, which is just as much a manual trigger since
// it POSTs /api/custom/sync/run?service=<id>. syncTypes.test.ts pins the flag against the route
// table parsed out of pocketbase/sync/api.go, so it cannot be forgotten on a routeless job or
// left behind on one that later gains a route.
export function hasManualTrigger(syncType: SyncTypeFlags): boolean {
  return syncType.manualTrigger !== false
}

// True for a sync type that only applies to the configured season, never a historical replay.
// The single reading of the flag: the card grid, the service dropdown and SyncTab's
// year-change reset all go through here rather than naming ids by hand (kindred#2593 -- the
// reset previously listed two of the five entries that carry the flag).
export function isCurrentYearOnly(syncType: SyncTypeFlags): boolean {
  return syncType.currentYearOnly === true
}

// Get sync types available for a given year
// For historical years (year < currentYear), excludes types with currentYearOnly flag
export function getYearSyncTypes(year: number, currentYear: number) {
  if (year === currentYear) return YEAR_SYNC_TYPES
  return YEAR_SYNC_TYPES.filter((t) => !isCurrentYearOnly(t))
}

// Get sync types for a specific phase and year
// For historical years (year !== currentYear), excludes types with currentYearOnly flag
export function getSyncTypesByPhase(phase: SyncPhase, year: number, currentYear: number) {
  return YEAR_SYNC_TYPES.filter((t) => {
    if (t.phase !== phase) return false
    if (isCurrentYearOnly(t) && year !== currentYear) return false
    return true
  })
}

// Icon for global section header
export { Globe }
