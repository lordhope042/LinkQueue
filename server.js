// ==================== IMPORTS ====================
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');

// ==================== CONFIG ====================
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==================== DATABASE CONNECTION ====================
let pool;
let dbConnected = false;

function initDatabaseConnection() {
    const connectionString = process.env.DATABASE_URL;
    
    console.log('\n🔍 Database Configuration:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`DATABASE_URL set: ${connectionString ? '✅ Yes' : '❌ No'}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`PORT: ${PORT}`);
    
    if (!connectionString) {
        console.error('\n❌ CRITICAL ERROR: DATABASE_URL environment variable is not set!');
        process.exit(1);
    }
    
    const maskedUrl = connectionString.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
    console.log(`Database URL: ${maskedUrl}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    pool = new Pool({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 20
    });
    
    return testDatabaseConnection();
}

async function testDatabaseConnection() {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
        console.log('✅ PostgreSQL Connected Successfully!');
        console.log(`   Time: ${result.rows[0].current_time}`);
        console.log(`   Version: ${result.rows[0].pg_version.split(',')[0]}\n`);
        dbConnected = true;
        return true;
    } catch (err) {
        console.error('❌ Database Connection Failed:', err.message);
        dbConnected = false;
        return false;
    } finally {
        if (client) client.release();
    }
}

// ==================== DATABASE INITIALIZATION ====================
async function initializeTables() {
    if (!dbConnected) {
        console.log('⚠️ Skipping table initialization - database not connected');
        return;
    }

    const client = await pool.connect();
    try {
        console.log('📦 Creating database tables if not exist...');
        
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
        console.log('  ✓ Users table ready');
        
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
        console.log('  ✓ Queues table ready');
        
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
        console.log('  ✓ Participants table ready');
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_queues_queue_id ON queues(queue_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_participants_queue_id ON participants(queue_id)`);
        console.log('  ✓ Indexes created');
        
        const adminCheck = await client.query(`SELECT * FROM users WHERE email = $1`, ['admin@linkqueue.com']);
        if (adminCheck.rows.length === 0) {
            const adminHash = await bcrypt.hash('admin123', 10);
            await client.query(
                `INSERT INTO users (user_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
                ['admin_001', 'Admin', 'admin@linkqueue.com', adminHash, 'admin']
            );
            console.log('  ✓ Default admin created');
        }
        
        const demoCheck = await client.query(`SELECT * FROM users WHERE email = $1`, ['demo@linkqueue.com']);
        if (demoCheck.rows.length === 0) {
            const demoHash = await bcrypt.hash('demo123', 10);
            await client.query(
                `INSERT INTO users (user_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
                ['user_001', 'Demo User', 'demo@linkqueue.com', demoHash, 'user']
            );
            console.log('  ✓ Default demo user created');
        }
        
        console.log('✅ All database tables ready\n');
        
    } catch (error) {
        console.error('❌ Table creation error:', error);
    } finally {
        client.release();
    }
}

// ==================== HELPER FUNCTIONS ====================
function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function verifyToken(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET || 'linkqueue_secret_key_2024');
    } catch (error) {
        return null;
    }
}

// ==================== AUTH MIDDLEWARE ====================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    const decoded = verifyToken(token);
    if (!decoded) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
}

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', async (req, res) => {
    let dbStatus = 'disconnected';
    if (dbConnected) {
        try {
            await pool.query('SELECT 1');
            dbStatus = 'connected';
        } catch { dbStatus = 'error'; }
    }
    res.json({ status: 'ok', database: dbStatus, timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
        
        const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });
        
        const hash = await bcrypt.hash(password, 10);
        const userId = generateId('user');
        const result = await pool.query(
            `INSERT INTO users (user_id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING user_id, name, email, role`,
            [userId, name, email.toLowerCase(), hash]
        );
        const user = result.rows[0];
        const token = jwt.sign(
            { userId: user.user_id, email: user.email, name: user.name, role: user.role },
            process.env.JWT_SECRET || 'linkqueue_secret_key_2024',
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
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        
        const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        
        const token = jwt.sign(
            { userId: user.user_id, email: user.email, name: user.name, role: user.role },
            process.env.JWT_SECRET || 'linkqueue_secret_key_2024',
            { expiresIn: '24h' }
        );
        res.json({ success: true, token, user: { userId: user.user_id, name: user.name, email: user.email, role: user.role } });
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
            `SELECT q.*, (SELECT COUNT(*) FROM participants WHERE queue_id = q.id AND status = 'waiting') as waiting_count
             FROM queues q WHERE q.creator_email = $1 ORDER BY q.created_at DESC`,
            [req.user.email]
        );
        res.json({ success: true, queues: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch queues' });
    }
});

