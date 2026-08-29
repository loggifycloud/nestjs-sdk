import { ArgumentsHost, Catch, HttpException, Injectable, Optional } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { Monitor } from '@loggifycloud/node';

@Catch()
@Injectable()
export class LoggifyExceptionFilter extends BaseExceptionFilter {
  constructor(@Optional() adapterHost?: HttpAdapterHost) {
    super(adapterHost?.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    try {
      if (host.getType() === 'http') {
        const request = host.switchToHttp().getRequest<{
          method?: string;
          url?: string;
          route?: { path?: string };
          routerPath?: string;
        }>();
        const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
        if (statusCode >= 500) {
          Monitor.captureException(exception, {
            endpoint: request?.route?.path ?? request?.routerPath ?? request?.url,
            method: request?.method,
            statusCode,
          });
        }
      }
    } catch {
      /* never throw into host app */
    }
    super.catch(exception, host);
  }
}
