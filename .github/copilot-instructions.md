# DDareungiMap Backend - AI Coding Assistant Instructions

## Project Overview

NestJS backend for Seoul's Ddareungi (bike-sharing) map application providing station info, real-time availability, route optimization with TTS navigation, and multi-provider OAuth authentication.

## Architecture Patterns

### Service Layer Architecture

**Critical Pattern**: Multi-layered service architecture with strict separation of concerns:

- **Main Service** (`{domain}.service.ts`): Lifecycle management only (`OnModuleInit`, orchestration)
- **Specialized Services** (in `services/` subdirectory): Single responsibility per service
  - Query services: Database operations and data retrieval
  - Sync services: Scheduled tasks and data synchronization
  - Realtime services: External API integration
  - Mapper services: Data transformation between DTOs and entities
  - Domain services: Business logic and domain operations

**Example from `stations/` module** (8 specialized services):

- `StationQueryService`: PostGIS spatial queries, GeoJSON responses
- `StationSyncService`: Weekly cron jobs (`@Cron('0 2 * * 0')`)
- `StationRealtimeService`: Seoul Open API integration
- `StationMapperService`: API response → DTO → Entity transformations

**Controller Pattern**: Inject specialized services directly, not through main service

```typescript
constructor(
  private readonly stationQueryService: StationQueryService,
  private readonly stationSyncService: StationSyncService,
  // NOT: private readonly stationsService: StationsService
) {}
```

### Domain Organization

```
src/{domain}/
├── {domain}.controller.ts    # Direct injection of specialized services
├── {domain}.module.ts         # All services registered as providers
├── services/                  # Multiple focused services (4-8 per domain)
├── entities/                  # TypeORM entities
├── dto/                       # API request/response with class-validator
├── interfaces/                # TypeScript interfaces
└── types/                     # Type aliases and unions
```

## Critical Conventions

### Error Handling & Response Format (MANDATORY)

**Non-negotiable policy** using NestJS global exception filter pattern:

```typescript
// Services throw NestJS built-in HttpException
async someService() {
  if (notFound) throw new NotFoundException('Resource not found');
  if (invalid) throw new BadRequestException('Invalid input');
  if (unauthorized) throw new ForbiddenException('Access denied');
}

// Controllers: NO try-catch needed - just call services
async someController() {
  const result = await this.service.method(); // HttpException auto-propagates
  return SuccessResponseDto.create('Success message', result);
}

// Global filter (in main.ts) catches all HttpExceptions
// Converts to standardized ErrorResponseDto.create(statusCode, message)
```

**Key Benefits**:

- Controllers stay clean without repetitive try-catch blocks
- Error response format centralized in `HttpExceptionFilter`
- Services throw descriptive `HttpException` types (NestJS built-in)
- Global filter registered in `main.ts` handles all error responses

### Environment Configuration

**Key difference from standard NestJS**: Environment-specific files with custom scripts

```bash
# Development (uses .env.local)
pnpm run start:local

# Production (uses .env.production)
pnpm run start:production
```

`ConfigModule.forRoot()` in `app.module.ts`:

```typescript
envFilePath: [`.env.${process.env.NODE_ENV || 'local'}`, '.env'];
```

**Required environment variables** (see `ENVIRONMENT_GUIDE.md`):

- Database: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (for navigation sessions & TTS cache)
- OAuth: `{GOOGLE|KAKAO|NAVER}_CLIENT_ID`, `_CLIENT_SECRET`, `_CALLBACK_URL`
- External APIs: `SEOUL_API_KEY`, `GRAPHHOPPER_URL`
- TTS: `GOOGLE_APPLICATION_CREDENTIALS`, `AWS_*`, `TTS_S3_BUCKET`
- Security: `ENCRYPTION_KEY` (32-byte hex for AES-256-GCM, see `CryptoService`)

### Database & Caching Patterns

**PostgreSQL with PostGIS**:

- TypeORM with `autoLoadEntities: true`, `synchronize: true` (dev only)
- Raw SQL for geospatial queries (see `StationQueryService.findNearbyStations()`)
- Repository pattern: `@InjectRepository(Entity)` then `this.repository.save()`

**Redis** (via `@liaoliaots/nestjs-redis`):

- Navigation sessions: `navigation:{sessionId}` with 1-hour TTL
- Route caching: `route:{routeId}` stored separately
- TTS caching: `tts:phrase:{hash}` → S3 URL (30-day TTL)
- Access via `this.redisService.getOrThrow()` (returns ioredis client)

