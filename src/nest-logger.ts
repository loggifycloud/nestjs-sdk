import { Monitor, type LogLevel } from '@loggifycloud/node';

const PATCH = Symbol.for('loggify.nestjs.console-logger-patched');

const NEST_LEVELS: Record<string, LogLevel> = {
  log: 'INFO',
  error: 'ERROR',
  warn: 'WARN',
  debug: 'DEBUG',
  verbose: 'DEBUG',
  fatal: 'FATAL',
};

/** Capture `new Logger('OrdersService').log(...)` without replacing Nest's logger. */
export function instrumentNestLogger() {
  try {
    const { ConsoleLogger } = require('@nestjs/common') as {
      ConsoleLogger?: { prototype?: Record<string | symbol, unknown> };
    };
    const proto = ConsoleLogger?.prototype;
    if (!proto || proto[PATCH]) return;

    const original = proto.printMessages;
    if (typeof original !== 'function') return;

    proto.printMessages = function (
      this: unknown,
      messages: unknown[],
      context?: string,
      logLevel?: string,
      writeStreamType?: string,
    ) {
      (original as (...args: unknown[]) => unknown).call(
        this,
        messages,
        context,
        logLevel,
        writeStreamType,
      );
      forwardNestLog(messages, context, logLevel);
    };
    Object.defineProperty(proto, PATCH, { value: true });
  } catch {
    /* never throw into host app */
  }
}

function forwardNestLog(messages: unknown[], context?: string, logLevel?: string) {
  try {
    const level = NEST_LEVELS[logLevel ?? 'log'] ?? 'INFO';
    for (const message of messages ?? []) {
      const attributes: Record<string, unknown> = { source: 'nestjs' };
      if (context) attributes.context = context;
      if (isPlainObject(message)) {
        Object.assign(attributes, message);
        const text =
          typeof attributes.message === 'string' ? attributes.message : stringify(message);
        Monitor.log(level, text, attributes);
        continue;
      }
      Monitor.log(level, stringify(message), attributes);
    }
  } catch {
    /* never throw into host app */
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function stringify(message: unknown) {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}
