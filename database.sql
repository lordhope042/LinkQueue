CREATE DATABASE IF NOT EXISTS linkqueue_db;
USE linkqueue_db;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'creator') DEFAULT 'creator',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE queues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    queue_name VARCHAR(100) NOT NULL,
    queue_key VARCHAR(50) UNIQUE NOT NULL,
    creator_id INT,
    status ENUM('active', 'ended') DEFAULT 'active',
    current_position INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE queue_participants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    queue_id INT,
    participant_name VARCHAR(100),
    participant_email VARCHAR(100),
    is_guest BOOLEAN DEFAULT TRUE,
    position INT NOT NULL,
    status ENUM('waiting', 'served', 'left') DEFAULT 'waiting',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE
);