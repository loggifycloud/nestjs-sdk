import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Monitor, MonitorOptions } from '@loggify/node';
import { LoggifyExceptionFilter } from './filter';
import { LoggifyInterceptor } from './interceptor';
import { LoggifyLogger } from './logger';
import { instrumentAxios } from './axios';
import { instrumentNestLogger } from './nest-logger';

export const LOGGIFY_OPTIONS = 'LOGGIFY_OPTIONS';

export interface LoggifyModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: any[];
  useFactory: (...args: any[]) => MonitorOptions | Promise<MonitorOptions>;
}

@Module({})
export class LoggifyModule {
  static forRoot(options?: MonitorOptions): DynamicModule {
    if (options) Monitor.init(options);
    instrumentNestLogger();
    instrumentAxios();
    return {
      module: LoggifyModule,
      global: true,
      providers: instrumentationProviders(),
      exports: [LoggifyLogger],
    };
  }

  static forRootAsync(options: LoggifyModuleAsyncOptions): DynamicModule {
    instrumentNestLogger();
    instrumentAxios();
    const optionsProvider: Provider = {
      provide: LOGGIFY_OPTIONS,
      inject: options.inject ?? [],
      useFactory: async (...args: any[]) => {
        const resolved = await options.useFactory(...args);
        Monitor.init(resolved);
        return resolved;
      },
    };
    return {
      module: LoggifyModule,
      global: true,
      imports: options.imports ?? [],
      providers: [optionsProvider, ...instrumentationProviders()],
      exports: [LoggifyLogger],
    };
  }
}

function instrumentationProviders(): Provider[] {
  return [
    LoggifyLogger,
    { provide: APP_INTERCEPTOR, useClass: LoggifyInterceptor },
    { provide: APP_FILTER, useClass: LoggifyExceptionFilter },
  ];
}
