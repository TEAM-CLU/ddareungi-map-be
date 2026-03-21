import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import {
  BASE_URL,
  BENCHMARK_PROGRESS_INTERVAL_MS,
  BENCHMARK_RELAY_SERVER_OUTPUT,
  NODE_CMD,
  PNPM_CMD,
  PORT,
  createLogger,
  getBenchmarkAuthHeaders,
  resolveOutputPaths,
} from './_shared.mjs';

const BENCHMARK_MAP_ITERATIONS = Number(
  process.env.BENCHMARK_MAP_ITERATIONS ?? 10,
);
const BENCHMARK_LOCK_CONCURRENCY = Number(
  process.env.BENCHMARK_LOCK_CONCURRENCY ?? 10,
);

const MAP_COORDINATES = {
  latitude: 37.630032,
  longitude: 127.076508,
};

const MAP_RADII = [1000, 5000];

const MODE_ENVS = {
  map_legacy: {
    STATION_REALTIME_LOCK_ENABLED: 'false',
  },
  map_split_no_lock: {
    STATION_REALTIME_LOCK_ENABLED: 'false',
  },
  map_split_with_lock: {
    STATION_REALTIME_LOCK_ENABLED: 'true',
  },
};

const { log, logError } = createLogger('[benchmark:stations]');
const BENCHMARK_AUTH_HEADERS = getBenchmarkAuthHeaders();

let currentChild = null;
const childState = new WeakMap();

process.on('SIGINT', async () => {
  if (currentChild) {
    await stopServer(currentChild);
  }
  process.exit(130);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(command, args, options = {}) {
  const label = options.label ?? `${command} ${args.join(' ')}`;
  log(`running command: ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options.spawnOptions,
    });

    let output = '';
    const capture = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (output.length > 20000) {
        output = output.slice(-20000);
      }
      if (options.relayOutput === true) {
        process.stdout.write(text);
      }
    };

    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    child.on('exit', (code, signal) => {
      if (code === 0) {
        log(`command complete: ${label}`);
        resolve(undefined);
        return;
      }

      reject(
        new Error(
          `Command failed: ${label} code=${String(code)} signal=${String(signal)}\n${output}`,
        ),
      );
    });
  });
}

function relayServerOutput(modeName, source, chunk) {
  if (!BENCHMARK_RELAY_SERVER_OUTPUT) {
    return;
  }

  const text = chunk.toString();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    const formatted = `[benchmark:stations] ${new Date().toISOString()} [server:${modeName}:${source}] ${line}\n`;
    if (source === 'stderr') {
      process.stderr.write(formatted);
    } else {
      process.stdout.write(formatted);
    }
  }
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

function summarize(values) {
  if (values.length === 0) {
    return {
      avg: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
    };
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

function diffCounters(before, after) {
  const result = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    result[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return result;
}

async function requestJson(url, options = {}) {
  const label =
    typeof options.logLabel === 'string' && options.logLabel.length > 0
      ? options.logLabel
      : url;

  const fetchOptions = { ...options };
  delete fetchOptions.logLabel;

  const startedAt = Date.now();
  const interval = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    log(`request still running: label=${label} elapsedMs=${elapsedMs}`);
  }, BENCHMARK_PROGRESS_INTERVAL_MS);

  try {
    const response = await fetch(url, fetchOptions);
    const body = await response.text();
    const json = body ? JSON.parse(body) : null;

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} ${body}`,
      );
    }

    return json;
  } finally {
    clearInterval(interval);
  }
}

