import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./noxAiPlayground.js', import.meta.url));

test('offline standalone NOX lab simulates context without WhatsApp or API credentials', () => {
  const result = spawnSync(process.execPath, [entry, '--self-test'], {
    encoding: 'utf8', timeout: 15000, env: {
      ...process.env, NOX_AI_ENABLED: 'false', NOX_AI_API_KEY: '', NOX_AI_MODEL: '',
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /5 cenários passaram/);
  assert.match(result.stdout, /Nenhuma chamada real de IA, WhatsApp ou Railway/);
  assert.match(result.stdout, /Miya/);
});

test('real mode refuses missing secrets before any model or WhatsApp connection', () => {
  const result = spawnSync(process.execPath, [entry, '--live'], {
    encoding: 'utf8', timeout: 15000, env: {
      ...process.env, NOX_AI_ENABLED: 'false', NOX_AI_PROVIDER: 'groq',
      NOX_AI_API_KEY: '', NOX_AI_MODEL: '',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NOX_AI_PROVIDER.*NOX_AI_MODEL.*NOX_AI_API_KEY/s);
  assert.doesNotMatch(result.stdout, /Modo IA real:/);
});
