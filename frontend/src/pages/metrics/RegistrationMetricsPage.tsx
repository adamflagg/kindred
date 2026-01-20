/**
 * RegistrationMetricsPage - Main page for viewing registration metrics.
 * Supports both single-year and year-over-year comparison modes.
 */

import { useState } from 'react';
import { useCurrentYear } from '../../hooks/useCurrentYear';
import { YearModeToggle } from '../../components/metrics/YearModeToggle';
import { RetentionTab } from './RetentionTab';
import { RegistrationTab } from './RegistrationTab';

type TabType = 'retention' | 'registration';

export function RegistrationMetricsPage() {
  const { currentYear, availableYears } = useCurrentYear();
  const [mode, setMode] = useState<'single' | 'comparison'>('single');
  // Default to currentYear (from context), comparison defaults to previous year
  const [yearA, setYearA] = useState(currentYear);
  const [yearB, setYearB] = useState(currentYear - 1);
  const [activeTab, setActiveTab] = useState<TabType>('registration');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Registration Metrics</h1>
          <p className="mt-1 text-muted-foreground">
            Analyze registration data and retention trends
          </p>
        </div>

        {/* Year Mode Toggle */}
        <div className="mb-6">
          <YearModeToggle
            mode={mode}
            onModeChange={setMode}
            yearA={yearA}
            yearB={yearB}
            onYearAChange={setYearA}
            onYearBChange={setYearB}
            availableYears={availableYears}
          />
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-border mb-6">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('registration')}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'registration'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              Registration
            </button>
            <button
              onClick={() => setActiveTab('retention')}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'retention'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              Retention
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'registration' && (
            <RegistrationTab year={yearA} />
          )}
          {activeTab === 'retention' && (
            <RetentionTab
              baseYear={mode === 'comparison' ? yearB : yearA - 1}
              compareYear={yearA}
            />
          )}
        </div>
      </div>
    </div>
  );
}
