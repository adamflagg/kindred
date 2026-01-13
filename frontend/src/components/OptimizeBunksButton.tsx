/**
 * OptimizeBunksButton - Level-of-effort selector for solver optimization
 *
 * A "Campfire Warmth" themed button that lets users choose how long
 * the solver should spend optimizing bunk assignments. The button
 * glows warmer as effort level increases, like adding fuel to a fire.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Wand2, ChevronDown, Zap, Flame, TreePine, Mountain } from 'lucide-react';
import { createPortal } from 'react-dom';

// Optimization levels with their configurations
export interface OptimizationLevel {
  id: string;
  name: string;
  shortName: string;
  timeLimit: number; // seconds
  description: string;
  icon: React.ElementType;
  warmth: 'cool' | 'warm' | 'hot' | 'blazing';
}

// Default level constant - guaranteed to exist
const DEFAULT_LEVEL: OptimizationLevel = {
  id: 'standard',
  name: 'Standard',
  shortName: 'Standard',
  timeLimit: 60,
  description: 'Balanced optimization (default)',
  icon: TreePine,
  warmth: 'warm',
};

// eslint-disable-next-line react-refresh/only-export-components -- Config constant needed by other components
export const OPTIMIZATION_LEVELS: OptimizationLevel[] = [
  {
    id: 'quick',
    name: 'Quick Check',
    shortName: 'Quick',
    timeLimit: 30,
    description: 'Fast scan for obvious improvements',
    icon: Zap,
    warmth: 'cool',
  },
  DEFAULT_LEVEL,
  {
    id: 'thorough',
    name: 'Thorough',
    shortName: 'Thorough',
    timeLimit: 180,
    description: 'Deep exploration of possibilities',
    icon: Flame,
    warmth: 'hot',
  },
  {
    id: 'deep-think',
    name: 'Deep Think',
    shortName: 'Deep',
    timeLimit: 300,
    description: 'Comprehensive search for best solution',
    icon: Mountain,
    warmth: 'blazing',
  },
];

const STORAGE_KEY = 'bunking-optimization-level';

function getStoredLevel(): string {
  if (typeof window === 'undefined') return 'standard';
  return localStorage.getItem(STORAGE_KEY) || 'standard';
}

function setStoredLevel(levelId: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, levelId);
  }
}

// Warmth-based glow styles
const warmthStyles = {
  cool: {
    glow: 'shadow-[0_0_15px_rgba(59,130,246,0.3)]',
    gradient: 'from-blue-500/10 to-transparent',
    ring: 'ring-blue-400/30',
    text: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    iconBg: 'bg-blue-100 dark:bg-blue-900/50',
  },
  warm: {
    glow: 'shadow-[0_0_15px_rgba(34,197,94,0.3)]',
    gradient: 'from-green-500/10 to-transparent',
    ring: 'ring-green-400/30',
    text: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-950/30',
    iconBg: 'bg-green-100 dark:bg-green-900/50',
  },
  hot: {
    glow: 'shadow-[0_0_20px_rgba(251,146,60,0.4)]',
    gradient: 'from-orange-500/15 to-transparent',
    ring: 'ring-orange-400/40',
    text: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    iconBg: 'bg-orange-100 dark:bg-orange-900/50',
  },
  blazing: {
    glow: 'shadow-[0_0_25px_rgba(239,68,68,0.5)]',
    gradient: 'from-red-500/20 to-orange-500/10',
    ring: 'ring-red-400/50',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30',
    iconBg: 'bg-red-100 dark:bg-red-900/50',
  },
};

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

export interface OptimizeBunksButtonProps {
  /** Whether the solver is currently running */
  isSolving: boolean;
  /** Whether results are being applied */
  isApplyingResults: boolean;
  /** Callback when user clicks to run solver with selected time limit */
  onRunSolver: (timeLimit: number) => void;
  /** Optional class name override */
  className?: string;
}

