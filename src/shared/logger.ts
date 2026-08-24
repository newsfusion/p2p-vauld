export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  t: string;
  level: LogLevel;
  module: string;
  msg: string;
}

const REDACTED_URL = "[redacted-url]";
const REDACTED_EMAIL = "[redacted-email]";
const REDACTED_FINANCIAL_VALUE = "[redacted-financial-value]";
const REDACTED_SECRET = "[redacted-secret]";
const REDACTED_CIRCULAR = "[redacted-circular]";
const REDACTED_DEPTH_LIMIT = "[redacted-depth-limit]";
const MAX_REDACTION_DEPTH = 5;

const SECRET_KEY_PATTERN = /(password|encrypted|secret|token|credential)/i;
const EMAIL_KEY_PATTERN = /(email|username|login)/i;
const URL_KEY_PATTERN = /(url|href|uri|origin|entryUrl)/i;
const FINANCIAL_KEY_PATTERN =
  /^(portfolioValue|platformValue|freeCash|netAnnualReturn(?:Pct)?)$/i;
const URL_PATTERN = /\b(?:https?:\/\/|chrome-extension:\/\/)[^\s]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

let productionOverride: boolean | null = null;

interface RedactionState {
  depth: number;
  seen: WeakSet<object>;
}

function isProductionBuild(): boolean {
  return productionOverride ?? import.meta.env.PROD === true;
}

function shouldEmit(level: LogLevel): boolean {
  if (!isProductionBuild()) return true;
  return level === "warn" || level === "error";
}

function redactInlineString(value: string): string {
  return value
    .replace(URL_PATTERN, REDACTED_URL)
    .replace(EMAIL_PATTERN, REDACTED_EMAIL);
}

function redactByKey(key: string | undefined, value: unknown): unknown {
  if (!key) return value;
  if (SECRET_KEY_PATTERN.test(key)) return REDACTED_SECRET;
  if (EMAIL_KEY_PATTERN.test(key)) return REDACTED_EMAIL;
  if (URL_KEY_PATTERN.test(key)) return REDACTED_URL;
  if (FINANCIAL_KEY_PATTERN.test(key)) return REDACTED_FINANCIAL_VALUE;
  return value;
}

function nextRedactionState(state: RedactionState): RedactionState {
  return {
    depth: state.depth + 1,
    seen: state.seen,
  };
}

function redactValue(
  value: unknown,
  key?: string,
  state: RedactionState = { depth: 0, seen: new WeakSet<object>() },
): unknown {
  const keyRedacted = redactByKey(key, value);
  if (keyRedacted !== value) return keyRedacted;

  if (typeof value === "string") {
    return redactInlineString(value);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (state.depth >= MAX_REDACTION_DEPTH) {
    return REDACTED_DEPTH_LIMIT;
  }

  if (state.seen.has(value)) {
    return REDACTED_CIRCULAR;
  }

  state.seen.add(value);
  if (Array.isArray(value)) {
    try {
      return value.map((entry) =>
        redactValue(entry, undefined, nextRedactionState(state)),
      );
    } finally {
      state.seen.delete(value);
    }
  }

  try {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey, nextRedactionState(state)),
      ]),
    );
  } finally {
    state.seen.delete(value);
  }
}

function emit(level: LogLevel, entry: LogEntry, context?: LogContext): void {
  if (!shouldEmit(level)) return;

  const emittedEntry = isProductionBuild()
    ? { ...entry, msg: redactInlineString(entry.msg) }
    : entry;
  const emittedContext = isProductionBuild()
    ? (redactValue(context ?? {}) as LogContext)
    : (context ?? {});
  const prefix = `[P2P] ${emittedEntry.module}: ${emittedEntry.msg}`;

  switch (level) {
    case "debug":
      console.debug(prefix, emittedEntry, emittedContext);
      return;
    case "info":
      console.info(prefix, emittedEntry, emittedContext);
      return;
    case "warn":
      console.warn(prefix, emittedEntry, emittedContext);
      return;
    case "error":
      console.error(prefix, emittedEntry, emittedContext);
      return;
  }
}

export function setLoggerProductionModeForTests(
  production: boolean | null,
): void {
  productionOverride = production;
}

export function createLogger(module: string) {
  function write(level: LogLevel, message: string, context?: LogContext): void {
    const entry: LogEntry = {
      t: new Date().toISOString(),
      level,
      module,
      msg: message,
    };
    emit(level, entry, context);
  }

  return {
    debug: (message: string, context?: LogContext) =>
      write("debug", message, context),
    info: (message: string, context?: LogContext) =>
      write("info", message, context),
    warn: (message: string, context?: LogContext) =>
      write("warn", message, context),
    error: (message: string, context?: LogContext) =>
      write("error", message, context),
  };
}
