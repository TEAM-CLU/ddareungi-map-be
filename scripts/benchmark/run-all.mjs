import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  NODE_CMD,
  createLogger,
  resolveOutputPaths,
} from './_shared.mjs';

const { log, logError } = createLogger('[benchmark:all]');

async function runScript(scriptPath, label, env) {
  log(`starting ${label}: script=${scriptPath}`);

  return new Promise((resolve, reject) => {
    const child = spawn(NODE_CMD, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        log(`completed ${label}`);
        resolve(undefined);
        return;
      }

      reject(
        new Error(
          `${label} failed: code=${String(code)} signal=${String(signal)}`,
        ),
      );
    });
  });
}

async function main() {
  const { timestamp, outputDir, outputJson, outputMd } =
    await resolveOutputPaths('benchmark-all');

  log(
    `benchmark-all run started: outputJson=${outputJson} outputMd=${outputMd}`,
  );

  const env = {
    BENCHMARK_TIMESTAMP: timestamp,
  };

  await runScript('scripts/benchmark/run-stations.mjs', 'stations benchmark', env);
  await runScript('scripts/benchmark/run-tts.mjs', 'tts benchmark', env);

  const results = {
    generatedAt: new Date().toISOString(),
    timestamp,
    stationsResultPath: path.join(
      outputDir,
      `stations-benchmark-${timestamp}.json`,
    ),
    stationsSummaryPath: path.join(
      outputDir,
      `stations-benchmark-${timestamp}.md`,
    ),
    ttsResultPath: path.join(outputDir, `tts-benchmark-${timestamp}.json`),
    ttsSummaryPath: path.join(outputDir, `tts-benchmark-${timestamp}.md`),
  };

  const markdown = [
    '# Combined Benchmark Index',
    '',
    `generatedAt: ${results.generatedAt}`,
    `timestamp: ${results.timestamp}`,
    '',
    `stationsResultPath: ${results.stationsResultPath}`,
    `stationsSummaryPath: ${results.stationsSummaryPath}`,
    `ttsResultPath: ${results.ttsResultPath}`,
    `ttsSummaryPath: ${results.ttsSummaryPath}`,
    '',
  ].join('\n');

  await writeFile(outputJson, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await writeFile(outputMd, `${markdown}\n`, 'utf8');

  log(`benchmark-all results written: ${outputJson}`);
  log(`benchmark-all summary written: ${outputMd}`);
}

main().catch((error) => {
  logError(
    `benchmark-all failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
  process.exit(1);
});
