const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const flash = require('connect-flash');
const db = require('./database');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// Configurar multer para guardar imágenes de comprobantes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB máximo
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPEG, PNG, WEBP)'));
    }
  }
});

const paymentInfo = {
  'Pago móvil': {
    title: 'Pago móvil',
    instructions: [
      'Banco: BBVA Provincial',
      'Teléfono: 0412-5551212',
      'Cédula: V-12345678',
      'Envíe el pago al número indicado y luego ingrese la referencia.'
    ]
  },
  'Transferencia bancaria': {
    title: 'Transferencia bancaria',
    instructions: [
      'Banco: Banesco',
      'Cuenta corriente: 0134-0000-0000-0000-0000',
      'Titular: Bella Napoli C.A.',
      'RIF: J-12345678-9',
      'Realice la transferencia y use el número de referencia del banco.'
    ]
  },
  'Zelle': {
    title: 'Zelle',
    instructions: [
      'Correo: pagos@bellanapoli.com',
      'Titular: Bella Napoli C.A.',
      'Envíe el pago a ese correo y capture la confirmación.'
    ]
  },
  'Binance': {
    title: 'Binance',
    instructions: [
      'ID de usuario: 123456789',
      'Correo: pagos@bellanapoli.com',
      'Transfiera USDT y guarde el comprobante.'
    ]
  }
};

// Asegurar que la carpeta uploads existe
const fs = require('fs');
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  // Cuando el cliente envía su user_id, unirse a la sala personal
  socket.on('register_user', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      socket.data.userId = userId;
    }
  });
});

const PORT = process.env.PORT || 3000;

// Configurar motor de plantillas EJS
app.set('view engine', 'ejs');

// Middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

const csrfProtection = csrf({ cookie: true });

app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (req.method === 'POST' && contentType.startsWith('multipart/form-data')) {
    return next();
  }
  csrfProtection(req, res, next);
});
app.use(flash());
app.use(express.static('public'));

// Configurar sesiones
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 día de duración
}));

// Middleware para pasar el usuario actual a todas las vistas
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use((req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    const count = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;
    res.locals.pendingOrdersCount = count;
  } else {
    res.locals.pendingOrdersCount = 0;
  }
  next();
});

app.use((req, res, next) => {
  if (typeof req.csrfToken === 'function') {
    res.locals.csrfToken = req.csrfToken();
  }
  next();
});

app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  // Para vistas que aún usan 'message'
  res.locals.message = res.locals.success_msg[0] || res.locals.error_msg[0] || null;
  next();
});

// Función helper: verificar si hay sesión activa
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// -------------------------------------------------------
// RUTAS DE AUTENTICACIÓN
// -------------------------------------------------------

// Registro (GET)
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// Registro (POST)
app.post('/register', (req, res) => {
  const { name, email, password, password2 } = req.body;

  // Validaciones básicas
  if (!name || !email || !password || !password2) {
    return res.render('register', { error: 'Todos los campos son obligatorios.' });
  }

  // Validar nombre (solo letras y números, sin espacios ni caracteres especiales)
  const nameRegex = /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ0-9]+$/;
  if (!nameRegex.test(name)) {
    return res.render('register', { 
      error: 'El nombre solo puede contener letras y números, sin espacios ni caracteres especiales.' 
    });
  }

  // Validar longitud máxima del nombre (30 caracteres)
  if (name.length > 30) {
    return res.render('register', {
      error: 'El nombre no puede exceder los 30 caracteres.'
    });
  }

  if (password !== password2) {
    return res.render('register', { error: 'Las contraseñas no coinciden.' });
  }

  // Validar que la contraseña no contenga espacios
  if (/\s/.test(password)) {
    return res.render('register', { error: 'La contraseña no puede contener espacios.' });
  }

  // Validar requisitos de la contraseña (mínimo 8, máximo 20, mayúscula, número, carácter especial)
  const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,20}$/;
  if (!passwordRegex.test(password)) {
    return res.render('register', { 
      error: 'La contraseña debe tener entre 8 y 20 caracteres, incluir al menos una mayúscula, un número y un carácter especial.' 
    });
  }

  // Validar formato de correo
  const emailFormatRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailFormatRegex.test(email)) {
    return res.render('register', { error: 'Formato de correo inválido. Use una dirección como tu@correo.com.' });
  }

  // Validar dominio del correo (whitelist)
  const allowedDomains = [
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'yahoo.es'
  ];

  const emailDomain = email.substring(email.lastIndexOf('@') + 1).toLowerCase();
  if (!allowedDomains.includes(emailDomain)) {
    return res.render('register', {
      error: '¡Solo se permiten correos de proveedores comunes! (Gmail, Outlook, Yahoo)'
    });
  }

  // Verificar si el correo ya existe
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    return res.render('register', { error: 'El correo ya está registrado.' });
  }

  // Hashear contraseña
  const hash = bcrypt.hashSync(password, 10);

  // Insertar usuario (rol por defecto 'customer')
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email, hash, 'customer');

  res.redirect('/login');
});

