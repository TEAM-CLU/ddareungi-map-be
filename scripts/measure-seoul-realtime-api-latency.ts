import axios from 'axios';

type SampleResult = {
  ok: boolean;
  ms: number;
  error?: string;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildRealtimeUrl(apiKey: string, stationId: string): string {
  return `http://openapi.seoul.go.kr:8088/${apiKey}/json/bikeList/1/1/${stationId}`;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apiKey = process.env.SEOUL_OPEN_API_KEY;
  if (!apiKey) {
    throw new Error(
      'SEOUL_OPEN_API_KEY is missing. Set it in env before running this script.',
    );
  }

  const stationIdsRaw =
    process.env.SEOUL_REALTIME_SAMPLE_STATION_IDS ?? '01611,02914,04041';
  const stationIds = stationIdsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const samples = Number(process.env.SEOUL_REALTIME_SAMPLE_COUNT ?? 200);
  const requestTimeoutMs = Number(
    process.env.SEOUL_REALTIME_REQUEST_TIMEOUT_MS ?? 10_000,
  );
  const interRequestDelayMs = Number(
    process.env.SEOUL_REALTIME_INTER_REQUEST_DELAY_MS ?? 60,
  );

  const results: SampleResult[] = [];

  for (let i = 0; i < samples; i++) {
    const stationId = stationIds[i % stationIds.length];
    const url = buildRealtimeUrl(apiKey, stationId);
    const started = Date.now();
    try {
      await axios.get(url, { timeout: requestTimeoutMs });
      results.push({ ok: true, ms: Date.now() - started });
    } catch (e) {
      const ms = Date.now() - started;
      const error = e instanceof Error ? e.message : String(e);
      results.push({ ok: false, ms, error });
    }

    // avoid hammering OpenAPI
    await delay(interRequestDelayMs);
  }

  const ok = results.filter((r) => r.ok).map((r) => r.ms);
  const failed = results.filter((r) => !r.ok);
  ok.sort((a, b) => a - b);

  const p50 = percentile(ok, 50);
  const p90 = percentile(ok, 90);
  const p95 = percentile(ok, 95);
  const p99 = percentile(ok, 99);
  const avg = mean(ok);

  // Recommended lock TTL guidance:
  // - If you chunk by N stations, a conservative TTL for the whole chunk is:
  //   ceil(((p99 + interRequestDelayMs) * N) / 1000) + 2
  const chunkSize = Number(process.env.STATION_REALTIME_LOCK_BATCH_SIZE ?? 50);
  const recommendedLockTtlSeconds = Number.isFinite(p99)
    ? Math.ceil(((p99 + interRequestDelayMs) * chunkSize) / 1000) + 2
    : NaN;

  console.log(
    JSON.stringify(
      {
        input: {
          stationIds,
          samples,
          requestTimeoutMs,
          interRequestDelayMs,
          chunkSize,
        },
        summary: {
          okCount: ok.length,
          failCount: failed.length,
          avgMs: avg,
          p50Ms: p50,
          p90Ms: p90,
          p95Ms: p95,
          p99Ms: p99,
          recommendedLockTtlSeconds,
        },
        failures: failed.slice(0, 10),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
