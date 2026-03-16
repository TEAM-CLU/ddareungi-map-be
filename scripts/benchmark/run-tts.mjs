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
  resolveOutputPaths,
} from './_shared.mjs';

const ROUTE_REQUESTS = [
  {
    name: 'R1',
    description: 'Nowon Station -> Seoul National University of Science and Technology',
    payload: {
      start: { lat: 37.655349, lng: 127.060187 },
      end: { lat: 37.631668, lng: 127.077481 },
    },
  },
  {
    name: 'R2',
    description: 'Nowon Station -> Seoul Women\'s University',
    payload: {
      start: { lat: 37.655349, lng: 127.060187 },
      end: { lat: 37.628114, lng: 127.090549 },
    },
  },
  {
    name: 'R3',
    description: 'Nowon Station -> Sahmyook University',
    payload: {
      start: { lat: 37.655349, lng: 127.060187 },
      end: { lat: 37.642561, lng: 127.105918 },
    },
  },
];

const MODE_ENVS = {
  tts_fulltext_supabase: {
    STATION_REALTIME_LOCK_ENABLED: 'true',
    TTS_SYNTHESIS_MODE: 'fulltext',
  },
  tts_chunked_supabase: {
    STATION_REALTIME_LOCK_ENABLED: 'true',
    TTS_SYNTHESIS_MODE: 'chunked',
  },
};

let currentChild = null;
const childState = new WeakMap();
const { log, logError } = createLogger('[benchmark:tts]');

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

    const formatted = `[benchmark:tts] ${new Date().toISOString()} [server:${modeName}:${source}] ${line}\n`;
    if (source === 'stderr') {
      process.stderr.write(formatted);
    } else {
      process.stdout.write(formatted);
    }
  }
}

function diffCounters(before, after) {
  const result = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    result[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return result;
}

function sumInstructionTextLength(instructions) {
  return instructions.reduce(
    (sum, instruction) => sum + String(instruction?.text ?? '').length,
    0,
  );
}

function uniqueInstructionTextLength(instructions) {
  return Array.from(
    new Set(instructions.map((instruction) => String(instruction?.text ?? ''))),
  ).reduce((sum, text) => sum + text.length, 0);
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
      const response = await fetch(`${BASE_URL}/internal/benchmark/snapshot`);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
    logLabel: 'benchmark-reset',
  });
}

async function snapshotBenchmark() {
  const json = await requestJson(`${BASE_URL}/internal/benchmark/snapshot`, {
    logLabel: 'benchmark-snapshot',
  });
  return json.data;
}

