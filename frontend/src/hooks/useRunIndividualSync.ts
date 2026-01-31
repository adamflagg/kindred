import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

// Map of sync types to their display names
// Note: "persons" is a combined sync that populates persons and households tables
// from a single API call (tags are stored as multi-select relation on persons)
// Note: "divisions" is global (no year field) - runs in weekly sync
export const SYNC_TYPE_NAMES: Record<string, string> = {
  // Weekly syncs (global definitions)
  person_tag_defs: 'Tags',
  custom_field_defs: 'Custom Fields',
  staff_lookups: 'Staff Lookups', // Global: positions, org_categories, program_areas
  financial_lookups: 'Financial Lookups', // Global: financial_categories, payment_methods
  divisions: 'Divisions', // Global: division definitions (no year field)
  // Daily syncs
  session_groups: 'Session Groups',
  sessions: 'Sessions',
  attendees: 'Attendees',
  persons: 'Persons', // Combined sync: persons + households (includes division relation)
  bunks: 'Bunks',
  bunk_plans: 'Bunk Plans',
  bunk_assignments: 'Bunk Assignments',
  staff: 'Staff', // Year-scoped staff records
  camper_history: 'Camper History', // Computed retention metrics
  financial_transactions: 'Financial Transactions', // Year-scoped financial data
  family_camp_derived: 'Family Camp Derived', // Computed from custom values
  staff_skills: 'Staff Skills', // Derived from person_custom_values Skills- fields
  financial_aid_applications: 'FA Applications', // Derived from person_custom_values FA- fields
  household_demographics: 'Household Demographics', // Computed from HH- fields
  camper_transportation: 'Camper Transportation', // Extracted from BUS- custom fields
  camper_dietary: 'Camper Dietary', // Extracted from Family Medical- custom fields
  quest_registrations: 'Quest Registrations', // Extracted from Quest-/Q- custom fields
  staff_applications: 'Staff Applications', // Extracted from App- custom fields
  staff_vehicle_info: 'Staff Vehicle Info', // Extracted from SVI- custom fields
  bunk_requests: 'Intake Requests',
  process_requests: 'Process Requests',
  // On-demand syncs (not part of daily sync)
  person_custom_values: 'Person Custom Values',
  household_custom_values: 'Household Custom Values',
};

// Convert sync type ID to API endpoint (snake_case -> kebab-case)
const toEndpoint = (syncType: string): string => syncType.replace(/_/g, '-');

export function useRunIndividualSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (syncType: string) => {
      // Validate sync type exists
      if (!SYNC_TYPE_NAMES[syncType]) {
        throw new Error(`Unknown sync type: ${syncType}`);
      }

      const response = await pb.send(`/api/custom/sync/${toEndpoint(syncType)}`, {
        method: 'POST',
      });
      
      return response;
    },
    // Note: No onMutate toast - the API responds within ~100ms with status: "started"
    // which triggers the onSuccess toast. Having both is redundant.
    onSuccess: (data, syncType) => {
      const displayName = SYNC_TYPE_NAMES[syncType] || syncType;

      // The Go API runs syncs in background goroutines and returns immediately
      // with status: "started". Actual completion comes via status polling.
      // Only show "started" confirmation here - completion toasts come from status updates.

      // Check if response indicates queued (sync is busy)
      if (data?.status === 'queued') {
        toast(`${displayName} sync queued (position ${data?.position || '?'})`, {
          icon: '📋',
          duration: 4000,
          className: 'toast-lodge toast-lodge-info',
          style: {
            borderLeft: '4px solid hsl(42, 92%, 62%)',
          },
        });
      } else if (data?.message?.includes('response delayed')) {
        // Check if response indicates delayed start (rate limiting)
        toast(`${displayName} sync is starting - this may take a few moments due to API rate limits`, {
          icon: '⏳',
          duration: 6000,
          className: 'toast-lodge toast-lodge-info',
          style: {
            borderLeft: '4px solid hsl(42, 92%, 62%)',
          },
        });
      } else if (data?.status === 'started') {
        // Async sync started - show confirmation (not completion)
        toast(`${displayName} sync started`, {
          icon: '✓',
          duration: 3000,
          className: 'toast-lodge toast-lodge-success',
          style: {
            borderLeft: '4px solid hsl(160, 100%, 21%)',
          },
        });
      } else if (data?.stats || data?.created !== undefined) {
        // Synchronous response with actual stats (some endpoints may return this)
        const stats = data?.stats || data;
        const created = stats?.created ?? 0;
        const updated = stats?.updated ?? 0;
        const skipped = stats?.skipped ?? 0;
        const errors = stats?.errors ?? 0;

        // Build a meaningful message based on what happened
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} created`);
        if (updated > 0) parts.push(`${updated} updated`);
        if (skipped > 0) parts.push(`${skipped} skipped`);
        if (errors > 0) parts.push(`${errors} errors`);

        const statsText = parts.length > 0 ? parts.join(', ') : 'no changes';
        const hasErrors = errors > 0;

        if (hasErrors) {
          toast(`${displayName} completed with errors: ${statsText}`, {
            icon: '⚠️',
            duration: 6000,
            className: 'toast-lodge toast-lodge-error',
            style: {
              borderLeft: '4px solid hsl(0, 72%, 51%)',
            },
          });
        } else {
          toast.success(`${displayName} complete: ${statsText}`, {
            duration: 5000,
          });
        }
      }

      // Invalidate sync status to show it's running
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
    },
    onError: (error, syncType) => {
      const displayName = SYNC_TYPE_NAMES[syncType] || syncType;
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Handle specific error cases
      if (errorMessage.includes('Gateway timeout')) {
        errorMessage = `${displayName} sync is taking longer than expected. Check the status in a moment.`;
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        errorMessage = `API rate limit reached. Please wait a moment before trying ${displayName} sync again.`;
      } else if (errorMessage.includes('already in progress')) {
        errorMessage = `${displayName} sync is already running.`;
      }
      
      toast.error(errorMessage);
    },
  });
}