async function waitForServer(modeName, child) {
  log(`waiting for server health check: mode=${modeName} url=${BASE_URL}`);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server exited before becoming ready for mode=${modeName} code=${child.exitCode}`,
      );
    }

    try {
      const response = await fetch(`${BASE_URL}/internal/benchmark/snapshot`, {
        headers: BENCHMARK_AUTH_HEADERS,
      });
      if (response.ok) {
        log(`server is ready: mode=${modeName} attempt=${attempt + 1}`);
        return;
      }
    } catch {
      // keep polling
    }

    if ((attempt + 1) % 5 === 0) {
      log(
        `server health still pending: mode=${modeName} attempt=${attempt + 1}/120`,
      );
    }

    await sleep(1000);
  }

  throw new Error(`Server did not become ready in time for mode=${modeName}`);
}

async function startServer(modeName) {
  log(`starting server: mode=${modeName}`);
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'local',
    ENABLE_BENCHMARK_METRICS: 'true',
    BENCHMARK_RATE_LIMIT_LIMIT:
      process.env.BENCHMARK_RATE_LIMIT_LIMIT ?? '1000',
    BENCHMARK_RATE_LIMIT_TTL_SECONDS:
      process.env.BENCHMARK_RATE_LIMIT_TTL_SECONDS ?? '60',
    PORT: String(PORT),
    ...MODE_ENVS[modeName],
  };

  const child = spawn(NODE_CMD, ['dist/main'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const state = {
    modeName,
    stopping: false,
    forced: false,
    output,
  };
  childState.set(child, state);

  const captureOutput = (chunk) => {
    output += chunk.toString();
    if (output.length > 20000) {
      output = output.slice(-20000);
    }
    state.output = output;
  };

  child.stdout.on('data', captureOutput);
  child.stderr.on('data', captureOutput);
  child.stdout.on('data', (chunk) =>
    relayServerOutput(modeName, 'stdout', chunk),
  );
  child.stderr.on('data', (chunk) =>
    relayServerOutput(modeName, 'stderr', chunk),
  );
  child.on('exit', (code, signal) => {
    if (state.stopping) {
      const forcedSuffix = state.forced ? ' forced=true' : '';
      log(
        `server stopped: mode=${modeName} code=${String(code)} signal=${String(signal)}${forcedSuffix}`,
      );
      return;
    }

    logError(
      `server exited unexpectedly: mode=${modeName} code=${String(code)} signal=${String(signal)}`,
    );

    if (state.output.trim().length > 0) {
      logError(`recent server output:\n${state.output}`);
    }
  });

  currentChild = child;
  await waitForServer(modeName, child);
  return child;
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  const state = childState.get(child);
  if (state) {
    state.stopping = true;
  }

  let exited = false;
  const waitForExit = new Promise((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve(undefined);
    });
  });

  child.kill('SIGTERM');
  log('sent SIGTERM to benchmark server');
  await Promise.race([waitForExit, sleep(5000)]);

  if (!exited && child.exitCode === null) {
    if (state) {
      state.forced = true;
    }
    child.kill('SIGKILL');
    log('sent SIGKILL to benchmark server after SIGTERM timeout');
    await waitForExit;
  }

  if (currentChild === child) {
    currentChild = null;
  }
}

async function resetBenchmark(options = {}) {
  log(`resetting benchmark metrics: ${JSON.stringify(options)}`);
  return requestJson(`${BASE_URL}/internal/benchmark/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...BENCHMARK_AUTH_HEADERS,
    },
    body: JSON.stringify(options),
    logLabel: 'benchmark-reset',
  });
}

async function snapshotBenchmark() {
  const json = await requestJson(`${BASE_URL}/internal/benchmark/snapshot`, {
    headers: BENCHMARK_AUTH_HEADERS,
    logLabel: 'benchmark-snapshot',
  });
  return json.data;
}

