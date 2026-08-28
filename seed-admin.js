const bcrypt = require('bcryptjs');
const db = require('./database');

const email = 'admin@pizzeria.com';
const plainPassword = 'admin123';
const hash = bcrypt.hashSync(plainPassword, 10);

const stmt = db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
stmt.run('Administrador', email, hash, 'admin');

console.log('Usuario admin creado: ' + email + ' / contraseña: ' + plainPassword);