import { defineConfig } from 'tsup';
import { writeThirdPartyLicenses } from './scripts/third-party-licenses';

// Runtime dependencies (package.json "dependencies") stay external. Everything else that's
// imported, like satori and zod, is bundled; satori lands in a lazy chunk that only the
// image step loads.
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  clean: true,
  metafile: true,
  banner: { js: '#!/usr/bin/env node' },
  onSuccess: async () => {
    writeThirdPartyLicenses(process.cwd(), 'dist');
  },
});
