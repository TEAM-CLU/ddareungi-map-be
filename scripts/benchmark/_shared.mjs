import { existsSync, readFileSync } from 'node:fs';
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

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

function resolveEnvValue(key) {
  const directValue = process.env[key];
  if (directValue) {
    return directValue;
  }

  const nodeEnv = process.env.NODE_ENV ?? 'local';
  const envFilePaths = [
    path.resolve(process.cwd(), `.env.${nodeEnv}`),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envFilePath of envFilePaths) {
    const entries = readEnvFile(envFilePath);
    if (entries[key]) {
      return entries[key];
    }
  }

  return undefined;
}

export function getBenchmarkAuthHeaders() {
  const username = resolveEnvValue('SWAGGER_ADMIN_USERNAME');
  const password = resolveEnvValue('SWAGGER_ADMIN_PASSWORD');

  if (!username || !password) {
    return {};
  }

  const authorization = Buffer.from(`${username}:${password}`).toString(
    'base64',
  );

  return {
    Authorization: `Basic ${authorization}`,
  };
}
