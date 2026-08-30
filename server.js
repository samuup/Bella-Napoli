// ======================================================
// server.js — PUNTO DE ENTRADA PRINCIPAL DEL PROYECTO
// ------------------------------------------------------
// Aplicación web "Bella Napoli" (pedidos de pizza) con:
//   - Framework: Express
//   - Vistas: EJS (TailwindCSS por CDN)
//   - Base de datos: PostgreSQL (pg + connect-pg-simple)
//   - Sesiones: express-session (store persistente en PG)
//   - Tiempo real: Socket.IO (notificaciones y pedidos)
//   - Protección CSRF: csurf
//
// Orden del archivo:
//   1. Imports y configuración (app, multer, paymentInfo, socket)
//   2. Middlewares globales (sesión, CSRF, flash, locales)
//   3. Helpers de autenticación (isAuthenticated, isAdmin)
//   4. Rutas de autenticación (registro, login, logout, passwords)
//   5. Menú principal y procesamiento del pedido
//   6. Rutas de administración (dashboard, Pizzas, Tamaños, Toppings, Bebidas, Pedidos)
//   7. Rutas de pedidos y detalle
//   8. Notificaciones
//   9. Pagos (crear pedido tras subir comprobante/referencia)
//   10. Confirmación de pedido
//   11. Arranque del servidor
// ======================================================

// Cargar variables de entorno desde .env
require('dotenv').config();

// --- Dependencias de terceros ---
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session); // Store de sesión en PostgreSQL
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const flash = require('connect-flash');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// --- Módulo local: pool de conexiones a la base de datos ---
const db = require('./database');

// Instancia principal de la aplicación Express
const app = express();

// ======================================================
// CONFIGURACIÓN DE SUBIDA DE ARCHIVOS (multer)
// Guarda las imágenes de comprobante de pago en public/uploads/
// ======================================================
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
  limits: { fileSize: 2 * 1024 * 1024 },
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

// ======================================================
// INFORMACIÓN DE PAGOS POR MÉTODO
// Muestra las instrucciones que el cliente ve en la
// pantalla de pago según el método seleccionado.
// ======================================================
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

// ======================================================
// SERVIDOR y SOCKET.IO
// Se crea el servidor HTTP para poder usar Socket.IO.
// Socket.IO permite enviar notificaciones en tiempo real
// al usuario conectado (habitación `user_<id>`) y al panel
// del administrador (eventos 'nuevo_pedido' / 'pago_realizado').
// ======================================================
const fs = require('fs');
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  socket.on('register_user', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      socket.data.userId = userId;
    }
  });
});

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');

// ======================================================
// MIDDLEWARES GLOBALES
// ======================================================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Protección CSRF: se omite en peticiones multipart (subida de
// archivos), donde la validación se hace explícitamente en la ruta.
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

// Sesiones persistidas en PostgreSQL (sobreviven reinicios del servidor).
app.use(session({
  store: new pgSession({
    pool: db,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Variable disponible en todas las vistas: usuario logueado (o null).
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Conteo de pedidos pendientes (para la campanita/sidebar del admin).
app.use((req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    db.query("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'")
      .then(result => {
        res.locals.pendingOrdersCount = parseInt(result.rows[0].count);
        next();
      })
      .catch(err => {
        console.error(err);
        res.locals.pendingOrdersCount = 0;
        next();
      });
  } else {
    res.locals.pendingOrdersCount = 0;
    next();
  }
});

// Token CSRF disponible en todas las vistas (campo oculto _csrf).
app.use((req, res, next) => {
  if (typeof req.csrfToken === 'function') {
    res.locals.csrfToken = req.csrfToken();
  }
  next();
});

// Mensajes flash (éxito / error) disponibles en las vistas.
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.message = res.locals.success_msg[0] || res.locals.error_msg[0] || null;
  next();
});

// ======================================================
// HELPERS DE AUTENTICACIÓN / AUTORIZACIÓN
// ======================================================
// Requiere que el usuario esté logueado (redirige a /login).
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// ==================== AUTENTICACIÓN ====================
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { name, email, password, password2 } = req.body;

  if (!name || !email || !password || !password2) {
    return res.render('register', { error: 'Todos los campos son obligatorios.' });
  }

  const nameRegex = /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ0-9]+$/;
  if (!nameRegex.test(name)) {
    return res.render('register', { 
      error: 'El nombre solo puede contener letras y números, sin espacios ni caracteres especiales.' 
    });
  }

  if (name.length > 30) {
    return res.render('register', {
      error: 'El nombre no puede exceder los 30 caracteres.'
    });
  }

  if (password !== password2) {
    return res.render('register', { error: 'Las contraseñas no coinciden.' });
  }

  if (/\s/.test(password)) {
    return res.render('register', { error: 'La contraseña no puede contener espacios.' });
  }

  const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,20}$/;
  if (!passwordRegex.test(password)) {
    return res.render('register', { 
      error: 'La contraseña debe tener entre 8 y 20 caracteres, incluir al menos una mayúscula, un número y un carácter especial.' 
    });
  }

  const emailFormatRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailFormatRegex.test(email)) {
    return res.render('register', { error: 'Formato de correo inválido. Use una dirección como tu@correo.com.' });
  }

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

  const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    return res.render('register', { error: 'El correo ya está registrado.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)', [
    name.trim(),
    email,
    hash,
    'customer'
  ]);

  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Correo y contraseña requeridos.' });
  }

  const userResult = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = userResult.rows[0];

  if (!user) {
    return res.render('login', { error: 'Correo o contraseña incorrectos.' });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) {
    return res.render('login', { error: 'Correo o contraseña incorrectos.' });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  if (user.role === 'admin') {
    return res.redirect('/admin');
  }
  res.redirect('/order');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ============ RECUPERACIÓN DE CONTRASEÑA ============
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { error: null, success: false });
});

