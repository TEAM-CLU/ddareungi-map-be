# DDareungiMap Backend - AI Coding Assistant Instructions

## Project Overview

This is a NestJS-based backend for a Seoul bike-sharing (Ddareungi) map application that provides station information, real-time availability, and route optimization.

## Architecture Patterns

### Service Layer Architecture

The codebase uses a multi-layered service architecture within each domain:

- **Main Service**: Lifecycle management only (e.g., `StationsService` handles `OnModuleInit`)
- **Specialized Services**: Each handles a specific responsibility
  - `StationQueryService`: Database queries and GeoJSON responses
  - `StationRealtimeService`: External API integration for live data
  - `StationSyncService`: Scheduled data synchronization
  - `StationMapperService`: Data transformation between external APIs and DTOs

### Domain Organization

Each domain follows this structure:

```
src/{domain}/
├── {domain}.controller.ts
├── {domain}.module.ts
├── services/           # Multiple focused services
├── entities/          # TypeORM entities
├── dto/              # API request/response objects
├── interfaces/       # TypeScript type definitions
└── types/           # Type aliases and unions
```

## Key Conventions

### Response Standardization

All API responses use standardized DTOs from `src/common/api-response.dto.ts`:

- `SuccessResponseDto.create(message, data)` for successful responses
- `ErrorResponseDto.create(statusCode, message)` for errors

### Environment Configuration

- Uses environment-specific files: `.env.local`, `.env.production`, `.env`
- Scripts: `pnpm run start:local` and `pnpm run start:production`
- ConfigService injection pattern for accessing environment variables

### Database Patterns

- PostgreSQL with PostGIS for geospatial queries
- TypeORM with `autoLoadEntities: true` and `synchronize: true` (dev only)
- Raw SQL for complex geospatial queries in services like `StationQueryService`
- Repository pattern with `@InjectRepository(Entity)`

### Authentication & Social Login

- JWT-based auth with multiple OAuth strategies (Google, Kakao, Naver)
- Strategy pattern in `auth/strategies/` directory
- Guards using `@UseGuards(JwtAuthGuard)` for protected endpoints

## External Integrations

### Key External Services

- **Seoul Open API**: Real-time bike station data (`SeoulApiService`)
- **GraphHopper**: Route optimization (`GraphHopperService`)
- **NodeMailer**: Email services (`MailService`)

### API Response Handling

- GeoJSON format for spatial data responses
- Real-time data fetching and caching patterns
- Scheduled sync jobs using `@nestjs/schedule`

## Development Workflows

### Running the Application

```bash
# Local development with hot reload
pnpm run start:local

# Production mode
pnpm run start:production

# Docker PostgreSQL database
docker-compose up -d
```

### Testing

```bash
pnpm run test        # Unit tests
pnpm run test:e2e    # End-to-end tests
pnpm run test:cov    # Coverage report
```

### Code Quality

- ESLint configuration in `eslint.config.mjs`
- Prettier formatting: `pnpm run format`
- Uses `class-validator` and `class-transformer` for DTO validation

## Common Patterns to Follow

1. **Service Injection**: Inject specialized services directly into controllers rather than going through main services
2. **DTO Validation**: Always use `class-validator` decorators on DTOs with `@ApiProperty` for Swagger
3. **Error Handling**: Use the standardized `HttpExceptionFilter` from `src/common/`
4. **Logging**: Use NestJS Logger with service name: `private readonly logger = new Logger(ServiceName.name)`
5. **Constants**: Define query constants at the top of services: `const QUERY_CONSTANTS = { ... } as const`

## Key Files to Reference

- `src/app.module.ts`: Main module configuration and database setup
- `src/stations/stations.module.ts`: Example of complex service organization
- `src/common/api-response.dto.ts`: Standard response patterns
- `ENVIRONMENT_GUIDE.md`: Environment configuration details
- `docker-compose.yml`: Local database setup
