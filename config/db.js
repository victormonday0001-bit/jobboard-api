const { Pool } = require('pg');
const logger   = require('../utils/logger');

const pool = new Pool({
  user:                    process.env.PG_USER,
  host:                    process.env.PG_HOST,
  database:                process.env.PG_DATABASE,
  password:                process.env.PG_PASSWORD,
  port:                    parseInt(process.env.PG_PORT) || 5432,
  max:                     parseInt(process.env.PG_MAX_CONNECTIONS) || 10,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error:', err);
  process.exit(-1);
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    client.release();
    logger.info(`✅ PostgreSQL connected: ${result.rows[0].version.split(' ').slice(0,2).join(' ')}`);
  } catch (err) {
    logger.error(`❌ PostgreSQL connection failed: ${err.message}`);
    process.exit(-1);
  }
};

const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, connectDB, withTransaction };