app.post('/forgot-password', csrfProtection, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.render('forgot-password', { error: 'Correo obligatorio', success: false });
  }

  const userResult = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  const user = userResult.rows[0];

  if (!user) {
    return res.render('forgot-password', { error: 'El correo no existe, reintenta con uno válido y recibirás instrucciones', success: false });
  }

  const token = crypto.randomBytes(20).toString('hex');
  await db.query('INSERT INTO password_resets (user_id, token) VALUES ($1, $2)', [user.id, token]);

  const resetLink = `http://localhost:${PORT}/reset-password/${token}`;
  console.log('Enlace de restablecimiento:', resetLink);

  res.render('forgot-password', { 
    error: null, 
    success: true, 
    resetLink
  });
});

app.get('/reset-password/:token', async (req, res) => {
  const token = req.params.token;
  const resetResult = await db.query('SELECT * FROM password_resets WHERE token = $1', [token]);
  const reset = resetResult.rows[0];

  if (!reset) {
    return res.render('reset-password', { token: null, error: 'Token inválido o expirado' });
  }

  res.render('reset-password', { token, error: null });
});

app.post('/reset-password/:token', csrfProtection, async (req, res) => {
  const token = req.params.token;
  const { password, password2 } = req.body;

  if (password !== password2) {
    return res.render('reset-password', { token, error: 'Las contraseñas no coinciden' });
  }

  const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,20}$/;
  if (!passwordRegex.test(password)) {
    return res.render('reset-password', { token, error: 'La contraseña debe tener entre 8 y 20 caracteres, incluir al menos una mayúscula, un número y un carácter especial.' });
  }

  const resetResult = await db.query('SELECT * FROM password_resets WHERE token = $1', [token]);
  const reset = resetResult.rows[0];

  if (!reset) {
    return res.render('reset-password', { token: null, error: 'Token inválido o expirado' });
  }

  const hash = bcrypt.hashSync(password, 10);

  const userResult = await db.query('SELECT password_hash FROM users WHERE id = $1', [reset.user_id]);
  const user = userResult.rows[0];

  if (bcrypt.compareSync(password, user.password_hash)) {
    return res.render('reset-password', { 
      token, 
      error: 'La nueva contraseña debe ser diferente a la anterior.' 
    });
  }

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, reset.user_id]);
  await db.query('DELETE FROM password_resets WHERE token = $1', [token]);

  req.flash('success_msg', 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
  res.redirect('/login');
});

// ==================== MENÚ PRINCIPAL ====================
app.get('/', async (req, res) => {
  try {
    const pizzas = (await db.query('SELECT * FROM pizzas WHERE active = 1')).rows;
    const sizes = (await db.query('SELECT * FROM sizes')).rows;
    const toppings = (await db.query('SELECT * FROM toppings')).rows;

    const priceRows = (await db.query('SELECT pizza_id, size_id, base_price FROM pizza_prices')).rows;
    const prices = {};
    for (const row of priceRows) {
      if (!prices[row.pizza_id]) prices[row.pizza_id] = {};
      prices[row.pizza_id][row.size_id] = row.base_price;
    }

    let notifications = [];
    if (req.session.user) {
      notifications = (await db.query('SELECT * FROM notifications WHERE user_id = $1 AND is_read = 0 ORDER BY created_at DESC', [req.session.user.id])).rows;
    }
    res.render('index', { pizzas, sizes, toppings, prices, notifications });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el menú');
  }
});

