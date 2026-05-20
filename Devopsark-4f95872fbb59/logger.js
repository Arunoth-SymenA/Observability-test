'use strict';
const winston = require('winston');
const Transport = require('winston-transport');
const { trace, context } = require('@opentelemetry/api');
const { SeverityNumber } = require('@opentelemetry/api-logs');
const { getLogEmitter, whenOtelReady, flushOtel, getOtelStatus } = require('./otel.js');

const LEVEL_NAMES = {
  0: 'emergency', 1: 'alert', 2: 'critical', 3: 'error', 4: 'warn', 5: 'notice', 6: 'info', 7: 'debug'
};

const customLevels = {
  levels: {
    emergency: 0,
    alert: 1,
    critical: 2,
    error: 3,
    warn: 4,
    notice: 5,
    info: 6,
    debug: 7
  }
};

const LEVEL_TO_SEVERITY = {
  emergency: SeverityNumber.FATAL4 ?? SeverityNumber.ERROR,
  alert: SeverityNumber.FATAL3 ?? SeverityNumber.ERROR,
  critical: SeverityNumber.FATAL2 ?? SeverityNumber.ERROR,
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  notice: SeverityNumber.INFO2 ?? SeverityNumber.INFO,
  info: SeverityNumber.INFO,
  debug: SeverityNumber.DEBUG,
  http: SeverityNumber.INFO,
  verbose: SeverityNumber.DEBUG,
  silly: SeverityNumber.DEBUG
};

function resolveLevelName(info) {
  if (typeof info.level === 'string') return info.level;
  return LEVEL_NAMES[info.level] || 'info';
}

const injectTraceContext = winston.format((info) => {
  const span = trace.getSpan(context.active());
  if (span) {
    const ctx = span.spanContext();
    info.trace_id = ctx.traceId;
    info.span_id = ctx.spanId;
  }
  return info;
});

class OtelTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.emitter = getLogEmitter();
  }

  log(info, callback) {
    setImmediate(() => this.emit('logged', info));

    try {
      if (!this.emitter) return callback();

      const levelName = resolveLevelName(info);
      const activeContext = context.active();
      const body = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
      this.emitter.emit(
        {
          severityNumber: LEVEL_TO_SEVERITY[levelName] ?? SeverityNumber.INFO,
          severityText: levelName.toUpperCase(),
          body
        },
        activeContext
      );
    } catch (err) {
      console.error('OTEL log emit failed:', err.message || err);
    }

    callback();
  }
}

function simpleFormat(info) {
  const ts = (info.timestamp && typeof info.timestamp === 'string')
    ? info.timestamp.replace('T', ' ').slice(0, 19)
    : (info.timestamp || '');
  const msg = info.message != null ? String(info.message) : (info.stack || '');
  return ts + ' [' + resolveLevelName(info) + ']: ' + msg;
}

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    injectTraceContext(),
    winston.format.errors({ stack: true }),
    winston.format.printf(simpleFormat)
  ),
  transports: [
    new winston.transports.Console(),
    new OtelTransport()
  ]
});

logger.whenReady = whenOtelReady;
logger.flushOtel = flushOtel;
logger.getOtelStatus = getOtelStatus;

module.exports = logger;
