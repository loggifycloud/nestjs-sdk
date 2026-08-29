import { Monitor } from '@loggify/node';

const MARKER = Symbol.for('loggify.nestjs.axios-patched');
const SPAN = Symbol.for('loggify.nestjs.axios-span');

/** Patches `axios` / `axios.create` when the package is installed. No-op otherwise. */
export function instrumentAxios() {
  let axios: {
    interceptors?: { request: { use: Function }; response: { use: Function } };
    create?: (config?: unknown) => unknown;
    [key: symbol]: unknown;
  };
  try {
    axios = require('axios');
  } catch {
    return;
  }
  if (!axios || axios[MARKER]) return;
  Object.defineProperty(axios, MARKER, { value: true });
  attach(axios);
  if (typeof axios.create !== 'function') return;
  const originalCreate = axios.create.bind(axios);
  axios.create = (config?: unknown) => {
    const instance = originalCreate(config) as Parameters<typeof attach>[0];
    attach(instance);
    return instance;
  };
}

function attach(instance: {
  interceptors?: { request: { use: Function }; response: { use: Function } };
  [key: symbol]: unknown;
}) {
  if (!instance?.interceptors || instance[MARKER]) return;
  Object.defineProperty(instance, MARKER, { value: true });
  instance.interceptors.request.use((config: Record<string | symbol, unknown>) => {
    try {
      const url = axiosUrl(config);
      if (Monitor.isCollectorUrl(url)) return config;
      const method = String(config.method ?? 'GET').toUpperCase();
      const path = requestPath(url);
      const span = Monitor.startSpan(`HTTP ${method} ${path}`, {
        kind: 'client',
        attributes: {
          'http.method': method,
          'http.url': url.slice(0, 512),
          'http.route': path,
        },
      });
      const header = Monitor.injectTraceparent({ traceId: span.traceId, spanId: span.spanId });
      const headers = (config.headers ?? {}) as {
        set?: (name: string, value: string) => void;
        traceparent?: string;
      };
      config.headers = headers;
      if (header) {
        if (typeof headers.set === 'function') headers.set('traceparent', header);
        else headers.traceparent = header;
      }
      config[SPAN] = span;
    } catch {
      /* never throw into host app */
    }
    return config;
  });
  instance.interceptors.response.use(
    (response: { config?: Record<symbol, unknown>; status?: number }) => {
      endAxiosSpan(response?.config, response?.status);
      return response;
    },
    (error: { config?: Record<symbol, unknown>; response?: { status?: number } }) => {
      endAxiosSpan(error?.config, error?.response?.status, true);
      throw error;
    },
  );
}

function endAxiosSpan(
  config: Record<symbol, unknown> | undefined,
  status?: number,
  failed = false,
) {
  const span = config?.[SPAN] as
    | { setAttribute(key: string, value: unknown): unknown; end(status?: string): void }
    | undefined;
  if (!span) return;
  try {
    if (status != null) span.setAttribute('http.status_code', status);
    span.end(failed || (status != null && status >= 500) ? 'error' : 'ok');
  } catch {
    span.end('error');
  }
}

function axiosUrl(config: Record<string, unknown>) {
  const url = String(config.url ?? '');
  const base = String(config.baseURL ?? '');
  if (!url) return base;
  try {
    return new URL(url, base || 'http://loggify.local').toString();
  } catch {
    return `${base}${url}`;
  }
}

function requestPath(rawUrl: string) {
  try {
    return new URL(rawUrl, 'http://loggify.local').pathname;
  } catch {
    return rawUrl.split('?')[0] || '/';
  }
}
