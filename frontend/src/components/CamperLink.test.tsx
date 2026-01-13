import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import CamperLink from './CamperLink';

// Wrapper to provide router context
const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('CamperLink', () => {
  describe('when request is confirmed with valid personCmId', () => {
    it('renders as a clickable link', () => {
      renderWithRouter(
        <CamperLink
          personCmId={12345}
          displayName="Sarah Johnson"
          isConfirmed={true}
        />
      );

      const link = screen.getByRole('link', { name: /Sarah Johnson/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/summer/camper/12345');
    });

    it('includes external link icon', () => {
      renderWithRouter(
        <CamperLink
          personCmId={12345}
          displayName="Sarah Johnson"
          isConfirmed={true}
        />
      );

      // The ExternalLink icon should be present (as an svg)
      const link = screen.getByRole('link');
      const svg = link.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('applies custom className to link', () => {
      renderWithRouter(
        <CamperLink
          personCmId={12345}
          displayName="Sarah Johnson"
          isConfirmed={true}
          className="custom-class"
        />
      );

      const link = screen.getByRole('link');
      expect(link).toHaveClass('custom-class');
    });
  });

  describe('when request is not confirmed', () => {
    it('renders as plain text without link', () => {
      renderWithRouter(
        <CamperLink
          personCmId={12345}
          displayName="Sarah Johnson"
          isConfirmed={false}
        />
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
    });

    it('shows unresolved indicator when showUnresolved is true', () => {
      renderWithRouter(
        <CamperLink
          personCmId={12345}
          displayName="Sarah Johnson"
          isConfirmed={false}
          showUnresolved={true}
        />
      );

      expect(screen.getByText(/unresolved/i)).toBeInTheDocument();
    });
  });

  describe('when personCmId is invalid', () => {
    it('renders as plain text when personCmId is null', () => {
      renderWithRouter(
        <CamperLink
          personCmId={null}
          displayName="Unknown Person"
          isConfirmed={true}
        />
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('Unknown Person')).toBeInTheDocument();
    });

    it('renders as plain text when personCmId is negative (placeholder)', () => {
      renderWithRouter(
        <CamperLink
          personCmId={-707171137}
          displayName="Ella Lanford"
          isConfirmed={true}
        />
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('Ella Lanford')).toBeInTheDocument();
    });

    it('renders as plain text when personCmId is zero', () => {
      renderWithRouter(
        <CamperLink
          personCmId={0}
          displayName="Some Person"
          isConfirmed={true}
        />
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders as plain text when personCmId is undefined', () => {
      renderWithRouter(
        <CamperLink
          personCmId={undefined}
          displayName="Some Person"
          isConfirmed={true}
        />
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  describe('display fallback', () => {
    it('shows fallback text when displayName is empty and personCmId is valid', () => {
      renderWithRouter(
        <CamperLink
          personCmId={12345}
          displayName=""
          isConfirmed={true}
        />
      );

      // Should show "View camper" as fallback
      expect(screen.getByText('View camper')).toBeInTheDocument();
    });

    it('shows nothing meaningful when both displayName and personCmId are invalid', () => {
      renderWithRouter(
        <CamperLink
          personCmId={null}
          displayName=""
          isConfirmed={false}
        />
      );

      // Should render but with minimal content
      const container = screen.getByTestId('camper-link-container');
      expect(container).toBeInTheDocument();
    });
  });
});
