import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

process.env.BOT_TOKEN ||= '000000:test-token-for-unit-tests';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * `node --check` só valida sintaxe: um import de algo que o módulo não exporta
 * passa batido e só explode no boot, em produção. Este teste fecha essa brecha.
 */
test('todo import nomeado entre os módulos de src/ existe de verdade', async () => {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  const problems = [];

  for (const file of files) {
    const code = await readFile(join(SRC, file), 'utf8');

    // import { a, b as c } from './modulo.js'
    const importRe = /import\s*\{([^}]+)\}\s*from\s*'(\.\/[^']+)'/g;
    let match;

    while ((match = importRe.exec(code)) !== null) {
      const [, namesBlock, target] = match;
      const targetFile = target.replace('./', '');
      if (!files.includes(targetFile)) {
        problems.push(`${file}: importa de '${target}', que não existe`);
        continue;
      }

      const mod = await import(join(SRC, targetFile));
      const names = namesBlock
        .split(',')
        .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);

      for (const name of names) {
        if (!(name in mod)) {
          problems.push(`${file}: importa '${name}' de '${target}', que não exporta isso`);
        }
      }
    }
  }

  assert.deepEqual(problems, [], `Imports quebrados:\n${problems.join('\n')}`);
});

test('nenhum módulo tem import de arquivo inexistente', async () => {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  const problems = [];

  for (const file of files) {
    const code = await readFile(join(SRC, file), 'utf8');
    for (const match of code.matchAll(/from\s*'(\.\/[^']+)'/g)) {
      const targetFile = match[1].replace('./', '');
      if (!files.includes(targetFile)) problems.push(`${file} → ${match[1]}`);
    }
  }

  assert.deepEqual(problems, []);
});
