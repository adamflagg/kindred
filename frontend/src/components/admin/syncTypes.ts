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
} from 'lucide-react';

// Global sync types - cross-year data not tied to a specific season
// These should NOT be included in historical year imports
export const GLOBAL_SYNC_TYPES = [
  { id: 'person_tag_defs', name: 'Tag Definitions', icon: Tag, color: 'text-pink-600' },
  { id: 'custom_field_defs', name: 'Field Definitions', icon: FileSpreadsheet, color: 'text-lime-600' },
] as const;

// Current year sync types - year-specific data that follows the sync chain
// Note: "persons" is a combined sync that populates persons and households tables
// from a single API call (tags are stored as multi-select relation on persons)
export const CURRENT_YEAR_SYNC_TYPES = [
  { id: 'session_groups', name: 'Session Groups', icon: FolderTree, color: 'text-cyan-600' },
  { id: 'sessions', name: 'Sessions', icon: Calendar, color: 'text-sky-600' },
  { id: 'attendees', name: 'Attendees', icon: Users, color: 'text-emerald-600' },
  { id: 'persons', name: 'Persons', icon: User, color: 'text-violet-600' }, // Combined: persons + households
  { id: 'bunks', name: 'Bunks', icon: BedDouble, color: 'text-amber-600' },
  { id: 'bunk_plans', name: 'Bunk Plans', icon: Layout, color: 'text-rose-600' },
  { id: 'bunk_assignments', name: 'Assignments', icon: UserCheck, color: 'text-indigo-600' },
  { id: 'bunk_requests', name: 'Intake Requests', icon: FileText, color: 'text-orange-600' },
  { id: 'process_requests', name: 'Process Requests', icon: Brain, color: 'text-teal-600' },
] as const;

// Combined sync types for backward compatibility
export const SYNC_TYPES = [...GLOBAL_SYNC_TYPES, ...CURRENT_YEAR_SYNC_TYPES] as const;

// Subset of sync types available for historical import
// Excludes global types (tag_defs, custom_field_defs) since they're cross-year
// Note: "persons" sync also populates households table (tags are multi-select on persons)
export const HISTORICAL_SYNC_TYPES = [
  { id: 'session_groups', name: 'Session Groups' },
  { id: 'sessions', name: 'Sessions' },
  { id: 'attendees', name: 'Attendees' },
  { id: 'persons', name: 'Persons' }, // Combined: persons + households
  { id: 'bunks', name: 'Bunks' },
  { id: 'bunk_plans', name: 'Bunk Plans' },
  { id: 'bunk_assignments', name: 'Assignments' },
] as const;

// Icon for global section header
export { Globe };
