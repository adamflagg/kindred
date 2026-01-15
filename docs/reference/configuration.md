# Configuration Reference

Complete reference for all configuration options in Kindred.

## Table of Contents
- [Environment Variables (.env)](#environment-variables-env)
- [Python Configuration (camp_config.py)](#python-configuration-camp_configpy)
- [AI Configuration (config/ai_config.json)](#ai-configuration)
- [Solver Configuration (Database)](#solver-configuration-database)
- [Docker Configuration](#docker-configuration)
- [Frontend Configuration](#frontend-configuration)

## Environment Variables (.env)

The `.env` file contains sensitive configuration and API keys. Copy `.env.example` to `.env` and configure.

### CampMinder API Configuration
```bash
# Required: CampMinder API credentials
CAMPMINDER_API_KEY=your-api-key-here
CAMPMINDER_CLIENT_ID=your-client-id
CAMPMINDER_SEASON_ID=current-season-id  # e.g., 159193 for 2025

# Optional: Override default endpoints
CAMPMINDER_API_BASE_URL=https://api.campminder.com
CAMPMINDER_API_TIMEOUT=30
```

### PocketBase Configuration
```bash
# Admin credentials (auto-created if not exists)
POCKETBASE_ADMIN_EMAIL=admin@camp.local
POCKETBASE_ADMIN_PASSWORD=secure-password-here

# Service configuration
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_PORT=8090

# Optional: External access
POCKETBASE_EXTERNAL_URL=https://bunking.camp.org
```

### AI Provider Configuration
```bash
# Provider selection: openai, anthropic, ollama
AI_PROVIDER=openai

# OpenAI Configuration
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini  # or gpt-4o, gpt-4-turbo
OPENAI_MAX_TOKENS=500
OPENAI_TEMPERATURE=0.0

# Anthropic Configuration  
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-haiku-20240307
ANTHROPIC_MAX_TOKENS=500

# Ollama Configuration (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### Authentication Configuration
```bash
# Auth mode: production, bypass (dev only)
AUTH_MODE=production

# Admin group for authorization
ADMIN_GROUP=camp-admins

# Session configuration
SESSION_SECRET=random-secret-key-here
SESSION_TIMEOUT=86400  # 24 hours in seconds

# CORS configuration
CORS_ALLOWED_ORIGINS=http://localhost:5173,https://bunking.camp.org
```

### OAuth2/OIDC Configuration
```bash
# OAuth2 provider settings
OIDC_CLIENT_ID=your-oauth-client-id
OIDC_CLIENT_SECRET=your-oauth-secret
OIDC_AUTH_URL=https://auth.provider.com/application/o/authorize/
OIDC_TOKEN_URL=https://auth.provider.com/application/o/token/
OIDC_USER_URL=https://auth.provider.com/application/o/userinfo/

# Optional: Custom scopes
OIDC_SCOPES=openid,profile,email
```

### Network & Proxy Configuration
```bash
# Traefik configuration (production)
TRAEFIK_DOMAIN=bunking.camp.org
TRAEFIK_CERT_EMAIL=admin@camp.org

# Development proxy
VITE_PROXY_TARGET=http://127.0.0.1:8080

# Docker deployment
PROXY_NETWORK=web-proxy
APPDATA_DIR=/path/to/appdata

# IPv4 enforcement (critical!)
# Always use 127.0.0.1, not localhost, for inter-service communication
```

### Logging & Monitoring
```bash
# Log levels: DEBUG, INFO, WARNING, ERROR
LOG_LEVEL=INFO
LOG_FILE=/var/log/bunking/app.log
LOG_MAX_SIZE=100M
LOG_MAX_AGE=30  # days

# OpenTelemetry (optional)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=camp-bunking
```

## Python Configuration (camp_config.py)

Main Python configuration in `bunking/config/camp_config.py`.

### Cabin Structure Configuration
```python
@dataclass
class CabinStructureConfig:
    max_campers_per_cabin: int = 10
    min_campers_per_cabin: int = 6
    
    # Cabin naming patterns
    cabin_prefix: str = "Cabin"
    use_alphabetic_names: bool = False
    
    # Special cabins to exclude
    excluded_cabins: List[str] = field(default_factory=lambda: [
        "Overflow", "Waitlist", "Staff"
    ])
```

### Session Rules Configuration
```python
@dataclass
class SessionRulesConfig:
    # Session categorization
    junior_sessions: List[int] = field(default_factory=lambda: [1, 2])
    senior_sessions: List[int] = field(default_factory=lambda: [3, 4])
    
    # Age/grade boundaries
    min_age: int = 7
    max_age: int = 17
    min_grade: int = 2
    max_grade: int = 11
    
    # Special handling
    family_camp_session_names: List[str] = field(default_factory=lambda: [
        "Family Camp", "Alumni Weekend"
    ])
```

### Solver Configuration
```python
@dataclass
class SolverConfig:
    # Time limits (seconds)
    max_solving_time: int = 30
    initial_solution_limit: int = 5
    
    # Optimization weights (0-100)
    friend_request_weight: int = 80
    age_balance_weight: int = 60
    grade_balance_weight: int = 50
    returning_camper_weight: int = 40
    
    # Constraint penalties
    hard_constraint_penalty: int = 1000
    soft_constraint_penalty: int = 10
    
    # Solver behavior
    use_parallel_solving: bool = True
    num_solver_workers: int = 4
```

### API Configuration
```python
@dataclass
class APIConfig:
    # Rate limiting
    requests_per_second: float = 2.0
    max_retries: int = 3
    retry_delay: float = 1.0
    
    # Pagination
    default_page_size: int = 100
    max_page_size: int = 500
    
    # Caching
    cache_ttl: int = 3600  # 1 hour
    use_request_cache: bool = True
```

## AI Configuration

Configuration for AI-powered bunk request processing in `config/ai_config.json`.

### Provider Configuration
```json
{
  "providers": {
    "openai": {
      "enabled": true,
      "api_key_env": "OPENAI_API_KEY",
      "models": {
        "primary": "gpt-4o-mini",
        "fallback": "gpt-3.5-turbo"
      },
      "parameters": {
        "temperature": 0.0,
        "max_tokens": 500,
        "response_format": {"type": "json_object"}
      }
    },
    "anthropic": {
      "enabled": false,
      "api_key_env": "ANTHROPIC_API_KEY",
      "models": {
        "primary": "claude-3-haiku-20240307"
      }
    }
  }
}
```

### Processing Configuration
```json
{
  "processing": {
    "batch_size": 50,
    "parallel_requests": 5,
    "timeout_seconds": 30,
    "retry_on_error": true,
    "max_retries": 3
  }
}
```

### Confidence Thresholds
```json
{
  "confidence": {
    "high_confidence_threshold": 0.9,
    "medium_confidence_threshold": 0.7,
    "low_confidence_threshold": 0.5,
    "require_human_review_below": 0.5
  }
}
```

### Spread Validation
```json
{
  "spread_validation": {
    "enabled": true,
    "max_grade_difference": 2,
    "max_age_difference_months": 24,
    "convert_to_spread_limited": true,
    "warn_on_conversion": true
  }
}
```

### Request Type Priorities
```json
{
  "request_priorities": {
    "must_bunk_with": 100,
    "must_not_bunk_with": 95,
    "prefer_bunk_with": 50,
    "prefer_not_bunk_with": 45,
    "spread_limited": 30
  }
}
```

## Solver Configuration (Database)

Solver configuration stored in PocketBase `admin_configs` collection.

### Priority Configuration
```javascript
{
  "key": "priority",
  "value": {
    "age_preference": {
      "enabled": true,
      "weight": 0.7,
      "description": "Prioritize age-appropriate placements"
    },
    "returning_camper": {
      "enabled": true,
      "weight": 0.5,
      "boost": 10
    },
    "sibling_placement": {
      "enabled": true,
      "weight": 0.8,
      "same_cabin_preference": false
    }
  }
}
```

### Constraint Configuration
```javascript
{
  "key": "constraints",
  "value": {
    "grade_spread": {
      "max_difference": 2,
      "strict": false
    },
    "age_spread": {
      "max_months": 24,
      "strict": false
    },
    "cabin_capacity": {
      "min_fill_ratio": 0.6,
      "max_fill_ratio": 1.0
    }
  }
}
```

### Optimization Weights
```javascript
{
  "key": "optimization",
  "value": {
    "objectives": {
      "maximize_fulfilled_requests": 0.4,
      "balance_cabin_sizes": 0.2,
      "minimize_age_variance": 0.2,
      "group_friends": 0.2
    },
    "penalties": {
      "unfulfilled_must_request": 1000,
      "unfulfilled_prefer_request": 10,
      "violated_must_not": 5000
    }
  }
}
```

## Docker Configuration

### Development (docker-compose.dev.yml)
```yaml
services:
  pocketbase:
    build: ./pocketbase
    ports:
      - "8090:8090"
    volumes:
      - ./pocketbase/pb_data:/pb_data
      - ./pocketbase/pb_migrations:/pb_migrations
    environment:
      - ENV=development
    
  frontend:
    build: ./bunking-frontend
    ports:
      - "5173:5173"
    environment:
      - VITE_API_URL=http://pocketbase:8090
    
  solver:
    build: ./solver
    environment:
      - POCKETBASE_URL=http://pocketbase:8090
```

### Production (docker-compose.yml)
```yaml
services:
  bunking:
    image: ghcr.io/adamflagg/kindred:latest
    restart: unless-stopped
    networks:
      - web-proxy
    volumes:
      - ${APPDATA_DIR}/bunking:/pb_data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:8080/health"]
      interval: 15s
      timeout: 10s
      retries: 5
      start_period: 45s
    labels:
      traefik.enable: true
      traefik.http.routers.bunking.rule: Host(`bunking.yourdomain.com`)
      traefik.http.services.bunking.loadbalancer.server.port: 8080
```

### Testing (docker-compose.test.yml)
```yaml
services:
  test-runner:
    build:
      context: .
      target: test
    environment:
      - CI=true
      - SKIP_POCKETBASE_TESTS=true
    command: pytest --cov
```

## Frontend Configuration

### Vite Configuration (vite.config.ts)
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8090',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['@radix-ui', 'lucide-react']
        }
      }
    }
  }
})
```

### TypeScript Configuration (tsconfig.json)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## Configuration Precedence

1. **Environment variables** - Highest priority
2. **Configuration files** - JSON/YAML configs
3. **Database configuration** - Runtime adjustable
4. **Code defaults** - Fallback values

## Configuration Best Practices

1. **Never commit secrets** - Use `.env` for sensitive data
2. **Use environment-specific files** - `.env.development`, `.env.production`
3. **Validate configuration** - Check required values on startup
4. **Document changes** - Update this reference when adding options
5. **Use type safety** - TypeScript/Python type hints for configs
6. **Centralize configuration** - Avoid scattered config values
7. **Make configs discoverable** - Clear naming, good organization
8. **Version control configs** - Track non-sensitive configuration

## Troubleshooting Configuration

### Common Issues

**Missing environment variables**
```bash
# Check all required variables are set
./scripts/check_env.sh
```

**Invalid JSON configuration**
```bash
# Validate JSON syntax
python -m json.tool config/ai_config.json
```

**Database configuration not loading**
```python
# Check database configs
uv run python scripts/check_configs.py
```

**OAuth2 not working**
```bash
# Verify OAuth configuration
uv run python scripts/test_oauth.py
```

## Related Documentation

- [CLI Commands](./cli-commands.md) - Command-line tools
- [Docker Deployment](../guides/docker-deployment.md) - Production configuration
- [Troubleshooting](../guides/troubleshooting.md) - Common issues and solutions