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
} from 'lucide-react';

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
  { id: 'session_groups', name: 'Session Groups', icon: FolderTree, color: 'text-cyan-600' },
  { id: 'sessions', name: 'Sessions', icon: Calendar, color: 'text-sky-600' },
  { id: 'attendees', name: 'Attendees', icon: Users, color: 'text-emerald-600' },
  { id: 'persons', name: 'Persons', icon: User, color: 'text-violet-600' }, // Combined: persons + households (includes division)
  { id: 'bunks', name: 'Bunks', icon: BedDouble, color: 'text-amber-600' },
  { id: 'bunk_plans', name: 'Bunk Plans', icon: Layout, color: 'text-rose-600' },
  { id: 'bunk_assignments', name: 'Assignments', icon: UserCheck, color: 'text-indigo-600' },
  { id: 'staff', name: 'Staff', icon: Tent, color: 'text-slate-600' },
  { id: 'financial_transactions', name: 'Financial Transactions', icon: Receipt, color: 'text-green-600' },
  { id: 'camper_history', name: 'Camper History', icon: History, color: 'text-cyan-600' },
  { id: 'family_camp_derived', name: 'Family Camp', icon: Home, color: 'text-orange-500' },
  // Bunk request processing - available for all years (historical CSV import)
  { id: 'bunk_requests', name: 'Intake Requests', icon: FileText, color: 'text-orange-600' },
  { id: 'process_requests', name: 'Process Requests', icon: Brain, color: 'text-teal-600' },
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
