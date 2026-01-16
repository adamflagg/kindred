/**
 * TDD Tests for SplitRequestModal
 *
 * Tests the modal for splitting a merged bunk_request into separate requests.
 * Following TDD: These tests are written FIRST to define expected behavior.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SplitRequestModal from './SplitRequestModal';
import type { BunkRequestsResponse } from '../types/pocketbase-types';
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create mock request object with multiple sources
function createMergedMockRequest(overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse {
  return {
    id: 'req_merged',
    collectionId: 'bunk_requests',
    collectionName: 'bunk_requests',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    requester_id: 12345,
    requestee_id: 67890,
    request_type: BunkRequestsRequestTypeOptions.bunk_with,
    session_id: 1000001,
    priority: 3,
    confidence_score: 0.95,
    source: 'family',
    source_field: 'share_bunk_with',
    source_fields: ['share_bunk_with', 'bunking_notes'], // Multiple sources
    status: 'pending',
    year: 2025,
    is_placeholder: false,
    metadata: {
      merged_from: ['req_original_1', 'req_original_2'],
    },
    ...overrides,
  } as BunkRequestsResponse;
}

// Mock source link data
interface SourceLinkData {
  original_request_id: string;
  source_field: string;
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('SplitRequestModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('rendering', () => {
    it('renders nothing when not open', () => {
      const { container } = renderWithQueryClient(
        <SplitRequestModal
          isOpen={false}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[]}
          onSplitComplete={() => {}}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders modal with title when open', () => {
      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[
            { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
            { original_request_id: 'orig_2', source_field: 'bunking_notes' },
          ]}
          onSplitComplete={() => {}}
        />
      );

      expect(
        screen.getByRole('heading', { name: /split request/i }) ||
        screen.getAllByText(/split request/i).length
      ).toBeTruthy();
    });

    it('shows all contributing sources', () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ];

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      );

      expect(screen.getAllByText(/share_bunk_with/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/bunking_notes/i).length).toBeGreaterThan(0);
    });
  });

  describe('source selection', () => {
    it('provides checkboxes to select sources to split off', () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ];

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    it('no sources are selected by default', () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ];

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach((checkbox) => {
        expect(checkbox).not.toBeChecked();
      });
    });
  });

  describe('request type selection for split sources', () => {
    it('shows type dropdown for each selected source', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ];

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      );

      // Select a source
      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0];
      expect(firstCheckbox).toBeDefined();
      if (firstCheckbox) fireEvent.click(firstCheckbox);

      // Should now show a type dropdown
      await waitFor(() => {
        expect(screen.getByRole('combobox') || screen.getByLabelText(/type/i)).toBeInTheDocument();
      });
    });
  });

  describe('split action', () => {
    it('has a split button', () => {
      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[
            { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
          ]}
          onSplitComplete={() => {}}
        />
      );

      expect(screen.getByRole('button', { name: /split/i })).toBeInTheDocument();
    });

    it('split button is disabled when no sources selected', () => {
      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[
            { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
          ]}
          onSplitComplete={() => {}}
        />
      );

      const splitButton = screen.getByRole('button', { name: /split/i });
      expect(splitButton).toBeDisabled();
    });

    it('calls split API with correct payload on confirm', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          original_request_id: 'req_merged',
          created_request_ids: ['new_req_1'],
          updated_source_fields: ['share_bunk_with'],
        }),
      });

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      );

      // Select a source to split
      const checkboxes = screen.getAllByRole('checkbox');
      const secondCheckbox = checkboxes[1];
      expect(secondCheckbox).toBeDefined();
      if (secondCheckbox) fireEvent.click(secondCheckbox); // Select bunking_notes

      const splitButton = screen.getByRole('button', { name: /split/i });
      fireEvent.click(splitButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/requests/split'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"request_id"'),
          })
        );
      });
    });

    it('calls onSplitComplete after successful split', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ];

      const onSplitComplete = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          original_request_id: 'req_merged',
          created_request_ids: ['new_req_1'],
          updated_source_fields: ['share_bunk_with'],
        }),
      });

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={onSplitComplete}
        />
      );

      // Select a source and split
      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0];
      expect(firstCheckbox).toBeDefined();
      if (firstCheckbox) fireEvent.click(firstCheckbox);

      const splitButton = screen.getByRole('button', { name: /split/i });
      fireEvent.click(splitButton);

      await waitFor(() => {
        expect(onSplitComplete).toHaveBeenCalled();
      });
    });

    it('shows error message on split failure', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Split failed' }),
      });

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      );

      // Select a source and try to split
      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0];
      expect(firstCheckbox).toBeDefined();
      if (firstCheckbox) fireEvent.click(firstCheckbox);

      const splitButton = screen.getByRole('button', { name: /split/i });
      fireEvent.click(splitButton);

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
      });
    });
  });

  describe('cancel action', () => {
    it('has a cancel button', () => {
      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[]}
          onSplitComplete={() => {}}
        />
      );

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('calls onClose when cancel is clicked', () => {
      const onClose = vi.fn();

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={onClose}
          request={createMergedMockRequest()}
          sourceLinks={[]}
          onSplitComplete={() => {}}
        />
      );

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('disables split button while submitting', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
      ];

      // Never resolve to keep it in loading state
      mockFetch.mockReturnValue(new Promise(() => {}));

      renderWithQueryClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      );

      // Select a source
      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0];
      expect(firstCheckbox).toBeDefined();
      if (firstCheckbox) fireEvent.click(firstCheckbox);

      const splitButton = screen.getByRole('button', { name: /split/i });
      fireEvent.click(splitButton);

      await waitFor(() => {
        expect(splitButton).toBeDisabled();
      });
    });
  });
});
