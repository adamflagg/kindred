/**
 * Tests for useCurrentYear hook
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { useCurrentYear, useYear, CurrentYearContext, type CurrentYearContextType } from './useCurrentYear';

describe('useCurrentYear', () => {
  it('should throw error when used outside provider', () => {
    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useCurrentYear());
    }).toThrow('useCurrentYear must be used within a CurrentYearProvider');

    consoleSpy.mockRestore();
  });

  it('should return context value when used within provider', () => {
    const mockContext: CurrentYearContextType = {
      currentYear: 2025,
      setCurrentYear: vi.fn(),
      availableYears: [2024, 2025, 2026],
      isTransitioning: false,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(CurrentYearContext.Provider, { value: mockContext }, children);

    const { result } = renderHook(() => useCurrentYear(), { wrapper });

    expect(result.current.currentYear).toBe(2025);
    expect(result.current.availableYears).toEqual([2024, 2025, 2026]);
    expect(result.current.isTransitioning).toBe(false);
    expect(typeof result.current.setCurrentYear).toBe('function');
  });

  it('should reflect context changes', () => {
    const mockContext: CurrentYearContextType = {
      currentYear: 2024,
      setCurrentYear: vi.fn(),
      availableYears: [2023, 2024],
      isTransitioning: true,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(CurrentYearContext.Provider, { value: mockContext }, children);

    const { result } = renderHook(() => useCurrentYear(), { wrapper });

    expect(result.current.currentYear).toBe(2024);
    expect(result.current.isTransitioning).toBe(true);
  });
});

describe('useYear', () => {
  it('should throw error when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useYear());
    }).toThrow('useCurrentYear must be used within a CurrentYearProvider');

    consoleSpy.mockRestore();
  });

  it('should return only the current year value', () => {
    const mockContext: CurrentYearContextType = {
      currentYear: 2025,
      setCurrentYear: vi.fn(),
      availableYears: [2024, 2025],
      isTransitioning: false,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(CurrentYearContext.Provider, { value: mockContext }, children);

    const { result } = renderHook(() => useYear(), { wrapper });

    expect(result.current).toBe(2025);
  });

  it('should update when context year changes', () => {
    let year = 2024;
    const mockContext: CurrentYearContextType = {
      get currentYear() {
        return year;
      },
      setCurrentYear: (newYear: number) => {
        year = newYear;
      },
      availableYears: [2024, 2025],
      isTransitioning: false,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(CurrentYearContext.Provider, { value: mockContext }, children);

    const { result, rerender } = renderHook(() => useYear(), { wrapper });

    expect(result.current).toBe(2024);

    // Simulate year change
    year = 2025;
    rerender();

    expect(result.current).toBe(2025);
  });
});