// Inicio de sesión (GET)
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Inicio de sesión (POST)
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Correo y contraseña requeridos.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.render('login', { error: 'Correo o contraseña incorrectos.' });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) {
    return res.render('login', { error: 'Correo o contraseña incorrectos.' });
  }

  // Guardar datos en sesión (excepto el hash de la contraseña)
  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  // Si es admin, redirigir al panel (por ahora a /, luego a /admin)
  if (user.role === 'admin') {
    return res.redirect('/admin');
  }
  res.redirect('/order');
});

// Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Olvidar contraseña
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { error: null, success: false });
});

app.post('/forgot-password', csrfProtection, (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.render('forgot-password', { error: 'Correo obligatorio', success: false });
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) {
    // No revelar si existe o no
    return res.render('forgot-password', { error: 'El correo no existe, reintenta con uno válido y recibirás instrucciones', success: false });
  }

  const token = crypto.randomBytes(20).toString('hex');
  db.prepare('INSERT INTO password_resets (user_id, token) VALUES (?, ?)').run(user.id, token);

  // En producción, enviar por correo el enlace. Para desarrollo, lo mostramos en consola y en la página.
  const resetLink = `http://localhost:${PORT}/reset-password/${token}`;
  console.log('Enlace de restablecimiento:', resetLink);

  res.render('forgot-password', { 
    error: null, 
    success: true, 
    resetLink // Solo para desarrollo
  });
});

app.get('/reset-password/:token', (req, res) => {
  const token = req.params.token;
  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!reset) {
    return res.render('reset-password', { token: null, error: 'Token inválido o expirado' });
  }

  // Opcional: verificar expiración (ej. 1 hora)
  res.render('reset-password', { token, error: null });
});

app.post('/reset-password/:token', csrfProtection, (req, res) => {
  const token = req.params.token;
  const { password, password2 } = req.body;

  if (password !== password2) {
    return res.render('reset-password', { token, error: 'Las contraseñas no coinciden' });
  }

  // Validar requisitos de contraseña (mismos que en registro)
  const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,20}$/;
  if (!passwordRegex.test(password)) {
    return res.render('reset-password', { token, error: 'La contraseña debe tener entre 8 y 20 caracteres, incluir al menos una mayúscula, un número y un carácter especial.' });
  }

  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!reset) {
    return res.render('reset-password', { token: null, error: 'Token inválido o expirado' });
  }

  const hash = bcrypt.hashSync(password, 10);

  // Verificar que la nueva contraseña sea diferente a la anterior
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(reset.user_id);
    if (bcrypt.compareSync(password, user.password_hash)) {
      return res.render('reset-password', { 
        token, 
        error: 'La nueva contraseña debe ser diferente a la anterior.' 
      });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, reset.user_id);
  db.prepare('DELETE FROM password_resets WHERE token = ?').run(token);

  req.flash('success_msg', 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
  res.redirect('/login');
});

// -------------------------------------------------------
// RUTA PRINCIPAL (MENÚ) 
// -------------------------------------------------------

app.get('/', (req, res) => {
  // Obtener pizzas activas
  const pizzas = db.prepare('SELECT * FROM pizzas WHERE active = 1').all();

  // Obtener tamaños
  const sizes = db.prepare('SELECT * FROM sizes').all();

  // Obtener toppings
  const toppings = db.prepare('SELECT * FROM toppings').all();

  // Construir un objeto con precios por pizza y tamaño
  const prices = {};
  const priceRows = db.prepare(`
    SELECT pizza_id, size_id, base_price
    FROM pizza_prices
  `).all();
  for (const row of priceRows) {
    if (!prices[row.pizza_id]) prices[row.pizza_id] = {};
    prices[row.pizza_id][row.size_id] = row.base_price;
  }

  let notifications = [];
  if (req.session.user) {
    notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC')
                      .all(req.session.user.id);
  }
  res.render('index', { pizzas, sizes, toppings, prices, notifications });
});

// -------------------------------------------------------
// PROCESAR PEDIDO (POST /order)
// -------------------------------------------------------

