// ==================== IMPORTS ====================
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path'); // ✅ Added for file serving

// ==================== CONFIG ====================
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static files from root directory (where your HTML files are)
app.use(express.static(path.join(__dirname)));

// Also serve from public folder if it exists
app.use(express.static(path.join(__dirname, 'public')));

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
                creator_email VARCHAR(100),
                name VARCHAR(200) NOT NULL,
                description TEXT,
                expiry_hours INTEGER DEFAULT 2,
                expires_at TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS participants (
                id SERIAL PRIMARY KEY,
                participant_id VARCHAR(100) UNIQUE NOT NULL,
                queue_id INTEGER REFERENCES queues(id) ON DELETE CASCADE,
                queue_ref VARCHAR(100),
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100),
                phone VARCHAR(50),
                is_guest BOOLEAN DEFAULT TRUE,
                position INTEGER,
                status VARCHAR(20) DEFAULT 'waiting',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                served_at TIMESTAMP
            )
        `);

        // Create default admin user if not exists
        const adminCheck = await client.query(
            `SELECT * FROM users WHERE email = $1`,
            ['admin@linkqueue.com']
        );

        if (adminCheck.rows.length === 0) {
            const adminHash = await bcrypt.hash('admin123', 10);
            await client.query(
                `INSERT INTO users (user_id, name, email, password_hash, role)
                 VALUES ($1, $2, $3, $4, $5)`,
                ['admin_001', 'Admin', 'admin@linkqueue.com', adminHash, 'admin']
            );
            console.log('✅ Default admin created');
        }

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

    jwt.verify(token, process.env.JWT_SECRET || 'linkqueue_secret_2024', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// ==================== API ROUTES ====================

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
        database: dbStatus,
        timestamp: new Date().toISOString()
    });
});

// Register
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }

    try {
        // Check if user exists
        const existing = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hash = await bcrypt.hash(password, 10);
        const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        const result = await pool.query(
            `INSERT INTO users (user_id, name, email, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING user_id, name, email, role`,
            [userId, name, email.toLowerCase(), hash]
        );

        const user = result.rows[0];
        const token = jwt.sign(
            { userId: user.user_id, email: user.email, name: user.name, role: user.role },
            process.env.JWT_SECRET || 'linkqueue_secret_2024',
            { expiresIn: '24h' }
        );

        res.json({ success: true, token, user });

    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM users WHERE email = $1`,
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.user_id, email: user.email, name: user.name, role: user.role },
            process.env.JWT_SECRET || 'linkqueue_secret_2024',
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: {
                userId: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify token
app.get('/api/verify', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

// Logout
app.post('/api/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out' });
});

// Get user's queues
app.get('/api/my-queues', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT q.*, 
             (SELECT COUNT(*) FROM participants WHERE queue_id = q.id AND status = 'waiting') as waiting_count
             FROM queues q 
             WHERE q.creator_email = $1 
             ORDER BY q.created_at DESC`,
            [req.user.email]
        );

        res.json({ success: true, queues: result.rows });
    } catch (err) {
        console.error('Get queues error:', err);
        res.status(500).json({ error: 'Failed to fetch queues' });
    }
});

// Create queue
app.post('/api/queues', authenticateToken, async (req, res) => {
    const { name, description, expiryHours = 2 } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Queue name required' });
    }

    try {
        // Get user's ID
        const userResult = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [req.user.email]
        );

        const queueId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

        const result = await pool.query(
            `INSERT INTO queues (queue_id, creator_id, creator_email, name, description, expiry_hours, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [queueId, userResult.rows[0].id, req.user.email, name, description, expiryHours, expiresAt]
        );

        res.json({ success: true, queue: result.rows[0] });
    } catch (err) {
        console.error('Create queue error:', err);
        res.status(500).json({ error: 'Failed to create queue' });
    }
});

// ==================== FRONTEND ROUTES ====================
// ✅ Serve HTML files for different routes

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Register page
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

// Dashboard (requires auth check on client side)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'user-dashboard.html'));
});

// Admin dashboard
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Join queue page
app.get('/join', (req, res) => {
    res.sendFile(path.join(__dirname, 'join-queue.html'));
});

// Catch-all route for SPA-like behavior (optional)
app.get('*', (req, res) => {
    // If the request is for an API route that doesn't exist, return 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // Otherwise, serve index.html for client-side routing
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== START SERVER ====================
async function startServer() {
    console.log('\n🚀 Starting LinkQueue server...\n');

    initDatabase();
    await testDB();
    await initializeTables();

    app.listen(PORT, '0.0.0.0', () => {
        console.log('═══════════════════════════════════════════════');
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🌐 Website: http://localhost:${PORT}`);
        console.log(`📡 API: http://localhost:${PORT}/api`);
        console.log(`🗄️ Database: ${dbConnected ? '✅ Connected' : '❌ Disconnected'}`);
        console.log('═══════════════════════════════════════════════');
        console.log('🔑 Test Credentials:');
        console.log('   Admin: admin@linkqueue.com / admin123');
        console.log('═══════════════════════════════════════════════\n');
    });
}

startServer();
