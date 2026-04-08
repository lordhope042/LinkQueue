// Global variables
let currentUser = null;
let currentQueueKey = null;
let currentParticipantId = null;
let refreshInterval = null;

// Check authentication on load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    
    // Check if on queue page with key param
    const urlParams = new URLSearchParams(window.location.search);
    const queueKey = urlParams.get('key');
    if (queueKey && window.location.pathname.includes('queue.html')) {
        joinQueueAsParticipant(queueKey);
    }
});

async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            updateUIForAuth();
            
            if (window.location.pathname.includes('dashboard.html')) {
                loadMyQueues();
            }
        } else {
            if (window.location.pathname.includes('dashboard.html')) {
                window.location.href = 'index.html';
            }
        }
    } catch (err) {
        console.error('Auth check failed:', err);
    }
}

function updateUIForAuth() {
    const authLink = document.getElementById('authLink');
    if (authLink) {
        if (currentUser) {
            authLink.textContent = currentUser.username;
            authLink.href = 'dashboard.html';
        } else {
            authLink.textContent = 'Login';
            authLink.href = '#';
        }
    }
}

function setupEventListeners() {
    // Login/Register modals
    const loginModal = document.getElementById('loginModal');
    const registerModal = document.getElementById('registerModal');
    const joinModal = document.getElementById('joinQueueModal');
    
    if (document.getElementById('authLink')) {
        document.getElementById('authLink').addEventListener('click', (e) => {
            e.preventDefault();
            if (!currentUser) showModal('loginModal');
        });
    }
    
    if (document.getElementById('joinQueueBtn')) {
        document.getElementById('joinQueueBtn').addEventListener('click', () => {
            showModal('joinQueueModal');
        });
    }
    
    if (document.getElementById('showRegister')) {
        document.getElementById('showRegister').addEventListener('click', (e) => {
            e.preventDefault();
            hideModal('loginModal');
            showModal('registerModal');
        });
    }
    
    if (document.getElementById('showLogin')) {
        document.getElementById('showLogin').addEventListener('click', (e) => {
            e.preventDefault();
            hideModal('registerModal');
            showModal('loginModal');
        });
    }
    
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            if (response.ok) {
                hideModal('loginModal');
                checkAuth();
                window.location.href = 'dashboard.html';
            } else {
                alert('Login failed');
            }
        });
    }
    
    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('regUsername').value;
            const email = document.getElementById('regEmail').value;
            const password = document.getElementById('regPassword').value;
            
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            
            if (response.ok) {
                alert('Registration successful! Please login.');
                hideModal('registerModal');
                showModal('loginModal');
            } else {
                alert('Registration failed');
            }
        });
    }
    
    // Join queue form
    const joinForm = document.getElementById('joinQueueForm');
    if (joinForm) {
        joinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const queueKey = document.getElementById('queueKey').value.trim();
            const name = document.getElementById('participantName').value;
            const email = document.getElementById('participantEmail').value;
            
            // Extract key from URL if full link provided
            let key = queueKey;
            if (queueKey.includes('queue.html?key=')) {
                key = queueKey.split('key=')[1];
            }
            
            const response = await fetch(`/api/queue/${key}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email })
            });
            
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('participantId', data.participantId);
                localStorage.setItem('queueKey', key);
                window.location.href = `queue.html?key=${key}&participant=${data.participantId}`;
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to join queue');
            }
        });
    }
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = 'index.html';
        });
    }
    
    // Create queue button
    const createBtn = document.getElementById('createQueueBtn');
    if (createBtn) {
        createBtn.addEventListener('click', () => showModal('createQueueModal'));
    }
    
    // Create queue form
    const createForm = document.getElementById('createQueueForm');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const queueName = document.getElementById('queueName').value;
            
            const response = await fetch('/api/queues', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queue_name: queueName })
            });
            
            if (response.ok) {
                hideModal('createQueueModal');
                loadMyQueues();
                document.getElementById('queueName').value = '';
            } else {
                alert('Failed to create queue');
            }
        });
    }
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

// Close modals when clicking close button
document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
        closeBtn.closest('.modal').style.display = 'none';
    });
});

window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

// Dashboard functions
async function loadMyQueues() {
    const container = document.getElementById('queuesList');
    if (!container) return;
    
    try {
        const response = await fetch('/api/my-queues');
        if (!response.ok) throw new Error('Failed to load queues');
        
        const data = await response.json();
        
        if (data.queues.length === 0) {
            container.innerHTML = '<div class="loading">No queues yet. Create your first queue!</div>';
            return;
        }
        
        container.innerHTML = data.queues.map(queue => `
            <div class="queue-card" onclick="showQueueDetail('${queue.queue_key}')">
                <h3>${escapeHtml(queue.queue_name)}</h3>
                <p>Participants: ${queue.participant_count || 0}</p>
                <p>Created: ${new Date(queue.created_at).toLocaleDateString()}</p>
                <span class="status ${queue.status}">${queue.status}</span>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<div class="loading">Error loading queues</div>';
    }
}