app.post('/order', isAuthenticated, (req, res) => {
  const { phone, pickup_time, payment_method, pizzas: pizzasData } = req.body;
  const user_id = req.session.user.id;

  // Validaciones
  if (!phone || !pickup_time || !payment_method) {
    return res.status(400).send('Faltan datos del cliente o método de pago.');
  }

  // Validar formato de teléfono venezolano: 4 dígitos - 7 dígitos
  const phoneRegex = /^\d{4}-\d{7}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).send('Formato de teléfono inválido. Use: 0000-0000000');
  }

  // Validar código de área
  const validAreaCodes = [
    '0212', '0241', '0251', '0261', '0271', '0281', '0291',
    '0410', '0412', '0414', '0416', '0418', '0420', '0424', '0426', '0428'
  ];
  const areaCode = phone.split('-')[0];
  if (!validAreaCodes.includes(areaCode)) {
    return res.status(400).send('Código de área no válido.');
  }

  // Validar horario de recogida: entre 17:00 y 23:59
  const [hours, minutes] = pickup_time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes < 17 * 60 || totalMinutes > 23 * 60 + 59) {
    return res.status(400).send('La hora de recogida debe ser entre las 5:00 PM y las 11:59 PM.');
  }

  // Calcular total y construir items
  let total = 0;
  const orderItems = []; // guardaremos { pizza_id, size_id, quantity, toppings[], lineTotal }

  if (pizzasData) {
    for (const [index, data] of Object.entries(pizzasData)) {
      if (data.selected) {
        const pizza_id = parseInt(index) + 1; // porque en el front usamos índices 0,1,2,3
        const size_id = parseInt(data.size);
        const quantity = parseInt(data.quantity) || 1;
        const topping_ids = [];
        if (data.toppings) {
          // Si es array, iterar; si es único, convertir a array
          const rawToppings = Array.isArray(data.toppings) ? data.toppings : [data.toppings];
          for (const t of rawToppings) {
            topping_ids.push(parseInt(t));
          }
        }

        // Obtener precio base para pizza y tamaño
        const priceRow = db.prepare('SELECT base_price FROM pizza_prices WHERE pizza_id = ? AND size_id = ?')
                            .get(pizza_id, size_id);
        if (!priceRow) continue; // combinación no existe
        let base = priceRow.base_price;

        // Sumar costo de toppings
        let toppingsCost = 0;
        for (const t_id of topping_ids) {
          const topping = db.prepare('SELECT extra_price FROM toppings WHERE id = ?').get(t_id);
          if (topping) toppingsCost += topping.extra_price;
        }

        const lineTotal = (base + toppingsCost) * quantity;
        total += lineTotal;

        orderItems.push({
          pizza_id,
          size_id,
          quantity,
          topping_ids,
          lineTotal
        });
      }
    }
  }

  // Procesar bebidas
  const bebidasData = req.body.bebidas || {};
  const orderBebidas = [];
  for (const [bebidaId, qty] of Object.entries(bebidasData)) {
    const quantity = parseInt(qty) || 0;
    if (quantity > 0) {
      const bebida = db.prepare('SELECT name, price FROM bebidas WHERE id = ? AND active = 1').get(bebidaId);
      if (bebida) {
        const lineTotal = bebida.price * quantity;
        total += lineTotal;
        orderBebidas.push({
          bebida_id: parseInt(bebidaId),
          name: bebida.name,
          quantity,
          price: bebida.price,
          lineTotal
        });
      }
    }
  }

  if (orderItems.length === 0) {
    return res.status(400).send('No has seleccionado ninguna pizza.');
  }

  // Insertar la orden
  const insertOrder = db.prepare(`
    INSERT INTO orders (user_id, customer_name, phone, pickup_time, payment_method, total, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  const customerName = req.session.user.name;
  const result = insertOrder.run(user_id, customerName, phone, pickup_time, payment_method, total.toFixed(2));
  const orderId = result.lastInsertRowid;

  // Insertar cada item
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, pizza_id, size_id, quantity, line_total)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertTopping = db.prepare(`
    INSERT INTO order_item_toppings (order_item_id, topping_id) VALUES (?, ?)
  `);

  const details = []; // para mostrar en la confirmación
  for (const item of orderItems) {
    const itemResult = insertItem.run(orderId, item.pizza_id, item.size_id, item.quantity, item.lineTotal);
    const orderItemId = itemResult.lastInsertRowid;

    for (const t_id of item.topping_ids) {
      insertTopping.run(orderItemId, t_id);
    }

    // Recoger nombres para la vista de confirmación
    const pizza = db.prepare('SELECT name FROM pizzas WHERE id = ?').get(item.pizza_id);
    const size = db.prepare('SELECT label FROM sizes WHERE id = ?').get(item.size_id);
    const toppingNames = item.topping_ids.map(t_id => {
      const t = db.prepare('SELECT name FROM toppings WHERE id = ?').get(t_id);
      return t ? t.name : '';
    }).filter(Boolean);

    details.push({
      pizzaName: pizza.name,
      sizeLabel: size.label,
      quantity: item.quantity,
      toppings: toppingNames,
      lineTotal: item.lineTotal
    });
  }

  // Insertar cada bebida
  const insertBebida = db.prepare(`
    INSERT INTO order_bebidas (order_id, bebida_id, quantity, line_total)
    VALUES (?, ?, ?, ?)
  `);

  const bebidaDetails = []; // para la confirmación
  for (const b of orderBebidas) {
    insertBebida.run(orderId, b.bebida_id, b.quantity, b.lineTotal);
    bebidaDetails.push({
      name: b.name,
      quantity: b.quantity,
      lineTotal: b.lineTotal
    });
  }

  // Obtener datos para la notificación
  const newOrder = {
    id: orderId,
    customer_name: customerName,
    total: total.toFixed(2),
    status: 'pending',
    created_at: new Date().toISOString()
  };
  io.emit('nuevo_pedido', newOrder);

  // Renderizar confirmación
  if (payment_method === 'Efectivo en local') {
    res.render('order-confirmation', {
      customerName,
      pickup_time,
      payment_method,
      items: details,
      bebidas: bebidaDetails,
      total: total.toFixed(2)
    });
  } else {
    // Redirigir a la página de pago
    res.redirect(`/payment/${orderId}`);
  }
});

// -------------------------------------------------------
// RUTA ADMIN (protegida, solo admin)
// -------------------------------------------------------

// Middleware para admin
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Acceso denegado. Solo administradores.');
}

// Dashboard
app.get('/admin', isAdmin, (req, res) => {
  // Estadísticas generales
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(total), 0) as total FROM orders').get().total;
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const activePizzas = db.prepare('SELECT COUNT(*) as count FROM pizzas WHERE active = 1').get().count;
  const totalToppings = db.prepare('SELECT COUNT(*) as count FROM toppings').get().count;
  
  // Pedidos de hoy vs ayer
  const today = new Date().toISOString().split('T')[0]; // formato YYYY-MM-DD
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const ordersToday = db.prepare("SELECT COUNT(*) as count FROM orders WHERE date(created_at) = ?").get(today).count;
  const ordersYesterday = db.prepare("SELECT COUNT(*) as count FROM orders WHERE date(created_at) = ?").get(yesterday).count;
  
  // Pedidos por estado
  const ordersByStatus = {
    pending: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count,
    confirmed: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'").get().count,
    ready: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'ready'").get().count,
    delivered: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'delivered'").get().count
  };

  // Pizzas más vendidas (top 5)
  const topPizzas = db.prepare(`
    SELECT p.name, SUM(oi.quantity) as total_sold
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    GROUP BY oi.pizza_id
    ORDER BY total_sold DESC
    LIMIT 5
  `).all();

  // Ingredientes extra más pedidos (top 5)
  const topToppings = db.prepare(`
    SELECT t.name, COUNT(*) as times_used
    FROM order_item_toppings oit
    JOIN toppings t ON oit.topping_id = t.id
    GROUP BY oit.topping_id
    ORDER BY times_used DESC
    LIMIT 5
  `).all();

  // Tamaños más comprados
  const topSizes = db.prepare(`
    SELECT s.label, COUNT(*) as times_used
    FROM order_items oi
    JOIN sizes s ON oi.size_id = s.id
    GROUP BY oi.size_id
    ORDER BY times_used DESC
  `).all();

  // Últimos 5 pedidos para la tabla rápida
  const recentOrders = db.prepare(`
    SELECT id, customer_name, total, status, created_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  res.render('admin', {
    totalRevenue,
    totalOrders,
    activePizzas,
    totalToppings,
    ordersToday,
    ordersYesterday,
    ordersByStatus,
    topPizzas,
    topToppings,
    topSizes,
    recentOrders,
  });
});

