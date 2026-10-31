import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Some networks (corporate npm proxies) serve registry metadata whose tarball links point at
// a private mirror, and pnpm writes those links into the lockfile. CI and every contributor
// outside that network then can't install. Packages must resolve from the public registry.

const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');

describe('pnpm-lock.yaml', () => {
  it('has no tarball links to private mirrors', () => {
    const links = [...lockfile.matchAll(/tarball: (\S+?)[},]/g)].map((m) => m[1] ?? '');
    const private_ = links.filter((url) => !url.startsWith('https://registry.npmjs.org/'));
    expect(private_, 'strip them with: sed -i "" -E "s/, tarball: [^}]+//" pnpm-lock.yaml').toEqual(
      [],
    );
  });
});
