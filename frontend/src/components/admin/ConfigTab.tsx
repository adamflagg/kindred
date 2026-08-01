import { useState, useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { AlertCircle, Loader2, Save, RefreshCw, RotateCcw, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSolverConfig, type ConfigSection } from '../../hooks/useSolverConfig'
import { useUpdateSolverConfig, useResetSolverConfig } from '../../hooks/useSolverConfigMutation'
import { SectionCard } from './SectionCard'
import { ScaleGuideSidebar } from './ScaleGuideSidebar'
import { CONFIG_CATEGORIES } from '../../config/manageTabs'

export function ConfigTab() {
  const { category: activeCategory = 'solver' } = useParams<{ category: string }>()
  const [searchTerm, setSearchTerm] = useState('')
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})

  const { data: solverConfigData, isLoading, error } = useSolverConfig()
  const updateConfig = useUpdateSolverConfig()
  const resetConfig = useResetSolverConfig()

  const sections = useMemo(() => solverConfigData?.sections ?? [], [solverConfigData?.sections])

  // Group configs by business_category, splitting sections as needed
  const categorizedSections = useMemo(() => {
    const result: Record<string, ConfigSection[]> = {
      solver: [],
      processing: [],
      history: [],
      general: [],
    }

    sections.forEach((section) => {
      const configsByCategory: Record<string, typeof section.configs> = {}

      section.configs.forEach((config) => {
        const businessCategory = (config.metadata?.['business_category'] as string) || 'solver'
        configsByCategory[businessCategory] ??= []
        configsByCategory[businessCategory].push(config)
      })

      for (const [category, configs] of Object.entries(configsByCategory)) {
        if (configs.length > 0 && result[category]) {
          result[category].push({
            ...section,
            configs: configs,
          })
        }
      }
    })

    return result
  }, [sections])

  // Filter sections by search term
  const filteredSections = useMemo(() => {
    const categorySections = categorizedSections[activeCategory] ?? []

    if (!searchTerm.trim()) return categorySections

    const term = searchTerm.toLowerCase()
    return categorySections
      .map((section) => ({
        ...section,
        configs: section.configs.filter(
          (config) =>
            (config.metadata?.friendly_name?.toLowerCase().includes(term) ?? false) ||
            (config.description?.toLowerCase().includes(term) ?? false) ||
            config.config_key.toLowerCase().includes(term)
        ),
      }))
      .filter((section) => section.configs.length > 0)
  }, [categorizedSections, activeCategory, searchTerm])

  const hasChanges = Object.keys(editedValues).length > 0

  const handleValueChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }))
  }

  const saveAllChanges = async () => {
    try {
      for (const [key, value] of Object.entries(editedValues)) {
        await updateConfig.mutateAsync({ key, value })
      }
      setEditedValues({})
      toast.success(`Saved ${Object.keys(editedValues).length} changes`)
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleDiscard = () => {
    setEditedValues({})
    toast('Changes discarded', { icon: '\u21a9\ufe0f', duration: 2000 })
  }

  const handleResetToDefaults = async () => {
    if (
      confirm(
        'Reset ALL settings to factory defaults? This cannot be undone and will affect optimizer behavior.'
      )
    ) {
      try {
        await resetConfig.mutateAsync()
        setEditedValues({})
        toast.success('All settings reset to factory defaults')
      } catch (error) {
        toast.error(`Failed to reset: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lodge" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center sm:p-6 dark:border-red-800 dark:bg-red-950/30">
        <AlertCircle className="mx-auto mb-2 h-6 w-6 text-red-500 sm:h-8 sm:w-8 dark:text-red-400" />
        <p className="text-sm text-red-700 dark:text-red-300">Failed to load configuration</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      {/* Mobile Category Tabs */}
      <div className="lg:hidden">
        <div className="-mx-1 flex scrollbar-none gap-2 overflow-x-auto px-1 pb-2">
          {CONFIG_CATEGORIES.map((category) => {
            const Icon = category.icon
            const isActive = activeCategory === category.id
            const sectionCount = categorizedSections[category.id]?.length ?? 0

            return (
              <Link
                key={category.id}
                to={category.path}
                className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-forest-100 dark:bg-forest-900/40 text-forest-800 dark:text-forest-200'
                    : 'bg-muted/50 dark:bg-muted text-muted-foreground hover:bg-muted'
                }`}
              >
                <Icon className="h-4 w-4" />
                {category.name}
                {sectionCount > 0 && <span className="text-sm opacity-60">({sectionCount})</span>}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden w-56 flex-shrink-0 lg:block">
        <div className="sticky top-4 space-y-1.5">
          {CONFIG_CATEGORIES.map((category) => {
            const Icon = category.icon
            const isActive = activeCategory === category.id
            const sectionCount = categorizedSections[category.id]?.length ?? 0

            return (
              <Link
                key={category.id}
                to={category.path}
                className={`block w-full rounded-lg px-4 py-3.5 text-left transition-colors ${
                  isActive
                    ? 'bg-forest-100 dark:bg-forest-900/40 text-forest-800 dark:text-forest-200'
                    : 'text-muted-foreground hover:bg-muted/50 dark:hover:bg-muted'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5" />
                  <div className="flex-1">
                    <div className="text-base font-semibold">{category.name}</div>
                    <div className="text-muted-foreground mt-0.5 text-sm">
                      {sectionCount} sections
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}

          {/* Sidebar Reset to Defaults Button */}
          <div className="border-border mt-4 border-t pt-4">
            <button
              onClick={handleResetToDefaults}
              disabled={resetConfig.isPending}
              className="flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              title="Reset all settings to factory defaults"
            >
              {resetConfig.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Reset to Defaults
            </button>
            <p className="text-muted-foreground mt-1.5 px-4 text-xs">Restores factory settings</p>
          </div>
        </div>
      </div>

      {/* Scale Guide Sidebar - floating on right edge */}
      <ScaleGuideSidebar activeCategory={activeCategory} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Search */}
        <div className="mb-5 sm:mb-6">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search settings..."
              className="bg-muted/30 dark:bg-muted/50 border-border focus:border-forest-500 focus:ring-forest-500 w-full rounded-lg border py-3 pr-12 pl-12 text-base focus:ring-1 focus:outline-none"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-4 -translate-y-1/2"
              >
                <X className="h-5 w-5" />
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
            <div className="text-muted-foreground py-12 text-center">
              <Search className="mx-auto mb-3 h-10 w-10 opacity-50" />
              <p className="text-base">No settings found</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Buttons */}
      {hasChanges && (
        <div className="animate-in slide-in-from-bottom-4 fixed right-4 bottom-4 z-50 flex items-center gap-3 duration-200 sm:right-6 sm:bottom-6">
          <button
            onClick={handleDiscard}
            className="bg-card text-muted-foreground hover:bg-muted hover:text-foreground border-border flex items-center gap-2 rounded-xl border px-5 py-3 text-base font-semibold shadow-lg transition-colors"
            title="Discard unsaved changes"
          >
            <X className="h-5 w-5" />
            <span className="hidden sm:inline">Discard</span>
          </button>
          <button
            onClick={saveAllChanges}
            disabled={updateConfig.isPending}
            className="bg-forest-600 hover:bg-forest-700 flex items-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-lg transition-colors"
          >
            {updateConfig.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="h-5 w-5" /> Save {Object.keys(editedValues).length}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
