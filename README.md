# @loggifycloud/nestjs

Documentation: [https://loggify.cloud/docs](https://loggify.cloud/docs)

NestJS wrapper around `@loggifycloud/node`. Incoming HTTP is still captured by the Node agent; this package adds a module, Nest route templates (`GET /orders/:id` instead of `/orders/42`), exception capture, and a `LoggerService`.

Call `Monitor.init` **before** `NestFactory.create` - or at least before requiring `pg`, `mysql`, `ioredis`, or `mongodb` - so datastore queries become child spans.

```ts
// instrument.ts
import { Monitor } from '@loggifycloud/nestjs';

Monitor.init({
  apiKey: process.env.LOGGIFY_KEY!,
  service: 'orders-api',
  environment: process.env.NODE_ENV ?? 'production',
});
```

```ts
// main.ts
import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { LoggifyModule } from '@loggifycloud/nestjs';

@Module({
  imports: [LoggifyModule.forRoot()],
})
export class AppModule {}
```

`LoggifyModule.forRoot(options)` also calls `Monitor.init` when options are passed. Prefer the `instrument.ts` pattern so clients imported by other modules are patched.

```ts
LoggifyModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    apiKey: config.getOrThrow('LOGGIFY_KEY'),
    service: 'orders-api',
    environment: config.get('NODE_ENV') ?? 'production',
  }),
});
```

After init, incoming requests become a server span. NestJS route metadata is applied by `LoggifyInterceptor`:

```text
GET /orders/:id
 ├── HTTP GET /pay     (HttpService / axios, W3C traceparent)
 ├── redis GET
 └── postgresql SELECT
```

Inbound `traceparent` continues the trace. `LoggifyModule` patches `axios` / `axios.create` when that package is installed (Nest `HttpService` included) so outbound calls inject the client span. `Monitor.extractTraceparent` / `injectTraceparent` are available for other transports.

No extra middleware is required. `pg`, `mysql` / `mysql2`, `ioredis` / `redis`, and `mongodb` are patched by `@loggifycloud/node` when the package is loaded. Unhandled HTTP 5xx exceptions are captured by `LoggifyExceptionFilter`.

## Logger

Keep using Nest's `Logger` and Pino. After `LoggifyModule.forRoot()`, `new Logger('OrdersService').log(...)` is captured automatically (Nest writes to `stdout`, not `console`, so this is patched separately). Pino is captured by `@loggifycloud/node` after `Monitor.init`.

### NestJS Logger

```ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  accept(orderId: string) {
    this.logger.log(`order accepted`);
    this.logger.warn('queue delayed');
  }
}
```

No `useLogger` required. To send Nest's own framework logs as structured Loggify logs instead of (or in addition to) stdout formatting, you can still replace the adapter:

```ts
import { LoggifyLogger } from '@loggifycloud/nestjs';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(LoggifyLogger));
```

### Pino / nestjs-pino

Init Loggify **before** `pino` / `nestjs-pino` is loaded (same `instrument.ts` first in `main.ts`). Existing pino calls stay as they are:

```ts
import pino from 'pino';

const log = pino();
log.info({ orderId: 'ord_123' }, 'order accepted');
```

```ts
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [LoggerModule.forRoot(), LoggifyModule.forRoot()],
})
export class AppModule {}
```

```ts
constructor(private readonly logger: Logger) {} // nestjs-pino
this.logger.log({ orderId: 'ord_123' }, 'order accepted');
```

Opt out with `captureLoggers: false`. Do not `app.useLogger(LoggifyLogger)` if you want Nest to keep using pino as its logger - Loggify already records pino lines.

## Logs

```ts
import { Monitor } from '@loggifycloud/nestjs';

Monitor.info('order accepted', { orderId: 'ord_123' });
Monitor.warn('queue delayed', { lagMs: 420 });
Monitor.error('payment failed', { provider: 'stripe' });
```