async function showQueueDetail(queueKey) {
    currentQueueKey = queueKey;
    
    // Fetch queue details and participants
    const [queueRes, participantsRes] = await Promise.all([
        fetch(`/api/queue/${queueKey}`),
        fetch(`/api/queue/${queueKey}/participants`)
    ]);
    
    if (queueRes.ok && participantsRes.ok) {
        const queueData = await queueRes.json();
        const participantsData = await participantsRes.json();
        
        document.getElementById('detailQueueName').textContent = queueData.queue.queue_name;
        document.getElementById('shareLink').value = `${window.location.origin}/queue.html?key=${queueKey}`;
        
        const participantsList = document.getElementById('participantsList');
        if (participantsData.participants.length === 0) {
            participantsList.innerHTML = '<div class="loading">No participants waiting</div>';
        } else {
            participantsList.innerHTML = participantsData.participants.map(p => `
                <div class="participant-item">
                    <span class="participant-position">#${p.position}</span>
                    <span>${escapeHtml(p.participant_name)}</span>
                    <span>${p.is_guest ? '👤 Guest' : '📧 Registered'}</span>
                </div>
            `).join('');
        }
        
        // Setup next button
        const nextBtn = document.getElementById('nextBtn');
        nextBtn.onclick = async () => {
            const response = await fetch(`/api/queue/${queueKey}/next`, { method: 'POST' });
            if (response.ok) {
                showQueueDetail(queueKey); // Refresh
            }
        };
        
        // Setup end queue button
        const endBtn = document.getElementById('endQueueBtn');
        endBtn.onclick = async () => {
            if (confirm('End this queue? No more participants can join.')) {
                await fetch(`/api/queue/${queueKey}/end`, { method: 'POST' });
                showQueueDetail(queueKey);
                loadMyQueues();
            }
        };
        
        showModal('queueDetailModal');
    }
}

// Participant queue page
async function joinQueueAsParticipant(queueKey) {
    const urlParams = new URLSearchParams(window.location.search);
    let participantId = urlParams.get('participant');
    
    // If no participant ID, show join form
    if (!participantId) {
        const savedId = localStorage.getItem('participantId');
        const savedKey = localStorage.getItem('queueKey');
        if (savedId && savedKey === queueKey) {
            participantId = savedId;
        } else {
            // Show join form instead
            document.getElementById('queueInfo').innerHTML = `
                <h2>Join Queue</h2>
                <form id="quickJoinForm">
                    <input type="text" placeholder="Your Name" id="quickName" required>
                    <input type="email" placeholder="Email (optional)" id="quickEmail">
                    <button type="submit" class="btn btn-primary">Join Queue</button>
                </form>
            `;
            
            document.getElementById('quickJoinForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = document.getElementById('quickName').value;
                const email = document.getElementById('quickEmail').value;
                
                const response = await fetch(`/api/queue/${queueKey}/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    window.location.href = `queue.html?key=${queueKey}&participant=${data.participantId}`;
                } else {
                    alert('Failed to join queue');
                }
            });
            return;
        }
    }
    
    currentParticipantId = participantId;
    
    // Load queue info
    async function updatePosition() {
        const response = await fetch(`/api/queue/${queueKey}/position/${participantId}`);
        if (response.ok) {
            const data = await response.json();
            
            document.getElementById('queueName').textContent = data.queueName;
            document.getElementById('positionNumber').textContent = data.position;
            document.getElementById('waitTime').textContent = data.estimatedMinutes < 60 
                ? `${data.estimatedMinutes} minutes` 
                : 'Less than a minute';
            document.getElementById('peopleAhead').textContent = data.peopleAhead;
            document.getElementById('currentServing').textContent = data.currentServing;
            
            if (data.status === 'served') {
                document.getElementById('statusMessage').innerHTML = '✅ You have been served! Thank you for using LinkQueue.';
                document.getElementById('statusMessage').className = 'status-message served';
                if (refreshInterval) clearInterval(refreshInterval);
            } else if (data.position === data.currentServing) {
                document.getElementById('statusMessage').innerHTML = '🔔 It\'s your turn! Please proceed.';
            } else {
                document.getElementById('statusMessage').innerHTML = '';
            }
        } else {
            document.getElementById('queueInfo').innerHTML = '<h2>Queue not found or expired</h2>';
            if (refreshInterval) clearInterval(refreshInterval);
        }
    }
    
    await updatePosition();
    refreshInterval = setInterval(updatePosition, 5000);
}

function copyLink() {
    const linkInput = document.getElementById('shareLink');
    linkInput.select();
    document.execCommand('copy');
    alert('Link copied to clipboard!');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}