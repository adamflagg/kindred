import { useCallback, useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { getAuthMethods } from '../lib/pocketbase'
import { Loader2, LogIn, Trees, Mountain, AlertCircle } from 'lucide-react'
import { BrandedLogo } from '../components/BrandedLogo'
import { getCampName, getPageDescription, getSsoDisplayName } from '../config/branding'

interface OAuth2Provider {
  name: string
  displayName?: string
  state: string
  authURL: string
  codeVerifier: string
  codeChallenge: string
  codeChallengeMethod: string
}

const LoginPage = () => {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [providers, setProviders] = useState<OAuth2Provider[]>([])
  // Use ref instead of state for auto-login tracking since we don't need re-renders
  const autoLoginAttemptedRef = useRef(false)

  // Get the 'from' location if redirected from a protected route or query param
  const searchParams = new URLSearchParams(location.search)
  const fromQuery = searchParams.get('from')
  const from = fromQuery ?? location.state?.from?.pathname ?? '/'

  // Define handleProviderLogin BEFORE useEffects that use it
  const handleProviderLogin = useCallback(
    async (provider: OAuth2Provider) => {
      setIsLoading(true)
      try {
        await login(provider.name)
        // On success, the auth change will trigger redirect
      } catch (err: unknown) {
        console.error('Login failed:', err)
        setError('Login failed. Please try again.')
        setIsLoading(false)
      }
    },
    [login]
  )

  // Fetch available auth providers
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const authMethods = await getAuthMethods()
        const oauth2Providers = authMethods.oauth2.providers
        setProviders(oauth2Providers)
        setIsLoading(false)
      } catch (err) {
        console.error('Failed to fetch auth providers:', err)
        setError('Failed to load authentication options')
        setIsLoading(false)
      }
    }

    if (!user) {
      void fetchProviders()
    }
  }, [user])

  useEffect(() => {
    // If user is already logged in, redirect them away from login page
    if (user) {
      void navigate(from, { replace: true })
      return
    }

    // Auto-login if there's only one provider and we haven't tried yet
    if (providers.length === 1 && !autoLoginAttemptedRef.current && !error && providers[0]) {
      autoLoginAttemptedRef.current = true
      void handleProviderLogin(providers[0])
    }
  }, [user, navigate, from, providers, error, handleProviderLogin])

  // Get a user-friendly provider name
  const getProviderDisplayName = (provider: OAuth2Provider) => {
    if (provider.displayName) return provider.displayName

    // Common provider name mappings
    const nameMap: Record<string, string> = {
      oidc: getSsoDisplayName(),
      google: 'Google',
      github: 'GitHub',
      microsoft: 'Microsoft',
      discord: 'Discord',
      gitlab: 'GitLab',
      facebook: 'Facebook',
      twitter: 'Twitter',
      apple: 'Apple',
    }

    return nameMap[provider.name] ?? provider.name
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Ambient background */}
      <div className="from-background via-background to-forest-100/30 dark:to-forest-900/30 absolute inset-0 bg-gradient-to-b" />

      {/* Mountain silhouette */}
      <div className="absolute right-0 bottom-0 left-0 h-48 opacity-[0.04]">
        <svg viewBox="0 0 1440 320" className="h-full w-full" preserveAspectRatio="none">
          <path
            fill="currentColor"
            d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,197.3C840,192,960,160,1080,165.3C1200,171,1320,213,1380,234.7L1440,256L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
          />
        </svg>
      </div>

      {/* Floating decorative elements */}
      <div
        className="text-primary/5 animate-float absolute top-16 left-8"
        style={{ animationDelay: '0s' }}
      >
        <Trees className="h-20 w-20" />
      </div>
      <div
        className="text-primary/5 animate-float absolute right-12 bottom-24"
        style={{ animationDelay: '1.5s' }}
      >
        <Mountain className="h-16 w-16" />
      </div>

      {/* Main content */}
      <div className="animate-fade-in relative z-10 w-full max-w-md px-4">
        <div className="card-lodge p-8 sm:p-10">
          {/* Logo */}
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <div className="from-primary/10 via-accent/10 to-primary/10 absolute -inset-3 rounded-2xl bg-gradient-to-r blur-xl" />
              <BrandedLogo size="large" className="relative" />
            </div>
          </div>

          {/* Title */}
          <div className="mb-8 text-center">
            <h1 className="font-display text-foreground mb-2 text-2xl font-bold sm:text-3xl">
              {getCampName()}
            </h1>
            <p className="text-muted-foreground">{getPageDescription()}</p>
          </div>

          {/* Auth content */}
          <div className="space-y-6">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800/50 dark:bg-red-900/20">
                <div className="flex gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
                  <div className="flex-1">
                    <h3 className="mb-1 font-semibold text-red-800 dark:text-red-200">
                      Authentication Error
                    </h3>
                    <p className="mb-4 text-sm text-red-700 dark:text-red-300">{error}</p>
                    <button
                      onClick={() => {
                        setError(null)
                        autoLoginAttemptedRef.current = false
                      }}
                      className="btn-primary text-sm"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
            ) : isLoading ? (
              <div className="py-4 text-center">
                <div className="relative inline-flex">
                  <div className="bg-primary/20 absolute inset-0 animate-pulse rounded-full blur-md" />
                  <Loader2 className="text-primary relative h-10 w-10 animate-spin" />
                </div>
                <p className="text-foreground mt-4 font-medium">
                  {providers.length === 1 && providers[0]
                    ? `Connecting to ${getProviderDisplayName(providers[0])}...`
                    : 'Preparing login...'}
                </p>
                <p className="text-muted-foreground mt-2 text-sm">
                  A popup window will appear shortly
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {providers.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-muted-foreground mb-2">
                      No authentication providers configured.
                    </p>
                    <p className="text-muted-foreground text-sm">Contact your administrator.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {providers.map((provider) => (
                      <button
                        key={provider.name}
                        onClick={() => handleProviderLogin(provider)}
                        className="bg-primary text-primary-foreground shadow-lodge-md hover:shadow-lodge-lg flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                      >
                        <LogIn className="h-5 w-5" />
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
        <p className="text-muted-foreground/70 mt-6 text-center text-sm">
          Use your staff credentials
        </p>
        <p className="text-muted-foreground/40 mt-3 text-center text-xs">
          City data by{' '}
          <a
            href="https://simplemaps.com/data/us-cities"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-muted-foreground/60 underline"
          >
            SimpleMaps
          </a>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
