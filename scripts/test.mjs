#!/usr/bin/env node
// Runs the unit, contract and launcher tests with Node's test runner (TypeScript through tsx).
// Each test file runs in its own process, so tests that change HOME or the environment can't
// affect each other. Integration tests (real VS Code) run separately: npm run test:integration.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const only = process.argv.slice(2);
const files = (
  only.length ? only : fs.globSync('test/{unit,contract,launcher}/**/*.test.ts', { cwd: root })
).sort();
if (!files.length) {
  console.error('no test files found');
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-reporter=spec', '--test-timeout=60000', ...files],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
