import {
  FolderTree,
  Calendar,
  Users,
  User,
  Layout,
  UserCheck,
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
  History,
  Home,
  Sparkles,
  HandCoins,
  Heart,
} from 'lucide-react';

// Sync phase definitions
export type SyncPhase = 'source' | 'expensive' | 'transform' | 'process' | 'export';

export const SYNC_PHASES: { id: SyncPhase; name: string; description: string }[] = [
  { id: 'source', name: 'CampMinder', description: 'Sync from CampMinder API' },
  { id: 'expensive', name: 'Custom Values', description: 'Sync custom field values (slow)' },
  { id: 'transform', name: 'Transform', description: 'Compute derived tables' },
  { id: 'process', name: 'Process', description: 'Import CSV + AI processing' },
  { id: 'export', name: 'Export', description: 'Export to Google Sheets' },
];

// Global sync types - cross-year data not tied to a specific season
// These should NOT be included in historical year imports
export const GLOBAL_SYNC_TYPES = [
  { id: 'person_tag_defs', name: 'Tag Definitions', icon: Tag, color: 'text-pink-600' },
  { id: 'custom_field_defs', name: 'Field Definitions', icon: FileSpreadsheet, color: 'text-lime-600' },
  { id: 'staff_lookups', name: 'Staff Lookups', icon: ClipboardList, color: 'text-stone-600' }, // positions, org_categories, program_areas
  { id: 'financial_lookups', name: 'Financial Lookups', icon: DollarSign, color: 'text-emerald-600' }, // financial_categories, payment_methods
  { id: 'divisions', name: 'Divisions', icon: Layers, color: 'text-purple-600' }, // Global: division definitions (no year field)
] as const;

// Year-specific sync types - data that follows the sync chain
// Note: "persons" is a combined sync that populates persons and households tables
// from a single API call (tags are stored as multi-select relation on persons)
// Types with currentYearOnly: true are only available for current year syncs
export const YEAR_SYNC_TYPES = [
  // Source phase - CampMinder API calls
  { id: 'session_groups', name: 'Session Groups', icon: FolderTree, color: 'text-cyan-600', phase: 'source' as SyncPhase },
  { id: 'sessions', name: 'Sessions', icon: Calendar, color: 'text-sky-600', phase: 'source' as SyncPhase },
  { id: 'attendees', name: 'Attendees', icon: Users, color: 'text-emerald-600', phase: 'source' as SyncPhase },
  { id: 'persons', name: 'Persons', icon: User, color: 'text-violet-600', phase: 'source' as SyncPhase }, // Combined: persons + households (includes division)
  { id: 'bunks', name: 'Bunks', icon: BedDouble, color: 'text-amber-600', phase: 'source' as SyncPhase },
  { id: 'bunk_plans', name: 'Bunk Plans', icon: Layout, color: 'text-rose-600', phase: 'source' as SyncPhase },
  { id: 'bunk_assignments', name: 'Assignments', icon: UserCheck, color: 'text-indigo-600', phase: 'source' as SyncPhase },
  { id: 'staff', name: 'Staff', icon: Tent, color: 'text-slate-600', phase: 'source' as SyncPhase },
  { id: 'financial_transactions', name: 'Financial Transactions', icon: Receipt, color: 'text-green-600', phase: 'source' as SyncPhase },
  // Transform phase - derived tables
  { id: 'camper_history', name: 'Camper History', icon: History, color: 'text-cyan-600', phase: 'transform' as SyncPhase },
  { id: 'family_camp_derived', name: 'Family Camp', icon: Home, color: 'text-orange-500', phase: 'transform' as SyncPhase },
  { id: 'staff_skills', name: 'Staff Skills', icon: Sparkles, color: 'text-purple-500', phase: 'transform' as SyncPhase },
  { id: 'financial_aid_applications', name: 'FA Applications', icon: HandCoins, color: 'text-green-600', phase: 'transform' as SyncPhase },
  { id: 'household_demographics', name: 'Demographics', icon: Heart, color: 'text-pink-500', phase: 'transform' as SyncPhase },
  // Process phase - CSV + AI
  { id: 'bunk_requests', name: 'Intake Requests', icon: FileText, color: 'text-orange-600', phase: 'process' as SyncPhase },
  { id: 'process_requests', name: 'Process Requests', icon: Brain, color: 'text-teal-600', phase: 'process' as SyncPhase },
] as const;

// Combined sync types for backward compatibility
export const SYNC_TYPES = [...GLOBAL_SYNC_TYPES, ...YEAR_SYNC_TYPES] as const;

// Backward compatibility alias
export const CURRENT_YEAR_SYNC_TYPES = YEAR_SYNC_TYPES;

// Get sync types available for a given year
// For historical years (year < currentYear), excludes types with currentYearOnly flag
export function getYearSyncTypes(year: number, currentYear: number) {
  if (year === currentYear) return YEAR_SYNC_TYPES;
  return YEAR_SYNC_TYPES.filter(t => !('currentYearOnly' in t && t.currentYearOnly));
}

// Icon for global section header
export { Globe };
