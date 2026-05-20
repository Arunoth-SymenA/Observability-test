# DevOpsArk observability

## Setup

1. Copy repo root `.env.observability.example` → `.env`
2. In your app entry (`index.js`):

```javascript
const logger = require('./logger.js');
const metricsMiddleware = require('./metricsMiddleware.js');

logger.whenReady().then(() => {
  app.use(metricsMiddleware);
  // routes...
});
```

3. Use **logger.info / logger.warn / logger.error** instead of `console.log`
4. Do not use top-level `await` with `require()` — use `logger.whenReady().then(...)`

Endpoints are read from env (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_COLLECTOR_METRICS_URL, etc.).
