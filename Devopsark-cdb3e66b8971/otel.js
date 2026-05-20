'use strict';
// App → OTLP → otel-collector (cluster Service or otel.devopsark.com) → OpenSearch + /metrics
try { require('dotenv').config(); } catch (_) {}

const { context, metrics } = require('@opentelemetry/api');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');


function envTrim(key) {
  const v = process.env[key];
  if (v == null || v === '') return '';
  return String(v).trim().replace(/^["']|["']$/g, '');
}

function normalizeOtlpBase(url) {
  return String(url || '').replace(/\/$/, '').replace(/\/metrics$/, '');
}

function resolveOtlpEndpoint() {
  return normalizeOtlpBase(
    envTrim('OTEL_EXPORTER_OTLP_ENDPOINT') ||
      envTrim('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT') ||
      envTrim('DEVOPSARK_OTEL_COLLECTOR_OTLP_URL') ||
      (envTrim('KUBERNETES_SERVICE_HOST')
        ? envTrim('DEVOPSARK_OTEL_COLLECTOR_OTLP_URL_CLUSTER')
        : envTrim('DEVOPSARK_OTEL_COLLECTOR_OTLP_URL_PUBLIC')) ||
      envTrim('DEVOPSARK_OTEL_COLLECTOR_OTLP_URL_PUBLIC') ||
      envTrim('DEVOPSARK_OTEL_COLLECTOR_OTLP_URL_CLUSTER')
  );
}

function resolveCollectorMetricsUrl() {
  const raw =
    envTrim('OTEL_COLLECTOR_METRICS_URL') ||
    envTrim('PROMETHEUS_METRICS_ENDPOINT') ||
    envTrim('PROMETHEUS_ENDPOINT') ||
    envTrim('DEVOPSARK_OTEL_COLLECTOR_METRICS_URL') ||
    (envTrim('KUBERNETES_SERVICE_HOST')
      ? envTrim('DEVOPSARK_OTEL_COLLECTOR_METRICS_URL_CLUSTER')
      : envTrim('DEVOPSARK_OTEL_COLLECTOR_METRICS_URL_PUBLIC')) ||
    envTrim('DEVOPSARK_OTEL_COLLECTOR_METRICS_URL_PUBLIC') ||
    envTrim('DEVOPSARK_OTEL_COLLECTOR_METRICS_URL_CLUSTER');
  return String(raw).replace(/\/$/, '');
}


const endpoint = resolveOtlpEndpoint();
const collectorMetricsUrl = resolveCollectorMetricsUrl();
const otlpMetricsBase = normalizeOtlpBase(
  process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || endpoint
);

const serviceName = process.env.OTEL_SERVICE_NAME || "arkrn:project:a8bf51db-3da1-4059-947a-688fd96469ae:observabilityIntegration:8dea9a5c-bd1e-4086-99fb-cdb3e66b8971";

function parseIntegrationId(name) {
  const fromEnv = process.env.OTEL_INTEGRATION_ID;
  if (fromEnv) return fromEnv;
  const m = String(name).match(/observabilityIntegration:([0-9a-f-]+)/i);
  return m ? m[1] : undefined;
}

const integrationId = parseIntegrationId(serviceName);

const resource = new Resource({
  [ATTR_SERVICE_NAME]: serviceName,
  'service.namespace': 'devopsark',
  'service.instance.id': String(process.pid),
  ...(integrationId && {
    integration_id: integrationId,
    'devopsark.integration_id': integrationId
  })
});

let loggerProvider = null;
let spanProcessor = null;
let otelReady = false;
let otelReadyResolve;
let otelReadyReject;
const otelReadyPromise = new Promise((resolve, reject) => {
  otelReadyResolve = resolve;
  otelReadyReject = reject;
});

let httpCounter;
let errorCounter;
let durationHistogram;
let transferBytesCounter;

const otlpExportOpts = { timeoutMillis: 10000 };
const EXPORT_BATCH_DELAY_MS = Math.max(
  200,
  Number(process.env.OTEL_EXPORT_BATCH_DELAY_MS || process.env.OTEL_BSP_SCHEDULE_DELAY || 300)
);
const EXPORT_BATCH_SIZE = Math.min(Number(process.env.OTEL_EXPORT_BATCH_SIZE || 64), 256);

const traceExporter = new OTLPTraceExporter({
  url: endpoint + '/v1/traces',
  ...otlpExportOpts
});
const logExporter = new OTLPLogExporter({
  url: endpoint + '/v1/logs',
  ...otlpExportOpts
});
const metricExporter = new OTLPMetricExporter({
  url: otlpMetricsBase + '/v1/metrics',
  ...otlpExportOpts
});

spanProcessor = new BatchSpanProcessor(traceExporter, {
  scheduledDelayMillis: EXPORT_BATCH_DELAY_MS,
  maxExportBatchSize: EXPORT_BATCH_SIZE,
  maxQueueSize: 2048,
  exportTimeoutMillis: 10000
});

const meterProvider = new MeterProvider({ resource });
meterProvider.addMetricReader(
  new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || 3000)
  })
);

