import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProcessRequestOptions from './ProcessRequestOptions';

// Mock PocketBase lib - data must be inline since vi.mock is hoisted
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn().mockReturnValue({
      getFullList: vi.fn().mockResolvedValue([
        { id: '1', name: 'Taste of Camp', session_type: 'main', year: 2025, start_date: '2025-06-01' },
        { id: '2', name: 'Session 2', session_type: 'main', year: 2025, start_date: '2025-06-15' },
        { id: '3', name: 'Session 2a', session_type: 'embedded', year: 2025, start_date: '2025-06-15' },
        { id: '4', name: 'Session 2b', session_type: 'embedded', year: 2025, start_date: '2025-06-22' },
        { id: '5', name: 'Session 3', session_type: 'main', year: 2025, start_date: '2025-07-01' },
        { id: '6', name: 'Session 3a', session_type: 'embedded', year: 2025, start_date: '2025-07-08' },
        { id: '7', name: 'Session 4', session_type: 'main', year: 2025, start_date: '2025-07-15' },
      ]),
    }),
  },
}));

// Mock useYear hook
vi.mock('../../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
}));

// Source field display labels and their corresponding values
const SOURCE_FIELD_OPTIONS = [
  { value: 'bunk_with', label: 'Bunk With' },
  { value: 'not_bunk_with', label: 'Not Bunk With' },
  { value: 'bunking_notes', label: 'Bunking Notes' },
  { value: 'internal_notes', label: 'Internal Notes' },
  { value: 'socialize_with', label: 'Socialize With' },
];

