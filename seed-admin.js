// ======================================================
// seed-admin.js
// ------------------------------------------------------
// Script utilitario para crear el usuario administrador
// por defecto en la base de datos PostgreSQL.
//
// Uso:
//   node seed-admin.js
//
// NOTA: Este script fue migrado de SQLite a PostgreSQL.
// Antes usaba db.prepare()/stmt.run() (API de better-sqlite3)
// que ya no existe porque el proyecto ahora usa el módulo
// 'pg'. Ahora utiliza consultas parametrizadas ($1, $2...).
// ======================================================

const bcrypt = require('bcryptjs');
const db = require('./database'); // Pool de conexiones PostgreSQL

// Credenciales del administrador por defecto.
const email = 'admin@pizzeria.com';
const plainPassword = 'admin123';

async function seedAdmin() {
  try {
    // Generamos el hash de la contraseña con bcrypt (10 rondas).
    const hash = bcrypt.hashSync(plainPassword, 10);

    // Insertamos el admin SOLO si el correo aún no existe.
    // ON CONFLICT DO NOTHING evita duplicados si el script se ejecuta dos veces.
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      ['Administrador', email, hash, 'admin']
    );

    if (result.rows.length > 0) {
      console.log('✅ Usuario admin creado: ' + email + ' / contraseña: ' + plainPassword);
    } else {
      console.log('ℹ️  El usuario admin ya existía (' + email + '). No se modificó.');
    }
  } catch (err) {
    console.error('❌ Error al crear el usuario admin:', err);
    process.exit(1);
  } finally {
    // Cerramos el pool para que el proceso pueda terminar.
    await db.end();
  }
}

// Ejecutamos el script.
seedAdmin();