async function createRouteAndNavigation(routeRequest) {
  const startTime = performance.now();
  const response = await requestJson(
    `${BASE_URL}/internal/benchmark/scenarios/navigation/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeRequest.payload),
      logLabel: `tts-navigation-start ${routeRequest.name}`,
    },
  );

  if (!response.data?.routeId || !response.data?.navigation) {
    throw new Error(
      `Failed to resolve routeId for TTS benchmark route=${routeRequest.name}`,
    );
  }

  return {
    routeId: response.data.routeId,
    navigation: response.data.navigation,
    latencyMs: performance.now() - startTime,
  };
}

async function runTtsPhase(modeName, phaseName) {
  log(`tts phase start: mode=${modeName} phase=${phaseName}`);
  const phaseBefore = await snapshotBenchmark();
  const routes = [];

  for (const routeRequest of ROUTE_REQUESTS) {
    log(
      `tts route start: mode=${modeName} phase=${phaseName} route=${routeRequest.name}`,
    );
    const before = await snapshotBenchmark();
    const execution = await createRouteAndNavigation(routeRequest);
    const after = await snapshotBenchmark();
    const instructions = Array.isArray(execution.navigation.instructions)
      ? execution.navigation.instructions
      : [];
    const metricsDelta = diffCounters(before, after);

    routes.push({
      name: routeRequest.name,
      description: routeRequest.description,
      routeId: execution.routeId,
      latencyMs: execution.latencyMs,
      instructionCount: instructions.length,
      instructionTextLength: sumInstructionTextLength(instructions),
      uniqueInstructionCount: new Set(
        instructions.map((instruction) => instruction.text),
      ).size,
      uniqueInstructionTextLength: uniqueInstructionTextLength(instructions),
      metricsDelta,
    });

    log(
      `tts route complete: mode=${modeName} phase=${phaseName} route=${routeRequest.name} latencyMs=${execution.latencyMs.toFixed(2)} instructionCount=${instructions.length} synthDelta=${metricsDelta.google_tts_synthesize_total ?? 0} synthChars=${metricsDelta.google_tts_synthesize_chars_total ?? 0} mergedCacheHit=${metricsDelta.tts_merged_cache_hit_total ?? 0}`,
    );
  }

  const phaseAfter = await snapshotBenchmark();
  const metrics = diffCounters(phaseBefore, phaseAfter);
  log(
    `tts phase complete: mode=${modeName} phase=${phaseName} totalLatencyMs=${sumPhaseLatency(routes).toFixed(2)} synthTotal=${metrics.google_tts_synthesize_total ?? 0} mergedCacheHit=${metrics.tts_merged_cache_hit_total ?? 0}`,
  );

  return {
    routes,
    metrics,
  };
}

async function runTtsSuite(modeName) {
  log(`starting tts-only suite: mode=${modeName}`);
  const child = await startServer(modeName);

  try {
    await resetBenchmark({
      clearCaches: true,
      clearRedisCaches: true,
      clearStorageCaches: true,
    });

    const cold = await runTtsPhase(modeName, 'cold');
    const warm = await runTtsPhase(modeName, 'warm');

    return {
      cold,
      warm,
      metrics: await snapshotBenchmark(),
    };
  } finally {
    await stopServer(child);
  }
}

function sumPhaseLatency(routes) {
  return routes.reduce((sum, route) => sum + route.latencyMs, 0);
}

function renderPhaseTable(modeName, phaseName, phaseResults) {
  const lines = [`## ${modeName} (${phaseName})`, ''];
  lines.push(
    '| 경로 | 설명 | latency(ms) | instruction 수 | instruction 글자수 | unique text 수 | unique 글자수 | Google TTS 호출 | Google TTS 글자수 | chunk synth | chunk 글자수 | chunk hit | merged cache hit | merged 생성 |',
  );
  lines.push(
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );

  for (const route of phaseResults.routes) {
    lines.push(
      `| ${route.name} | ${route.description} | ${route.latencyMs.toFixed(2)} | ${route.instructionCount} | ${route.instructionTextLength} | ${route.uniqueInstructionCount} | ${route.uniqueInstructionTextLength} | ${route.metricsDelta.google_tts_synthesize_total ?? 0} | ${route.metricsDelta.google_tts_synthesize_chars_total ?? 0} | ${route.metricsDelta.tts_chunk_synthesized_total ?? 0} | ${route.metricsDelta.tts_chunk_synthesized_chars_total ?? 0} | ${route.metricsDelta.tts_chunk_cache_hit_total ?? 0} | ${route.metricsDelta.tts_merged_cache_hit_total ?? 0} | ${route.metricsDelta.tts_merged_created_total ?? 0} |`,
    );
  }

  lines.push('');
  return lines;
}

function renderModeSummaryRows(modeName, modeResults) {
  return ['cold', 'warm'].map((phaseName) => {
    const phase = modeResults[phaseName];
    return `| ${modeName} | ${phaseName} | ${sumPhaseLatency(phase.routes).toFixed(2)} | ${phase.metrics.google_tts_synthesize_total ?? 0} | ${phase.metrics.google_tts_synthesize_chars_total ?? 0} | ${phase.metrics.tts_fulltext_synthesized_total ?? 0} | ${phase.metrics.tts_fulltext_synthesized_chars_total ?? 0} | ${phase.metrics.tts_chunk_synthesized_total ?? 0} | ${phase.metrics.tts_chunk_synthesized_chars_total ?? 0} | ${phase.metrics.tts_chunk_cache_hit_total ?? 0} | ${phase.metrics.tts_merged_cache_hit_total ?? 0} | ${phase.metrics.tts_merged_created_total ?? 0} |`;
  });
}

function renderSummary(fulltext, chunked) {
  const warmReduction =
    fulltext.warm.metrics.google_tts_synthesize_total === 0
      ? 0
      : 1 -
        chunked.warm.metrics.google_tts_synthesize_total /
          fulltext.warm.metrics.google_tts_synthesize_total;

  return [
    '# TTS Benchmark Summary',
    '',
    '| 모드 | phase | 총 route latency(ms) | 총 Google TTS 호출 | 총 Google TTS 글자수 | 총 fulltext 신규 합성 | 총 fulltext 글자수 | 총 chunk 신규 합성 | 총 chunk 글자수 | 총 chunk cache hit | 총 merged cache hit | 총 merged 생성 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...renderModeSummaryRows('tts_fulltext_supabase', fulltext),
    ...renderModeSummaryRows('tts_chunked_supabase', chunked),
    '',
    `Warm phase chunked Google TTS 호출 절감률: ${(warmReduction * 100).toFixed(2)}%`,
    '',
  ];
}

async function main() {
  const { outputJson, outputMd } = await resolveOutputPaths('tts-benchmark');
  log(
    `tts benchmark run started: outputJson=${outputJson} outputMd=${outputMd}`,
  );
  await runCommand(PNPM_CMD, ['run', 'build'], {
    label: 'tts benchmark prebuild',
  });

  const results = {
    generatedAt: new Date().toISOString(),
    routes: ROUTE_REQUESTS,
    ttsResults: {
      tts_fulltext_supabase: await runTtsSuite('tts_fulltext_supabase'),
      tts_chunked_supabase: await runTtsSuite('tts_chunked_supabase'),
    },
  };

  const markdown = [
    ...renderSummary(
      results.ttsResults.tts_fulltext_supabase,
      results.ttsResults.tts_chunked_supabase,
    ),
    ...renderPhaseTable(
      'tts_fulltext_supabase',
      'cold',
      results.ttsResults.tts_fulltext_supabase.cold,
    ),
    ...renderPhaseTable(
      'tts_fulltext_supabase',
      'warm',
      results.ttsResults.tts_fulltext_supabase.warm,
    ),
    ...renderPhaseTable(
      'tts_chunked_supabase',
      'cold',
      results.ttsResults.tts_chunked_supabase.cold,
    ),
    ...renderPhaseTable(
      'tts_chunked_supabase',
      'warm',
      results.ttsResults.tts_chunked_supabase.warm,
    ),
  ].join('\n');

  await writeFile(outputJson, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await writeFile(outputMd, `${markdown}\n`, 'utf8');

  log(`tts benchmark results written: ${outputJson}`);
  log(`tts benchmark summary written: ${outputMd}`);
}

main().catch(async (error) => {
  logError(
    `tts benchmark failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
  if (currentChild) {
    await stopServer(currentChild);
  }
  process.exit(1);
});