// ==================== PROCESAR PEDIDO ====================
app.post('/order', isAuthenticated, async (req, res) => {
  const { phone, pickup_time, payment_method, pizzas: pizzasData } = req.body;
  const user_id = req.session.user.id;

  if (!phone || !pickup_time || !payment_method) {
    return res.status(400).send('Faltan datos del cliente o método de pago.');
  }

  const phoneRegex = /^\d{4}-\d{7}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).send('Formato de teléfono inválido. Use: 0000-0000000');
  }

  const validAreaCodes = [
    '0212', '0241', '0251', '0261', '0271', '0281', '0291',
    '0410', '0412', '0414', '0416', '0418', '0420', '0424', '0426', '0428'
  ];
  const areaCode = phone.split('-')[0];
  if (!validAreaCodes.includes(areaCode)) {
    return res.status(400).send('Código de área no válido.');
  }

  const [hours, minutes] = pickup_time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes < 17 * 60 || totalMinutes > 23 * 60 + 59) {
    return res.status(400).send('La hora de recogida debe ser entre las 5:00 PM y las 11:59 PM.');
  }

  let total = 0;
  const orderItems = [];

  if (pizzasData) {
    for (const [index, data] of Object.entries(pizzasData)) {
      if (data.selected) {
        const pizza_id = parseInt(index) + 1;
        const size_id = parseInt(data.size);
        const quantity = parseInt(data.quantity) || 1;
        const topping_ids = [];
        if (data.toppings) {
          const rawToppings = Array.isArray(data.toppings) ? data.toppings : [data.toppings];
          for (const t of rawToppings) {
            topping_ids.push(parseInt(t));
          }
        }

        const priceRow = (await db.query('SELECT base_price FROM pizza_prices WHERE pizza_id = $1 AND size_id = $2', [pizza_id, size_id])).rows[0];
        if (!priceRow) continue;
        let base = priceRow.base_price;

        let toppingsCost = 0;
        for (const t_id of topping_ids) {
          const topping = (await db.query('SELECT extra_price FROM toppings WHERE id = $1', [t_id])).rows[0];
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

  const bebidasData = req.body.bebidas || {};
  const orderBebidas = [];
  for (const [bebidaId, qty] of Object.entries(bebidasData)) {
    const quantity = parseInt(qty) || 0;
    if (quantity > 0) {
      const bebida = (await db.query('SELECT name, price FROM bebidas WHERE id = $1 AND active = 1', [bebidaId])).rows[0];
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

  const customerName = req.session.user.name;

  const details = [];
  for (const item of orderItems) {
    const pizza = (await db.query('SELECT name FROM pizzas WHERE id = $1', [item.pizza_id])).rows[0];
    const size = (await db.query('SELECT label FROM sizes WHERE id = $1', [item.size_id])).rows[0];
    const toppingNames = [];
    for (const t_id of item.topping_ids) {
      const topping = (await db.query('SELECT name FROM toppings WHERE id = $1', [t_id])).rows[0];
      if (topping) toppingNames.push(topping.name);
    }
    details.push({
      pizzaName: pizza.name,
      sizeLabel: size.label,
      quantity: item.quantity,
      toppings: toppingNames,
      lineTotal: item.lineTotal
    });
  }

  const bebidaDetails = orderBebidas.map(b => ({
    name: b.name,
    quantity: b.quantity,
    lineTotal: b.lineTotal
  }));

  if (payment_method === 'Efectivo en local') {
    const insertOrder = await db.query(
      `INSERT INTO orders (user_id, customer_name, phone, pickup_time, payment_method, total, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
      [user_id, customerName, phone, pickup_time, payment_method, total.toFixed(2)]
    );
    const orderId = insertOrder.rows[0].id;

    for (const item of orderItems) {
      const insertItem = await db.query(
        'INSERT INTO order_items (order_id, pizza_id, size_id, quantity, line_total) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [orderId, item.pizza_id, item.size_id, item.quantity, item.lineTotal]
      );
      const orderItemId = insertItem.rows[0].id;
      for (const t_id of item.topping_ids) {
        await db.query('INSERT INTO order_item_toppings (order_item_id, topping_id) VALUES ($1, $2)', [orderItemId, t_id]);
      }
    }
    for (const b of orderBebidas) {
      await db.query('INSERT INTO order_bebidas (order_id, bebida_id, quantity, line_total) VALUES ($1, $2, $3, $4)',
        [orderId, b.bebida_id, b.quantity, b.lineTotal]);
    }

    io.emit('nuevo_pedido', { id: orderId, customer_name: customerName, total: total.toFixed(2), status: 'pending', created_at: new Date().toISOString() });

    return res.render('order-confirmation', {
      customerName,
      pickup_time,
      payment_method,
      items: details,
      bebidas: bebidaDetails,
      total: total.toFixed(2)
    });
  }

  // Métodos de pago con comprobante/referencia: NO se crea el pedido en la BD
  // hasta que el usuario proporcione el número de referencia o suba el comprobante.
  req.session.pendingOrder = {
    user_id,
    customerName,
    phone,
    pickup_time,
    payment_method,
    total: total.toFixed(2),
    orderItems,
    orderBebidas,
    details,
    bebidaDetails
  };
  res.redirect('/payment');
});

// ==================== RUTAS ADMIN ====================
// Middleware que bloquea el acceso a usuarios que no son admin.
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Acceso denegado. Solo administradores.');
}

// --- Dashboard del administrador ---
app.get('/admin', isAdmin, async (req, res) => {
  const totalRevenue = (await db.query('SELECT COALESCE(SUM(total), 0) as total FROM orders')).rows[0].total;
  const totalOrders = (await db.query('SELECT COUNT(*) as count FROM orders')).rows[0].count;
  const activePizzas = (await db.query('SELECT COUNT(*) as count FROM pizzas WHERE active = 1')).rows[0].count;
  const totalToppings = (await db.query('SELECT COUNT(*) as count FROM toppings')).rows[0].count;
  
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const ordersToday = (await db.query('SELECT COUNT(*) as count FROM orders WHERE created_at::date = $1', [today])).rows[0].count;
  const ordersYesterday = (await db.query('SELECT COUNT(*) as count FROM orders WHERE created_at::date = $1', [yesterday])).rows[0].count;

  const ordersByStatus = {
    pending: (await db.query("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'")).rows[0].count,
    confirmed: (await db.query("SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'")).rows[0].count,
    ready: (await db.query("SELECT COUNT(*) as count FROM orders WHERE status = 'ready'")).rows[0].count,
    delivered: (await db.query("SELECT COUNT(*) as count FROM orders WHERE status = 'delivered'")).rows[0].count
  };

  const topPizzas = (await db.query(`
    SELECT p.name, SUM(oi.quantity) as total_sold
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    GROUP BY oi.pizza_id, p.name
    ORDER BY total_sold DESC
    LIMIT 5
  `)).rows;

  const topToppings = (await db.query(`
    SELECT t.name, COUNT(*) as times_used
    FROM order_item_toppings oit
    JOIN toppings t ON oit.topping_id = t.id
    GROUP BY oit.topping_id, t.name
    ORDER BY times_used DESC
    LIMIT 5
  `)).rows;

  const topSizes = (await db.query(`
    SELECT s.label, COUNT(*) as times_used
    FROM order_items oi
    JOIN sizes s ON oi.size_id = s.id
    GROUP BY oi.size_id, s.label
    ORDER BY times_used DESC
  `)).rows;

  const recentOrders = (await db.query(`
    SELECT id, customer_name, total, status, created_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT 5
  `)).rows;

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
    recentOrders
  });
});

// --- Pizzas ---
app.get('/admin/pizzas', isAdmin, async (req, res) => {
  const pizzas = (await db.query('SELECT * FROM pizzas ORDER BY id')).rows;
  res.render('admin-pizzas', { pizzas });
});

app.get('/admin/pizzas/add', isAdmin, async (req, res) => {
  const sizes = (await db.query('SELECT * FROM sizes')).rows;
  res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: null });
});

app.post('/admin/pizzas/add', isAdmin, async (req, res) => {
  const { name, description, active } = req.body;

  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    const sizes = (await db.query('SELECT * FROM sizes')).rows;
    return res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: 'Nombre de pizza inválido (solo letras y espacios).' });
  }

  if (description && !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s.,]+$/.test(description.trim())) {
    const sizes = (await db.query('SELECT * FROM sizes')).rows;
    return res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: 'La descripción no puede contener números.' });
  }

  const sizes = (await db.query('SELECT * FROM sizes')).rows;
  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    if (isNaN(priceValue) || priceValue < 0) {
      return res.render('admin-pizza-form', { pizza: null, sizes, prices: {}, error: `El precio para ${size.label} no puede ser negativo.` });
    }
  }

  const result = await db.query('INSERT INTO pizzas (name, description, active) VALUES ($1, $2, $3) RETURNING id',
    [name, description || null, active || 1]);
  const pizzaId = result.rows[0].id;

  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    await db.query('INSERT INTO pizza_prices (pizza_id, size_id, base_price) VALUES ($1, $2, $3)',
      [pizzaId, size.id, priceValue]);
  }

  req.flash('success_msg', 'Pizza creada');
  res.redirect('/admin/pizzas');
});

app.get('/admin/pizzas/edit/:id', isAdmin, async (req, res) => {
  const pizza = (await db.query('SELECT * FROM pizzas WHERE id = $1', [req.params.id])).rows[0];
  if (!pizza) return res.status(404).send('Pizza no encontrada');
  const sizes = (await db.query('SELECT * FROM sizes')).rows;
  const priceRows = (await db.query('SELECT size_id, base_price FROM pizza_prices WHERE pizza_id = $1', [pizza.id])).rows;
  const prices = {};
  priceRows.forEach(row => { prices[row.size_id] = row.base_price; });
  res.render('admin-pizza-form', { pizza, sizes, prices, error: null });
});

app.post('/admin/pizzas/edit/:id', isAdmin, async (req, res) => {
  const pizza = (await db.query('SELECT * FROM pizzas WHERE id = $1', [req.params.id])).rows[0];
  if (!pizza) return res.status(404).send('Pizza no encontrada');
  const { name, description, active } = req.body;

  const sizes = (await db.query('SELECT * FROM sizes')).rows;

  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    return res.render('admin-pizza-form', { pizza, sizes, prices: {}, error: 'Nombre inválido.' });
  }

  if (description && !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s.,]+$/.test(description.trim())) {
    return res.render('admin-pizza-form', { pizza, sizes, prices: {}, error: 'Descripción inválida (no puede contener números).' });
  }

  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    if (isNaN(priceValue) || priceValue < 0) {
      return res.render('admin-pizza-form', { pizza, sizes, prices: {}, error: `El precio para ${size.label} no puede ser negativo.` });
    }
  }

  await db.query('UPDATE pizzas SET name = $1, description = $2, active = $3 WHERE id = $4',
    [name, description || null, active, pizza.id]);

  for (const size of sizes) {
    const priceValue = parseFloat(req.body['price_' + size.id] || 0);
    await db.query('DELETE FROM pizza_prices WHERE pizza_id = $1 AND size_id = $2', [pizza.id, size.id]);
    await db.query('INSERT INTO pizza_prices (pizza_id, size_id, base_price) VALUES ($1, $2, $3)',
      [pizza.id, size.id, priceValue]);
  }

  req.flash('success_msg', 'Pizza actualizada');
  res.redirect('/admin/pizzas');
});

app.post('/admin/pizzas/delete/:id', isAdmin, async (req, res) => {
  const count = (await db.query('SELECT COUNT(*) as count FROM order_items WHERE pizza_id = $1', [req.params.id])).rows[0].count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, hay pedidos que la incluyen');
    return res.redirect('/admin/pizzas');
  }
  await db.query('DELETE FROM pizza_prices WHERE pizza_id = $1', [req.params.id]);
  await db.query('DELETE FROM pizzas WHERE id = $1', [req.params.id]);
  req.flash('success_msg', 'Pizza eliminada');
  res.redirect('/admin/pizzas');
});

// --- Tamaños ---
app.get('/admin/sizes', isAdmin, async (req, res) => {
  const sizes = (await db.query('SELECT * FROM sizes ORDER BY id')).rows;
  res.render('admin-sizes', { sizes });
});

app.post('/admin/sizes/add', isAdmin, async (req, res) => {
  const { label } = req.body;
  if (!label || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(label.trim())) {
    req.flash('error_msg', 'Etiqueta inválida (solo letras y espacios)');
    return res.redirect('/admin/sizes');
  }

  const result = await db.query('INSERT INTO sizes (label) VALUES ($1) RETURNING id', [label]);
  const sizeId = result.rows[0].id;

  const pizzas = (await db.query('SELECT id FROM pizzas')).rows;
  for (const p of pizzas) {
    await db.query('INSERT INTO pizza_prices (pizza_id, size_id, base_price) VALUES ($1, $2, 0.0)',
      [p.id, sizeId]);
  }

  req.flash('success_msg', 'Tamaño agregado');
  res.redirect('/admin/sizes');
});

app.get('/admin/sizes/edit/:id', isAdmin, async (req, res) => {
  const size = (await db.query('SELECT * FROM sizes WHERE id = $1', [req.params.id])).rows[0];
  if (!size) return res.status(404).send('Tamaño no encontrado');
  res.render('admin-size-edit', { size });
});

app.post('/admin/sizes/edit/:id', isAdmin, async (req, res) => {
  const { label } = req.body;
  const sizeId = req.params.id;
  if (!label || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(label.trim())) {
    req.flash('error_msg', 'Etiqueta inválida');
    return res.redirect(`/admin/sizes/edit/${sizeId}`);
  }
  await db.query('UPDATE sizes SET label = $1 WHERE id = $2', [label, req.params.id]);
  req.flash('success_msg', 'Tamaño actualizado');
  res.redirect('/admin/sizes');
});

app.post('/admin/sizes/delete/:id', isAdmin, async (req, res) => {
  const count = (await db.query('SELECT COUNT(*) as count FROM order_items WHERE size_id = $1', [req.params.id])).rows[0].count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, hay pedidos que lo usan');
    return res.redirect('/admin/sizes');
  }
  await db.query('DELETE FROM pizza_prices WHERE size_id = $1', [req.params.id]);
  await db.query('DELETE FROM sizes WHERE id = $1', [req.params.id]);
  req.flash('success_msg', 'Tamaño eliminado');
  res.redirect('/admin/sizes');
});

// --- Toppings ---
app.get('/admin/toppings', isAdmin, async (req, res) => {
  const toppings = (await db.query('SELECT * FROM toppings ORDER BY id')).rows;
  res.render('admin-toppings', { toppings });
});

app.post('/admin/toppings/add', isAdmin, async (req, res) => {
  const { name, extra_price } = req.body;
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    req.flash('error_msg', 'Nombre inválido (solo letras y espacios)');
    return res.redirect('/admin/toppings');
  }
  const price = parseFloat(extra_price);
  if (isNaN(price) || price < 0) {
    req.flash('error_msg', 'Precio inválido (debe ser positivo)');
    return res.redirect('/admin/toppings');
  }
  await db.query('INSERT INTO toppings (name, extra_price) VALUES ($1, $2)', [name.trim(), price]);
  req.flash('success_msg', 'Ingrediente agregado');
  res.redirect('/admin/toppings');
});

app.get('/admin/toppings/edit/:id', isAdmin, async (req, res) => {
  const topping = (await db.query('SELECT * FROM toppings WHERE id = $1', [req.params.id])).rows[0];
  if (!topping) return res.status(404).send('Ingrediente no encontrado');
  res.render('admin-topping-edit', { topping });
});

app.post('/admin/toppings/edit/:id', isAdmin, async (req, res) => {
  const { name, extra_price } = req.body;
  const id = req.params.id;
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    req.flash('error_msg', 'Nombre inválido');
    return res.redirect(`/admin/toppings/edit/${id}`);
  }
  const price = parseFloat(extra_price);
  if (isNaN(price) || price < 0) {
    req.flash('error_msg', 'Precio inválido');
    return res.redirect(`/admin/toppings/edit/${id}`);
  }
  await db.query('UPDATE toppings SET name = $1, extra_price = $2 WHERE id = $3', [name.trim(), price, id]);
  req.flash('success_msg', 'Ingrediente actualizado');
  res.redirect('/admin/toppings');
});

app.post('/admin/toppings/delete/:id', isAdmin, async (req, res) => {
  const count = (await db.query('SELECT COUNT(*) as count FROM order_item_toppings WHERE topping_id = $1', [req.params.id])).rows[0].count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, está en pedidos');
    return res.redirect('/admin/toppings');
  }
  await db.query('DELETE FROM toppings WHERE id = $1', [req.params.id]);
  req.flash('success_msg', 'Ingrediente eliminado');
  res.redirect('/admin/toppings');
});

// --- Bebidas ---
app.get('/admin/bebidas', isAdmin, async (req, res) => {
  const bebidas = (await db.query('SELECT * FROM bebidas ORDER BY id')).rows;
  res.render('admin-bebidas', { bebidas });
});

app.post('/admin/bebidas/add', isAdmin, async (req, res) => {
  const { name, price } = req.body;
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    req.flash('error_msg', 'Nombre inválido (solo letras y espacios)');
    return res.redirect('/admin/bebidas');
  }
  const priceValue = parseFloat(price);
  if (isNaN(priceValue) || priceValue < 0) {
    req.flash('error_msg', 'Precio inválido (debe ser positivo)');
    return res.redirect('/admin/bebidas');
  }
  await db.query('INSERT INTO bebidas (name, price, active) VALUES ($1, $2, 1)', [name.trim(), priceValue]);
  req.flash('success_msg', 'Bebida agregada');
  res.redirect('/admin/bebidas');
});

app.get('/admin/bebidas/edit/:id', isAdmin, async (req, res) => {
  const bebida = (await db.query('SELECT * FROM bebidas WHERE id = $1', [req.params.id])).rows[0];
  if (!bebida) return res.status(404).send('Bebida no encontrada');
  res.render('admin-bebida-edit', { bebida, error: null });
});

app.post('/admin/bebidas/edit/:id', isAdmin, async (req, res) => {
  const bebida = (await db.query('SELECT * FROM bebidas WHERE id = $1', [req.params.id])).rows[0];
  if (!bebida) return res.status(404).send('Bebida no encontrada');
  const { name, price, active } = req.body;
  if (!name || !/^[A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+$/.test(name.trim())) {
    return res.render('admin-bebida-edit', { bebida, error: 'Nombre inválido (solo letras y espacios).' });
  }
  const priceValue = parseFloat(price);
  if (isNaN(priceValue) || priceValue < 0) {
    return res.render('admin-bebida-edit', { bebida, error: 'Precio inválido (debe ser positivo).' });
  }
  await db.query('UPDATE bebidas SET name = $1, price = $2, active = $3 WHERE id = $4',
    [name.trim(), priceValue, active || 0, req.params.id]);
  req.flash('success_msg', 'Bebida actualizada');
  res.redirect('/admin/bebidas');
});

app.post('/admin/bebidas/delete/:id', isAdmin, async (req, res) => {
  const count = (await db.query('SELECT COUNT(*) as count FROM order_bebidas WHERE bebida_id = $1', [req.params.id])).rows[0].count;
  if (count > 0) {
    req.flash('error_msg', 'No se puede eliminar, hay pedidos que la incluyen');
    return res.redirect('/admin/bebidas');
  }
  await db.query('DELETE FROM bebidas WHERE id = $1', [req.params.id]);
  req.flash('success_msg', 'Bebida eliminada');
  res.redirect('/admin/bebidas');
});

// --- Pedidos ---
app.get('/admin/orders', isAdmin, async (req, res) => {
  const { nombre, telefono, fecha } = req.query;
  let sql = 'SELECT * FROM orders';
  const conditions = [];
  const params = [];

  if (nombre && nombre.trim() !== '') {
    params.push(`%${nombre.trim()}%`);
    conditions.push(`customer_name LIKE $${params.length}`);
  }
  if (telefono && telefono.trim() !== '') {
    params.push(`%${telefono.trim()}%`);
    conditions.push(`phone LIKE $${params.length}`);
  }
  if (fecha && fecha.trim() !== '') {
    params.push(fecha.trim());
    conditions.push(`created_at::date = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC';

  const ordersResult = await db.query(sql, params);
  const orders = ordersResult.rows;

  for (const order of orders) {
    const items = (await db.query(`
      SELECT oi.*, p.name as pizza_name, s.label as size_label
      FROM order_items oi
      JOIN pizzas p ON oi.pizza_id = p.id
      JOIN sizes s ON oi.size_id = s.id
      WHERE oi.order_id = $1
    `, [order.id])).rows;

    for (const item of items) {
      const toppingRows = (await db.query(`
        SELECT t.name FROM order_item_toppings oit
        JOIN toppings t ON oit.topping_id = t.id
        WHERE oit.order_item_id = $1
      `, [item.id])).rows;
      item.toppings = toppingRows.map(t => t.name);
    }
    order.items = items;
  }

  res.render('admin-orders', { orders, nombre, telefono, fecha });
});

// ==================== PEDIDOS DEL CLIENTE ====================

// Página "Arma tu pedido" (formulario multi-paso del cliente).
app.get('/order', isAuthenticated, async (req, res) => {
  const pizzas = (await db.query('SELECT * FROM pizzas WHERE active = 1')).rows;
  const sizes = (await db.query('SELECT * FROM sizes')).rows;
  const toppings = (await db.query('SELECT * FROM toppings')).rows;
  const bebidas = (await db.query('SELECT * FROM bebidas WHERE active = 1')).rows;

  const priceRows = (await db.query('SELECT pizza_id, size_id, base_price FROM pizza_prices')).rows;
  const prices = {};
  for (const row of priceRows) {
    if (!prices[row.pizza_id]) prices[row.pizza_id] = {};
    prices[row.pizza_id][row.size_id] = row.base_price;
  }

  res.render('order', { pizzas, sizes, toppings, prices, bebidas });
});

// Detalle de un pedido del cliente logueado (solo el suyo).
app.get('/order-detail/:id', isAuthenticated, async (req, res) => {
  const order = (await db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id])).rows[0];
  if (!order) return res.status(404).send('Pedido no encontrado');

  const items = (await db.query(`
    SELECT oi.*, p.name as pizza_name, s.label as size_label
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    JOIN sizes s ON oi.size_id = s.id
    WHERE oi.order_id = $1
  `, [order.id])).rows;

  for (const item of items) {
    const toppingRows = (await db.query(`
      SELECT t.name FROM order_item_toppings oit
      JOIN toppings t ON oit.topping_id = t.id
      WHERE oit.order_item_id = $1
    `, [item.id])).rows;
    item.toppings = toppingRows.map(t => t.name);
  }

  const bebidas = (await db.query(`
    SELECT b.name, ob.quantity, ob.line_total
    FROM order_bebidas ob
    JOIN bebidas b ON ob.bebida_id = b.id
    WHERE ob.order_id = $1
  `, [order.id])).rows;

  res.render('order-detail', { order, items, bebidas });
});

// ==================== NOTIFICACIONES ====================
// Endpoints usados por la campanita de notificaciones del cliente.
app.post('/notification/:id/read', isAuthenticated, async (req, res) => {
  await db.query('UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
  res.json({ success: true });
});

app.post('/notification/:id/delete', isAuthenticated, async (req, res) => {
  await db.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
  res.json({ success: true });
});

app.post('/notifications/delete-all', isAuthenticated, async (req, res) => {
  await db.query('DELETE FROM notifications WHERE user_id = $1', [req.session.user.id]);
  res.json({ success: true });
});

app.post('/admin/orders/:id/status', isAdmin, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'ready', 'delivered'];
  if (!validStatuses.includes(status)) {
    req.flash('error_msg', 'Estado inválido');
    return res.redirect('/admin/orders');
  }

  const order = (await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) {
    req.flash('error_msg', 'Pedido no encontrado');
    return res.redirect('/admin/orders');
  }

  await db.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);

  if (status === 'ready' || status === 'delivered') {
    const message = status === 'ready'
      ? `Tu pedido #${order.id} está listo para recoger.`
      : `Tu pedido #${order.id} ha sido entregado. ¡Buen provecho!`;

    const notif = await db.query('INSERT INTO notifications (user_id, order_id, message) VALUES ($1, $2, $3) RETURNING id',
      [order.user_id, order.id, message]);
    const notifId = notif.rows[0].id;

    io.to(`user_${order.user_id}`).emit('notification', {
      id: notifId,
      message,
      order_id: order.id,
      is_read: 0,
      created_at: new Date().toISOString()
    });
  }

  req.flash('success_msg', 'Estado actualizado');
  res.redirect('/admin/orders');
});

app.get('/admin/orders/:id/print', isAdmin, async (req, res) => {
  const order = (await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).send('Pedido no encontrado');

  const items = (await db.query(`
    SELECT oi.*, p.name as pizza_name, s.label as size_label
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    JOIN sizes s ON oi.size_id = s.id
    WHERE oi.order_id = $1
  `, [order.id])).rows;

  for (const item of items) {
    const toppingRows = (await db.query(`
      SELECT t.name FROM order_item_toppings oit
      JOIN toppings t ON oit.topping_id = t.id
      WHERE oit.order_item_id = $1
    `, [item.id])).rows;
    item.toppings = toppingRows.map(t => t.name);
  }

  const bebidas = (await db.query(`
    SELECT b.name, ob.quantity, ob.line_total
    FROM order_bebidas ob
    JOIN bebidas b ON ob.bebida_id = b.id
    WHERE ob.order_id = $1
  `, [order.id])).rows;

  res.render('print-order', { order, items, bebidas });
});

app.post('/admin/orders/delete/:id', isAdmin, async (req, res) => {
  await db.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
  req.flash('success_msg', 'Pedido eliminado');
  res.redirect('/admin/orders');
});

app.post('/admin/orders/delete-all', isAdmin, async (req, res) => {
  await db.query('DELETE FROM orders');
  req.flash('success_msg', 'Todos los pedidos han sido eliminados');
  res.redirect('/admin/orders');
});

// --- Pagos ---
app.get('/payment', isAuthenticated, (req, res) => {
  const pending = req.session.pendingOrder;
  if (!pending) {
    return res.status(404).send('No hay un pedido pendiente de pago.');
  }
  const order = {
    id: null,
    total: pending.total,
    payment_method: pending.payment_method
  };
  res.render('payment', { order, error: null, paymentData: paymentInfo[pending.payment_method] || null });
});

app.post('/payment', isAuthenticated, upload.single('receipt'), csrfProtection, async (req, res) => {
  const pending = req.session.pendingOrder;
  if (!pending) {
    return res.status(404).send('No hay un pedido pendiente de pago.');
  }

  const { payment_ref } = req.body;
  let payment_receipt = null;
  if (req.file) {
    payment_receipt = '/uploads/' + req.file.filename;
  }

  const paymentData = paymentInfo[pending.payment_method] || null;
  const orderView = {
    id: null,
    total: pending.total,
    payment_method: pending.payment_method
  };

  if (!payment_ref && !payment_receipt) {
    return res.render('payment', { order: orderView, error: 'Debes ingresar número de referencia o subir comprobante', paymentData });
  }

  if (payment_ref && !/^\d{6}$/.test(payment_ref)) {
    return res.render('payment', { order: orderView, error: 'La referencia debe contener exactamente 6 dígitos.', paymentData });
  }

  // El pedido solo se crea en la BD cuando el usuario proporciona
  // el número de referencia o sube el comprobante.
  const insertOrder = await db.query(
    `INSERT INTO orders (user_id, customer_name, phone, pickup_time, payment_method, payment_status, payment_ref, payment_receipt, total, status)
     VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, 'pending') RETURNING id`,
    [pending.user_id, pending.customerName, pending.phone, pending.pickup_time, pending.payment_method,
     payment_ref || null, payment_receipt, pending.total]
  );
  const orderId = insertOrder.rows[0].id;

  for (const item of pending.orderItems) {
    const insertItem = await db.query(
      'INSERT INTO order_items (order_id, pizza_id, size_id, quantity, line_total) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [orderId, item.pizza_id, item.size_id, item.quantity, item.lineTotal]
    );
    const orderItemId = insertItem.rows[0].id;
    for (const t_id of item.topping_ids) {
      await db.query('INSERT INTO order_item_toppings (order_item_id, topping_id) VALUES ($1, $2)', [orderItemId, t_id]);
    }
  }
  for (const b of pending.orderBebidas) {
    await db.query('INSERT INTO order_bebidas (order_id, bebida_id, quantity, line_total) VALUES ($1, $2, $3, $4)',
      [orderId, b.bebida_id, b.quantity, b.lineTotal]);
  }

  delete req.session.pendingOrder;

  io.emit('pago_realizado', { id: orderId, customer_name: pending.customerName, total: pending.total });
  io.emit('nuevo_pedido', { id: orderId, customer_name: pending.customerName, total: pending.total, status: 'pending', created_at: new Date().toISOString() });

  res.redirect(`/order-confirmation/${orderId}`);
});

// ==================== CONFIRMACIÓN DE PEDIDO ====================
// Muestra el resumen del pedido completado (cliente).
app.get('/order-confirmation/:id', isAuthenticated, async (req, res) => {
  const order = (await db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id])).rows[0];
  if (!order) return res.status(404).send('Pedido no encontrado');

  const items = (await db.query(`
    SELECT oi.*, p.name as pizza_name, s.label as size_label
    FROM order_items oi
    JOIN pizzas p ON oi.pizza_id = p.id
    JOIN sizes s ON oi.size_id = s.id
    WHERE oi.order_id = $1
  `, [order.id])).rows;

  const details = [];
  for (const item of items) {
    const toppingRows = (await db.query(`
      SELECT t.name FROM order_item_toppings oit
      JOIN toppings t ON oit.topping_id = t.id
      WHERE oit.order_item_id = $1
    `, [item.id])).rows;
    details.push({
      quantity: item.quantity,
      pizzaName: item.pizza_name,
      sizeLabel: item.size_label,
      toppings: toppingRows.map(t => t.name),
      lineTotal: item.line_total
    });
  }

  const bebidas = (await db.query(`
    SELECT b.name, ob.quantity, ob.line_total
    FROM order_bebidas ob
    JOIN bebidas b ON ob.bebida_id = b.id
    WHERE ob.order_id = $1
  `, [order.id])).rows;

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

// El administrador confirma o rechaza el pago de un pedido
// (botones "Confirmar pago" / "Rechazar pago" en admin-orders).
app.post('/admin/orders/:id/payment', isAdmin, async (req, res) => {
  const { payment_status } = req.body;

  if (!['paid', 'rejected'].includes(payment_status)) {
    req.flash('error_msg', 'Estado de pago inválido');
    return res.redirect('/admin/orders');
  }

  const order = (await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) {
    req.flash('error_msg', 'Pedido no encontrado');
    return res.redirect('/admin/orders');
  }

  await db.query('UPDATE orders SET payment_status = $1 WHERE id = $2', [payment_status, order.id]);

  if (payment_status === 'paid') {
    const message = `Tu pedido #${order.id} ha sido confirmado y está en preparación.`;
    const notif = await db.query('INSERT INTO notifications (user_id, order_id, message) VALUES ($1, $2, $3) RETURNING id',
      [order.user_id, order.id, message]);
    const notifId = notif.rows[0].id;

    io.to(`user_${order.user_id}`).emit('notification', {
      id: notifId,
      message,
      order_id: order.id,
      is_read: 0,
      created_at: new Date().toISOString()
    });
  }

  req.flash('success_msg', 'Estado de pago actualizado');
  res.redirect('/admin/orders');
});

server.listen(PORT, () => {
  console.log(`🍕 Servidor corriendo en http://localhost:${PORT}`);
});