export default function OptimizeBunksButton({
  isSolving,
  isApplyingResults,
  onRunSolver,
  className,
}: OptimizeBunksButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLevelId, setSelectedLevelId] = useState(getStoredLevel);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  // Default to standard level if stored level not found
  const selectedLevel =
    OPTIMIZATION_LEVELS.find((l) => l.id === selectedLevelId) ?? DEFAULT_LEVEL;
  const isDisabled = isSolving || isApplyingResults;
  const warmth = warmthStyles[selectedLevel.warmth];

  // Update dropdown position when opening
  const updateDropdownPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle escape key to close dropdown
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Handle level selection
  const handleSelectLevel = (level: OptimizationLevel) => {
    setSelectedLevelId(level.id);
    setStoredLevel(level.id);
    setIsOpen(false);
  };

  // Handle main button click
  const handleMainClick = () => {
    if (isDisabled) return;
    onRunSolver(selectedLevel.timeLimit);
  };

  // Handle chevron click to toggle dropdown
  const handleDropdownToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDisabled) return;
    if (!isOpen) {
      updateDropdownPosition();
    }
    setIsOpen(!isOpen);
  };

  const LevelIcon = selectedLevel.icon;

  // Get button text based on state
  const getButtonText = () => {
    if (isSolving) return 'Optimizing...';
    if (isApplyingResults) return 'Applying...';
    return 'Optimize';
  };

  return (
    <div className="relative">
      {/* Main button with split action */}
      <div
        className={`
          inline-flex items-stretch rounded-xl overflow-hidden
          transition-all duration-300
          ${isDisabled ? 'opacity-70' : warmth.glow}
          ${className || ''}
        `}
      >
        {/* Primary action button */}
        <button
          ref={buttonRef}
          onClick={handleMainClick}
          disabled={isDisabled}
          className={`
            btn-primary px-3 py-2 text-sm
            flex items-center gap-1.5
            rounded-none rounded-l-xl
            border-r border-primary-foreground/20
            disabled:cursor-not-allowed
          `}
          aria-label={`Optimize bunks using ${selectedLevel.name} mode (${formatTime(selectedLevel.timeLimit)})`}
        >
          {isSolving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{getButtonText()}</span>
          <span className="sm:hidden">{isSolving || isApplyingResults ? '...' : 'Go'}</span>
        </button>

        {/* Dropdown toggle */}
        <button
          onClick={handleDropdownToggle}
          disabled={isDisabled}
          className={`
            btn-primary px-2 py-2
            flex items-center gap-1
            rounded-none rounded-r-xl
            disabled:cursor-not-allowed
            hover:bg-primary/80
          `}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label="Select optimization level"
        >
          <LevelIcon className="h-3.5 w-3.5 hidden sm:block" />
          <span className="text-xs font-medium hidden sm:inline">
            {formatTime(selectedLevel.timeLimit)}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* Dropdown menu - rendered in portal */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label="Optimization levels"
            className="fixed z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              minWidth: dropdownPosition.width,
            }}
          >
            <div
              className="
              bg-card rounded-xl border-2 border-border
              shadow-lg shadow-black/10 dark:shadow-black/30
              overflow-hidden
            "
            >
              {/* Header */}
              <div className="px-4 py-2.5 bg-muted/50 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Optimization Level
                </p>
              </div>

              {/* Options */}
              <div className="py-1">
                {OPTIMIZATION_LEVELS.map((level) => {
                  const levelWarmth = warmthStyles[level.warmth];
                  const isSelected = level.id === selectedLevelId;
                  const Icon = level.icon;

                  return (
                    <button
                      key={level.id}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelectLevel(level)}
                      className={`
                        w-full px-3 py-2.5 flex items-center gap-3
                        transition-all duration-150
                        ${isSelected ? levelWarmth.bg + ' ' + levelWarmth.ring + ' ring-1 ring-inset' : 'hover:bg-muted/50'}
                      `}
                    >
                      {/* Icon with warmth-colored background */}
                      <div
                        className={`
                        flex-shrink-0 w-9 h-9 rounded-lg
                        flex items-center justify-center
                        ${levelWarmth.iconBg}
                        transition-all duration-200
                      `}
                      >
                        <Icon className={`h-4.5 w-4.5 ${levelWarmth.text}`} />
                      </div>

                      {/* Text content */}
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-semibold text-sm ${isSelected ? levelWarmth.text : 'text-foreground'}`}
                          >
                            {level.name}
                          </span>
                          <span
                            className={`
                            text-xs font-mono px-1.5 py-0.5 rounded
                            ${isSelected ? levelWarmth.bg + ' ' + levelWarmth.text : 'bg-muted text-muted-foreground'}
                          `}
                          >
                            {formatTime(level.timeLimit)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{level.description}</p>
                      </div>

                      {/* Selection indicator */}
                      {isSelected && (
                        <div
                          className={`
                          flex-shrink-0 w-2 h-2 rounded-full
                          ${level.warmth === 'cool' ? 'bg-blue-500' : ''}
                          ${level.warmth === 'warm' ? 'bg-green-500' : ''}
                          ${level.warmth === 'hot' ? 'bg-orange-500 animate-pulse' : ''}
                          ${level.warmth === 'blazing' ? 'bg-red-500 animate-pulse' : ''}
                        `}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Footer hint */}
              <div className="px-4 py-2 bg-muted/30 border-t border-border">
                <p className="text-[10px] text-muted-foreground text-center">
                  Longer times explore more possibilities for better results
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Utility function needed for time display consistency
export { formatTime };