async function runMapRequest(radius, includeBatchSync) {
  log(
    `running map request: radius=${radius} includeBatchSync=${includeBatchSync}`,
  );
  const start = performance.now();
  const mapResponse = await requestJson(
    `${BASE_URL}/internal/benchmark/scenarios/map-area/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...BENCHMARK_AUTH_HEADERS,
      },
      body: JSON.stringify({
        latitude: MAP_COORDINATES.latitude,
        longitude: MAP_COORDINATES.longitude,
        radius,
      }),
      logLabel: `map-query radius=${radius}`,
    },
  );
  const mapOnlyLatencyMs = performance.now() - start;
  const stationCount =
    typeof mapResponse.data?.stationCount === 'number'
      ? mapResponse.data.stationCount
      : 0;
  const stationNumbers = Array.isArray(mapResponse.data?.stationNumbers)
    ? mapResponse.data.stationNumbers
    : [];

  let endToEndLatencyMs = mapOnlyLatencyMs;
  if (includeBatchSync) {
    log(
      `running realtime batch sync scenario: radius=${radius} stationCount=${stationNumbers.length}`,
    );
    const endToEndStart = performance.now();
    await requestJson(
      `${BASE_URL}/internal/benchmark/scenarios/map-area/end-to-end`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...BENCHMARK_AUTH_HEADERS,
        },
        body: JSON.stringify({
          latitude: MAP_COORDINATES.latitude,
          longitude: MAP_COORDINATES.longitude,
          radius,
          syncStrategy: 'batch_parallel',
        }),
        logLabel: `map-end-to-end-batch radius=${radius}`,
      },
    );
    endToEndLatencyMs = performance.now() - endToEndStart;
  }

  return {
    stationCount,
    stationNumbers,
    mapOnlyLatencyMs,
    endToEndLatencyMs,
  };
}

async function runLegacyMapRequest(radius) {
  log(`running legacy map scenario: radius=${radius}`);

  const start = performance.now();
  const response = await requestJson(
    `${BASE_URL}/internal/benchmark/scenarios/map-area/end-to-end`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...BENCHMARK_AUTH_HEADERS,
      },
      body: JSON.stringify({
        latitude: MAP_COORDINATES.latitude,
        longitude: MAP_COORDINATES.longitude,
        radius,
        syncStrategy: 'inline',
      }),
      logLabel: `map-end-to-end-inline radius=${radius}`,
    },
  );
  const latency = performance.now() - start;

  return {
    stationCount:
      typeof response.data?.stationCount === 'number'
        ? response.data.stationCount
        : 0,
    stationNumbers: Array.isArray(response.data?.stationNumbers)
      ? response.data.stationNumbers
      : [],
    mapOnlyLatencyMs: latency,
    endToEndLatencyMs: latency,
  };
}

async function runMapSuite(modeName, includeBatchSync) {
  log(
    `starting map suite: mode=${modeName} includeBatchSync=${includeBatchSync}`,
  );
  const child = await startServer(modeName);

  try {
    const results = {};

    for (const radius of MAP_RADII) {
      log(`map suite radius start: mode=${modeName} radius=${radius}`);
      await resetBenchmark();
      const iterations = [];

      for (let index = 0; index < BENCHMARK_MAP_ITERATIONS; index += 1) {
        log(
          `map iteration start: mode=${modeName} radius=${radius} iteration=${index + 1}/${BENCHMARK_MAP_ITERATIONS}`,
        );
        const iteration = await (modeName === 'map_legacy'
          ? runLegacyMapRequest(radius)
          : runMapRequest(radius, includeBatchSync));
        iterations.push(iteration);
        log(
          `map iteration complete: mode=${modeName} radius=${radius} iteration=${index + 1}/${BENCHMARK_MAP_ITERATIONS} mapOnlyMs=${iteration.mapOnlyLatencyMs.toFixed(2)} endToEndMs=${iteration.endToEndLatencyMs.toFixed(2)} stationCount=${iteration.stationCount}`,
        );
      }

      const snapshot = await snapshotBenchmark();
      const mapLatencies = iterations.map((item) => item.mapOnlyLatencyMs);
      const endToEndLatencies = iterations.map(
        (item) => item.endToEndLatencyMs,
      );

      results[radius] = {
        iterations,
        mapOnlyStats: summarize(mapLatencies),
        endToEndStats: summarize(endToEndLatencies),
        avgStationCount:
          iterations.reduce((sum, item) => sum + item.stationCount, 0) /
          iterations.length,
        metrics: snapshot,
        avgExternalCallsPerRequest:
          snapshot.seoul_realtime_fetch_started_total / iterations.length,
      };
      log(
        `map suite radius complete: mode=${modeName} radius=${radius} avgEndToEndMs=${results[radius].endToEndStats.avg.toFixed(2)} avgExternalCallsPerRequest=${results[radius].avgExternalCallsPerRequest.toFixed(2)}`,
      );
    }

    return results;
  } finally {
    await stopServer(child);
  }
}

async function runLockIteration(radius) {
  return runMapRequest(radius, true);
}

async function runLockSuite(modeName) {
  log(`starting lock suite: mode=${modeName}`);
  const child = await startServer(modeName);

  try {
    const results = {};

    for (const radius of MAP_RADII) {
      log(`lock suite radius start: mode=${modeName} radius=${radius}`);
      await resetBenchmark();
      const iterations = await Promise.all(
        Array.from({ length: BENCHMARK_LOCK_CONCURRENCY }, () =>
          runLockIteration(radius),
        ),
      );
      const snapshot = await snapshotBenchmark();

      results[radius] = {
        iterations,
        mapOnlyStats: summarize(
          iterations.map((item) => item.mapOnlyLatencyMs),
        ),
        endToEndStats: summarize(
          iterations.map((item) => item.endToEndLatencyMs),
        ),
        metrics: snapshot,
      };
      log(
        `lock suite radius complete: mode=${modeName} radius=${radius} syncRequested=${snapshot.station_sync_requested_total} lockSkipped=${snapshot.station_lock_skipped_total} externalCalls=${snapshot.seoul_realtime_fetch_started_total}`,
      );
    }

    return results;
  } finally {
    await stopServer(child);
  }
}

function renderStatsRow(label, stats, extra = '') {
  return `| ${label} | ${stats.avg.toFixed(2)} | ${stats.min.toFixed(2)} | ${stats.max.toFixed(2)} | ${stats.p50.toFixed(2)} | ${stats.p95.toFixed(2)} | ${extra} |`;
}

function renderMapSummary(results) {
  const lines = ['# Benchmark Summary', '', '## 지도 조회 비교', ''];

  for (const [modeName, modeResults] of Object.entries(results)) {
    lines.push(`### ${modeName}`, '');
    lines.push('| 반경 | 평균(ms) | 최소 | 최대 | p50 | p95 | 외부 API/요청 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');

    for (const radius of MAP_RADII) {
      const result = modeResults[radius];
      lines.push(
        renderStatsRow(
          `${radius}m end-to-end`,
          result.endToEndStats,
          result.avgExternalCallsPerRequest.toFixed(2),
        ),
      );
      if (modeName !== 'map_legacy') {
        lines.push(
          renderStatsRow(
            `${radius}m map-only`,
            result.mapOnlyStats,
            result.avgExternalCallsPerRequest.toFixed(2),
          ),
        );
      }
    }

    lines.push('');
  }

  return lines;
}

