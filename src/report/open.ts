import { spawn } from 'node:child_process';

/** Opens a file with the OS default app. Best effort: a missing opener is not an error. */
export function openFile(path: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [path]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', path]]
        : ['xdg-open', [path]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}
