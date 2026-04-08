# 🚀 Linkqueue Backend

A queue management backend built with Node.js, Express, and PostgreSQL. Designed for deployment on Render.

---

## 📦 Features

* Queue creation & management
* User authentication (JWT-based)
* Expiry handling
* REST API structure

---

## 🛠 Tech Stack

* Node.js
* Express.js
* PostgreSQL
* JWT Authentication

---

## ⚙️ Setup (Local Development)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/linkqueue-backend.git
cd linkqueue-backend
```

---

### 2. Install dependencies

```bash
npm install
```

---

### 3. Create `.env` file

```env
DATABASE_URL=your_database_url
JWT_SECRET=your_super_secret_key
PORT=3000
```

---

### 4. Start the server

```bash
npm start
```

---

## 🗄 Database Setup (PostgreSQL)

Run this SQL:

```sql
CREATE TABLE IF NOT EXISTS queues (
    id SERIAL PRIMARY KEY,
    queue_id VARCHAR(100) UNIQUE NOT NULL,
    creator_id INT NOT NULL,
    creator_email VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    expiry_hours INT DEFAULT 2,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## ☁️ Deployment (Render)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/your-username/linkqueue-backend.git
git push -u origin main
```

---

### 2. Create a Web Service on Render

* Connect your GitHub repo
* Select **Node**
* Build Command:

```bash
npm install
```

* Start Command:

```bash
npm start
```

---

### 3. Add Environment Variables in Render

```
DATABASE_URL=your_render_database_url
JWT_SECRET=your_generated_secret
PORT=3000
```

---

### 4. Attach PostgreSQL Database

* Create PostgreSQL on Render
* Copy **External Database URL**
* Paste into `DATABASE_URL`

---

## 🔐 JWT Secret

Generate a secure key:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 📡 API Base URL

```
http://localhost:3000
```

or (after deploy):

```
https://your-app.onrender.com
```

---

## ⚠️ Important Notes

* Do NOT commit `.env`
* Always use environment variables in production
* Ensure PostgreSQL is fully ready before connecting

---

## 🧪 Testing

Use:

* Postman
* Thunder Client (VS Code)

---

## 📄 License

MIT

---

## 👨‍💻 Author

HOPE CHIKAMSO OKECHUKWU