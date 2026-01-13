import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import type { ConfigWithMetadata } from './useSolverConfig';

interface UpdateSolverConfigParams {
  key: string;
  value: unknown;
}

export function useUpdateSolverConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: UpdateSolverConfigParams) => {
      // Parse the key to get category, subcategory, and config_key
      const keyParts = key.split('.');
      let category: string;
      let subcategory: string | null = null;
      let config_key: string;
      
      if (keyParts.length === 2) {
        [category, config_key] = keyParts as [string, string];
      } else if (keyParts.length === 3) {
        [category, subcategory, config_key] = keyParts as [string, string, string];
      } else {
        throw new Error(`Invalid configuration key format: "${key}"`);
      }
      
      // Build the filter
      let filter = `category = "${category}" && config_key = "${config_key}"`;
      if (subcategory) {
        filter += ` && subcategory = "${subcategory}"`;
      } else {
        filter += ` && (subcategory = "" || subcategory = null)`;
      }
      
      // Find the config by key parts
      const configs = await pb.collection<ConfigWithMetadata>('config').getFullList({
        filter: filter
      });
      
      if (configs.length === 0) {
        throw new Error(`Configuration key "${key}" not found`);
      }
      
      const config = configs[0];
      if (!config) {
        throw new Error(`Configuration key "${key}" not found`);
      }

      // Update the config value
      return await pb.collection<ConfigWithMetadata>('config').update(config.id, {
        value: value
      });
    },
    onSuccess: () => {
      // Invalidate solver config query to refetch
      queryClient.invalidateQueries({ queryKey: ['solver-config'] });
    }
  });
}

export function useResetSolverConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Get all configs
      const configs = await pb.collection<ConfigWithMetadata>('config').getFullList();
      
      // Reset each to default value if it exists in metadata
      const updates = configs.map(config => {
        const defaultValue = config.metadata?.['default_value'];
        if (defaultValue !== undefined && defaultValue !== null) {
          return pb.collection<ConfigWithMetadata>('config').update(config.id, {
            value: defaultValue
          });
        }
        return Promise.resolve(config);
      });
      
      return await Promise.all(updates);
    },
    onSuccess: () => {
      // Invalidate solver config query to refetch
      queryClient.invalidateQueries({ queryKey: ['solver-config'] });
    }
  });
}