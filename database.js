const Database = require('better-sqlite3');
const db = new Database('pizzeria.db');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('customer', 'admin')) DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pizzas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
  );

  -- Tamaños: solo guardamos la etiqueta, sin multiplicador
  CREATE TABLE IF NOT EXISTS sizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL
  );

  -- Precios fijos por pizza y tamaño
  CREATE TABLE IF NOT EXISTS pizza_prices (
    pizza_id INTEGER NOT NULL,
    size_id INTEGER NOT NULL,
    base_price REAL NOT NULL,
    PRIMARY KEY (pizza_id, size_id),
    FOREIGN KEY (pizza_id) REFERENCES pizzas(id) ON DELETE CASCADE,
    FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS toppings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    extra_price REAL NOT NULL DEFAULT 0.50
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    pickup_time TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    payment_ref TEXT,
    payment_receipt TEXT,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    pizza_id INTEGER NOT NULL,
    size_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    line_total REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (pizza_id) REFERENCES pizzas(id),
    FOREIGN KEY (size_id) REFERENCES sizes(id)
  );

  CREATE TABLE IF NOT EXISTS order_item_toppings (
    order_item_id INTEGER NOT NULL,
    topping_id INTEGER NOT NULL,
    PRIMARY KEY (order_item_id, topping_id),
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    FOREIGN KEY (topping_id) REFERENCES toppings(id) ON DELETE CASCADE
  );

  -- Bebidas
  CREATE TABLE IF NOT EXISTS bebidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
  );

  -- Bebidas incluidas en un pedido
  CREATE TABLE IF NOT EXISTS order_bebidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    bebida_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    line_total REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (bebida_id) REFERENCES bebidas(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
`);

// Datos semilla
const insertSize = db.prepare('INSERT OR IGNORE INTO sizes (id, label) VALUES (?, ?)');
insertSize.run(1, 'Mediana');
insertSize.run(2, 'Grande');

const insertPizza = db.prepare('INSERT OR IGNORE INTO pizzas (id, name, description, active) VALUES (?, ?, ?, 1)');
insertPizza.run(1, 'Margarita', 'Salsa de tomate, mozzarella y albahaca');
insertPizza.run(2, 'Pepperoni', 'Pepperoni y mozzarella');
insertPizza.run(3, 'Hawaiana', 'Jamón, piña y mozzarella');
insertPizza.run(4, 'Vegetariana', 'Pimiento, champiñones, aceitunas y mozzarella');

// Precios fijos (sin multiplicador)
const insertPrice = db.prepare(`
  INSERT OR IGNORE INTO pizza_prices (pizza_id, size_id, base_price)
  VALUES (?, ?, ?)
`);
// Margarita
insertPrice.run(1, 1, 8.5);   // Mediana
insertPrice.run(1, 2, 10.5);  // Grande
// Pepperoni
insertPrice.run(2, 1, 9.5);
insertPrice.run(2, 2, 11.5);
// Hawaiana
insertPrice.run(3, 1, 10.0);
insertPrice.run(3, 2, 12.0);
// Vegetariana
insertPrice.run(4, 1, 9.0);
insertPrice.run(4, 2, 11.0);

// Toppings
const insertTopping = db.prepare('INSERT OR IGNORE INTO toppings (id, name, extra_price) VALUES (?, ?, ?)');
insertTopping.run(1, 'Queso extra', 0.50);
insertTopping.run(2, 'Champiñones', 0.50);
insertTopping.run(3, 'Aceitunas', 0.50);
insertTopping.run(4, 'Pepperoni extra', 0.50);

// Insertar bebidas de ejemplo
const insertBebida = db.prepare('INSERT OR IGNORE INTO bebidas (id, name, price, active) VALUES (?, ?, ?, 1)');
insertBebida.run(1, 'Coca-Cola 355ml', 2.50);
insertBebida.run(2, 'Sprite 355ml', 2.50);
insertBebida.run(3, 'Agua mineral 500ml', 1.50);
insertBebida.run(4, 'Cerveza artesanal', 4.00);

console.log('✅ Base de datos actualizada: solo tamaños Mediana y Grande con precios fijos.');

module.exports = db;