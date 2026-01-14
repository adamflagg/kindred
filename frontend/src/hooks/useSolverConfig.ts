import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import type { ConfigRecord, ConfigSectionsRecord } from '../types/pocketbase-types';
import { queryKeys, userDataOptions } from '../utils/queryKeys';

export interface ConfigWithMetadata extends ConfigRecord {
  metadata: {
    friendly_name?: string;
    tooltip?: string;
    section?: string;
    display_order?: number;
    [key: string]: unknown;
  };
}

export interface ConfigSection {
  id: string;
  section_key: string;
  title: string;
  description: string | undefined;
  display_order: number;
  expanded_by_default: boolean | undefined;
  configs: ConfigWithMetadata[];
}

export interface SolverConfigData {
  sections: ConfigSection[];
  configs: ConfigWithMetadata[];
  flat: Record<string, unknown>;
}

export function useSolverConfig() {
  const { user } = useAuth();
  
  return useQuery<SolverConfigData>({
    queryKey: queryKeys.solverConfig(),
    ...userDataOptions,
    queryFn: async () => {
      // Fetch all config records
      const configs = await pb.collection<ConfigWithMetadata>('config').getFullList({
        sort: 'category,subcategory,config_key'
      });
      
      // Fetch all sections
      let sections: ConfigSectionsRecord[] = [];
      try {
        sections = await pb.collection<ConfigSectionsRecord>('config_sections').getFullList({
          sort: 'display_order'
        });
      } catch {
        // If config_sections doesn't exist yet, continue without sections
        console.warn('config_sections table not found, continuing without sections');
      }
      
      // Group configs by section
      const sectionMap = new Map<string, ConfigSection>();
      
      // Initialize sections
      sections.forEach(section => {
        sectionMap.set(section.section_key, {
          id: section.id,
          section_key: section.section_key,
          title: section.title,
          description: section.description,
          display_order: section.display_order,
          expanded_by_default: section.expanded_by_default,
          configs: []
        });
      });
      
      // Add configs to their sections
      configs.forEach(config => {
        const sectionKey = config.metadata?.section;
        if (sectionKey && sectionMap.has(sectionKey)) {
          const section = sectionMap.get(sectionKey);
          if (section) {
            section.configs.push(config);
          }
        } else {
          // If no section or section not found, add to an "other" section
          if (!sectionMap.has('other')) {
            sectionMap.set('other', {
              id: 'other',
              section_key: 'other',
              title: 'Other Settings',
              description: 'Uncategorized configuration settings',
              display_order: 999,
              expanded_by_default: false,
              configs: []
            });
          }
          const otherSection = sectionMap.get('other');
          if (otherSection) {
            otherSection.configs.push(config);
          }
        }
      });
      
      // Sort configs within each section by display_order
      sectionMap.forEach(section => {
        section.configs.sort((a, b) => {
          const orderA = a.metadata?.display_order ?? 999;
          const orderB = b.metadata?.display_order ?? 999;
          return orderA - orderB;
        });
      });
      
      // Convert to array and sort by section display_order
      const sortedSections = Array.from(sectionMap.values()).sort((a, b) => 
        a.display_order - b.display_order
      );
      
      // Create flat structure for backward compatibility
      const flat = configs.reduce<Record<string, unknown>>((acc, config) => {
        const key = [config.category, config.subcategory, config.config_key]
          .filter(Boolean)
          .join('.');
        acc[key] = config.value;
        return acc;
      }, {});
      
      return {
        sections: sortedSections,
        configs: configs,
        flat: flat
      };
    },
    enabled: !!user, // Only run query if user is authenticated
  });
}

// Helper function to get a specific config value
export function useSolverConfigValue<T = unknown>(key: string, defaultValue?: T): T | undefined {
  const { data } = useSolverConfig();

  if (!data) return defaultValue;

  // Check flat structure for quick access
  if (key in data.flat) {
    return data.flat[key] as T;
  }

  // Search through configs for the key (in case it's a partial match)
  for (const config of data.configs) {
    const fullKey = [config.category, config.subcategory, config.config_key]
      .filter(Boolean)
      .join('.');
    if (fullKey === key || config.config_key === key) {
      return config.value as T;
    }
  }

  return defaultValue;
}