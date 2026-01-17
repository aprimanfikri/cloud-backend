import { config } from "@/config/env";

const isDev = config.APP_ENV !== "production" || config.DEBUG_LOGS;

const logger = {
  log: (...args: Parameters<typeof console.log>): void => {
    if (isDev) console.log(...args);
  },
  info: (...args: Parameters<typeof console.info>): void => {
    if (isDev) console.info(...args);
  },
  error: (...args: Parameters<typeof console.error>): void => {
    console.error(...args);
  },
  warn: (...args: Parameters<typeof console.warn>): void => {
    if (isDev) console.warn(...args);
  },
  debug: (...args: Parameters<typeof console.debug>): void => {
    if (isDev) console.debug(...args);
  },
} as const;

export default logger;
