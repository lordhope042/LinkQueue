// db.js - PostgreSQL version for Render
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false } // Required for Render PostgreSQL
});

// Test connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ PostgreSQL connection error:', err.message);
    } else {
        console.log('✅ PostgreSQL connected successfully');
        release();
    }
});

// Create tables on startup
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create queues table
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
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'closed')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create participants table
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
                status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'served', 'cancelled')),
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                served_at TIMESTAMP
            )
        `);
        
        // Create indexes for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_participants_queue_id ON participants(queue_id);
            CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status);
            CREATE INDEX IF NOT EXISTS idx_queues_queue_id ON queues(queue_id);
            CREATE INDEX IF NOT EXISTS idx_queues_creator_id ON queues(creator_id);
            CREATE INDEX IF NOT EXISTS idx_queues_status ON queues(status);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        `);
        
        console.log('✅ Database tables ready');
    } catch (error) {
        console.error('Database init error:', error);
    } finally {
        client.release();
    }
}

// Helper function to convert MySQL query to PostgreSQL
function formatQuery(sql, params = []) {
    // Replace MySQL's ? with PostgreSQL's $1, $2, etc.
    let counter = 1;
    return sql.replace(/\?/g, () => `$${counter++}`);
}

module.exports = { pool, initializeDatabase, formatQuery };