// ----------------------------------------------------
// Pizzas
// ----------------------------------------------------
app.get('/admin/pizzas', isAdmin, (req, res) => {
  const pizzas = db.prepare('SELECT * FROM pizzas ORDER BY id').all();
  res.render('admin-pizzas', { pizzas });
});

app.get('/admin/pizzas/add', isAdmin, (req, res) => {
  const sizes = db.prepare('SELECT * FROM sizes').all();
  res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: null });
});

app.post('/admin/pizzas/add', isAdmin, (req, res) => {
  const { name, description, active } = req.body;

  // Validar nombre
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    const sizes = db.prepare('SELECT * FROM sizes').all();
    return res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: 'Nombre de pizza inválido (solo letras y espacios).' });
  }

  // Validar descripción (solo si se proporciona)
  if (description && !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(description.trim())) {
    const sizes = db.prepare('SELECT * FROM sizes').all();
    return res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: 'La descripción solo puede contener letras y espacios.' });
  }

  // Validar que todos los precios sean >=0
  const sizes = db.prepare('SELECT * FROM sizes').all();
  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    if (isNaN(priceValue) || priceValue < 0) {
      return res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: `El precio para ${size.label} no puede ser negativo.` });
    }
  }
  // Insertar pizza
  const result = db.prepare('INSERT INTO pizzas (name, description, active) VALUES (?, ?, ?)').run(name, description || null, active || 1);
  const pizzaId = result.lastInsertRowid;
  // Insertar precios por tamaño (los campos price_<id>)
  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    db.prepare('INSERT INTO pizza_prices (pizza_id, size_id, base_price) VALUES (?, ?, ?)').run(pizzaId, size.id, priceValue);
  }
  req.flash('success_msg', 'Pizza creada');
  res.redirect('/admin/pizzas');
});

app.get('/admin/pizzas/edit/:id', isAdmin, (req, res) => {
  const pizza = db.prepare('SELECT * FROM pizzas WHERE id = ?').get(req.params.id);
  if (!pizza) return res.status(404).send('Pizza no encontrada');
  const sizes = db.prepare('SELECT * FROM sizes').all();
  const priceRows = db.prepare('SELECT size_id, base_price FROM pizza_prices WHERE pizza_id = ?').all(pizza.id);
  const prices = {};
  priceRows.forEach(row => { prices[row.size_id] = row.base_price; });
  res.render('admin-pizza-form', { pizza, sizes, prices, error: null });
});

