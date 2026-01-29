import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DrillDownModal } from './DrillDownModal';

// Mock the auth-dependent hook
vi.mock('../../hooks/useDrilldownAttendees', () => ({
  useDrilldownAttendees: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

// Wrap component with QueryClient for React Query
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('DrillDownModal', () => {
  const defaultProps = {
    year: 2025,
    filter: { type: 'grade' as const, value: '6', label: 'Grade 6' },
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('keyboard accessibility', () => {
    it('calls onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      renderWithClient(<DrillDownModal {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose for other keys', () => {
      const onClose = vi.fn();
      renderWithClient(<DrillDownModal {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'Tab' });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('when filter is null', () => {
    it('renders nothing', () => {
      const { container } = renderWithClient(
        <DrillDownModal {...defaultProps} filter={null} />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('does not respond to Escape key', () => {
      const onClose = vi.fn();
      renderWithClient(<DrillDownModal {...defaultProps} filter={null} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('basic rendering', () => {
    it('renders header with filter label', () => {
      renderWithClient(<DrillDownModal {...defaultProps} />);

      expect(screen.getByText(/Grade 6/)).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      renderWithClient(<DrillDownModal {...defaultProps} onClose={onClose} />);

      // The X button doesn't have an accessible name, find by parent structure
      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find((btn) =>
        btn.querySelector('svg.lucide-x')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
      } else {
        // Alternative: find the button with just the X icon (last one in header area)
        const buttons = screen.getAllByRole('button');
        const lastButton = buttons[buttons.length - 1];
        if (lastButton) {
          fireEvent.click(lastButton);
        }
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
