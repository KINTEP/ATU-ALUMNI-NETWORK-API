// src/config/db.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';
const useCloudSQL = isProduction && process.env.DB_HOST?.includes('/cloudsql/');

const poolConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ...(useCloudSQL
        ? {
            host: process.env.DB_HOST, // Unix socket path for Cloud SQL
        }
        : {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
        }),
    max: 20,
    idleTimeoutMillis: 30000,
    // ✅ FIX: Reduced from 10000ms — a 10s wait before error is too long for Cloud Run.
    // Users would stare at a spinner for 10s before getting a 500. 5s is the right balance.
    connectionTimeoutMillis: 5000,
};

// ✅ SAFE: Never log password — only connection metadata
console.log('Database config:', {
    user: poolConfig.user,
    database: poolConfig.database,
    host: poolConfig.host,
    isProduction,
    useCloudSQL
});

const pool = new Pool(poolConfig);

pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database error:', err);
});

export default pool;