app.post('/admin/pizzas/edit/:id', isAdmin, (req, res) => {
  const pizza = db.prepare('SELECT * FROM pizzas WHERE id = ?').get(req.params.id);
  const { name, description, active } = req.body;

  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    const sizes = db.prepare('SELECT * FROM sizes').all();
    const priceRows = db.prepare('SELECT size_id, base_price FROM pizza_prices WHERE pizza_id = ?').all(pizza.id);
    const prices = {};
    priceRows.forEach(row => { prices[row.size_id] = row.base_price; });
    return res.render('admin-pizza-form', { pizza, sizes, prices, error: 'Nombre inválido.' });
  }

  if (description && !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(description.trim())) {
    const sizes = db.prepare('SELECT * FROM sizes').all();
    const priceRows = db.prepare('SELECT size_id, base_price FROM pizza_prices WHERE pizza_id = ?').all(pizza.id);
    const prices = {};
    priceRows.forEach(row => { prices[row.size_id] = row.base_price; });
    return res.render('admin-pizza-form', { pizza, sizes, prices, error: 'Descripción inválida (solo letras y espacios).' });
  }

  // Validar precios
  const sizes = db.prepare('SELECT * FROM sizes').all();
  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    if (isNaN(priceValue) || priceValue < 0) {
      const priceRows = db.prepare('SELECT size_id, base_price FROM pizza_prices WHERE pizza_id = ?').all(pizza.id);
      const prices = {};
      priceRows.forEach(row => { prices[row.size_id] = row.base_price; });
      return res.render('admin-pizza-form', { pizza, sizes, prices, error: `El precio para ${size.label} no puede ser negativo.` });
    }
  }
  db.prepare('UPDATE pizzas SET name = ?, description = ?, active = ? WHERE id = ?').run(name, description || null, active, pizza.id);
  // Actualizar precios
  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    // Usamos INSERT OR REPLACE (o podemos actualizar si existe)
    db.prepare('INSERT OR REPLACE INTO pizza_prices (pizza_id, size_id, base_price) VALUES (?, ?, ?)').run(pizza.id, size.id, priceValue);
  }
  req.flash('success_msg', 'Pizza actualizada');
  res.redirect('/admin/pizzas');
});

app.post('/admin/pizzas/delete/:id', isAdmin, (req, res) => {
  // Verificar que no haya order_items que referencien esta pizza
  const count = db.prepare('SELECT COUNT(*) as count FROM order_items WHERE pizza_id = ?').get(req.params.id).count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, hay pedidos que la incluyen');
    return res.redirect('/admin/pizzas'); 
  }
  db.prepare('DELETE FROM pizza_prices WHERE pizza_id = ?').run(req.params.id);
  db.prepare('DELETE FROM pizzas WHERE id = ?').run(req.params.id);
  req.flash('success_msg', 'Pizza eliminada');
  res.redirect('/admin/pizzas');
});

// ----------------------------------------------------
// Tamaños (solo Mediana y Grande, sin multiplicador)
// ----------------------------------------------------
app.get('/admin/sizes', isAdmin, (req, res) => {
  const sizes = db.prepare('SELECT * FROM sizes ORDER BY id').all();
  res.render('admin-sizes', { sizes});
});

app.post('/admin/sizes/add', isAdmin, (req, res) => {
  const { label } = req.body;

  if (!label || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(label.trim())) {
    req.flash('error_msg', 'Etiqueta inválida (solo letras y espacios)');
    return res.redirect('/admin/sizes');
  }

  const result = db.prepare('INSERT INTO sizes (label) VALUES (?)').run(label);
  const sizeId = result.lastInsertRowid;
  // Crear entradas en pizza_prices con precio 0.0 para cada pizza existente
  const pizzas = db.prepare('SELECT id FROM pizzas').all();
  const insertPrice = db.prepare('INSERT OR IGNORE INTO pizza_prices (pizza_id, size_id, base_price) VALUES (?, ?, 0.0)');
  for (const p of pizzas) {
    insertPrice.run(p.id, sizeId);
  }
  req.flash('success_msg', 'Tamaño agregado'); res.redirect('/admin/sizes');
});

app.get('/admin/sizes/edit/:id', isAdmin, (req, res) => {
  const size = db.prepare('SELECT * FROM sizes WHERE id = ?').get(req.params.id);
  if (!size) return res.status(404).send('Tamaño no encontrado');
  res.render('admin-size-edit', { size });
});

app.post('/admin/sizes/edit/:id', isAdmin, (req, res) => {
  const { label } = req.body;
  const sizeId = req.params.id;
  
  if (!label || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(label.trim())) {
    req.flash('error_msg', 'Etiqueta inválida');
    return res.redirect(`/admin/sizes/edit/${sizeId}`);
  }
  
  db.prepare('UPDATE sizes SET label = ? WHERE id = ?').run(label, req.params.id);
  req.flash('success_msg', 'Tamaño actualizado'); res.redirect('/admin/sizes');
});

app.post('/admin/sizes/delete/:id', isAdmin, (req, res) => {
  // No permitir borrar si hay pedidos que lo usen
  const count = db.prepare('SELECT COUNT(*) as count FROM order_items WHERE size_id = ?').get(req.params.id).count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, hay pedidos que lo usan');
    return res.redirect('/admin/sizes');
  }
  db.prepare('DELETE FROM pizza_prices WHERE size_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sizes WHERE id = ?').run(req.params.id);
  req.flash('success_msg', 'Tamaño eliminado'); res.redirect('/admin/sizes');
});

// ----------------------------------------------------
// Toppings
// ----------------------------------------------------
app.get('/admin/toppings', isAdmin, (req, res) => {
  const toppings = db.prepare('SELECT * FROM toppings ORDER BY id').all();
  res.render('admin-toppings', { toppings });
});

