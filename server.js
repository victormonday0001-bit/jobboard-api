require('dotenv').config();
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const compression  = require('compression');
const path         = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi    = require('swagger-ui-express');

const { connectDB }              = require('./config/db');
const { generalLimiter }         = require('./middleware/rateLimit');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app    = express();
const PORT   = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// ── Security ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:         isProd ? process.env.CLIENT_URL : true,
  methods:        ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials:    true,
}));

// ── Performance ───────────────────────────────────────────────────
app.use(compression());

// ── Logging ───────────────────────────────────────────────────────
app.use(morgan(isProd ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ── Body Parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Trust Proxy (for Render/Railway) ─────────────────────────────
app.set('trust proxy', 1);

// ── Rate Limiting ─────────────────────────────────────────────────
app.use(generalLimiter);

// ── Static Uploads ────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Swagger Docs ──────────────────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'Job Board API',
      version:     '1.0.0',
      description: 'Production-grade Job Board REST API — built by Victor Monday',
      contact:     { name: 'Victor Monday' },
    },
    servers: [
      { url: process.env.APP_URL || `http://localhost:${PORT}`, description: 'Current server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
          description:  'Enter your access token from /api/auth/login',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./routes/*.js'],
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'JobBoard API Docs',
  customCss:       '.swagger-ui .topbar { background: #1a1a1a; }',
}));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

// ── Health Check ──────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:    'ok',
  timestamp: new Date().toISOString(),
  uptime:    `${Math.floor(process.uptime())}s`,
  env:       process.env.NODE_ENV,
}));

// ── API Routes ────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/companies',     require('./routes/companies'));
app.use('/api/jobs',          require('./routes/jobs'));
app.use('/api/applications',  require('./routes/applications'));
app.use('/api/admin',         require('./routes/admin'));

// ── 404 + Error Handlers ──────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────────────
const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`✅ Job Board API running at http://localhost:${PORT}`);
    logger.info(`📚 Swagger docs at http://localhost:${PORT}/api/docs`);
    logger.info(`❤️  Health check at http://localhost:${PORT}/health`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  start();
}

module.exports = app;
