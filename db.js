// db.js - PostgreSQL version for Supabase
const { Pool } = require('pg');
require('dotenv').config();

// Use DATABASE_URL from environment (Supabase provides this)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Required for Supabase
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
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
        // Create users table with Google OAuth columns
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'user',
                google_id VARCHAR(255) UNIQUE,
                avatar_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Users table ready');

        // Add Google columns if they don't exist (for existing tables)
        try {
            await client.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
                ADD COLUMN IF NOT EXISTS avatar_url TEXT,
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            `);
            console.log('✓ Google OAuth columns added to users table');
        } catch (err) {
            console.log('Note: Google columns may already exist:', err.message);
        }

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
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Queues table ready');

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
                status VARCHAR(20) DEFAULT 'waiting',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                served_at TIMESTAMP
            )
        `);
        console.log('✓ Participants table ready');

        // Create indexes for better performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_participants_queue_id ON participants(queue_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_queues_queue_id ON queues(queue_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_queues_creator_id ON queues(creator_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
        console.log('✓ Indexes created');

        // Create function to auto-update updated_at timestamp
        await client.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql'
        `);

        // Create trigger for users table
        await client.query(`
            DROP TRIGGER IF EXISTS update_users_updated_at ON users;
            CREATE TRIGGER update_users_updated_at
                BEFORE UPDATE ON users
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column()
        `);
        console.log('✓ Updated_at trigger created');

        console.log('✅ All database tables ready');
        return true;
    } catch (error) {
        console.error('❌ Database init error:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Helper function for parameterized queries
function formatQuery(sql, params = []) {
    let counter = 1;
    return sql.replace(/\?/g, () => `$${counter++}`);
}

module.exports = { pool, initializeDatabase, formatQuery };
