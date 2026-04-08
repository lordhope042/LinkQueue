// ==================== IMPORTS ====================
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// ==================== CONFIG ====================
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== DATABASE ====================
let pool;
let dbConnected = false;

// Initialize DB connection
function initDatabase() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        console.error('❌ DATABASE_URL is missing');
        return null;
    }

    pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    return pool;
}

// Test DB connection
async function testDB() {
    try {
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();

        dbConnected = true;
        console.log('✅ PostgreSQL connected');
    } catch (err) {
        dbConnected = false;
        console.error('❌ DB connection failed:', err.message);
    }
}

// ==================== DB INITIALIZATION ====================
async function initializeTables() {
    if (!dbConnected) return;

    const client = await pool.connect();

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS queues (
                id SERIAL PRIMARY KEY,
                queue_id VARCHAR(100) UNIQUE NOT NULL,
                creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(200) NOT NULL,
                description TEXT,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS participants (
                id SERIAL PRIMARY KEY,
                participant_id VARCHAR(100) UNIQUE NOT NULL,
                queue_id INTEGER REFERENCES queues(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                status VARCHAR(20) DEFAULT 'waiting',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Tables initialized');
    } catch (err) {
        console.error('❌ Table creation error:', err.message);
    } finally {
        client.release();
    }
}

// ==================== AUTH MIDDLEWARE ====================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// ==================== ROUTES ====================

// Health check
app.get('/api/health', async (req, res) => {
    let dbStatus = 'disconnected';

    try {
        if (pool) {
            await pool.query('SELECT 1');
            dbStatus = 'connected';
        }
    } catch {
        dbStatus = 'error';
    }

    res.json({
        status: 'ok',
        database: dbStatus
    });
});

// Register
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        const hash = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (user_id, name, email, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [`user_${Date.now()}`, name, email, hash]
        );

        res.json({ success: true, user: result.rows[0] });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query(
            `SELECT * FROM users WHERE email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({ token, user });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Example protected route
app.get('/api/dashboard', authenticateToken, (req, res) => {
    res.json({
        message: 'Protected data',
        user: req.user
    });
});

// ==================== START SERVER ====================
async function startServer() {
    console.log('\n🚀 Starting server...\n');

    initDatabase();
    await testDB();
    await initializeTables();

    app.listen(PORT, '0.0.0.0', () => {
        console.log('══════════════════════════════');
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🗄️ Database: ${dbConnected ? 'Connected' : 'Disconnected'}`);
        console.log('══════════════════════════════\n');
    });
}

startServer();