app.post('/admin/toppings/add', isAdmin, (req, res) => {
  const { name, extra_price } = req.body;

  // Validar nombre: solo letras y espacios, no vacío
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    req.flash('error_msg', 'Nombre inválido (solo letras y espacios)');
    return res.redirect('/admin/toppings');
  }

  // Validar precio: número positivo
  const price = parseFloat(extra_price);
  if (isNaN(price) || price < 0) {
    req.flash('error_msg', 'Precio inválido (debe ser positivo)');
    return res.redirect('/admin/toppings');
  }

  // Luego continuar con la inserción...
  db.prepare('INSERT INTO toppings (name, extra_price) VALUES (?, ?)').run(name.trim(), price);
  req.flash('success_msg', 'Ingrediente agregado'); res.redirect('/admin/toppings');
});

app.get('/admin/toppings/edit/:id', isAdmin, (req, res) => {
  const topping = db.prepare('SELECT * FROM toppings WHERE id = ?').get(req.params.id);
  if (!topping) return res.status(404).send('Ingrediente no encontrado');
  res.render('admin-topping-edit', { topping });
});

app.post('/admin/toppings/edit/:id', isAdmin, (req, res) => {
  const { name, extra_price } = req.body;
  const id = req.params.id;

  // Validar nombre
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    req.flash('error_msg', 'Nombre inválido');
    return res.redirect(`/admin/toppings/edit/${id}`);
  }

  // Validar precio
  const price = parseFloat(extra_price);
  if (isNaN(price) || price < 0) {
    req.flash('error_msg', 'Precio inválido');
    return res.redirect(`/admin/toppings/edit/${id}`);
  }

  db.prepare('UPDATE toppings SET name = ?, extra_price = ? WHERE id = ?').run(name.trim(), price, id);
  req.flash('success_msg', 'Ingrediente actualizado'); res.redirect('/admin/toppings');
});

app.post('/admin/toppings/delete/:id', isAdmin, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM order_item_toppings WHERE topping_id = ?').get(req.params.id).count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, está en pedidos');
    return res.redirect('/admin/toppings');
  }
  db.prepare('DELETE FROM toppings WHERE id = ?').run(req.params.id);
  req.flash('success_msg', 'Ingrediente eliminado'); res.redirect('/admin/toppings');
});

// ----------------------------------------------------
// Bebidas
// ----------------------------------------------------
app.get('/admin/bebidas', isAdmin, (req, res) => {
  const bebidas = db.prepare('SELECT * FROM bebidas ORDER BY id').all();
  res.render('admin-bebidas', { bebidas });
});

app.post('/admin/bebidas/add', isAdmin, (req, res) => {
  const { name, price } = req.body;

  // Validar nombre (solo letras y espacios)
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    req.flash('error_msg', 'Nombre inválido (solo letras y espacios)');
    return res.redirect('/admin/bebidas');
  }

  // Validar precio
  const priceValue = parseFloat(price);
  if (isNaN(priceValue) || priceValue < 0) {
    req.flash('error_msg', 'Precio inválido (debe ser positivo)');
    return res.redirect('/admin/bebidas');
  }

  db.prepare('INSERT INTO bebidas (name, price, active) VALUES (?, ?, 1)').run(name.trim(), priceValue);
  req.flash('success_msg', 'Bebida agregada'); res.redirect('/admin/bebidas');
});

app.get('/admin/bebidas/edit/:id', isAdmin, (req, res) => {
  const bebida = db.prepare('SELECT * FROM bebidas WHERE id = ?').get(req.params.id);
  if (!bebida) return res.status(404).send('Bebida no encontrada');
  res.render('admin-bebida-edit', { bebida, error: null });
});

app.post('/admin/bebidas/edit/:id', isAdmin, (req, res) => {
  const bebida = db.prepare('SELECT * FROM bebidas WHERE id = ?').get(req.params.id);
  if (!bebida) return res.status(404).send('Bebida no encontrada');

  const { name, price, active } = req.body;

  // Validar nombre
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    return res.render('admin-bebida-edit', { bebida, error: 'Nombre inválido (solo letras y espacios).' });
  }

  // Validar precio
  const priceValue = parseFloat(price);
  if (isNaN(priceValue) || priceValue < 0) {
    return res.render('admin-bebida-edit', { bebida, error: 'Precio inválido (debe ser positivo).' });
  }

  db.prepare('UPDATE bebidas SET name = ?, price = ?, active = ? WHERE id = ?')
    .run(name.trim(), priceValue, active || 0, req.params.id);
  req.flash('success_msg', 'Bebida actualizada'); res.redirect('/admin/bebidas');
});

app.post('/admin/bebidas/delete/:id', isAdmin, (req, res) => {
  // Verificar si ya se usó en algún pedido
  const count = db.prepare('SELECT COUNT(*) as count FROM order_bebidas WHERE bebida_id = ?').get(req.params.id).count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, hay pedidos que la incluyen');
    return res.redirect('/admin/bebidas');
  }
  db.prepare('DELETE FROM bebidas WHERE id = ?').run(req.params.id);
  req.flash('success_msg', 'Bebida eliminada'); res.redirect('/admin/bebidas');
});

