import { useState, useMemo } from 'react';
import {
  AlertCircle,
  Loader2,
  Save,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  Sliders,
  Database,
  Workflow,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSolverConfig, type ConfigSection } from '../../hooks/useSolverConfig';
import { useUpdateSolverConfig, useResetSolverConfig } from '../../hooks/useSolverConfigMutation';
import { SectionCard } from './SectionCard';
import { ScaleGuideSidebar } from './ScaleGuideSidebar';

// Category definitions - these IDs match the business_category values in config metadata
interface CategoryDef {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

// eslint-disable-next-line react-refresh/only-export-components -- Config constant for category navigation
export const CATEGORIES: CategoryDef[] = [
  {
    id: 'solver',
    name: 'Bunk Optimizer',
    icon: Sliders,
    description: 'Cabin assignment rules'
  },
  {
    id: 'processing',
    name: 'Request Processing',
    icon: Workflow,
    description: 'AI-powered request pipeline'
  },
  {
    id: 'history',
    name: 'Data & History',
    icon: Database,
    description: 'Historical context & tracking'
  }
];

export function ConfigTab() {
  const [activeCategory, setActiveCategory] = useState<string>('solver');
  const [searchTerm, setSearchTerm] = useState('');
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  const { data: solverConfigData, isLoading, error } = useSolverConfig();
  const updateConfig = useUpdateSolverConfig();
  const resetConfig = useResetSolverConfig();

  const sections = useMemo(
    () => solverConfigData?.sections ?? [],
    [solverConfigData?.sections]
  );

  // Group configs by business_category, splitting sections as needed
  const categorizedSections = useMemo(() => {
    const result: Record<string, ConfigSection[]> = {
      solver: [],
      processing: [],
      history: []
    };

    sections.forEach(section => {
      const configsByCategory: Record<string, typeof section.configs> = {};

      section.configs.forEach(config => {
        const businessCategory = config.metadata?.['business_category'] as string || 'solver';
        if (!configsByCategory[businessCategory]) {
          configsByCategory[businessCategory] = [];
        }
        configsByCategory[businessCategory].push(config);
      });

      for (const [category, configs] of Object.entries(configsByCategory)) {
        if (configs.length > 0 && result[category]) {
          result[category].push({
            ...section,
            configs: configs
          });
        }
      }
    });

    return result;
  }, [sections]);

  // Filter sections by search term
  const filteredSections = useMemo(() => {
    const categorySections = categorizedSections[activeCategory] || [];

    if (!searchTerm.trim()) return categorySections;

    const term = searchTerm.toLowerCase();
    return categorySections.map(section => ({
      ...section,
      configs: section.configs.filter(config =>
        config.metadata?.friendly_name?.toLowerCase().includes(term) ||
        config.description?.toLowerCase().includes(term) ||
        config.config_key.toLowerCase().includes(term)
      )
    })).filter(section => section.configs.length > 0);
  }, [categorizedSections, activeCategory, searchTerm]);

  const hasChanges = Object.keys(editedValues).length > 0;

  const handleValueChange = (key: string, value: string) => {
    setEditedValues(prev => ({ ...prev, [key]: value }));
  };

  const saveAllChanges = async () => {
    try {
      for (const [key, value] of Object.entries(editedValues)) {
        await updateConfig.mutateAsync({ key, value });
      }
      setEditedValues({});
      toast.success(`Saved ${Object.keys(editedValues).length} changes`);
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDiscard = () => {
    setEditedValues({});
    toast('Changes discarded', { icon: '\u21a9\ufe0f', duration: 2000 });
  };

  const handleResetToDefaults = async () => {
    if (confirm('Reset ALL settings to factory defaults? This cannot be undone and will affect optimizer behavior.')) {
      try {
        await resetConfig.mutateAsync();
        setEditedValues({});
        toast.success('All settings reset to factory defaults');
      } catch (error) {
        toast.error(`Failed to reset: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lodge" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/30 rounded-xl p-4 sm:p-6 text-center border border-red-200 dark:border-red-800">
        <AlertCircle className="w-6 h-6 sm:w-8 sm:h-8 text-red-500 dark:text-red-400 mx-auto mb-2" />
        <p className="text-red-700 dark:text-red-300 text-sm">Failed to load configuration</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
      {/* Mobile Category Tabs */}
      <div className="lg:hidden">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
          {CATEGORIES.map(category => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;
            const sectionCount = categorizedSections[category.id]?.length || 0;

            return (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg whitespace-nowrap text-sm font-semibold transition-colors flex-shrink-0 ${
                  isActive
                    ? 'bg-forest-100 dark:bg-forest-900/40 text-forest-800 dark:text-forest-200'
                    : 'bg-muted/50 dark:bg-muted text-muted-foreground hover:bg-muted'
                }`}
              >
                <Icon className="w-4 h-4" />
                {category.name}
                {sectionCount > 0 && (
                  <span className="text-sm opacity-60">({sectionCount})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-4 space-y-1.5">
          {CATEGORIES.map(category => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;
            const sectionCount = categorizedSections[category.id]?.length || 0;

            return (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`w-full text-left px-4 py-3.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-forest-100 dark:bg-forest-900/40 text-forest-800 dark:text-forest-200'
                    : 'text-muted-foreground hover:bg-muted/50 dark:hover:bg-muted'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5" />
                  <div className="flex-1">
                    <div className="font-semibold text-base">{category.name}</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      {sectionCount} sections
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Sidebar Reset to Defaults Button */}
          <div className="pt-4 mt-4 border-t border-border">
            <button
              onClick={handleResetToDefaults}
              disabled={resetConfig.isPending}
              className="w-full text-left px-4 py-2.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm flex items-center gap-2 transition-colors"
              title="Reset all settings to factory defaults"
            >
              {resetConfig.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Reset to Defaults
            </button>
            <p className="text-xs text-muted-foreground mt-1.5 px-4">
              Restores factory settings
            </p>
          </div>
        </div>
      </div>

      {/* Scale Guide Sidebar - floating on right edge */}
      <ScaleGuideSidebar activeCategory={activeCategory} />

      {/* Content */}
      <div className="flex-1 min-w-0">

        {/* Search */}
        <div className="mb-5 sm:mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search settings..."
              className="w-full pl-12 pr-12 py-3 bg-muted/30 dark:bg-muted/50 border border-border rounded-lg text-base focus:border-forest-500 focus:ring-1 focus:ring-forest-500 focus:outline-none"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {filteredSections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              editedValues={editedValues}
              onValueChange={handleValueChange}
              defaultExpanded={index < 3}
            />
          ))}

          {filteredSections.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-base">No settings found</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Buttons */}
      {hasChanges && (
        <div className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 z-50 flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-200">
          <button
            onClick={handleDiscard}
            className="flex items-center gap-2 px-5 py-3 bg-card text-muted-foreground rounded-xl shadow-lg hover:bg-muted hover:text-foreground transition-colors font-semibold text-base border border-border"
            title="Discard unsaved changes"
          >
            <X className="w-5 h-5" />
            <span className="hidden sm:inline">Discard</span>
          </button>
          <button
            onClick={saveAllChanges}
            disabled={updateConfig.isPending}
            className="flex items-center gap-2 px-6 py-3 bg-forest-600 text-white rounded-xl shadow-lg hover:bg-forest-700 transition-colors font-semibold text-base"
          >
            {updateConfig.isPending ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Saving...</>
            ) : (
              <><Save className="w-5 h-5" /> Save {Object.keys(editedValues).length}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