**Example Redis pattern** (`NavigationSessionService`):

```typescript
const redis = this.redisService.getOrThrow();
await redis.setex(key, TTL, JSON.stringify(data));
const raw = await redis.get(key);
const data = JSON.parse(raw);
```

### Authentication & Guards

**Multi-provider OAuth** (Google, Kakao, Naver) + JWT:

- Strategies in `auth/strategies/{google,kakao,naver}.strategy.ts`
- Protected routes: `@UseGuards(JwtAuthGuard)` (from `user/guards/jwt-auth.guard.ts`)
- OAuth callback pattern: `@UseGuards(AuthGuard('google'))` for login endpoints

**Email verification with crypto** (`CryptoService`):

- AES-256-GCM encryption for security tokens
- Pattern: Send code → Verify → Return encrypted `securityToken` → Use for account lookup
- See `FEATURE_GUIDE_EMAIL_VERIFICATION.md` for flow

## External Integrations

**Seoul Open API** (`SeoulApiService`):

- Station list and real-time bike availability
- Weekly sync via `@Cron('0 2 * * 0')` in `StationSyncService`
- Response mapping: `parseStationResponse()` → `StationResponseDto` → `Station` entity

**GraphHopper** (`GraphHopperService`):

- Bike route optimization with profiles (`safe_bike`, `fast_bike`)
- Multi-point routing with waypoints
- Returns GeoJSON and turn-by-turn instructions

**Google Cloud TTS** (`TtsService`, `GoogleTtsProvider`):

- Auto-translates navigation instructions (EN → KO) via `TranslationService`
- Synthesizes to MP3, uploads to S3, caches URL in Redis
- Batch processing: `batchSynthesize()` for multiple instructions
- See `TTS_IMPLEMENTATION.md` for setup

**AWS S3** (TTS audio files):

- Public-readable bucket for audio playback
- Key format: `tts/{lang}/{hash}.mp3`

## Development Workflows

### Running & Building

```bash
# Local dev with hot-reload
pnpm run start:local         # NODE_ENV=local

# Production
pnpm run start:production    # NODE_ENV=production

# Database
docker-compose up -d         # PostgreSQL + PostGIS

# Code quality
pnpm run format              # Prettier
pnpm run lint                # ESLint with --fix

# Testing
pnpm run test                # Jest unit tests
pnpm run test:e2e            # E2E tests
pnpm run test:cov            # Coverage report
```

### Key Module Examples

**Stations Module** (`src/stations/`):

- 8 specialized services for complex domain
- PostGIS spatial queries for nearby stations
- Scheduled weekly sync from Seoul API
- GeoJSON responses for map rendering

**Navigation Module** (`src/navigation/`):

- Redis-based session management (1-hour TTL)
- TTS integration for turn-by-turn audio
- Reroute and return-to-route capabilities
- Depends on `RoutesModule` and `TtsModule`

**Routes Module** (`src/routes/`):

- GraphHopper integration with multiple profiles
- Route builder and optimizer services
- Converts GraphHopper response to app-specific DTOs

**TTS Module** (`src/tts/`):

- Translation → Synthesis → S3 upload → Redis cache
- Requires Google Cloud credentials and AWS credentials
- Returns `{ text, textKo, ttsUrl }` for each instruction

## Common Patterns

1. **Service Granularity**: 4-8 specialized services per complex domain (see `stations/`, `navigation/`)
2. **Constants**: Define at top of services: `const QUERY_CONSTANTS = { ... } as const`
3. **Logging**: `private readonly logger = new Logger(ServiceName.name)`
4. **DTO Validation**: `class-validator` decorators + `@ApiProperty` for Swagger
5. **Redis Keys**: Use prefixes: `navigation:`, `route:`, `tts:phrase:`
6. **Scheduled Tasks**: `@Cron()` from `@nestjs/schedule` (enabled in `app.module.ts`)

## Reference Files

- `src/app.module.ts`: Module structure, TypeORM + Redis config
- `src/stations/stations.module.ts`: Complex service organization example
- `src/common/api-response.dto.ts`: Mandatory response format
- `src/common/crypto.service.ts`: AES-256-GCM encryption pattern
- `ENVIRONMENT_GUIDE.md`: Environment setup, TTS/OAuth configuration
- `TTS_IMPLEMENTATION.md`: TTS workflow and caching strategy
- `FEATURE_GUIDE_EMAIL_VERIFICATION.md`: Email verification flow
