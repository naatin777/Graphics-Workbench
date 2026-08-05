import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGGREGATE_WEBVIEW_SCRIPTS = ['test:webview:coverage'];

const appsDirectory = path.join(repositoryRoot, 'webview', 'apps');
const expectedAppNames = readdirSync(appsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function packageJsonScripts() {
  return JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).scripts;
}

function workflowContent(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

void test('webview appごとにvitest設定とtest fileがある', () => {
  assert.ok(expectedAppNames.length >= 5, 'webview apps must exist');
  for (const appName of expectedAppNames) {
    const appRoot = path.join(appsDirectory, appName);
    assert.ok(
      readdirSync(appRoot).includes('vitest.config.ts'),
      `${appName} must define a vitest.config.ts`,
    );
    const testFiles = readdirSync(path.join(appRoot, 'src')).filter((name) => name.endsWith('.test.tsx'));
    assert.ok(testFiles.length > 0, `${appName} must have at least one webview test file`);
  }
});

void test('package.jsonのtest:webviewスクリプトがwebview app一覧と一致する', () => {
  const scripts = packageJsonScripts();
  const expectedPerAppScripts = expectedAppNames.map((appName) => `test:webview:${appName}`);

  for (const scriptName of expectedPerAppScripts) {
    assert.ok(scripts[scriptName], `${scriptName} must exist in package.json`);
  }

  for (const scriptName of Object.keys(scripts)) {
    if (scriptName.startsWith('test:webview:') && !AGGREGATE_WEBVIEW_SCRIPTS.includes(scriptName)) {
      assert.ok(
        expectedPerAppScripts.includes(scriptName),
        `${scriptName} does not match a webview app under webview/apps`,
      );
    }
  }
});

void test('test:webviewとtest:webview:coverageが全appを網羅する', () => {
  const scripts = packageJsonScripts();
  const coverageScript = scripts['test:webview:coverage'];
  const testScript = scripts['test:webview'];

  assert.ok(coverageScript, 'test:webview:coverage must exist');
  assert.ok(testScript, 'test:webview must exist');

  for (const appName of expectedAppNames) {
    assert.ok(coverageScript.includes(`test:webview:${appName}`), `coverage must include ${appName}`);
    assert.ok(testScript.includes(`test:webview:${appName}`), `test:webview must include ${appName}`);
  }
});

void test('CI workflowは手書きのapp一覧ではなくtest:webview:coverageを使う', () => {
  const testWorkflow = workflowContent(path.join('.github', 'workflows', 'test.yml'));
  const releaseWorkflow = workflowContent(path.join('.github', 'workflows', 'release.yml'));

  for (const workflow of [testWorkflow, releaseWorkflow]) {
    assert.ok(
      workflow.includes('npm run test:webview:coverage'),
      'webview CI must use the centralized test:webview:coverage script',
    );
    for (const appName of expectedAppNames) {
      assert.ok(
        !workflow.includes(`npm run test:webview:${appName}`),
        `workflow must not hand-write test:webview:${appName}; app additions belong in package.json`,
      );
    }
  }
});