function renderLockSummary(lockResults) {
  const lines = ['## Redis 락 비교', ''];

  for (const radius of MAP_RADII) {
    const withoutLock = lockResults.map_split_no_lock[radius].metrics;
    const withLock = lockResults.map_split_with_lock[radius].metrics;
    const reduction =
      withoutLock.seoul_realtime_fetch_started_total === 0
        ? 0
        : 1 -
          withLock.seoul_realtime_fetch_started_total /
            withoutLock.seoul_realtime_fetch_started_total;

    lines.push(`### ${radius}m`, '');
    lines.push(
      '| 모드 | sync 요청 | 락 획득 | 락 스킵 | 외부 API 호출 | 감소율 |',
    );
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    lines.push(
      `| without_lock | ${withoutLock.station_sync_requested_total} | ${withoutLock.station_lock_acquired_total} | ${withoutLock.station_lock_skipped_total} | ${withoutLock.seoul_realtime_fetch_started_total} | 0.00% |`,
    );
    lines.push(
      `| with_lock | ${withLock.station_sync_requested_total} | ${withLock.station_lock_acquired_total} | ${withLock.station_lock_skipped_total} | ${withLock.seoul_realtime_fetch_started_total} | ${(reduction * 100).toFixed(2)}% |`,
    );
    lines.push('');
  }

  return lines;
}

async function main() {
  const { outputJson, outputMd } =
    await resolveOutputPaths('stations-benchmark');
  log(
    `stations benchmark run started: outputJson=${outputJson} outputMd=${outputMd}`,
  );
  await runCommand(PNPM_CMD, ['run', 'build'], {
    label: 'stations benchmark prebuild',
  });

  const mapResults = {
    map_legacy: await runMapSuite('map_legacy', false),
    map_split_no_lock: await runMapSuite('map_split_no_lock', true),
    map_split_with_lock: await runMapSuite('map_split_with_lock', true),
  };

  const lockResults = {
    map_split_no_lock: await runLockSuite('map_split_no_lock'),
    map_split_with_lock: await runLockSuite('map_split_with_lock'),
  };

  const results = {
    generatedAt: new Date().toISOString(),
    mapResults,
    lockResults,
  };

  const markdown = [
    ...renderMapSummary(mapResults),
    ...renderLockSummary(lockResults),
  ].join('\n');

  await writeFile(outputJson, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await writeFile(outputMd, `${markdown}\n`, 'utf8');

  log(`stations benchmark results written: ${outputJson}`);
  log(`stations benchmark summary written: ${outputMd}`);
}

main().catch(async (error) => {
  logError(
    `stations benchmark failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  if (currentChild) {
    await stopServer(currentChild);
  }
  process.exit(1);
});
