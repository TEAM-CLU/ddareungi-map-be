import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { StationQueryService } from '../src/stations/services/station-query.service';

type BenchConfig = {
  latitude: number;
  longitude: number;
  radius: number;
  warmup: number;
  iterations: number;
  outputDir: string;
};

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx];
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = n === 0 ? 0 : values.reduce((s, v) => s + v, 0) / n;
  const variance =
    n === 0 ? 0 : values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
  const stdev = Math.sqrt(variance);
  return {
    n,
    meanMs: mean,
    stdevMs: stdev,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function parseArgs(): Partial<BenchConfig> {
  const args = process.argv.slice(2);
  const out: Partial<BenchConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if (!next) continue;

    if (a === '--lat') out.latitude = Number(next);
    if (a === '--lng') out.longitude = Number(next);
    if (a === '--radius') out.radius = Number(next);
    if (a === '--warmup') out.warmup = Number(next);
    if (a === '--iterations') out.iterations = Number(next);
    if (a === '--outDir') out.outputDir = next;
  }

  return out;
}

async function main() {
  const args = parseArgs();
  const config: BenchConfig = {
    latitude: args.latitude ?? 37.630032,
    longitude: args.longitude ?? 127.076508,
    radius: args.radius ?? 3000,
    warmup: args.warmup ?? 3,
    iterations: args.iterations ?? 20,
    outputDir: args.outputDir ?? 'benchmark-results',
  };

  const startedAt = new Date().toISOString();
  const outputPath = join(process.cwd(), config.outputDir);
  await mkdir(outputPath, { recursive: true });

  // 실시간 API 호출(Seoul OpenAPI) 선택: 키가 없으면 측정 불가
  if (!process.env.SEOUL_OPEN_API_KEY) {
    const result = {
      startedAt,
      ok: false,
      reason:
        'SEOUL_OPEN_API_KEY 환경변수가 없습니다. 실제 실시간 API 호출 벤치마크를 수행할 수 없습니다.',
      config,
    };
    const file = join(outputPath, `stations-map-area-bench-${Date.now()}.json`);
    await writeFile(file, JSON.stringify(result, null, 2), 'utf-8');

    console.error(result.reason);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const stationQuery = app.get(StationQueryService);

    // Preflight: 대여소 개수 확인 및 대략적인 소요 시간 안내
    const preflightStations = await stationQuery.findStationsInMapArea(
      config.latitude,
      config.longitude,
      config.radius,
    );
    const stationCount = preflightStations.length;
    const totalRealtimeRuns = config.warmup + config.iterations;
    const minPerRunMs = stationCount * 59; // delay만 고려한 하한(네트워크/DB 업데이트 제외)
    const roughPerRunMs = stationCount * 150; // 대략 추정(네트워크+DB 업데이트 포함, 보수적)
    const roughTotalMs = roughPerRunMs * totalRealtimeRuns;

    console.log(
      `[bench] config: lat=${config.latitude}, lng=${config.longitude}, radius=${config.radius}m, warmup=${config.warmup}, iterations=${config.iterations}`,
    );
    console.log(
      `[bench] preflight: stations=${stationCount} (withRealtimeSync는 순차 호출이므로 station 수에 비례해 오래 걸립니다)`,
    );
    console.log(
      `[bench] estimate per withRealtimeSync run: >=${Math.round(minPerRunMs)}ms (delay only), ~${Math.round(roughPerRunMs)}ms (rough)`,
    );
    console.log(
      `[bench] estimate total withRealtimeSync time: ~${Math.round(
        roughTotalMs / 1000,
      )}s (rough)`,
    );
    if (stationCount >= 200) {
      console.log(
        `[bench] warning: stationCount가 커서 매우 오래 걸릴 수 있습니다. 빠른 비교가 필요하면 --iterations 3 또는 radius를 줄여주세요.`,
      );
    }

    // 워밍업
    for (let i = 0; i < config.warmup; i++) {
      console.log(`[bench] warmup ${i + 1}/${config.warmup} (dbOnly)`);
      await stationQuery.findStationsInMapArea(
        config.latitude,
        config.longitude,
        config.radius,
      );
      console.log(
        `[bench] warmup ${i + 1}/${config.warmup} (withRealtimeSync)`,
      );
      await stationQuery.findStationsInMapAreaWithRealtimeSync(
        config.latitude,
        config.longitude,
        config.radius,
      );
    }

    // 측정
    const dbOnlyMs: number[] = [];
    const withRealtimeMs: number[] = [];
    let stationsCountDbOnly: number | null = null;
    let stationsCountWithRealtime: number | null = null;

    for (let i = 0; i < config.iterations; i++) {
      console.log(`[bench] iteration ${i + 1}/${config.iterations} (dbOnly)`);
      const t0 = nowMs();
      const a = await stationQuery.findStationsInMapArea(
        config.latitude,
        config.longitude,
        config.radius,
      );
      const t1 = nowMs();
      dbOnlyMs.push(t1 - t0);
      stationsCountDbOnly = stationsCountDbOnly ?? a.length;

      console.log(
        `[bench] iteration ${i + 1}/${config.iterations} (withRealtimeSync)`,
      );
      const t2 = nowMs();
      const b = await stationQuery.findStationsInMapAreaWithRealtimeSync(
        config.latitude,
        config.longitude,
        config.radius,
      );
      const t3 = nowMs();
      withRealtimeMs.push(t3 - t2);
      stationsCountWithRealtime = stationsCountWithRealtime ?? b.length;
    }

    const result = {
      startedAt,
      ok: true,
      node: process.version,
      config,
      stationsCount: {
        dbOnly: stationsCountDbOnly,
        withRealtimeSync: stationsCountWithRealtime,
      },
      timingsMs: {
        dbOnly: stats(dbOnlyMs),
        withRealtimeSync: stats(withRealtimeMs),
      },
      rawSamplesMs: {
        dbOnly: dbOnlyMs,
        withRealtimeSync: withRealtimeMs,
      },
    };

    const file = join(outputPath, `stations-map-area-bench-${Date.now()}.json`);
    await writeFile(file, JSON.stringify(result, null, 2), 'utf-8');

    console.log(`Wrote benchmark result: ${file}`);

    console.log(JSON.stringify(result.timingsMs, null, 2));
  } finally {
    await app.close();
  }
}

void main();