const sdk = new NodeSDK({
  resource,
  autoDetectResources: false,
  spanProcessors: [spanProcessor],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-runtime-node': { enabled: false }
    })
  ]
});

async function startOtel() {
  try {
    loggerProvider = new LoggerProvider({ resource });
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(logExporter, {
        scheduledDelayMillis: EXPORT_BATCH_DELAY_MS,
        maxExportBatchSize: EXPORT_BATCH_SIZE,
        maxQueueSize: 2048,
        exportTimeoutMillis: 10000
      })
    );
    logs.setGlobalLoggerProvider(loggerProvider);

    await sdk.start();
    metrics.setGlobalMeterProvider(meterProvider);

    const meter = metrics.getMeter('devopsark-sdk');
    httpCounter = meter.createCounter('devopsark_http_requests_total', { description: 'Total HTTP requests' });
    errorCounter = meter.createCounter('devopsark_http_errors_total', { description: 'Total HTTP error responses (status >= 400)' });
    durationHistogram = meter.createHistogram('devopsark_http_duration_ms', { description: 'HTTP request duration in ms' });
    transferBytesCounter = meter.createCounter('devopsark_http_transfer_bytes_total', { description: 'Total HTTP bytes (request+response Content-Length, best-effort)' });

    otelReady = true;
    otelReadyResolve();
  } catch (err) {
    console.error('[OTEL] start failed:', err.message || err);
    otelReadyReject(err);
  }
}

startOtel();

function whenOtelReady() {
  return otelReadyPromise;
}

async function flushOtel() {
  if (loggerProvider) await loggerProvider.forceFlush();
  if (spanProcessor) await spanProcessor.forceFlush();
}

function recordHttpMetrics(req, res, duration) {
  if (!httpCounter || !durationHistogram) return;
  const route = req.route && req.route.path ? req.route.path : (req.baseUrl ? req.baseUrl + (req.path || '') : req.path) || 'unknown';
  const labels = { method: req.method, route, status: String(res.statusCode) };
  httpCounter.add(1, labels);
  durationHistogram.record(duration, labels);
  if (res.statusCode >= 400) errorCounter.add(1, labels);
  if (transferBytesCounter) {
    const reqB = parseInt(String(req.headers['content-length'] || '0'), 10);
    const reqBytes = Number.isFinite(reqB) ? Math.max(0, reqB) : 0;
    let resBytes = 0;
    try {
      const cl = res.getHeader && res.getHeader('content-length');
      if (cl != null) {
        const n = parseInt(String(cl), 10);
        if (Number.isFinite(n)) resBytes = Math.max(0, n);
      }
    } catch (_) {}
    transferBytesCounter.add(reqBytes + resBytes, labels);
  }
}

function getLogEmitter() {
  return {
    emit: (record, ctx) => {
      if (!otelReady || !loggerProvider) return;
      const activeContext = ctx || context.active();
      context.with(activeContext, () => {
        try {
          const otelLog = logs.getLogger('winston', '1.0.0');
          const body = record?.body != null ? String(record.body) : '';
          otelLog.emit({
            severityNumber: record?.severityNumber ?? SeverityNumber.INFO,
            severityText: record?.severityText || 'INFO',
            body
          });
        } catch (err) {
          console.error('[OTEL] log export failed:', err.message || err);
        }
      });
    }
  };
}

function getOtelStatus() {
  return {
    ready: otelReady,
    otlpEndpoint: endpoint,
    otlpUrls: {
      traces: endpoint + '/v1/traces',
      logs: endpoint + '/v1/logs',
      metrics: otlpMetricsBase + '/v1/metrics'
    },
    collectorMetricsUrl,
    serviceName,
    integrationId: integrationId || null,
    exports: { logs: true, traces: true, metrics: true }
  };
}

async function shutdown() {
  try {
    await flushOtel();
    await meterProvider.shutdown();
    await sdk.shutdown();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
  getLogEmitter,
  recordHttpMetrics,
  whenOtelReady,
  flushOtel,
  getOtelStatus,
  collectorMetricsUrl,
  otlpEndpoint: endpoint,
  serviceName,
  integrationId
};
