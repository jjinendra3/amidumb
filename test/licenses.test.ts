import { describe, expect, it } from 'vitest';
import { packageOf } from '../scripts/third-party-licenses';

describe('packageOf', () => {
  it.each([
    ['node_modules/.pnpm/satori@0.63.2/node_modules/satori/dist/index.js', 'satori'],
    ['node_modules/.pnpm/x@1/node_modules/@shuding/opentype.js/dist/a.mjs', '@shuding/opentype.js'],
    ['node_modules/zod/v4/classic/index.js', 'zod'],
    ['src/cli.ts', undefined],
  ])('%s → %s', (path, name) => expect(packageOf(path)).toBe(name));
});
