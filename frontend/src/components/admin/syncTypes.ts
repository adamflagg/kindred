import {
  Calendar,
  Users,
  User,
  Home,
  Layout,
  UserCheck,
  FileText,
  Brain,
} from 'lucide-react';

// Sync type configuration for the sync status grid
export const SYNC_TYPES = [
  { id: 'sessions', name: 'Sessions', icon: Calendar, color: 'text-sky-600' },
  { id: 'attendees', name: 'Attendees', icon: Users, color: 'text-emerald-600' },
  { id: 'persons', name: 'Persons', icon: User, color: 'text-violet-600' },
  { id: 'bunks', name: 'Bunks', icon: Home, color: 'text-amber-600' },
  { id: 'bunk_plans', name: 'Bunk Plans', icon: Layout, color: 'text-rose-600' },
  { id: 'bunk_assignments', name: 'Assignments', icon: UserCheck, color: 'text-indigo-600' },
  { id: 'bunk_requests', name: 'Requests', icon: FileText, color: 'text-orange-600' },
  { id: 'process_requests', name: 'Process', icon: Brain, color: 'text-teal-600' },
] as const;

// Subset of sync types available for historical import
export const HISTORICAL_SYNC_TYPES = [
  { id: 'sessions', name: 'Sessions' },
  { id: 'attendees', name: 'Attendees' },
  { id: 'persons', name: 'Persons' },
  { id: 'bunks', name: 'Bunks' },
  { id: 'bunk_plans', name: 'Bunk Plans' },
  { id: 'bunk_assignments', name: 'Assignments' },
] as const;
