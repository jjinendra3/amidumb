import pc from 'picocolors';

// A spinner with rotating captions: a blank line above it, the caption, and the elapsed
// time on the line below. Draws only on a TTY; elsewhere it prints nothing and just waits,
// so logs and pipes stay clean.

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface SpinnerOptions {
  captions: readonly string[];
  stream?: NodeJS.WriteStream;
  frameMs?: number;
  captionMs?: number;
  /** Picks the starting caption; defaults to random. */
  random?: () => number;
}

export async function withSpinner<T>(task: Promise<T>, opts: SpinnerOptions): Promise<T> {
  const stream = opts.stream ?? process.stderr;
  if (!stream.isTTY || opts.captions.length === 0) return task;

  const frameMs = opts.frameMs ?? 80;
  const captionMs = opts.captionMs ?? 2200;
  const captions = opts.captions;
  let caption = Math.floor((opts.random ?? Math.random)() * captions.length);
  let frame = 0;
  let elapsed = 0;
  const started = Date.now();

  // Each draw writes the caption line, steps down to the timer line, and steps back up.
  const draw = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const line = `${FRAMES[frame % FRAMES.length]} ${captions[caption % captions.length]}…`;
    const width = (stream.columns ?? 80) - 1;
    stream.write(
      `\r\x1b[K${line.slice(0, width)}\x1b[1B\r\x1b[K${pc.dim(`  ${seconds}s`)}\x1b[1A\r`,
    );
  };

  // Clears both lines and leaves the cursor on the blank line, so what's printed next
  // lands right where the spinner started.
  const restore = () => stream.write('\r\x1b[K\x1b[1B\r\x1b[K\x1b[2A\r\x1b[?25h');
  // Ctrl-C skips `finally`: give the cursor back before exiting.
  const onSigint = () => {
    restore();
    process.exit(130);
  };
  process.once('SIGINT', onSigint);
  // Hide the cursor, leave the blank line, and make room for the timer line.
  stream.write('\x1b[?25l\n\n\x1b[1A');
  draw();
  const timer = setInterval(() => {
    frame++;
    elapsed += frameMs;
    if (elapsed >= captionMs) {
      elapsed = 0;
      caption++;
    }
    draw();
  }, frameMs);

  try {
    return await task;
  } finally {
    clearInterval(timer);
    process.removeListener('SIGINT', onSigint);
    restore();
  }
}