// ----------------------------------------------------
// Pedidos
// ----------------------------------------------------
app.get('/admin/orders', isAdmin, (req, res) => {
  const { nombre, telefono, fecha } = req.query;

  let sql = 'SELECT * FROM orders';
  const conditions = [];
  const params = [];

  if (nombre && nombre.trim() !== '') {
    conditions.push('customer_name LIKE ?');
    params.push(`%${nombre.trim()}%`);
  }

  if (telefono && telefono.trim() !== '') {
    conditions.push('phone LIKE ?');
    params.push(`%${telefono.trim()}%`);
  }

  if (fecha && fecha.trim() !== '') {
    conditions.push('date(created_at) = ?');
    params.push(fecha.trim());
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY created_at DESC';
  const orders = db.prepare(sql).all(...params);

  // Obtener items y toppings de cada orden (igual que antes)
  for (const order of orders) {
    const items = db.prepare(`
      SELECT oi.*, p.name as pizza_name, s.label as size_label
      FROM order_items oi
      JOIN pizzas p ON oi.pizza_id = p.id
      JOIN sizes s ON oi.size_id = s.id
      WHERE oi.order_id = ?
    `).all(order.id);

    for (const item of items) {
      const toppingRows = db.prepare(`
        SELECT t.name FROM order_item_toppings oit
        JOIN toppings t ON oit.topping_id = t.id
        WHERE oit.order_item_id = ?
      `).all(item.id);
      item.toppings = toppingRows.map(t => t.name);
    }
    order.items = items;
  }

  res.render('admin-orders', { orders, nombre, telefono, fecha });
});

// Página de pedido (protegida)
app.get('/order', isAuthenticated, (req, res) => {
  const pizzas = db.prepare('SELECT * FROM pizzas WHERE active = 1').all();
  const sizes = db.prepare('SELECT * FROM sizes').all();
  const toppings = db.prepare('SELECT * FROM toppings').all();
  const bebidas = db.prepare('SELECT * FROM bebidas WHERE active = 1').all();

  const prices = {};
  const priceRows = db.prepare('SELECT pizza_id, size_id, base_price FROM pizza_prices').all();
  for (const row of priceRows) {
    if (!prices[row.pizza_id]) prices[row.pizza_id] = {};
    prices[row.pizza_id][row.size_id] = row.base_price;
  }

  res.render('order', { pizzas, sizes, toppings, prices, bebidas });
});

// Detalle del pedido para cliente
app.get('/order-detail/:id', isAuthenticated, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
                      .get(req.params.id, req.session.user.id);
  if (!order) return res.status(404).send('Pedido no encontrado');

  // Obtener items (pizzas)
  const items = db.prepare(`
    SELECT oi.*, p.name as pizza_name, s.label as size_label
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    JOIN sizes s ON oi.size_id = s.id
    WHERE oi.order_id = ?
  `).all(order.id);

  for (const item of items) {
    const toppingRows = db.prepare(`
      SELECT t.name FROM order_item_toppings oit
      JOIN toppings t ON oit.topping_id = t.id
      WHERE oit.order_item_id = ?
    `).all(item.id);
    item.toppings = toppingRows.map(t => t.name);
  }

  // Obtener bebidas
  const bebidas = db.prepare(`
    SELECT b.name, ob.quantity, ob.line_total
    FROM order_bebidas ob
    JOIN bebidas b ON ob.bebida_id = b.id
    WHERE ob.order_id = ?
  `).all(order.id);

  res.render('order-detail', { order, items, bebidas });
});

app.post('/notification/:id/read', isAuthenticated, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.user.id);
  res.json({ success: true });
});

app.post('/notification/:id/delete', isAuthenticated, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.user.id);
  res.json({ success: true });
});

app.post('/notifications/delete-all', isAuthenticated, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?')
    .run(req.session.user.id);
  res.json({ success: true });
});

app.post('/admin/orders/:id/status', isAdmin, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'ready', 'delivered'];
  if (!validStatuses.includes(status)) {
    req.flash('error_msg', 'Estado inválido');
    return res.redirect('/admin/orders');
  }

  // Obtener el pedido antes de usarlo
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    req.flash('error_msg', 'Pedido no encontrado');
    return res.redirect('/admin/orders');
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);

  if (status === 'ready' || status === 'delivered') {
    const message = status === 'ready'
      ? `Tu pedido #${order.id} está listo para recoger.`
      : `Tu pedido #${order.id} ha sido entregado. ¡Buen provecho!`;

    db.prepare('INSERT INTO notifications (user_id, order_id, message) VALUES (?, ?, ?)')
      .run(order.user_id, order.id, message);

    io.to(`user_${order.user_id}`).emit('notification', {
      id: db.prepare('SELECT last_insert_rowid() as id').get().id,
      message,
      order_id: order.id,
      is_read: 0,
      created_at: new Date().toISOString()
    });
  }

  req.flash('success_msg', 'Estado actualizado');
  res.redirect('/admin/orders');
});

