/**
 * TDD Tests for MergeRequestsModal
 *
 * Tests the modal for merging multiple bunk_requests into one.
 * Following TDD: These tests are written FIRST to define expected behavior.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import MergeRequestsModal from './MergeRequestsModal';
import type { BunkRequestsResponse } from '../types/pocketbase-types';
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create mock request objects
function createMockRequest(overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse {
  return {
    id: 'req_1',
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
    status: 'pending',
    year: 2025,
    is_placeholder: false,
    metadata: {},
    ...overrides,
  } as BunkRequestsResponse;
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

describe('MergeRequestsModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('rendering', () => {
    it('renders nothing when not open', () => {
      const { container } = renderWithQueryClient(
        <MergeRequestsModal
          isOpen={false}
          onClose={() => {}}
          requests={[]}
          onMergeComplete={() => {}}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders modal with title when open', () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      expect(screen.getByText(/merge requests/i)).toBeInTheDocument();
    });

    it('shows both requests in side-by-side comparison', () => {
      const requests = [
        createMockRequest({ id: 'req_1', source_field: 'share_bunk_with' }),
        createMockRequest({ id: 'req_2', source_field: 'bunking_notes' }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      expect(screen.getByText(/share_bunk_with/i)).toBeInTheDocument();
      expect(screen.getByText(/bunking_notes/i)).toBeInTheDocument();
    });
  });

  describe('target selection', () => {
    it('provides radio buttons to select which target to keep', () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBeGreaterThanOrEqual(2);
    });

    it('first request is selected by default', () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      const radios = screen.getAllByRole('radio');
      expect(radios[0]).toBeChecked();
    });
  });

  describe('request type selection', () => {
    it('shows request type dropdown', () => {
      const requests = [
        createMockRequest({ id: 'req_1', request_type: BunkRequestsRequestTypeOptions.bunk_with }),
        createMockRequest({ id: 'req_2', request_type: BunkRequestsRequestTypeOptions.not_bunk_with }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      // Should have a way to select final type
      expect(screen.getByLabelText(/final.*type/i) || screen.getByRole('combobox')).toBeInTheDocument();
    });
  });

  describe('merge preview', () => {
    it('shows preview of combined source_fields', () => {
      const requests = [
        createMockRequest({ id: 'req_1', source_field: 'share_bunk_with' }),
        createMockRequest({ id: 'req_2', source_field: 'bunking_notes' }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      // Should show merged source fields preview
      expect(screen.getByText(/source.*fields/i) || screen.getByText(/combined/i)).toBeInTheDocument();
    });
  });

  describe('merge action', () => {
    it('has a merge button', () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      expect(screen.getByRole('button', { name: /merge/i })).toBeInTheDocument();
    });

    it('calls merge API with correct payload on confirm', async () => {
      const requests = [
        createMockRequest({ id: 'req_1', request_type: BunkRequestsRequestTypeOptions.bunk_with }),
        createMockRequest({ id: 'req_2', request_type: BunkRequestsRequestTypeOptions.bunk_with }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          merged_request_id: 'req_1',
          deleted_request_ids: ['req_2'],
          source_fields: ['share_bunk_with', 'bunking_notes'],
          confidence_score: 0.95,
        }),
      });

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      const mergeButton = screen.getByRole('button', { name: /merge/i });
      fireEvent.click(mergeButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/requests/merge'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"request_ids"'),
          })
        );
      });
    });

    it('calls onMergeComplete after successful merge', async () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      const onMergeComplete = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          merged_request_id: 'req_1',
          deleted_request_ids: ['req_2'],
          source_fields: [],
          confidence_score: 0.95,
        }),
      });

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={onMergeComplete}
        />
      );

      const mergeButton = screen.getByRole('button', { name: /merge/i });
      fireEvent.click(mergeButton);

      await waitFor(() => {
        expect(onMergeComplete).toHaveBeenCalled();
      });
    });

    it('shows error message on merge failure', async () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Merge failed' }),
      });

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      const mergeButton = screen.getByRole('button', { name: /merge/i });
      fireEvent.click(mergeButton);

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
      });
    });
  });

  describe('cancel action', () => {
    it('has a cancel button', () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('calls onClose when cancel is clicked', () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      const onClose = vi.fn();

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={onClose}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('disables merge button while submitting', async () => {
      const requests = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2' }),
      ];

      // Never resolve to keep it in loading state
      mockFetch.mockReturnValue(new Promise(() => {}));

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      );

      const mergeButton = screen.getByRole('button', { name: /merge/i });
      fireEvent.click(mergeButton);

      await waitFor(() => {
        expect(mergeButton).toBeDisabled();
      });
    });
  });
});
