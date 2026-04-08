// API Service for Frontend
const API_BASE = 'http://localhost:3000/api';

class LinkQueueAPI {
    constructor() {
        this.token = localStorage.getItem('auth_token');
    }

    setToken(token) {
        this.token = token;
        if (token) {
            localStorage.setItem('auth_token', token);
        } else {
            localStorage.removeItem('auth_token');
        }
    }

    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Request failed');
        }
        return data;
    }

    // Auth
    async register(name, email, password, role = 'user') {
        return this.request('/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password, role })
        });
    }

    async login(email, password) {
        const result = await this.request('/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        if (result.token) {
            this.setToken(result.token);
        }
        return result;
    }

    async logout() {
        await this.request('/logout', { method: 'POST' });
        this.setToken(null);
    }

    // Queues
    async createQueue(name, expiryHours, description) {
        return this.request('/queues', {
            method: 'POST',
            body: JSON.stringify({ name, expiryHours, description })
        });
    }

    async getQueueInfo(queueId) {
        return this.request(`/queues/${queueId}`);
    }

    async joinQueue(queueId, name, email, phone, isGuest = true) {
        return this.request(`/queues/${queueId}/join`, {
            method: 'POST',
            body: JSON.stringify({ name, email, phone, isGuest })
        });
    }

    async getQueueStatus(queueId) {
        return this.request(`/queues/${queueId}/status`);
    }

    async getMyPosition(participantId) {
        return this.request(`/participants/${participantId}/position`);
    }

    async getMyQueues() {
        return this.request('/my-queues');
    }

    async serveNext(queueId) {
        return this.request(`/queues/${queueId}/serve`, { method: 'POST' });
    }

    async deleteQueue(queueId) {
        return this.request(`/queues/${queueId}`, { method: 'DELETE' });
    }

    // Admin
    async getAllQueues() {
        return this.request('/admin/queues');
    }
}

const api = new LinkQueueAPI();