// ======================================================
// database.js
// ------------------------------------------------------
// MÓDULO DE BASE DE DATOS POSTGRESQL
// Reemplaza la versión anterior que usaba SQLite.
// Ahora utilizamos 'pg' (node-postgres) con Supabase.
//
// Estructura del archivo:
//   1. Creación del Pool de conexiones
//   2. initDb(): crea las tablas si no existen
//   3. seedData(): inserta datos de ejemplo si están vacías
//   4. setup(): inicializa BD y siembra datos
//   5. Exportación del Pool
//
// TABLAS:
//   users               - Usuarios (customer / admin)
//   pizzas              - Pizzas del menú
//   sizes               - Tamaños (Mediana, Grande...)
//   pizza_prices        - Precio por pizza + tamaño
//   toppings            - Ingredientes extra
//   orders              - Pedidos
//   order_items         - Líneas de cada pedido (pizzas)
//   order_item_toppings - Ingredientes de cada línea de pizza
//   bebidas             - Bebidas / acompañantes
//   order_bebidas       - Bebidas de cada pedido
//   password_resets     - Tokens para resetear contraseña
//   notifications       - Notificaciones por usuario
//   session             - Sesiones persistidas (creada por connect-pg-simple)
// ======================================================

// Importamos Pool desde 'pg' para manejar conexiones.
const { Pool } = require('pg');

// Creamos un pool de conexiones usando la URL de Supabase.
// La URL se lee desde el archivo .env (gracias a dotenv en server.js).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4
});

// ------------------------------------------------------
// FUNCIÓN: crear tablas si no existen
// ------------------------------------------------------
async function initDb() {
  // Todas las tablas se crean en una sola transacción para mayor eficiencia.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('customer','admin')) DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pizzas (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sizes (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pizza_prices (
      pizza_id INTEGER REFERENCES pizzas(id) ON DELETE CASCADE,
      size_id INTEGER REFERENCES sizes(id) ON DELETE CASCADE,
      base_price REAL NOT NULL,
      PRIMARY KEY (pizza_id, size_id)
    );

    CREATE TABLE IF NOT EXISTS toppings (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      extra_price REAL DEFAULT 0.50
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      pickup_time TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      payment_ref TEXT,
      payment_receipt TEXT,
      total REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      pizza_id INTEGER REFERENCES pizzas(id),
      size_id INTEGER REFERENCES sizes(id),
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_item_toppings (
      order_item_id INTEGER REFERENCES order_items(id) ON DELETE CASCADE,
      topping_id INTEGER REFERENCES toppings(id) ON DELETE CASCADE,
      PRIMARY KEY (order_item_id, topping_id)
    );

    CREATE TABLE IF NOT EXISTS bebidas (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS order_bebidas (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      bebida_id INTEGER REFERENCES bebidas(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('✅ Base de datos PostgreSQL inicializada');
}

// ------------------------------------------------------
// FUNCIÓN: insertar datos semilla solo si las tablas están vacías
// ------------------------------------------------------
async function seedData() {
  // Verificamos si ya hay tamaños insertados.
  const sizeCount = await pool.query('SELECT COUNT(*) FROM sizes');
  if (parseInt(sizeCount.rows[0].count) === 0) {
    // Insertamos tamaños
    await pool.query(`
      INSERT INTO sizes (id, label) VALUES
      (1, 'Mediana'),
      (2, 'Grande')
    `);

    // Insertamos pizzas
    await pool.query(`
      INSERT INTO pizzas (id, name, description, active) VALUES
      (1, 'Margarita', 'Salsa de tomate, mozzarella y albahaca', 1),
      (2, 'Pepperoni', 'Pepperoni y mozzarella', 1),
      (3, 'Hawaiana', 'Jamón, piña y mozzarella', 1),
      (4, 'Vegetariana', 'Pimiento, champiñones, aceitunas y mozzarella', 1)
    `);

    // Insertamos precios para cada pizza y tamaño
    await pool.query(`
      INSERT INTO pizza_prices (pizza_id, size_id, base_price) VALUES
      (1, 1, 8.5),
      (1, 2, 10.5),
      (2, 1, 9.5),
      (2, 2, 11.5),
      (3, 1, 10.0),
      (3, 2, 12.0),
      (4, 1, 9.0),
      (4, 2, 11.0)
    `);

    // Insertamos toppings
    await pool.query(`
      INSERT INTO toppings (id, name, extra_price) VALUES
      (1, 'Queso extra', 0.50),
      (2, 'Champiñones', 0.50),
      (3, 'Aceitunas', 0.50),
      (4, 'Pepperoni extra', 0.50)
    `);

    // Insertamos bebidas de ejemplo
    await pool.query(`
      INSERT INTO bebidas (id, name, price, active) VALUES
      (1, 'Coca-Cola 355ml', 2.50, 1),
      (2, 'Sprite 355ml', 2.50, 1),
      (3, 'Agua mineral 500ml', 1.50, 1),
      (4, 'Cerveza artesanal', 4.00, 1)
    `);

    console.log('✅ Datos semilla insertados');
  }
}

// ------------------------------------------------------
// FUNCIÓN PRINCIPAL: inicializar BD y sembrar datos
// ------------------------------------------------------
async function setup() {
  await initDb();
  await seedData();
}

// Ejecutamos la inicialización
setup();

// Exportamos el pool para que server.js pueda usarlo
module.exports = pool;