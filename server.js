const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==================== DATABASE CONNECTION ====================
let pool;

function initDatabaseConnection() {
    // Get connection string from environment variables
    const connectionString = process.env.DATABASE_URL || process.env.DB_URL;
    
    console.log('\n🔍 Database Configuration:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`DATABASE_URL set: ${connectionString ? '✅ Yes' : '❌ No'}`);
    console.log(`PORT: ${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    
    if (!connectionString) {
        console.error('\n❌ CRITICAL ERROR: DATABASE_URL environment variable is not set!');
        console.error('Please add DATABASE_URL to your Render environment variables.');
        console.error('Format: postgresql://username:password@host:5432/database\n');
        process.exit(1);
    }
    
    // Mask password for logging
    const maskedUrl = connectionString.replace(/:[^:@]+@/, ':****@');
    console.log(`Database URL: ${maskedUrl}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    pool = new Pool({
        connectionString: connectionString,
        ssl: {
            rejectUnauthorized: false  // Required for Render PostgreSQL
        },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 20
    });
    
    // Test the connection
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
        return true;
    } catch (err) {
        console.error('❌ Database Connection Failed:', err.message);
        console.error('   Please check:');
        console.error('   1. DATABASE_URL is correct');
        console.error('   2. Database is fully provisioned (status: available)');
        console.error('   3. Network access is allowed');
        return false;
    } finally {
        if (client) client.release();
    }
}

// ==================== DATABASE INITIALIZATION ====================
async function initializeTables() {
    const client = await pool.connect();
    try {
        console.log('📦 Creating database tables if not exist...');
        
        // Users table
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
        
        // Queues table
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
        console.log('  ✓ Queues table ready');
        
        // Participants table
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
        console.log('  ✓ Participants table ready');
        
        // Create indexes for performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_participants_queue_id ON participants(queue_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_queues_queue_id ON queues(queue_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_queues_creator_email ON queues(creator_email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_queues_status ON queues(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        console.log('  ✓ Indexes created');
        
        console.log('✅ All database tables ready\n');
        
    } catch (error) {
        console.error('❌ Table creation error:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function createDefaultUsers() {
    const client = await pool.connect();
    try {
        // Check if admin exists
        const adminCheck = await client.query('SELECT id FROM users WHERE email = $1', ['admin@linkqueue.com']);
        
        if (adminCheck.rows.length === 0) {
            console.log('📝 Creating default users...');
            
            const adminHash = await bcrypt.hash('admin123', 10);
            const userHash = await bcrypt.hash('demo123', 10);
            
            await client.query(
                `INSERT INTO users (user_id, name, email, password_hash, role) 
                 VALUES ($1, $2, $3, $4, $5)`,
                ['admin_001', 'Super Admin', 'admin@linkqueue.com', adminHash, 'admin']
            );
            
            await client.query(
                `INSERT INTO users (user_id, name, email, password_hash, role) 
                 VALUES ($1, $2, $3, $4, $5)`,
                ['user_001', 'Demo User', 'demo@linkqueue.com', userHash, 'user']
            );
            
            console.log('✅ Default users created:');
            console.log('   Admin: admin@linkqueue.com / admin123');
            console.log('   User:  demo@linkqueue.com / demo123\n');
        } else {
            console.log('✅ Default users already exist\n');
        }
    } catch (error) {
        console.error('❌ Error creating default users:', error);
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

// ==================== AUTHENTICATION ROUTES ====================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'LinkQueue API is running',
        timestamp: new Date().toISOString(),
        database: pool ? 'connected' : 'disconnected'
    });
});

// Register User
app.post('/api/register', async (req, res) => {
    console.log('📝 Register attempt:', req.body.email);
    
    try {
        const { name, email, password, role = 'user' } = req.body;
        
        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required' 
            });
        }
        
        if (password.length < 4) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 4 characters' 
            });
        }
        
        if (!email.includes('@')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid email address' 
            });
        }
        
        // Check if user exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email already registered' 
            });
        }
        
        // Create user
        const userId = generateId('user');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            `INSERT INTO users (user_id, name, email, password_hash, role) 
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, name, email.toLowerCase(), hashedPassword, role]
        );
        
        // Generate token
        const token = jwt.sign(
            { userId, email: email.toLowerCase(), name, role },
            process.env.JWT_SECRET || 'linkqueue_secret_key_2024',
            { expiresIn: '24h' }
        );
        
        console.log('✅ User registered:', email);
        
        res.json({
            success: true,
            message: 'Registration successful',
            token,
            user: { userId, name, email: email.toLowerCase(), role }
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error. Please try again.' 
        });
    }
});

// Login User
app.post('/api/login', async (req, res) => {
    console.log('🔐 Login attempt:', req.body.email);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password required' 
            });
        }
        
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        const token = jwt.sign(
            { userId: user.user_id, email: user.email, name: user.name, role: user.role },
            process.env.JWT_SECRET || 'linkqueue_secret_key_2024',
            { expiresIn: '24h' }
        );
        
        console.log('✅ User logged in:', email);
        
        res.json({
            success: true,
            message: `Welcome back, ${user.name}!`,
            token,
            user: { 
                userId: user.user_id, 
                name: user.name, 
                email: user.email, 
                role: user.role 
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error. Please try again.' 
        });
    }
});

// Verify token endpoint
app.get('/api/verify', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    
    res.json({ success: true, user: decoded });
});

// Logout (just clear client-side storage)
app.post('/api/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

// ==================== QUEUE ROUTES ====================

// Get user's queues
app.get('/api/my-queues', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    try {
        const result = await pool.query(
            `SELECT queue_id, name, description, expiry_hours, expires_at, status, created_at,
             (SELECT COUNT(*) FROM participants WHERE queue_id = queues.id AND status = 'waiting') as waiting_count
             FROM queues 
             WHERE creator_email = $1 
             ORDER BY created_at DESC`,
            [decoded.email]
        );
        
        res.json({ success: true, queues: result.rows });
    } catch (error) {
        console.error('Get queues error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Create queue
app.post('/api/queues', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    try {
        const { name, expiryHours = 2, description = '' } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ success: false, message: 'Queue name is required' });
        }
        
        const queueId = generateId('q');
        const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
        
        // Get user's database ID
        const userResult = await pool.query('SELECT id FROM users WHERE user_id = $1', [decoded.userId]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        await pool.query(
            `INSERT INTO queues (queue_id, creator_id, creator_email, name, description, expiry_hours, expires_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [queueId, userResult.rows[0].id, decoded.email, name.trim(), description.trim(), expiryHours, expiresAt]
        );
        
        console.log(`✅ Queue created: ${name} by ${decoded.email}`);
        
        res.json({
            success: true,
            message: 'Queue created successfully',
            queue: { queueId, name, description, expiryHours, expiresAt }
        });
        
    } catch (error) {
        console.error('Create queue error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get queue info
app.get('/api/queues/:queueId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT q.*, COUNT(p.id) as participant_count 
             FROM queues q 
             LEFT JOIN participants p ON q.id = p.queue_id AND p.status = 'waiting'
             WHERE q.queue_id = $1 
             GROUP BY q.id`,
            [req.params.queueId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found' });
        }
        
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
        console.error('Get queue error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Join queue
app.post('/api/queues/:queueId/join', async (req, res) => {
    try {
        const { name, email, phone, isGuest = true } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        
        // Check if queue exists and is active
        const queueResult = await pool.query(
            `SELECT * FROM queues 
             WHERE queue_id = $1 AND status = 'active' AND expires_at > NOW()`,
            [req.params.queueId]
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Queue not found or has expired' 
            });
        }
        
        const queue = queueResult.rows[0];
        
        // Check if already in queue (if email provided)
        if (email) {
            const existingResult = await pool.query(
                `SELECT id FROM participants 
                 WHERE queue_id = $1 AND email = $2 AND status = 'waiting'`,
                [queue.id, email.toLowerCase()]
            );
            
            if (existingResult.rows.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'You are already in this queue' 
                });
            }
        }
        
        // Get current position
        const positionResult = await pool.query(
            'SELECT COUNT(*) as count FROM participants WHERE queue_id = $1 AND status = $2',
            [queue.id, 'waiting']
        );
        const position = parseInt(positionResult.rows[0].count) + 1;
        
        // Add participant
        const participantId = generateId('p');
        
        await pool.query(
            `INSERT INTO participants 
             (participant_id, queue_id, queue_ref, name, email, phone, is_guest, position) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [participantId, queue.id, req.params.queueId, name.trim(), email ? email.toLowerCase() : null, phone || null, isGuest, position]
        );
        
        console.log(`✅ ${name} joined queue: ${queue.name} (Position: ${position})`);
        
        res.json({
            success: true,
            message: `Successfully joined ${queue.name}`,
            participant: { participantId, position, queueName: queue.name }
        });
        
    } catch (error) {
        console.error('Join queue error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get queue status with participants
app.get('/api/queues/:queueId/status', async (req, res) => {
    try {
        // Get queue info
        const queueResult = await pool.query(
            'SELECT * FROM queues WHERE queue_id = $1',
            [req.params.queueId]
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found' });
        }
        
        const queue = queueResult.rows[0];
        const isActive = new Date(queue.expires_at) > new Date() && queue.status === 'active';
        
        // Get participants
        const participantsResult = await pool.query(
            `SELECT participant_id, name, position, joined_at, is_guest 
             FROM participants 
             WHERE queue_id = $1 AND status = 'waiting' 
             ORDER BY position ASC`,
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
                totalParticipants: participantsResult.rows.length
            },
            participants: participantsResult.rows.map(p => ({
                participantId: p.participant_id,
                name: p.name,
                position: p.position,
                joinedAt: p.joined_at,
                isGuest: p.is_guest
            }))
        });
        
    } catch (error) {
        console.error('Queue status error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get participant position
app.get('/api/participants/:participantId/position', async (req, res) => {
    try {
        const participantResult = await pool.query(
            `SELECT p.*, q.name as queue_name, q.queue_id 
             FROM participants p 
             JOIN queues q ON p.queue_id = q.id 
             WHERE p.participant_id = $1 AND p.status = 'waiting'`,
            [req.params.participantId]
        );
        
        if (participantResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Not in queue or already served' 
            });
        }
        
        const participant = participantResult.rows[0];
        
        // Count people ahead
        const aheadResult = await pool.query(
            `SELECT COUNT(*) as count 
             FROM participants 
             WHERE queue_id = $1 AND position < $2 AND status = 'waiting'`,
            [participant.queue_id, participant.position]
        );
        
        // Count people behind
        const behindResult = await pool.query(
            `SELECT COUNT(*) as count 
             FROM participants 
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

// Serve next participant (queue owner only)
app.post('/api/queues/:queueId/serve', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    try {
        // Verify ownership
        const queueResult = await pool.query(
            'SELECT * FROM queues WHERE queue_id = $1 AND creator_email = $2',
            [req.params.queueId, decoded.email]
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Queue not found or you are not the owner' 
            });
        }
        
        const queue = queueResult.rows[0];
        
        // Get next participant
        const nextResult = await pool.query(
            `SELECT * FROM participants 
             WHERE queue_id = $1 AND status = 'waiting' 
             ORDER BY position ASC LIMIT 1`,
            [queue.id]
        );
        
        if (nextResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'No participants waiting' 
            });
        }
        
        const nextParticipant = nextResult.rows[0];
        
        // Mark as served
        await pool.query(
            `UPDATE participants 
             SET status = 'served', served_at = NOW() 
             WHERE id = $1`,
            [nextParticipant.id]
        );
        
        console.log(`✅ Served: ${nextParticipant.name} from queue: ${queue.name}`);
        
        res.json({
            success: true,
            message: `Served: ${nextParticipant.name}`,
            served: { name: nextParticipant.name, position: nextParticipant.position }
        });
        
    } catch (error) {
        console.error('Serve next error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete queue
app.delete('/api/queues/:queueId', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    try {
        const result = await pool.query(
            'DELETE FROM queues WHERE queue_id = $1 AND creator_email = $2',
            [req.params.queueId, decoded.email]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Queue not found or you are not the owner' 
            });
        }
        
        console.log(`✅ Queue deleted: ${req.params.queueId} by ${decoded.email}`);
        
        res.json({ success: true, message: 'Queue deleted successfully' });
        
    } catch (error) {
        console.error('Delete queue error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==================== SERVER STARTUP ====================
async function startServer() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║           🚀 LINKQUEUE BACKEND STARTUP                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    // Step 1: Initialize database connection
    const connected = await initDatabaseConnection();
    if (!connected) {
        console.error('❌ Cannot start server without database connection');
        process.exit(1);
    }
    
    // Step 2: Create tables
    try {
        await initializeTables();
    } catch (error) {
        console.error('❌ Failed to initialize tables:', error.message);
        process.exit(1);
    }
    
    // Step 3: Create default users
    await createDefaultUsers();
    
    // Step 4: Start Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║     🎉 LINKQUEUE SERVER IS RUNNING SUCCESSFULLY!        ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log(`║  📡 API URL:      http://localhost:${PORT}/api              ║`);
        console.log(`║  🌐 Web URL:      http://localhost:${PORT}                  ║`);
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log('║  🔑 TEST CREDENTIALS:                                    ║');
        console.log('║     Admin Email: admin@linkqueue.com                     ║');
        console.log('║     Admin Password: admin123                             ║');
        console.log('║                                                         ║');
        console.log('║     User Email: demo@linkqueue.com                       ║');
        console.log('║     User Password: demo123                               ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log('║  💾 Database: PostgreSQL (Render)                        ║');
        console.log('║  🟢 Status: ONLINE                                       ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');
    });
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('\n📴 Received SIGTERM, closing server...');
        server.close(async () => {
            console.log('📴 Server closed');
            await pool.end();
            console.log('📴 Database pool closed');
            process.exit(0);
        });
    });
}

// Start the application
startServer().catch(error => {
    console.error('❌ Fatal error during startup:', error);
    process.exit(1);
});
