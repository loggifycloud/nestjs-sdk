import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Monitor } from '@loggify/node';
import { Observable } from 'rxjs';
import { instrumentNestLogger } from './nest-logger';
import { nestHttpMethod, nestHttpRoute } from './route';

@Injectable()
export class LoggifyInterceptor implements NestInterceptor {
  constructor() {
    instrumentNestLogger();
  }
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    try {
      if (context.getType() === 'http') {
        const route = nestHttpRoute(context);
        const method = nestHttpMethod(context);
        Monitor.setHttpRoute(route);
        Monitor.setSpanName(`${method} ${route}`);
        Monitor.setSpanAttribute('http.route', route);
        Monitor.setSpanAttribute('nestjs.controller', context.getClass()?.name);
        Monitor.setSpanAttribute('nestjs.handler', context.getHandler()?.name);
      }
    } catch {
      /* never throw into host app */
    }
    return next.handle();
  }
}
