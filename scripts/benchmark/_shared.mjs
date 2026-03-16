import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const PORT = Number(process.env.BENCHMARK_PORT ?? 3000);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const NODE_CMD = process.platform === 'win32' ? 'node.exe' : 'node';
export const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
export const BENCHMARK_PROGRESS_INTERVAL_MS = Number(
  process.env.BENCHMARK_PROGRESS_INTERVAL_MS ?? 10000,
);
export const BENCHMARK_RELAY_SERVER_OUTPUT =
  process.env.BENCHMARK_RELAY_SERVER_OUTPUT !== 'false';

const DEFAULT_OUTPUT_DIR = 'benchmark-results';

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatTimestamp(date = new Date()) {
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(
      '',
    ) +
    '-' +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(
      '',
    )
  );
}

export function getBenchmarkTimestamp() {
  return process.env.BENCHMARK_TIMESTAMP ?? formatTimestamp();
}

export async function resolveOutputPaths(baseName) {
  const timestamp = getBenchmarkTimestamp();
  const outputDir = path.resolve(
    process.cwd(),
    process.env.BENCHMARK_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR,
  );

  await mkdir(outputDir, { recursive: true });

  return {
    timestamp,
    outputDir,
    outputJson: path.join(outputDir, `${baseName}-${timestamp}.json`),
    outputMd: path.join(outputDir, `${baseName}-${timestamp}.md`),
  };
}

export function createLogger(prefix) {
  function timestamp() {
    return new Date().toISOString();
  }

  return {
    log(message) {
      process.stdout.write(`${prefix} ${timestamp()} ${message}\n`);
    },
    logError(message) {
      process.stderr.write(`${prefix} ${timestamp()} ${message}\n`);
    },
  };
}
