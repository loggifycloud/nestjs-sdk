import { LoggerService } from '@nestjs/common';
import { Monitor } from '@loggify/node';

export class LoggifyLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]) {
    Monitor.info(stringify(message), attributes(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    const [trace, context] = optionalParams;
    const attrs: Record<string, unknown> = {};
    if (typeof context === 'string') attrs.context = context;
    else if (typeof trace === 'string' && optionalParams.length === 1) attrs.context = trace;
    if (typeof trace === 'string' && optionalParams.length > 1) attrs.stackTrace = trace;
    Monitor.error(stringify(message), attrs);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    Monitor.warn(stringify(message), attributes(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    Monitor.debug(stringify(message), attributes(optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    Monitor.debug(stringify(message), { ...attributes(optionalParams), severity: 'verbose' });
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    Monitor.fatal(stringify(message), attributes(optionalParams));
  }
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

function attributes(optionalParams: unknown[]): Record<string, unknown> | undefined {
  const context = optionalParams.find((value) => typeof value === 'string');
  return context ? { context } : undefined;
}
