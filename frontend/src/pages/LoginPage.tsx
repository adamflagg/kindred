import { useCallback, useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { getAuthMethods } from '../lib/pocketbase';
import { Loader2, LogIn, Trees, Mountain, AlertCircle } from 'lucide-react';
import { BrandedLogo } from '../components/BrandedLogo';
import { getCampName, getPageDescription, getSsoDisplayName } from '../config/branding';

interface OAuth2Provider {
  name: string;
  displayName?: string;
  state: string;
  authURL: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

const LoginPage = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [providers, setProviders] = useState<OAuth2Provider[]>([]);
  // Use ref instead of state for auto-login tracking since we don't need re-renders
  const autoLoginAttemptedRef = useRef(false);

  // Get the 'from' location if redirected from a protected route or query param
  const searchParams = new URLSearchParams(location.search);
  const fromQuery = searchParams.get('from');
  const from = fromQuery || location.state?.from?.pathname || '/';

  // Define handleProviderLogin BEFORE useEffects that use it
  const handleProviderLogin = useCallback(async (provider: OAuth2Provider) => {
    setIsLoading(true);
    try {
      await login(provider.name);
      // On success, the auth change will trigger redirect
    } catch (err: unknown) {
      console.error('Login failed:', err);
      setError('Login failed. Please try again.');
      setIsLoading(false);
    }
  }, [login]);

  // Fetch available auth providers
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const authMethods = await getAuthMethods();
        const oauth2Providers = authMethods.oauth2?.providers || [];
        setProviders(oauth2Providers);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to fetch auth providers:', err);
        setError('Failed to load authentication options');
        setIsLoading(false);
      }
    };

    if (!user) {
      fetchProviders();
    }
  }, [user]);

  useEffect(() => {
    // If user is already logged in, redirect them away from login page
    if (user) {
      navigate(from, { replace: true });
      return;
    }

    // Auto-login if there's only one provider and we haven't tried yet
    if (providers.length === 1 && !autoLoginAttemptedRef.current && !error && providers[0]) {
      autoLoginAttemptedRef.current = true;
      handleProviderLogin(providers[0]);
    }
  }, [user, navigate, from, providers, error, handleProviderLogin]);

  // Get a user-friendly provider name
  const getProviderDisplayName = (provider: OAuth2Provider) => {
    if (provider.displayName) return provider.displayName;

    // Common provider name mappings
    const nameMap: Record<string, string> = {
      'oidc': getSsoDisplayName(),
      'google': 'Google',
      'github': 'GitHub',
      'microsoft': 'Microsoft',
      'discord': 'Discord',
      'gitlab': 'GitLab',
      'facebook': 'Facebook',
      'twitter': 'Twitter',
      'apple': 'Apple',
    };

    return nameMap[provider.name] || provider.name;
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
      {/* Ambient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-forest-100/30 dark:to-forest-900/30" />

      {/* Mountain silhouette */}
      <div className="absolute bottom-0 left-0 right-0 h-48 opacity-[0.04]">
        <svg viewBox="0 0 1440 320" className="w-full h-full" preserveAspectRatio="none">
          <path
            fill="currentColor"
            d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,197.3C840,192,960,160,1080,165.3C1200,171,1320,213,1380,234.7L1440,256L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
          />
        </svg>
      </div>

      {/* Floating decorative elements */}
      <div className="absolute top-16 left-8 text-primary/5 animate-float" style={{ animationDelay: '0s' }}>
        <Trees className="w-20 h-20" />
      </div>
      <div className="absolute bottom-24 right-12 text-primary/5 animate-float" style={{ animationDelay: '1.5s' }}>
        <Mountain className="w-16 h-16" />
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-md px-4 animate-fade-in">
        <div className="card-lodge p-8 sm:p-10">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute -inset-3 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-2xl blur-xl" />
              <BrandedLogo size="large" className="relative" />
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground mb-2">
              {getCampName()}
            </h1>
            <p className="text-muted-foreground">
              {getPageDescription()}
            </p>
          </div>

          {/* Auth content */}
          <div className="space-y-6">
            {error ? (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 p-5">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-red-800 dark:text-red-200 mb-1">
                      Authentication Error
                    </h3>
                    <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                      {error}
                    </p>
                    <button
                      onClick={() => {
                        setError(null);
                        autoLoginAttemptedRef.current = false;
                      }}
                      className="btn-primary text-sm"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
            ) : isLoading ? (
              <div className="text-center py-4">
                <div className="relative inline-flex">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-md animate-pulse" />
                  <Loader2 className="w-10 h-10 animate-spin text-primary relative" />
                </div>
                <p className="mt-4 text-foreground font-medium">
                  {providers.length === 1 && providers[0]
                    ? `Connecting to ${getProviderDisplayName(providers[0])}...`
                    : 'Preparing login...'}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  A popup window will appear shortly
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {providers.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground mb-2">
                      No authentication providers configured.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Contact your administrator.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {providers.map((provider) => (
                      <button
                        key={provider.name}
                        onClick={() => handleProviderLogin(provider)}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3.5
                                   bg-primary text-primary-foreground font-semibold rounded-xl
                                   shadow-lodge-md hover:shadow-lodge-lg
                                   hover:-translate-y-0.5 active:translate-y-0
                                   transition-all duration-200"
                      >
                        <LogIn className="w-5 h-5" />
                        Sign in with {getProviderDisplayName(provider)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer hint */}
        <p className="text-center mt-6 text-sm text-muted-foreground/70">
          Use your staff credentials
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
