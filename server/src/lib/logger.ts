/**
 * Tiny structured logger. Enough for now — swap for pino later if needed.
 */
const ts = () => new Date().toISOString();
const fmt = (level: string, msg: string, meta?: unknown) => {
  const base = `${ts()} [${level}] ${msg}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
};

export const log = {
  info: (msg: string, meta?: unknown) => console.log(fmt('INFO', msg, meta)),
  warn: (msg: string, meta?: unknown) => console.warn(fmt('WARN', msg, meta)),
  error: (msg: string, meta?: unknown) => console.error(fmt('ERROR', msg, meta)),
  debug: (msg: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== 'production') console.log(fmt('DEBUG', msg, meta));
  },
};
