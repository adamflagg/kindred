import { useQuery } from '@tanstack/react-query';
import { pb, type AdminSetting } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import { queryKeys, userDataOptions } from '../utils/queryKeys';

export function useAdminSettings() {
  const { user } = useAuth();
  return useQuery<AdminSetting[]>({
    queryKey: queryKeys.adminSettings(),
    queryFn: async () => {
      const settings = await pb
        .collection<AdminSetting>('admin_settings')
        .getFullList({
          sort: 'key',
        });

      return settings;
    },
    ...userDataOptions,
    enabled: !!user, // Only run query if user is authenticated
  });
}