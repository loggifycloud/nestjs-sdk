'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { Controller, Get, HttpException, HttpStatus, Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { nestHttpRoute } = require('../dist/route');
const { LoggifyModule, Monitor } = require('../dist');

function decorateMethod(decorator, ctor, key) {
  const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, key);
  decorator(ctor.prototype, key, descriptor);
}

test('records NestJS route templates and 5xx exceptions', async (t) => {
  const posts = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return { status: 202 };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  class OrdersController {
    findOne() {
      return { id: '42' };
    }
  }
  decorateMethod(Get(':id'), OrdersController, 'findOne');
  Controller('orders')(OrdersController);

  class FailController {
    boom() {
      throw new Error('payment failed');
    }
  }
  decorateMethod(Get(), FailController, 'boom');
  Controller('fail')(FailController);

  class MissingController {
    missing() {
      throw new HttpException('gone', HttpStatus.NOT_FOUND);
    }
  }
  decorateMethod(Get(), MissingController, 'missing');
  Controller('missing')(MissingController);

  class AppModule {}
  Module({
    imports: [
      LoggifyModule.forRoot({
        apiKey: 'test-key',
        service: 'nest-service',
        environment: 'test',
        endpoint: 'http://collector.invalid',
        flushIntervalMs: 60_000,
        captureConsole: false,
      }),
    ],
    controllers: [OrdersController, FailController, MissingController],
  })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();

  await request(`${base}/orders/42`);
  await request(`${base}/fail`);
  await request(`${base}/missing`);
  await new Promise((resolve) => setImmediate(resolve));
  await Monitor.flush();

  const ingest = posts.filter((post) => String(post.url).endsWith('/v1/ingest'));
  const httpRequests = ingest.flatMap((post) => post.body.httpRequests ?? []);
  const spans = ingest
    .flatMap((post) => post.body.traces ?? [])
    .flatMap((trace) => trace.spans ?? []);
  const errors = ingest.flatMap((post) => post.body.errors ?? []);

  const order = httpRequests.find((event) => event.route === '/orders/:id');
  assert.ok(order, 'expected templated NestJS route');
  assert.equal(order.method, 'GET');
  assert.equal(order.statusCode, 200);

  const serverSpan = spans.find(
    (span) => span.kind === 'server' && span.name === 'GET /orders/:id',
  );
  assert.ok(serverSpan);
  assert.equal(serverSpan.attributes['http.route'], '/orders/:id');
  assert.equal(serverSpan.attributes['nestjs.controller'], 'OrdersController');
  assert.equal(serverSpan.attributes['nestjs.handler'], 'findOne');

  assert.equal(httpRequests.filter((event) => event.route === '/orders/42').length, 0);

  const fail = httpRequests.find((event) => event.route === '/fail');
  assert.ok(fail);
  assert.equal(fail.statusCode, 500);
  assert.ok(errors.some((error) => error.message === 'payment failed'));

  const missing = httpRequests.find((event) => event.route === '/missing');
  assert.ok(missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(errors.filter((error) => String(error.message).includes('gone')).length, 0);
});

test('continues W3C traces on inbound HTTP and axios', async (t) => {
  const posts = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return { status: 202 };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const captured = [];
  const downstream = http.createServer((req, res) => {
    captured.push(req.headers.traceparent);
    res.statusCode = 204;
    res.end();
  });
  await new Promise((resolve) => downstream.listen(0, '127.0.0.1', resolve));
  t.after(() => downstream.close());
  const echo = `http://127.0.0.1:${downstream.address().port}/pay`;

  class ProxyController {
    async proxy() {
      const axios = require('axios');
      await axios.get(echo);
      return { ok: true };
    }
  }
  decorateMethod(Get(), ProxyController, 'proxy');
  Controller('proxy')(ProxyController);

  class AppModule {}
  Module({
    imports: [
      LoggifyModule.forRoot({
        apiKey: 'test-key',
        service: 'nest-service',
        environment: 'test',
        endpoint: 'http://collector.invalid',
        flushIntervalMs: 60_000,
        captureConsole: false,
      }),
    ],
    controllers: [ProxyController],
  })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();

  const parentTraceId = 'cccccccccccccccccccccccccccccccc';
  const parentSpanId = 'dddddddddddddddd';
  await request(`${base}/proxy`, {
    traceparent: `00-${parentTraceId}-${parentSpanId}-01`,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await Monitor.flush();

  const ingest = posts.filter((post) => String(post.url).endsWith('/v1/ingest'));
  const spans = ingest
    .flatMap((post) => post.body.traces ?? [])
    .flatMap((trace) => (trace.spans ?? []).map((span) => ({ ...span, traceId: trace.traceId })));
  const serverSpan = spans.find((span) => span.kind === 'server' && span.name === 'GET /proxy');
  const clientSpan = spans.find((span) => span.kind === 'client');
  assert.ok(serverSpan, 'missing Nest server span');
  assert.ok(clientSpan, 'missing axios client span');
  assert.equal(serverSpan.traceId, parentTraceId);
  assert.equal(serverSpan.parentSpanId, parentSpanId);
  assert.equal(clientSpan.traceId, parentTraceId);
  assert.equal(captured.length, 1);
  assert.equal(captured[0], `00-${clientSpan.traceId}-${clientSpan.spanId}-01`);
});

test('joins controller and handler path metadata', () => {
  class UsersController {
    findOne() {}
  }
  const context = {
    getClass: () => UsersController,
    getHandler: () => UsersController.prototype.findOne,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/users/9' }),
    }),
  };
  decorateMethod(Get(':id'), UsersController, 'findOne');
  Controller('users')(UsersController);
  assert.equal(nestHttpRoute(context), '/users/:id');
});

test('captures Nest Logger without replacing it', async (t) => {
  const posts = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return { status: 202 };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const { LoggifyModule } = require('../dist');
  LoggifyModule.forRoot({
    apiKey: 'test-key',
    service: 'nest-service',
    environment: 'test',
    endpoint: 'http://collector.invalid',
    flushIntervalMs: 60_000,
    captureConsole: false,
  });

  const { ConsoleLogger, Logger } = require('@nestjs/common');
  Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
  const logger = new ConsoleLogger('OrdersService');
  logger.log('order accepted');
  logger.warn('queue delayed');

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && posts.filter((post) => String(post.url).endsWith('/v1/logs')).length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const logs = posts
    .filter((post) => String(post.url).endsWith('/v1/logs'))
    .map((post) => post.body.logs[0]);
  assert.ok(
    logs.some(
      (log) =>
        log.level === 'INFO' &&
        log.message === 'order accepted' &&
        log.attributes.source === 'nestjs' &&
        log.attributes.context === 'OrdersService',
    ),
    JSON.stringify(logs),
  );
  assert.ok(
    logs.some(
      (log) =>
        log.level === 'WARN' &&
        log.message === 'queue delayed' &&
        log.attributes.context === 'OrdersService',
    ),
    JSON.stringify(logs),
  );
});

function request(url, headers) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        res.resume();
        res.once('end', resolve);
      })
      .once('error', reject);
  });
}
