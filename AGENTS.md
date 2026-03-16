# AGENTS.md

## Project Overview

This project is the **NestJS backend for the Seoul Ddareungi bike-sharing map service**.

Main features:

- Ddareungi station information
- Real-time bike availability
- GraphHopper-based route optimization
- Turn-by-turn navigation with TTS
- OAuth authentication (Google, Kakao, Naver)
- Email/password authentication
- Redis-based navigation session management
- Supabase PostgreSQL + PostGIS database

The project follows a **domain-oriented architecture**.

---

# Runtime & Deployment

Server architecture:

Nginx → NestJS Server (PM2 cluster mode)

Production runtime:

PM2 cluster

PM2 must remain the process manager.

AI agents **must NOT change the runtime architecture to Docker or other process managers**.

---

# Database

Database system:

Supabase PostgreSQL + PostGIS

ORM:

TypeORM

Configuration:

- autoLoadEntities: true
- synchronize: true

Notes:

- PostGIS queries may use **raw SQL instead of TypeORM QueryBuilder**
- Spatial queries are typically implemented in `StationQueryService`

---

# Redis

Redis location:

EC2 local Redis

Connection:

localhost

External access:

Blocked

Example configuration:

bind 127.0.0.1

Redis is used for the following purposes.

### Navigation Session

Key format:

navigation:{sessionId}

TTL: 1 hour

### Route Cache

route:{routeId}

### TTS Cache

tts:phrase:{hash}

TTL: 30 days

---

# GraphHopper

GraphHopper runs on an **EC2 local server**.

Route profiles:

- safe_bike
- fast_bike
- walk

These profiles are implemented using **GraphHopper custom models**.

---

# TTS Architecture

TTS provider:

Google Cloud TTS

Audio file storage:

Supabase Storage

Caching:

Redis cache

TTS workflow:

navigation instruction  
→ translation  
→ Google TTS synthesis  
→ audio file generation  
→ upload to Supabase Storage  
→ Redis cache

---

# Authentication

Supported authentication methods:

- Google OAuth
- Kakao OAuth
- Naver OAuth
- Email + Password

Token strategy:

JWT access token only

Refresh tokens are **not used**.

---

# API Response Format

All APIs must follow the standardized response format.

Success response:

SuccessResponseDto

Example:

{
success: true,
message: string,
data: object
}

Error response:

ErrorResponseDto

Controllers must always return this structure.

---

# Error Handling Rules

Exceptions must be thrown in **services**, not controllers.

Controllers **must not contain try-catch blocks**.

Example:

Service:

throw new NotFoundException('Station not found')

Controller:

const result = await service.method()  
return SuccessResponseDto.create(message, result)

Errors are handled by the **global exception filter**.

---

# Service Architecture

Each domain is split into multiple services.

Service types:

- Query Service
- Sync Service
- Realtime Service
- Mapper Service
- Domain Service

Example structure:

stations  
 └ services  
 ├ StationQueryService  
 ├ StationSyncService  
 ├ StationRealtimeService  
 └ StationMapperService

Controllers must **inject specialized services directly**.

Correct:

constructor(
private readonly stationQueryService: StationQueryService
) {}

Incorrect:

constructor(
private readonly stationsService: StationsService
) {}

---

# Naming Conventions

File and variable naming:

camelCase

DTO naming:

PascalCase + Dto

Example:

StationRealtimeSyncResultDto

Service naming:

PascalCase + Service

Example:

StationRealtimeLockService

Internal types:

PascalCase + Result / Data / Info

Example:

StationRealtimeSyncResult

Naming order:

Domain → Responsibility → Type

---

# DTO Rules

DTO classes must include:

- class-validator decorators
- @ApiProperty (for Swagger)

---

# Swagger

Swagger is enabled.

When creating new APIs, AI agents must include Swagger decorators.

Examples:

@ApiOperation  
@ApiResponse  
@ApiProperty

---

# Testing

Testing is **mandatory**.

Testing framework:

Jest

When creating new services or modifying logic, unit tests must be added.

---

# Prohibited Coding Practices

AI agents must **not generate the following patterns**.

### Business Logic in Controllers

Controllers must only orchestrate services.

Forbidden:

business logic inside controllers

---

### Repository Usage in Controllers

Forbidden:

Controller → Repository access

Repositories must only be used inside services.

---

### Console Logging

Forbidden:

console.log

Use NestJS Logger instead.

private readonly logger = new Logger(ServiceName.name)

---

# Redis Key Rules

Redis keys must use prefixes.

Prefixes:

navigation:  
route:  
tts:phrase:

Examples:

navigation:sessionId  
route:routeId  
tts:phrase:hash

---

# Scheduler

Scheduled jobs use:

@nestjs/schedule

Example:

@Cron()

Example schedule:

@Cron('0 2 \* \* 0')

---

# Project Structure

src  
 ├ auth  
 ├ stations  
 ├ navigation  
 ├ routes  
 ├ tts  
 ├ users  
 ├ common

Each domain follows this structure:

domain  
 ├ controller  
 ├ module  
 ├ services  
 ├ dto  
 ├ entities  
 ├ interfaces  
 └ types

---

# AI Agent Behavior Rules

When modifying code, AI agents must preserve the following rules.

1. No business logic in controllers
2. Repositories only used inside services
3. No console.log
4. Maintain SuccessResponseDto / ErrorResponseDto structure
5. Preserve multi-service architecture
6. Maintain Redis key prefix rules
7. Preserve DTO validation
8. Preserve Swagger decorators
9. Maintain PM2 cluster runtime

---

# Reference Documents

ENVIRONMENT_GUIDE.md  
TTS_IMPLEMENTATION.md  
FEATURE_GUIDE_EMAIL_VERIFICATION.md
