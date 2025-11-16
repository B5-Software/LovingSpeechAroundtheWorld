const LEVELS = ['debug', 'info', 'warn', 'error'];

function formatLine(scope, level, message, extra) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${scope}] [${level.toUpperCase()}] ${message}`;
  if (!extra || extra.length === 0) {
    return base;
  }
  return `${base} ${extra.map((chunk) => (typeof chunk === 'string' ? chunk : JSON.stringify(chunk))).join(' ')}`;
}

export function createLogger(scope = 'app', options = {}) {
  const minLevelIndex = LEVELS.indexOf(options.level || 'info');
  const shouldLog = (level) => LEVELS.indexOf(level) >= minLevelIndex;

  const logger = {};
  LEVELS.forEach((level) => {
    logger[level] = (message, ...extra) => {
      if (!shouldLog(level)) return;
      const line = formatLine(scope, level, message, extra);
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    };
  });

  logger.child = (childScope) => createLogger(`${scope}:${childScope}`, options);

  return logger;
}

export const rootLogger = createLogger('loving-speech');