// Ruta para imprimir comanda
app.get('/admin/orders/:id/print', isAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).send('Pedido no encontrado');

  // Obtener items (pizzas)
  const items = db.prepare(`
    SELECT oi.*, p.name as pizza_name, s.label as size_label
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    JOIN sizes s ON oi.size_id = s.id
    WHERE oi.order_id = ?
  `).all(order.id);

  for (const item of items) {
    const toppingRows = db.prepare(`
      SELECT t.name FROM order_item_toppings oit
      JOIN toppings t ON oit.topping_id = t.id
      WHERE oit.order_item_id = ?
    `).all(item.id);
    item.toppings = toppingRows.map(t => t.name);
  }

  // Obtener bebidas
  const bebidas = db.prepare(`
    SELECT b.name, ob.quantity, ob.line_total
    FROM order_bebidas ob
    JOIN bebidas b ON ob.bebida_id = b.id
    WHERE ob.order_id = ?
  `).all(order.id);

  res.render('print-order', { order, items, bebidas });
});

// Eliminar pedido
app.post('/admin/orders/delete/:id', isAdmin, (req, res) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  req.flash('success_msg', 'Pedido eliminado'); res.redirect('/admin/orders');
});

//Eliminar todos los pedidos

app.post('/admin/orders/delete-all', isAdmin, (req, res) => {
  db.prepare('DELETE FROM orders').run();
  req.flash('success_msg', 'Todos los pedidos han sido eliminados');
  res.redirect('/admin/orders');
});

//--------//
// PAGOS -//
//--------//

app.get('/payment/:id', isAuthenticated, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!order) return res.status(404).send('Pedido no encontrado');
  res.render('payment', { order, error: null, paymentData: paymentInfo[order.payment_method] || null });
});

app.post('/payment/:id', isAuthenticated, upload.single('receipt'), csrfProtection, (req, res) => {
  res.locals.csrfToken = req.csrfToken();

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!order) return res.status(404).send('Pedido no encontrado');

  const { payment_ref } = req.body;
  let payment_receipt = null;
  if (req.file) {
    payment_receipt = '/uploads/' + req.file.filename;
  }

  // Validar que al menos tenga referencia o comprobante
  if (!payment_ref && !payment_receipt) {
    return res.render('payment', { order, error: 'Debes ingresar número de referencia o subir comprobante' });
  }

  if (payment_ref && !/^\d{6}$/.test(payment_ref)) {
    return res.render('payment', { order, error: 'La referencia debe contener exactamente 6 dígitos.' });
  }

  db.prepare('UPDATE orders SET payment_status = ?, payment_ref = ?, payment_receipt = ? WHERE id = ?')
    .run('submitted', payment_ref || null, payment_receipt, order.id);

  // Emitir evento de pago realizado
  io.emit('pago_realizado', { id: order.id, customer_name: order.customer_name, total: order.total });

  res.redirect(`/order-confirmation/${order.id}`); // o simplemente mostrar confirmación genérica
});

app.get('/order-confirmation/:id', isAuthenticated, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!order) return res.status(404).send('Pedido no encontrado');

  // Obtener items y bebidas para mostrar
  const items = db.prepare(`
    SELECT oi.*, p.name as pizza_name, s.label as size_label
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    JOIN sizes s ON oi.size_id = s.id
    WHERE oi.order_id = ?
  `).all(order.id);
  const details = items.map(item => {
    const toppingRows = db.prepare(`SELECT t.name FROM order_item_toppings oit JOIN toppings t ON oit.topping_id = t.id WHERE oit.order_item_id = ?`).all(item.id);
    return {
      quantity: item.quantity,
      pizzaName: item.pizza_name,
      sizeLabel: item.size_label,
      toppings: toppingRows.map(t => t.name),
      lineTotal: item.line_total
    };
  });
  const bebidas = db.prepare(`SELECT b.name, ob.quantity, ob.line_total FROM order_bebidas ob JOIN bebidas b ON ob.bebida_id = b.id WHERE ob.order_id = ?`).all(order.id);
  const bebidaDetails = bebidas.map(b => ({
    name: b.name,
    quantity: b.quantity,
    lineTotal: b.line_total
  }));

  res.render('order-confirmation', {
    customerName: order.customer_name,
    pickup_time: order.pickup_time,
    payment_method: order.payment_method,
    items: details,
    bebidas: bebidaDetails,
    total: order.total.toFixed(2)
  });
});

app.post('/admin/orders/:id/payment', isAdmin, (req, res) => {
  const { payment_status } = req.body;

  if (!['paid', 'rejected'].includes(payment_status)) {
    req.flash('error_msg', 'Estado de pago inválido');
    return res.redirect('/admin/orders');
  }

  // Obtener el pedido antes de usarlo
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    req.flash('error_msg', 'Pedido no encontrado');
    return res.redirect('/admin/orders');
  }

  db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(payment_status, order.id);

  if (payment_status === 'paid') {
    const message = `Tu pedido #${order.id} ha sido confirmado y está en preparación.`;
    db.prepare('INSERT INTO notifications (user_id, order_id, message) VALUES (?, ?, ?)')
      .run(order.user_id, order.id, message);

    io.to(`user_${order.user_id}`).emit('notification', {
      id: db.prepare('SELECT last_insert_rowid() as id').get().id,
      message,
      order_id: order.id,
      is_read: 0,
      created_at: new Date().toISOString()
    });
  }

  req.flash('success_msg', 'Estado de pago actualizado');
  res.redirect('/admin/orders');
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🍕 Servidor corriendo en http://localhost:${PORT}`);
});