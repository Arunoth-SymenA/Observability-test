const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const PUBLIC_API_URL = 'https://jsonplaceholder.typicode.com/posts/1';

// Middleware to parse JSON responses
app.use(express.json());

// Logger middleware to log incoming requests with timestamps
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - Duration: ${duration}ms`);
  });
  next();
});

// Root endpoint with application info
app.get('/', (req, res) => {
  res.json({
    appName: "Observability Node Server",
    version: "1.0.0",
    endpoints: {
      successResponse: "/response",
      failResponse: "/fail",
      anomalyResponse: "/anomaly"
    },
    message: "Use the above endpoints to test observability and monitoring scenarios."
  });
});

// 1. Response API (Success Endpoint)
// Fetches data from the open-source JSONPlaceholder API and returns it with request metadata.
app.get('/response', async (req, res) => {
  const startTime = Date.now();
  try {
    const apiResponse = await axios.get(PUBLIC_API_URL);
    const duration = Date.now() - startTime;
    
    res.status(200).json({
      status: "success",
      statusCode: 200,
      timestamp: new Date().toISOString(),
      latency_ms: duration,
      source: "JSONPlaceholder API",
      data: apiResponse.data
    });
  } catch (error) {
    console.error("Error in /response:", error.message);
    res.status(502).json({
      status: "error",
      message: "Bad Gateway - Failed to fetch from open source API",
      error: error.message
    });
  }
});

// 2. Fail API (Failure Endpoint)
// Simulates an internal application failure (e.g. database error, timeout).
app.get('/fail', (req, res) => {
  res.status(500).json({
    status: "error",
    statusCode: 500,
    timestamp: new Date().toISOString(),
    message: "Internal Server Error - Simulated application failure",
    error: {
      code: "ERR_CONNECTION_REFUSED",
      details: "Database connection failed to establish (simulated for observability testing)"
    }
  });
});

// 3. Anomaly API (Anomaly Endpoint)
// Simulates a performance anomaly by adding artificial high latency (random delay between 3-6 seconds)
app.get('/anomaly', async (req, res) => {
  const startTime = Date.now();
  
  // Generate random delay between 3000ms and 6000ms
  const delay = Math.floor(Math.random() * 3000) + 3000;
  
  // Promisified timeout
  await new Promise(resolve => setTimeout(resolve, delay));
  
  try {
    const apiResponse = await axios.get(PUBLIC_API_URL);
    const duration = Date.now() - startTime;
    
    res.status(200).json({
      status: "anomaly",
      statusCode: 200,
      timestamp: new Date().toISOString(),
      latency_ms: duration,
      simulated_delay_ms: delay,
      message: "Response succeeded, but experienced anomalous latency spikes",
      data: apiResponse.data
    });
  } catch (error) {
    console.error("Error in /anomaly:", error.message);
    res.status(502).json({
      status: "error",
      message: "Bad Gateway - Failed to fetch from open source API during anomalous run",
      error: error.message
    });
  }
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Observability Node Server listening on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  - http://localhost:${PORT}/response`);
  console.log(`  - http://localhost:${PORT}/fail`);
  console.log(`  - http://localhost:${PORT}/anomaly`);
  console.log(`==================================================`);
});