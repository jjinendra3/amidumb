import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Bundling third-party code into dist means shipping its licenses ourselves. This reads
// esbuild's metafile to see exactly which packages ended up in the bundle, adds what those
// packages inline from their own dependencies, and writes every license to one file.

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;
const LEGAL_NOTES = /\.LEGAL\.txt$/;

interface PackageInfo {
  name: string;
  version: string;
  license: string;
  repository?: string;
  dir: string;
}

/** `node_modules/.pnpm/x@1/node_modules/@scope/name/dist/a.js` → `@scope/name`. */
export function packageOf(path: string): string | undefined {
  const parts = path.split('node_modules/');
  const rest = parts.at(-1);
  if (parts.length < 2 || !rest) return undefined;
  const segments = rest.split('/');
  return segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
}

function readPackage(dir: string): PackageInfo {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : 'see license text',
    repository: repo?.replace(/^git\+/, '').replace(/\.git$/, ''),
    dir,
  };
}

/** Finds a package's directory from a file inside it, or from the package that depends on it. */
function packageDir(name: string, from: string): string | undefined {
  try {
    const require = createRequire(join(from, 'package.json'));
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    // Packages whose `exports` hide package.json: walk up from their entry point.
    try {
      let dir = dirname(createRequire(join(from, 'package.json')).resolve(name));
      while (!existsSync(join(dir, 'package.json')) || readPackage(dir).name !== name) {
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
      }
      return dir;
    } catch {
      return undefined;
    }
  }
}

export function writeThirdPartyLicenses(root: string, distDir: string): string {
  const metafilePath = join(distDir, 'metafile-esm.json');
  const metafile = JSON.parse(readFileSync(metafilePath, 'utf8')) as {
    inputs: Record<string, unknown>;
  };
  rmSync(metafilePath);

  const found = new Map<string, PackageInfo>();
  const visit = (name: string, from: string, depth: number) => {
    if (found.has(name)) return;
    const dir = packageDir(name, from);
    if (!dir) return;
    const info = readPackage(dir);
    found.set(name, info);
    // Bundled packages may inline their own dependencies into their builds.
    if (depth === 0) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir, depth + 1);
    }
  };
  for (const input of Object.keys(metafile.inputs)) {
    const name = packageOf(input);
    if (name) visit(name, join(root, dirname(input)), 0);
  }

  const sections = [...found.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const files = readdirSync(p.dir).filter((f) => LICENSE_FILE.test(f));
      const legal = existsSync(join(p.dir, 'dist'))
        ? readdirSync(join(p.dir, 'dist'))
            .filter((f) => LEGAL_NOTES.test(f))
            .slice(0, 1)
        : [];
      const texts = [
        ...files.map((f) => readFileSync(join(p.dir, f), 'utf8').trim()),
        ...legal.map((f) => readFileSync(join(p.dir, 'dist', f), 'utf8').trim()),
      ];
      return [
        `== ${p.name} ${p.version} (${p.license}) ==`,
        ...(p.repository ? [`Source: ${p.repository}`] : []),
        '',
        texts.length
          ? texts.join('\n\n')
          : `No license file in the package; declared license: ${p.license}.`,
      ].join('\n');
    });

  const out = join(distDir, 'THIRD_PARTY_LICENSES.txt');
  writeFileSync(
    out,
    [
      'amidumb bundles the third-party packages below into dist/. Each is distributed',
      'unmodified under its own license, reproduced here. MPL-2.0 packages are available',
      'in source form at the linked repositories.',
      '',
      ...sections,
      '',
    ].join('\n\n'),
  );
  return out;
}
