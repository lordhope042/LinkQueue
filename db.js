// db.js - Clean PostgreSQL setup for Render
const { Pool } = require("pg");
require("dotenv").config();

// Create pool using DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Render
  },
});

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("✅ PostgreSQL connected successfully");
    client.release();
  } catch (error) {
    console.error("❌ PostgreSQL connection error:", error.message);
    process.exit(1); // Stop app if DB fails
  }
}

// Initialize database tables
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log("📦 Initializing database...");

    // USERS TABLE
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // QUEUES TABLE
    await client.query(`
      CREATE TABLE IF NOT EXISTS queues (
        id SERIAL PRIMARY KEY,
        queue_id VARCHAR(100) UNIQUE NOT NULL,
        creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        creator_email VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        expiry_hours INTEGER DEFAULT 2,
        expires_at TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'active'
          CHECK (status IN ('active', 'expired', 'closed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // PARTICIPANTS TABLE
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        id SERIAL PRIMARY KEY,
        participant_id VARCHAR(100) UNIQUE NOT NULL,
        queue_id INTEGER REFERENCES queues(id) ON DELETE CASCADE,
        queue_ref VARCHAR(100) NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100),
        phone VARCHAR(50),
        is_guest BOOLEAN DEFAULT TRUE,
        position INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'waiting'
          CHECK (status IN ('waiting', 'served', 'cancelled')),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        served_at TIMESTAMP
      );
    `);

    // INDEXES
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_queues_queue_id ON queues(queue_id);
      CREATE INDEX IF NOT EXISTS idx_queues_creator_id ON queues(creator_id);
      CREATE INDEX IF NOT EXISTS idx_queues_status ON queues(status);
      CREATE INDEX IF NOT EXISTS idx_participants_queue_id ON participants(queue_id);
      CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status);
    `);

    console.log("✅ Database tables ready");
  } catch (error) {
    console.error("❌ Database initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Query helper (for easy reuse)
async function query(text, params) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (error) {
    console.error("❌ Query error:", error);
    throw error;
  }
}

// Optional: Convert MySQL-style ? → PostgreSQL $1, $2
function formatQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

module.exports = {
  pool,
  query,
  testConnection,
  initializeDatabase,
  formatQuery,
};
