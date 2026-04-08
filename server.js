const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { pool, initializeDatabase, formatQuery } = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper function
function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ============= API ROUTES =============

// Register User
app.post('/api/register', async (req, res) => {
    console.log('📝 Register request:', req.body.email);
    
    try {
        const { name, email, password, role = 'user' } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        
        if (password.length < 4) {
            return res.status(400).json({ success: false, message: 'Password must be at least 4 characters' });
        }
        
        // Check if user exists
        const [existing] = await pool.query(
            'SELECT id FROM users WHERE email = $1', [email]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        
        const userId = generateId('user');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            'INSERT INTO users (user_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
            [userId, name, email, hashedPassword, role]
        );
        
        const token = jwt.sign(
            { userId, email, name, role },
            process.env.JWT_SECRET || 'linkqueue_secret_key_2024',
            { expiresIn: '24h' }
        );
        
        console.log('✅ User registered:', email);
        
        res.json({
            success: true,
            message: 'Registration successful',
            token,
            user: { userId, name, email, role }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// Login User
app.post('/api/login', async (req, res) => {
    console.log('🔐 Login request:', req.body.email);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }
        
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1', [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
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
            user: { userId: user.user_id, name: user.name, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// Authentication check endpoint
app.get('/api/check-auth', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'linkqueue_secret_key_2024');
        res.json({ success: true, user: decoded });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

// Get My Queues
app.get('/api/my-queues', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'linkqueue_secret_key_2024');
        const result = await pool.query(
            `SELECT queue_id, name, description, expiry_hours, expires_at, status, created_at,
             (SELECT COUNT(*) FROM participants WHERE queue_id = queues.id AND status = 'waiting') as waiting_count
             FROM queues 
             WHERE creator_email = $1 
             ORDER BY created_at DESC`,
            [decoded.email]
        );
        
        res.json({ success: true, queues: result.rows || [] });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

// Create Queue
app.post('/api/queues', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'linkqueue_secret_key_2024');
        const { name, expiryHours = 2, description = '' } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, message: 'Queue name required' });
        }
        
        const queueId = generateId('q');
        const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
        
        const userResult = await pool.query(
            'SELECT id FROM users WHERE user_id = $1', [decoded.userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        await pool.query(
            `INSERT INTO queues (queue_id, creator_id, creator_email, name, description, expiry_hours, expires_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [queueId, userResult.rows[0].id, decoded.email, name, description, expiryHours, expiresAt]
        );
        
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

// Get Queue Info
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

// Join Queue
app.post('/api/queues/:queueId/join', async (req, res) => {
    try {
        const { name, email, phone, isGuest = true } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        
        const queueResult = await pool.query(
            'SELECT * FROM queues WHERE queue_id = $1 AND status = $2 AND expires_at > NOW()',
            [req.params.queueId, 'active']
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found or expired' });
        }
        
        const queue = queueResult.rows[0];
        
        // Check if already in queue
        if (email) {
            const existingResult = await pool.query(
                'SELECT id FROM participants WHERE queue_id = $1 AND email = $2 AND status = $3',
                [queue.id, email, 'waiting']
            );
            if (existingResult.rows.length > 0) {
                return res.status(400).json({ success: false, message: 'Already in this queue' });
            }
        }
        
        // Get current position
        const positionResult = await pool.query(
            'SELECT COUNT(*) as count FROM participants WHERE queue_id = $1 AND status = $2',
            [queue.id, 'waiting']
        );
        const position = parseInt(positionResult.rows[0].count) + 1;
        
        const participantId = generateId('p');
        
        await pool.query(
            `INSERT INTO participants (participant_id, queue_id, queue_ref, name, email, phone, is_guest, position) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [participantId, queue.id, req.params.queueId, name, email || null, phone || null, isGuest, position]
        );
        
        res.json({
            success: true,
            message: `Joined ${queue.name} successfully`,
            participant: { participantId, position, queueName: queue.name }
        });
    } catch (error) {
        console.error('Join queue error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Queue Status
app.get('/api/queues/:queueId/status', async (req, res) => {
    try {
        const queueResult = await pool.query(
            'SELECT * FROM queues WHERE queue_id = $1',
            [req.params.queueId]
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found' });
        }
        
        const queue = queueResult.rows[0];
        const isActive = new Date(queue.expires_at) > new Date() && queue.status === 'active';
        
        const participantsResult = await pool.query(
            `SELECT participant_id, name, position, joined_at, is_guest 
             FROM participants 
             WHERE queue_id = $1 AND status = $2 
             ORDER BY position ASC`,
            [queue.id, 'waiting']
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

// Get Participant Position
app.get('/api/participants/:participantId/position', async (req, res) => {
    try {
        const participantResult = await pool.query(
            `SELECT p.*, q.name as queue_name, q.queue_id 
             FROM participants p 
             JOIN queues q ON p.queue_id = q.id 
             WHERE p.participant_id = $1 AND p.status = $2`,
            [req.params.participantId, 'waiting']
        );
        
        if (participantResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Not in queue or already served' });
        }
        
        const participant = participantResult.rows[0];
        
        const aheadResult = await pool.query(
            'SELECT COUNT(*) as count FROM participants WHERE queue_id = $1 AND position < $2 AND status = $3',
            [participant.queue_id, participant.position, 'waiting']
        );
        
        const behindResult = await pool.query(
            'SELECT COUNT(*) as count FROM participants WHERE queue_id = $1 AND position > $2 AND status = $3',
            [participant.queue_id, participant.position, 'waiting']
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

// Serve Next (for queue creators)
app.post('/api/queues/:queueId/serve', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'linkqueue_secret_key_2024');
        
        const queueResult = await pool.query(
            'SELECT * FROM queues WHERE queue_id = $1 AND creator_email = $2',
            [req.params.queueId, decoded.email]
        );
        
        if (queueResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found or unauthorized' });
        }
        
        const queue = queueResult.rows[0];
        
        const nextResult = await pool.query(
            `SELECT * FROM participants 
             WHERE queue_id = $1 AND status = $2 
             ORDER BY position ASC LIMIT 1`,
            [queue.id, 'waiting']
        );
        
        if (nextResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No participants in queue' });
        }
        
        const nextParticipant = nextResult.rows[0];
        
        await pool.query(
            'UPDATE participants SET status = $1, served_at = NOW() WHERE id = $2',
            ['served', nextParticipant.id]
        );
        
        res.json({
            success: true,
            message: `Served: ${nextParticipant.name}`,
            served: { name: nextParticipant.name, position: nextParticipant.position }
        });
    } catch (error) {
        console.error('Serve next error:', error);
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

// Delete Queue
app.delete('/api/queues/:queueId', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'linkqueue_secret_key_2024');
        
        const result = await pool.query(
            'DELETE FROM queues WHERE queue_id = $1 AND creator_email = $2',
            [req.params.queueId, decoded.email]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Queue not found' });
        }
        
        res.json({ success: true, message: 'Queue deleted successfully' });
    } catch (error) {
        console.error('Delete queue error:', error);
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
    res.json({ success: true, message: 'Logged out' });
});

// Start server
async function startServer() {
    try {
        // Initialize database tables
        await initializeDatabase();
        
        // Check if default admin exists
        const adminCheck = await pool.query(
            'SELECT id FROM users WHERE email = $1', ['admin@linkqueue.com']
        );
        
        if (adminCheck.rows.length === 0) {
            const adminHash = await bcrypt.hash('admin123', 10);
            const userHash = await bcrypt.hash('demo123', 10);
            
            await pool.query(
                'INSERT INTO users (user_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
                ['admin_001', 'Super Admin', 'admin@linkqueue.com', adminHash, 'admin']
            );
            await pool.query(
                'INSERT INTO users (user_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
                ['user_001', 'Demo User', 'demo@linkqueue.com', userHash, 'user']
            );
            console.log('✅ Default users created');
        }
        
        // Start server
        app.listen(PORT, () => {
            console.log(`\n╔══════════════════════════════════════════════════╗`);
            console.log(`║     🚀 LinkQueue Server is Running!            ║`);
            console.log(`╠══════════════════════════════════════════════════╣`);
            console.log(`║  📡 API: http://localhost:${PORT}/api              ║`);
            console.log(`║  🌐 Web: http://localhost:${PORT}                  ║`);
            console.log(`╠══════════════════════════════════════════════════╣`);
            console.log(`║  📝 Test Credentials:                            ║`);
            console.log(`║     Admin: admin@linkqueue.com / admin123        ║`);
            console.log(`║     User:  demo@linkqueue.com / demo123          ║`);
            console.log(`╠══════════════════════════════════════════════════╣`);
            console.log(`║  💾 Database: PostgreSQL                         ║`);
            console.log(`╚══════════════════════════════════════════════════╝\n`);
        });
    } catch (error) {
        console.error('❌ Server startup failed:', error.message);
        process.exit(1);
    }
}

startServer();