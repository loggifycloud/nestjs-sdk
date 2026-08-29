import { ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

export function nestHttpRoute(context: ExecutionContext): string {
  const fromMetadata = joinPaths(
    Reflect.getMetadata(PATH_METADATA, context.getClass()),
    Reflect.getMetadata(PATH_METADATA, context.getHandler()),
  );
  if (fromMetadata) return fromMetadata;

  const request = httpRequest(context);
  if (typeof request?.route?.path === 'string' && request.route.path) {
    return normalizeRoute(request.route.path);
  }
  if (typeof request?.routerPath === 'string' && request.routerPath) {
    return normalizeRoute(request.routerPath);
  }
  return requestPath(request?.url);
}

export function nestHttpMethod(context: ExecutionContext): string {
  const request = httpRequest(context);
  if (typeof request?.method === 'string' && request.method) {
    return request.method.toUpperCase();
  }
  const method = Reflect.getMetadata(METHOD_METADATA, context.getHandler());
  const names = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];
  if (typeof method === 'number' && names[method]) return names[method];
  if (typeof method === 'string' && method) return method.toUpperCase();
  return 'GET';
}

function httpRequest(context: ExecutionContext) {
  return context.switchToHttp().getRequest<{
    method?: string;
    url?: string;
    route?: { path?: string };
    routerPath?: string;
  }>();
}

function joinPaths(controller: unknown, handler: unknown): string {
  const prefix = firstPath(controller);
  const path = firstPath(handler);
  if (!prefix && !path) return '';
  return normalizeRoute(`${prefix}${path === '/' ? '' : path}`);
}

function firstPath(value: unknown): string {
  if (Array.isArray(value)) return firstPath(value[0]);
  if (value === undefined || value === null || value === '') return '';
  const text = String(value);
  if (text === '/') return '';
  return text.startsWith('/') ? text : `/${text}`;
}

function normalizeRoute(value: string) {
  const route = value.replace(/\/{2,}/g, '/') || '/';
  return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
}

function requestPath(rawUrl?: string) {
  const raw = rawUrl ?? '/';
  try {
    return new URL(raw, 'http://loggify.local').pathname;
  } catch {
    return raw.split('?')[0] || '/';
  }
}