// Create queue
app.post('/api/queues', authenticateToken, async (req, res) => {
    const { name, description, expiryHours = 2 } = req.body;
    if (!name) return res.status(400).json({ error: 'Queue name required' });
    
    try {
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [req.user.email]);
        const queueId = generateId('q');
        const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
        const result = await pool.query(
            `INSERT INTO queues (queue_id, creator_id, creator_email, name, description, expiry_hours, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [queueId, userResult.rows[0].id, req.user.email, name, description, expiryHours, expiresAt]
        );
        res.json({ success: true, queue: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create queue' });
    }
});

// Get single queue info
app.get('/api/queues/:queueId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT q.*, COUNT(p.id) as participant_count 
             FROM queues q LEFT JOIN participants p ON q.id = p.queue_id AND p.status = 'waiting'
             WHERE q.queue_id = $1 GROUP BY q.id`,
            [req.params.queueId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Queue not found' });
        
        const queue = result.rows[0];
        const isActive = new Date(queue.expires_at) > new Date() && queue.status === 'active';
        res.json({
            success: true,
            queue: {
                queueId: queue.queue_id,
                name: queue.name,
                description: queue.description,
                participantCount: parseInt(queue.participant_count) || 0,
                expiresAt: queue.expires_at,
                isActive,
                createdAt: queue.created_at
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ✅ NEW: Get queue status with participants
app.get('/api/queues/:queueId/status', async (req, res) => {
    try {
        const { queueId } = req.params;
        
        const queueResult = await pool.query(
            `SELECT q.*, (SELECT COUNT(*) FROM participants WHERE queue_id = q.id AND status = 'waiting') as total_participants
             FROM queues q WHERE q.queue_id = $1`,
            [queueId]
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found' });
        }
        
        const queue = queueResult.rows[0];
        const isActive = new Date(queue.expires_at) > new Date() && queue.status === 'active';
        
        const participantsResult = await pool.query(
            `SELECT participant_id, name, position, joined_at, status, is_guest 
             FROM participants WHERE queue_id = $1 AND status = 'waiting' ORDER BY position ASC`,
            [queue.id]
        );
        
        res.json({
            success: true,
            queue: {
                queueId: queue.queue_id,
                name: queue.name,
                description: queue.description,
                isActive,
                expiresAt: queue.expires_at,
                totalParticipants: parseInt(queue.total_participants) || 0,
                createdAt: queue.created_at
            },
            participants: participantsResult.rows.map(p => ({
                participantId: p.participant_id,
                name: p.name,
                position: p.position,
                joinedAt: p.joined_at,
                status: p.status,
                isGuest: p.is_guest
            }))
        });
    } catch (error) {
        console.error('Queue status error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Join queue
app.post('/api/queues/:queueId/join', async (req, res) => {
    try {
        const { name, email, phone, isGuest = true } = req.body;
        if (!name || name.trim() === '') return res.status(400).json({ error: 'Name is required' });
        
        const queueResult = await pool.query(
            `SELECT * FROM queues WHERE queue_id = $1 AND status = 'active' AND expires_at > NOW()`,
            [req.params.queueId]
        );
        if (queueResult.rows.length === 0) return res.status(404).json({ error: 'Queue not found or has expired' });
        
        const queue = queueResult.rows[0];
        
        if (email) {
            const existingResult = await pool.query(
                `SELECT id FROM participants WHERE queue_id = $1 AND email = $2 AND status = 'waiting'`,
                [queue.id, email.toLowerCase()]
            );
            if (existingResult.rows.length > 0) return res.status(400).json({ error: 'You are already in this queue' });
        }
        
        const positionResult = await pool.query(
            'SELECT COUNT(*) as count FROM participants WHERE queue_id = $1 AND status = $2',
            [queue.id, 'waiting']
        );
        const position = parseInt(positionResult.rows[0].count) + 1;
        const participantId = generateId('p');
        
        await pool.query(
            `INSERT INTO participants (participant_id, queue_id, queue_ref, name, email, phone, is_guest, position) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [participantId, queue.id, req.params.queueId, name.trim(), email ? email.toLowerCase() : null, phone || null, isGuest, position]
        );
        
        res.json({
            success: true,
            message: `Successfully joined ${queue.name}`,
            participant: { participantId, position, queueName: queue.name }
        });
    } catch (error) {
        console.error('Join queue error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ✅ NEW: Get participant position
app.get('/api/participants/:participantId/position', async (req, res) => {
    try {
        const { participantId } = req.params;
        
        const participantResult = await pool.query(
            `SELECT p.*, q.name as queue_name, q.queue_id 
             FROM participants p JOIN queues q ON p.queue_id = q.id 
             WHERE p.participant_id = $1 AND p.status = 'waiting'`,
            [participantId]
        );
        
        if (participantResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Participant not found or already served' });
        }
        
        const participant = participantResult.rows[0];
        
        const aheadResult = await pool.query(
            `SELECT COUNT(*) as count FROM participants 
             WHERE queue_id = $1 AND position < $2 AND status = 'waiting'`,
            [participant.queue_id, participant.position]
        );
        
        const behindResult = await pool.query(
            `SELECT COUNT(*) as count FROM participants 
             WHERE queue_id = $1 AND position > $2 AND status = 'waiting'`,
            [participant.queue_id, participant.position]
        );
        
        res.json({
            success: true,
            position: participant.position,
            queueName: participant.queue_name,
            queueId: participant.queue_id,
            aheadCount: parseInt(aheadResult.rows[0].count),
            behindCount: parseInt(behindResult.rows[0].count),
            totalWaiting: parseInt(aheadResult.rows[0].count) + parseInt(behindResult.rows[0].count) + 1
        });
    } catch (error) {
        console.error('Participant position error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ NEW: Serve next participant (for queue owner)
app.post('/api/queues/:queueId/serve', authenticateToken, async (req, res) => {
    try {
        const { queueId } = req.params;
        
        const queueResult = await pool.query(
            'SELECT * FROM queues WHERE queue_id = $1 AND creator_email = $2',
            [queueId, req.user.email]
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found or unauthorized' });
        }
        
        const queue = queueResult.rows[0];
        
        const nextResult = await pool.query(
            `SELECT * FROM participants WHERE queue_id = $1 AND status = 'waiting' ORDER BY position ASC LIMIT 1`,
            [queue.id]
        );
        
        if (nextResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No participants waiting' });
        }
        
        const nextParticipant = nextResult.rows[0];
        
        await pool.query(
            `UPDATE participants SET status = 'served', served_at = NOW() WHERE id = $1`,
            [nextParticipant.id]
        );
        
        res.json({
            success: true,
            message: `Served: ${nextParticipant.name}`,
            served: { name: nextParticipant.name, position: nextParticipant.position }
        });
    } catch (error) {
        console.error('Serve error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ NEW: Delete queue
app.delete('/api/queues/:queueId', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM queues WHERE queue_id = $1 AND creator_email = $2',
            [req.params.queueId, req.user.email]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found or unauthorized' });
        }
        
        res.json({ success: true, message: 'Queue deleted' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==================== FRONTEND ROUTES ====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ERROR HANDLERS ====================
process.on('uncaughtException', (err) => console.error('❌ UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('❌ UNHANDLED REJECTION:', reason));
app.use((err, req, res, next) => {
    console.error('❌ Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ==================== START SERVER ====================
async function startServer() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║           🚀 LINKQUEUE BACKEND STARTUP                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    const connected = await initDatabaseConnection();
    if (connected) await initializeTables();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║     🎉 LINKQUEUE SERVER IS RUNNING SUCCESSFULLY!        ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log(`║  📡 API: http://0.0.0.0:${PORT}/api                        ║`);
        console.log(`║  🌐 Web: http://0.0.0.0:${PORT}                            ║`);
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log('║  🔑 Admin: admin@linkqueue.com / admin123                ║');
        console.log('║  👤 Demo:  demo@linkqueue.com / demo123                  ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log(`║  💾 Database: ${connected ? '✅ Connected' : '❌ Disconnected'}                               ║`);
        console.log('╚══════════════════════════════════════════════════════════╝\n');
    });
}

startServer().catch(error => {
    console.error('❌ Fatal error during startup:', error);
    process.exit(1);
});
