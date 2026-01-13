import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClearAssignmentsDialog from './ClearAssignmentsDialog';

describe('ClearAssignmentsDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    render(<ClearAssignmentsDialog {...defaultProps} isOpen={false} />);

    expect(screen.queryByText(/clear all assignments/i)).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    render(<ClearAssignmentsDialog {...defaultProps} />);

    expect(screen.getByRole('heading', { name: /clear all assignments/i })).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('calls onClose when cancel button clicked', () => {
    render(<ClearAssignmentsDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm when confirm button clicked', () => {
    render(<ClearAssignmentsDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /clear assignments/i }));

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('has accessible dialog structure', () => {
    render(<ClearAssignmentsDialog {...defaultProps} />);

    // Should have a heading
    expect(screen.getByRole('heading', { name: /clear all assignments/i })).toBeInTheDocument();

    // Should have two buttons
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear assignments/i })).toBeInTheDocument();
  });
});
