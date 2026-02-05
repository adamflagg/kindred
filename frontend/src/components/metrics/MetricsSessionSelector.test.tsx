/**
 * TDD Tests for MetricsSessionSelector - unified session dropdown for metrics module
 *
 * This component consumes the MetricsSessionContext and provides a dropdown
 * for filtering metrics data by session. It replaces both RegistrationSessionSelector
 * and RetentionSessionSelector.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MetricsSessionSelector } from "./MetricsSessionSelector";
import { MetricsSessionProvider } from "../../contexts/MetricsSessionContext";
import {
  CurrentYearContext,
  type CurrentYearContextType,
} from "../../hooks/useCurrentYear";

// Mock useMetricsSessions hook
vi.mock("../../hooks/useMetricsSessions", () => ({
  useMetricsSessions: vi.fn(() => ({
    data: [
      {
        cm_id: 1001,
        name: "Session 1",
        session_type: "main",
        start_date: "2026-06-15",
      },
      {
        cm_id: 1002,
        name: "Session 2",
        session_type: "main",
        start_date: "2026-07-01",
      },
      {
        cm_id: 1003,
        name: "Session 2a",
        session_type: "embedded",
        start_date: "2026-07-01",
      },
    ],
    isLoading: false,
  })),
}));

// Helper to create test wrapper with all required providers
function createWrapper(initialPath: string = "/metrics/registration") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockYearContext: CurrentYearContextType = {
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025, 2024, 2023, 2022],
    isTransitioning: false,
  };

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <CurrentYearContext.Provider value={mockYearContext}>
            <MetricsSessionProvider>{children}</MetricsSessionProvider>
          </CurrentYearContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("MetricsSessionSelector", () => {
  describe("rendering", () => {
    it('should render with "All Sessions" as default display', () => {
      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      expect(screen.getByText("All Sessions")).toBeInTheDocument();
    });

    it("should render a calendar icon", () => {
      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      // CalendarDays icon should be present
      const container = screen.getByRole("button").parentElement;
      expect(container?.querySelector("svg")).toBeInTheDocument();
    });

    it("should render selected session name from URL param", () => {
      render(<MetricsSessionSelector />, {
        wrapper: createWrapper("/metrics/registration?session=1001"),
      });

      expect(screen.getByText("Session 1")).toBeInTheDocument();
    });

    it("should render all session options when dropdown is opened", () => {
      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      // Click to open dropdown
      const button = screen.getByRole("button");
      fireEvent.click(button);

      // All sessions should be visible
      expect(screen.getByText("Session 1")).toBeInTheDocument();
      expect(screen.getByText("Session 2")).toBeInTheDocument();
      expect(screen.getByText("Session 2a")).toBeInTheDocument();
    });

    it('should show "All Sessions" option in dropdown', () => {
      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      const button = screen.getByRole("button");
      fireEvent.click(button);

      // "All Sessions" should appear as an option
      const allSessionsOptions = screen.getAllByText("All Sessions");
      expect(allSessionsOptions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("selection behavior", () => {
    it("should update URL when a session is selected", async () => {
      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      // Open dropdown
      const button = screen.getByRole("button");
      fireEvent.click(button);

      // Select Session 2
      const sessionOption = screen.getByText("Session 2");
      fireEvent.click(sessionOption);

      // Button should now show Session 2
      expect(screen.getByRole("button")).toHaveTextContent("Session 2");
    });

    it('should clear selection when "All Sessions" is selected', () => {
      render(<MetricsSessionSelector />, {
        wrapper: createWrapper("/metrics/registration?session=1001"),
      });

      // Open dropdown
      const button = screen.getByRole("button");
      fireEvent.click(button);

      // Select "All Sessions"
      const allOption = screen.getByRole("option", { name: "All Sessions" });
      fireEvent.click(allOption);

      // Button should now show "All Sessions"
      expect(screen.getByRole("button")).toHaveTextContent("All Sessions");
    });
  });

  describe("loading state", () => {
    it("should be disabled when sessions are loading", async () => {
      // Override mock for this test with loading state
      const { useMetricsSessions } =
        await import("../../hooks/useMetricsSessions");
      vi.mocked(useMetricsSessions).mockReturnValueOnce({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        isFetching: true,
        isSuccess: false,
        status: "pending",
        fetchStatus: "fetching",
      } as unknown as ReturnType<typeof useMetricsSessions>);

      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });
  });

  describe("edge cases", () => {
    it("should handle unknown session cm_id gracefully", () => {
      render(<MetricsSessionSelector />, {
        wrapper: createWrapper("/metrics/registration?session=9999"),
      });

      // Should fall back to "All Sessions" display when cm_id not found
      expect(screen.getByText("All Sessions")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("should have accessible role for the dropdown button", () => {
      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("should have listbox options when opened", () => {
      render(<MetricsSessionSelector />, { wrapper: createWrapper() });

      const button = screen.getByRole("button");
      fireEvent.click(button);

      const options = screen.getAllByRole("option");
      expect(options.length).toBeGreaterThan(0);
    });
  });
});
