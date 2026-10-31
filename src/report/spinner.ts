// A one-line spinner with rotating captions. Draws only on a TTY; elsewhere it prints
// nothing and just waits, so logs and pipes stay clean.

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

  const draw = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const line = `${FRAMES[frame % FRAMES.length]} ${captions[caption % captions.length]}… ${seconds}s`;
    const width = (stream.columns ?? 80) - 1;
    stream.write(`\r\x1b[K${line.slice(0, width)}`);
  };

  const restore = () => stream.write('\r\x1b[K\x1b[?25h');
  // Ctrl-C skips `finally`: give the cursor back before exiting.
  const onSigint = () => {
    restore();
    process.exit(130);
  };
  process.once('SIGINT', onSigint);
  stream.write('\x1b[?25l');
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
