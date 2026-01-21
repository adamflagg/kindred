import {
  FolderTree,
  Calendar,
  Users,
  User,
  Home,
  Layout,
  UserCheck,
  FileText,
  Brain,
  Tag,
  Building2,
  Tags,
  FileSpreadsheet,
} from 'lucide-react';

// Sync type configuration for the sync status grid
export const SYNC_TYPES = [
  { id: 'session_groups', name: 'Session Groups', icon: FolderTree, color: 'text-cyan-600' },
  { id: 'sessions', name: 'Sessions', icon: Calendar, color: 'text-sky-600' },
  { id: 'attendees', name: 'Attendees', icon: Users, color: 'text-emerald-600' },
  { id: 'person_tag_definitions', name: 'Tag Definitions', icon: Tag, color: 'text-pink-600' },
  { id: 'custom_field_definitions', name: 'Custom Field Defs', icon: FileSpreadsheet, color: 'text-lime-600' },
  { id: 'persons', name: 'Persons', icon: User, color: 'text-violet-600' },
  { id: 'households', name: 'Households', icon: Building2, color: 'text-purple-600' },
  { id: 'person_tags', name: 'Person Tags', icon: Tags, color: 'text-fuchsia-600' },
  { id: 'bunks', name: 'Bunks', icon: Home, color: 'text-amber-600' },
  { id: 'bunk_plans', name: 'Bunk Plans', icon: Layout, color: 'text-rose-600' },
  { id: 'bunk_assignments', name: 'Assignments', icon: UserCheck, color: 'text-indigo-600' },
  { id: 'bunk_requests', name: 'Requests', icon: FileText, color: 'text-orange-600' },
  { id: 'process_requests', name: 'Process', icon: Brain, color: 'text-teal-600' },
] as const;

// Subset of sync types available for historical import
export const HISTORICAL_SYNC_TYPES = [
  { id: 'session_groups', name: 'Session Groups' },
  { id: 'sessions', name: 'Sessions' },
  { id: 'attendees', name: 'Attendees' },
  { id: 'person_tag_definitions', name: 'Tag Definitions' },
  { id: 'custom_field_definitions', name: 'Custom Field Defs' },
  { id: 'persons', name: 'Persons' },
  { id: 'households', name: 'Households' },
  { id: 'person_tags', name: 'Person Tags' },
  { id: 'bunks', name: 'Bunks' },
  { id: 'bunk_plans', name: 'Bunk Plans' },
  { id: 'bunk_assignments', name: 'Assignments' },
] as const;