// Test wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('ProcessRequestOptions', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    isProcessing: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    render(<ProcessRequestOptions {...defaultProps} isOpen={false} />, { wrapper: createWrapper() });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/process requests/i)).toBeInTheDocument();
  });

  it('has session selector with friendly name options including embedded sessions', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const sessionSelect = screen.getByLabelText(/session/i);
    expect(sessionSelect).toBeInTheDocument();

    // Wait for sessions to load, then check all options exist (main sessions and embedded sessions)
    expect(screen.getByRole('option', { name: /all sessions/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /taste of camp/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /^session 2$/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /session 2a/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /session 2b/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^session 3$/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /session 3a/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /session 4/i })).toBeInTheDocument();
  });

  it('has source field checkboxes', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    // Check that source fields section exists
    expect(screen.getByText(/source fields/i)).toBeInTheDocument();

    // Each source field should have a checkbox
    for (const field of SOURCE_FIELD_OPTIONS) {
      expect(screen.getByLabelText(field.label)).toBeInTheDocument();
    }
  });

  it('source field checkboxes are unchecked by default (meaning all fields)', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    for (const field of SOURCE_FIELD_OPTIONS) {
      expect(screen.getByLabelText(field.label)).not.toBeChecked();
    }
  });

  it('has optional limit input', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const limitInput = screen.getByLabelText(/limit/i);
    expect(limitInput).toBeInTheDocument();
    expect(limitInput).toHaveAttribute('type', 'number');
    expect(limitInput).toHaveAttribute('placeholder', 'No limit');
  });

  it('has force reprocess checkbox with warning', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const forceCheckbox = screen.getByLabelText(/force reprocess/i);
    expect(forceCheckbox).toBeInTheDocument();
    expect(forceCheckbox).toHaveAttribute('type', 'checkbox');

    // Warning should not be visible initially
    expect(screen.queryByText(/will clear processed flags/i)).not.toBeInTheDocument();
  });

  it('shows force warning when checkbox is checked', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const forceCheckbox = screen.getByLabelText(/force reprocess/i);
    await userEvent.click(forceCheckbox);

    expect(screen.getByText(/will clear processed flags/i)).toBeInTheDocument();
  });

  it('calls onClose when cancel button clicked', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with default options when process button clicked', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      limit: undefined,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
    });
  });

  it('calls onSubmit with selected main session', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    // Wait for sessions to load
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /session 2$/i })).toBeInTheDocument();
    });

    const sessionSelect = screen.getByLabelText(/session/i);
    await userEvent.selectOptions(sessionSelect, '2');

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: '2',
      limit: undefined,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
    });
  });

  it('calls onSubmit with selected embedded session', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    // Wait for sessions to load
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /session 2a/i })).toBeInTheDocument();
    });

    const sessionSelect = screen.getByLabelText(/session/i);
    await userEvent.selectOptions(sessionSelect, '2a');

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: '2a',
      limit: undefined,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
    });
  });

  it('calls onSubmit with selected source fields', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    // Select some source fields
    await userEvent.click(screen.getByLabelText('Bunk With'));
    await userEvent.click(screen.getByLabelText('Not Bunk With'));

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFields: expect.arrayContaining(['bunk_with', 'not_bunk_with']),
      })
    );
    // Verify only 2 source fields selected
    const firstCall = defaultProps.onSubmit.mock.calls[0];
    if (!firstCall) throw new Error('Expected onSubmit to be called');
    expect(firstCall[0].sourceFields).toHaveLength(2);
  });

  it('calls onSubmit with limit when provided', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const limitInput = screen.getByLabelText(/limit/i);
    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, '25');

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      limit: 25,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
    });
  });

  it('calls onSubmit with forceReprocess when checked', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const forceCheckbox = screen.getByLabelText(/force reprocess/i);
    await userEvent.click(forceCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      limit: undefined,
      forceReprocess: true,
      sourceFields: [],
      debug: false,
      trace: false,
    });
  });

  it('calls onSubmit with all options combined', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    // Wait for sessions to load
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /session 3a/i })).toBeInTheDocument();
    });

    // Select embedded session
    const sessionSelect = screen.getByLabelText(/session/i);
    await userEvent.selectOptions(sessionSelect, '3a');

    // Select source fields
    await userEvent.click(screen.getByLabelText('Internal Notes'));
    await userEvent.click(screen.getByLabelText('Bunking Notes'));

    // Set limit
    const limitInput = screen.getByLabelText(/limit/i);
    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, '15');

    // Enable force reprocess
    const forceCheckbox = screen.getByLabelText(/force reprocess/i);
    await userEvent.click(forceCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: '3a',
      limit: 15,
      forceReprocess: true,
      sourceFields: expect.arrayContaining(['internal_notes', 'bunking_notes']),
      debug: false,
      trace: false,
    });
  });

  it('disables buttons when isProcessing is true', () => {
    render(<ProcessRequestOptions {...defaultProps} isProcessing={true} />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('shows processing state on button', () => {
    render(<ProcessRequestOptions {...defaultProps} isProcessing={true} />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: /processing/i })).toBeInTheDocument();
  });

  it('validates limit is positive number', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const limitInput = screen.getByLabelText(/limit/i);
    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, '-5');

    // The input should accept the value but submission should treat it as undefined
    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      limit: undefined,  // Negative values treated as no limit
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
    });
  });

  it('disables source field checkboxes when processing', () => {
    render(<ProcessRequestOptions {...defaultProps} isProcessing={true} />, { wrapper: createWrapper() });

    for (const field of SOURCE_FIELD_OPTIONS) {
      expect(screen.getByLabelText(field.label)).toBeDisabled();
    }
  });

  it('can toggle source fields on and off', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    const checkbox = screen.getByLabelText('Bunk With');

    // Check
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Uncheck
    await userEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('has accessible structure', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    // Should have a heading
    expect(screen.getByRole('heading', { name: /process requests/i })).toBeInTheDocument();

    // All inputs should have labels
    expect(screen.getByLabelText(/session/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/limit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/force reprocess/i)).toBeInTheDocument();

    // Should have two action buttons
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^process$/i })).toBeInTheDocument();
  });

  it('displays helpful description text', () => {
    render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText(/process original bunk requests/i)).toBeInTheDocument();
  });

  it('resets form when closed and reopened', async () => {
    const { rerender } = render(<ProcessRequestOptions {...defaultProps} />, { wrapper: createWrapper() });

    // Wait for sessions to load
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /session 3a/i })).toBeInTheDocument();
    });

    // Change some values
    const sessionSelect = screen.getByLabelText(/session/i);
    await userEvent.selectOptions(sessionSelect, '3a');
    const limitInput = screen.getByLabelText(/limit/i);
    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, '50');
    await userEvent.click(screen.getByLabelText('Bunk With'));

    // Close the modal
    rerender(<ProcessRequestOptions {...defaultProps} isOpen={false} />);

    // Reopen the modal
    rerender(<ProcessRequestOptions {...defaultProps} isOpen={true} />);

    // Values should be reset
    expect(screen.getByLabelText(/session/i)).toHaveValue('all');
    expect(screen.getByLabelText(/limit/i)).toHaveValue(null);
    expect(screen.getByLabelText('Bunk With')).not.toBeChecked();
  });
});
