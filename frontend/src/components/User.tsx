import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { User as UserIcon, Mail, Activity, AlertTriangle, LogOut } from 'lucide-react';
import { pb } from '../lib/pocketbase';

export default function User() {
  const navigate = useNavigate();
  const { user, isLoading, error, isBypassMode, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-6 text-center">
          <h2 className="text-xl font-display font-bold text-destructive mb-2">Authentication Error</h2>
          <p className="text-muted-foreground">{error || 'Not authenticated'}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header Section */}
      <div className="card-lodge p-4 sm:p-6 mb-6">
        <h1 className="text-2xl sm:text-3xl font-display font-bold flex items-center gap-3">
          <UserIcon className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
          My Account
        </h1>
        <p className="text-muted-foreground mt-2">View and manage your profile information</p>
      </div>

      <div className="max-w-3xl mx-auto">
        {/* Main Profile Section */}
        <div className="space-y-6">
          {/* Profile Header Card */}
          <div className="card-lodge overflow-hidden">
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 p-6">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="w-24 h-24 bg-background rounded-full flex items-center justify-center shadow-lg overflow-hidden">
                    {user['avatar'] ? (
                      <img 
                        src={pb.files.getURL(user, user['avatar'])}
                        alt={user['name'] || user['email']}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <UserIcon className="w-12 h-12 text-primary" />
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-foreground">{user['name'] || user['email']}</h2>
                  <p className="text-muted-foreground">{user['email']}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Account Details Card */}
          <div className="card-lodge p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-primary" />
              Account Information
            </h3>

            <div className="space-y-4">
              <div className="pb-4 border-b border-border">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Email Address</p>
                    <p className="font-medium">{user['email'] || 'No email address provided'}</p>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center flex-shrink-0">
                    <Activity className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Account Status</p>
                    <p className="font-medium text-primary">Active</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bypass Mode Warning */}
          {isBypassMode && (
            <div className="bg-accent/20 border border-accent/50 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-accent-foreground">Bypass Mode Active</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Authentication is in bypass mode. User information may not reflect actual authentication data.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Sign Out Section */}
          <div className="card-lodge p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <LogOut className="w-5 h-5 text-muted-foreground" />
                  Session
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Sign out of your account on this device
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all
                         text-red-600 dark:text-red-400
                         bg-red-50 dark:bg-red-900/20
                         hover:bg-red-100 dark:hover:bg-red-900/30
                         border border-red-200 dark:border-red-800/50
                         hover:border-red-300 dark:hover:border-red-700/50
                         flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}