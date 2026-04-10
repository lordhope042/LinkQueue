// db.js - Clean PostgreSQL setup for Render (WITH MIGRATIONS)
const { Pool } = require("pg");
require("dotenv").config();

// ==================== CONNECTION ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Render
  },
});

// ==================== TEST CONNECTION ====================
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("✅ PostgreSQL connected successfully");
    client.release();
  } catch (error) {
    console.error("❌ PostgreSQL connection error:", error.message);
    process.exit(1);
  }
}

// ==================== INITIALIZE DATABASE ====================
async function initializeDatabase() {
  const client = await pool.connect();

  try {
    console.log("📦 Initializing database...");

    // ==================== USERS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user'
          CHECK (role IN ('admin', 'user')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ==================== QUEUES ====================
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

    // ==================== PARTICIPANTS (UPDATED) ====================
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
          CHECK (status IN ('waiting', 'serving', 'next', 'served', 'skipped', 'cancelled')),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        served_at TIMESTAMP,

        -- NEW FIELDS
        notification_sent BOOLEAN DEFAULT FALSE,
        notification_sent_at TIMESTAMP,
        grace_expires_at TIMESTAMP
      );
    `);

    // ==================== INDEXES ====================
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_queues_queue_id ON queues(queue_id);
      CREATE INDEX IF NOT EXISTS idx_queues_creator_id ON queues(creator_id);
      CREATE INDEX IF NOT EXISTS idx_queues_status ON queues(status);
      CREATE INDEX IF NOT EXISTS idx_participants_queue_id ON participants(queue_id);
      CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status);
    `);

    console.log("✅ Base tables ready");

    // ==================== SAFE MIGRATIONS ====================
    console.log("🔄 Running safe migrations...");

    // Fix status constraint
    await client.query(`
      ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_status_check;
    `);

    await client.query(`
      ALTER TABLE participants ADD CONSTRAINT participants_status_check
      CHECK (status IN ('waiting', 'serving', 'next', 'served', 'skipped', 'cancelled'));
    `);

    // Add missing columns (safe for existing DB)
    await client.query(`
      ALTER TABLE participants 
      ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT FALSE;
    `);

    await client.query(`
      ALTER TABLE participants 
      ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMP;
    `);

    await client.query(`
      ALTER TABLE participants 
      ADD COLUMN IF NOT EXISTS grace_expires_at TIMESTAMP;
    `);

    console.log("✅ Migrations complete");

  } catch (error) {
    console.error("❌ Database initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
}

// ==================== QUERY HELPER ====================
async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error("❌ Query error:", error);
    throw error;
  }
}

// ==================== OPTIONAL FORMATTER ====================
function formatQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ==================== EXPORT ====================
module.exports = {
  pool,
  query,
  testConnection,
  initializeDatabase,
  formatQuery,
};
