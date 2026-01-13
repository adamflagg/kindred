import { useState, useEffect } from 'react';
import { pb } from '../lib/pocketbase';
import { Users as UsersIcon, Mail, Calendar, Shield } from 'lucide-react';
import type { RecordModel } from 'pocketbase';

interface User extends RecordModel {
  email: string;
  name: string;
  avatar?: string;
  created: string;
}

// Generate consistent color from string (for avatar backgrounds)
function getAvatarColor(str: string): string {
  const colors = [
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return colors[Math.abs(hash) % colors.length] || 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300';
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await pb.collection('users').getList<User>(1, 1000, {
        sort: '-created',
        requestKey: null
      });

      setUsers(result.items);
    } catch (err: unknown) {
      const error = err as { message?: string };
      if (error?.message?.includes('autocancelled')) {
        return;
      }
      setError(error?.message || 'Failed to fetch users');
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-forest-700 to-forest-800 rounded-xl px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-white/10 rounded-lg">
              <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-display font-bold text-white">
                System Access
              </h1>
              <p className="text-forest-200 text-xs sm:text-sm">
                Users authenticated via Pocket ID
              </p>
            </div>
          </div>
          {!isLoading && !error && (
            <div className="text-right">
              <div className="text-lg sm:text-xl font-display font-bold text-white tabular-nums">
                {users.length}
              </div>
              <div className="text-forest-300 text-xs sm:text-sm">
                {users.length === 1 ? 'user' : 'users'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="spinner-lodge" />
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-4 sm:p-6 text-center">
          <h2 className="text-base sm:text-lg font-display font-bold text-red-800 dark:text-red-200 mb-2">
            Error Loading Users
          </h2>
          <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>
          <button onClick={fetchUsers} className="btn-primary">
            Try Again
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 sm:p-12 text-center">
          <UsersIcon className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/50 mx-auto mb-4" />
          <h2 className="text-base sm:text-lg font-display font-semibold text-foreground mb-2">
            No Users Yet
          </h2>
          <p className="text-muted-foreground text-sm">
            Users will appear here after signing in via Pocket ID
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden divide-y divide-border">
          {users.map((user, index) => (
            <div
              key={user.id}
              className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4 hover:bg-muted/50 dark:hover:bg-muted/30 transition-colors"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {/* Avatar */}
              <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${
                user.avatar ? '' : getAvatarColor(user.email)
              }`}>
                {user.avatar ? (
                  <img
                    src={pb.files.getURL(user, user.avatar, { thumb: '44x44' })}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm sm:text-base font-semibold">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              {/* User Info */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate text-sm sm:text-base">
                  {user.name || user.email.split('@')[0]}
                </div>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground">
                  <Mail className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                  <span className="truncate">{user.email}</span>
                </div>
              </div>

              {/* Join Date */}
              <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground flex-shrink-0">
                <Calendar className="h-3.5 w-3.5" />
                <span>{formatRelativeTime(user.created)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
