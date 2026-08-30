# 🍕 Bella Napoli — Pizzería Artesanal (Pedidos Web)

Aplicación web completa para una pizzería que permite a los clientes **armar su pedido de pizza en línea** (pizzas, tamaños, ingredientes extra y bebidas), elegir un **método de pago**, subir su **comprobante** (o ingresar la referencia) y seguir el estado del pedido en tiempo real mediante **notificaciones**. Incluye un **panel de administración** para gestionar menú, pedidos y pagos.

> Stack: **Node.js + Express + EJS (TailwindCSS) + PostgreSQL + Socket.IO**

---

## Tabla de contenidos

- [Características](#características)
- [Tecnologías](#tecnologías)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos previos](#requisitos-previos)
- [Instalación](#instalación)
- [Configuración (variables de entorno)](#configuración-variables-de-entorno)
- [Uso](#uso)
  - [Scripts disponibles](#scripts-disponibles)
  - [Credenciales por defecto](#credenciales-por-defecto)
- [Rutas y funcionalidad](#rutas-y-funcionalidad)
  - [Rutas públicas](#rutas-públicas)
  - [Rutas de cliente (autenticado)](#rutas-de-cliente-autenticado)
  - [Rutas de administrador](#rutas-de-administrador)
- [Esquema de la base de datos](#esquema-de-la-base-de-datos)
- [Flujo de un pedido](#flujo-de-un-pedido)
- [Seguridad](#seguridad)
- [Sesiones y despliegue](#sesiones-y-despliegue)
- [Despliegue en Render (o similar)](#despliegue-en-render-o-similar)
- [Solución de problemas](#solución-de-problemas)
- [Créditos y licencia](#créditos-y-licencia)

---

## Características

**Para clientes**
- Registro e inicio de sesión con validaciones robustas (formato de correo, dominios permitidos y fortaleza de contraseña).
- Recuperación de contraseña mediante enlace con token.
- Formulario multi-paso "Arma tu pedido":
  1. Elección de pizzas, tamaño (Mediana / Grande), cantidad y **ingredientes extra (toppings)**.
  2. Pregunta si desea bebidas.
  3. Selección de bebidas / acompañantes.
  4. Datos de contacto, hora de recogida (17:00–23:59) y método de pago.
- **Resumen del pedido y total en tiempo real** mientras se seleccionan productos.
- **Steppers táctiles (− / +)** para cantidades que funcionan también en celulares (no solo en PC).
- Pago con **número de referencia u subida de comprobante** (imagen). El pedido **solo se crea en la base de datos** si se proporciona referencia o comprobante.
- Estado del pedido en tiempo real (listo para recoger / entregado) a través de **notificaciones (Socket.IO)**.

**Para administradores**
- Dashboard con métricas: ingresos, total de pedidos, pizzas activas, ingredientes, pedidos de hoy/ayer, estados, productos más vendidos y últimos pedidos.
- CRUD de **pizzas** (con precios por tamaño), **tamaños**, **ingredientes** y **bebidas**.
- Gestión de **pedidos**: búsqueda/filtros (nombre, teléfono, fecha), cambio de estado, **impresión de comanda**, ver el comprobante, eliminar pedidos y **confirmar/rechazar pagos**.
- Notificaciones sonoras y contador de pedidos pendientes en tiempo real.

---

## Tecnologías

| Capa      | Tecnología                                                         |
|-----------|--------------------------------------------------------------------|
| Backend   | Node.js, Express 5, Socket.IO                                      |
| Plantillas| EJS + TailwindCSS (CDN) + Google Fonts (Playfair Display / Inter)  |
| Base datos| PostgreSQL (`pg`)                                                  |
| Sesiones  | `express-session` + `connect-pg-simple` (store persistente en PG)  |
| Seguridad | `csurf` (CSRF), `bcryptjs` (contraseñas), `connect-flash` (mensajes) |
| Archivos  | `multer` (subida de comprobantes a `public/uploads/`)              |
| Utilidades| `dotenv`, `cookie-parser`, `body-parser`, `node-cron` (no usado aún)|

---

## Estructura del proyecto

```
pizza-proyecto/
├── server.js            # Punto de entrada: rutas, middlewares, Socket.IO
├── database.js          # Pool PostgreSQL + creación de tablas + datos semilla
├── seed-admin.js        # Script para crear el usuario administrador
├── package.json         # Dependencias y scripts
├── .env                 # Variables de entorno (NO se sube a git)
├── .gitignore
└── views/               # Plantillas EJS
    ├── csrf.ejs             # (partial) campo oculto _csrf
    ├── modal-confirm.ejs    # (partial) modal de confirmación
    ├── admin-sidebar.ejs    # (partial) barra lateral del admin
    ├── index.ejs            # Página principal / menú
    ├── login.ejs            # Inicio de sesión
    ├── register.ejs         # Registro
    ├── forgot-password.ejs  # Recuperar contraseña
    ├── reset-password.ejs   # Establecer nueva contraseña
    ├── order.ejs            # Formulario "Arma tu pedido" (multi-paso)
    ├── payment.ejs          # Pantalla de pago / comprobante
    ├── order-confirmation.ejs # Confirmación y resumen del pedido
    ├── order-detail.ejs     # Detalle de un pedido del cliente
    ├── print-order.ejs      # Comanda (imprimible)
    └── admin*.ejs           # Vistas del panel de administración
```

> **Consejo:** cada archivo de `views/` incluye un comentario de cabecera explicando qué variables recibe y qué hace la vista.

---

## Requisitos previos

- **Node.js** v18 o superior (proyecto usa ECMAScript CommonJS).
- **PostgreSQL** (local o en la nube, p. ej. Supabase o Render Postgres).
- **npm** (viene con Node).

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone <url-del-repositorio>
cd pizza-proyecto

# 2. Instalar dependencias
npm install
```

---

## Configuración (variables de entorno)

Crea un archivo `.env` en la raíz del proyecto. Toma como referencia `.env.example` (si lo tienes) o usa estas variables mínimas:

```env
# Secreto para firmar las cookies de sesión (¡cámbialo!)
SESSION_SECRET=una-cadena-larga-y-secreta

# Puerto del servidor (opcional, por defecto 3000)
PORT=3000

# URL de conexión a PostgreSQL
DATABASE_URL=postgres://usuario:password@host:puerto/nombre_db

# (Opcional) Ruta SQLite legada — no se usa en esta versión
DATABASE_PATH=...
```

> ⚠️ **Importante:** el archivo `.env` **no debe** subirse a git (ya está en `.gitignore`). Contiene credenciales.

---

## Uso

### Scripts disponibles

| Comando             | Descripción                                  |
|---------------------|----------------------------------------------|
| `npm start`         | Ejecuta el servidor en producción            |
| `npm run dev`       | Ejecuta con `nodemon` (recarga automática)   |
| `node seed-admin.js`| Crea el usuario administrador por defecto    |

### Credenciales por defecto

Tras ejecutar `node seed-admin.js`, el usuario administrador creado es:

```
Correo:     admin@pizzeria.com
Contraseña: admin123
```

> ⚠️ Cambia estas credenciales después del primer inicio de sesión.

---

## Rutas y funcionalidad

### Rutas públicas
| Método | Ruta                  | Descripción                                  |
|--------|-----------------------|----------------------------------------------|
| GET    | `/`                   | Página principal / menú                      |
| GET    | `/register`           | Mostrar formulario de registro               |
| POST   | `/register`           | Procesar registro                            |
| GET    | `/login`              | Mostrar formulario de inicio de sesión       |
| POST   | `/login`              | Procesar inicio de sesión                    |
| GET    | `/logout`             | Cerrar sesión                                |
| GET    | `/forgot-password`    | Mostrar solicitud de recuperación            |
| POST   | `/forgot-password`    | Generar token de recuperación                |
| GET    | `/reset-password/:token` | Mostrar formulario para nueva contraseña  |
| POST   | `/reset-password/:token` | Actualizar contraseña                      |

### Rutas de cliente (autenticado)
| Método | Ruta                    | Descripción                                            |
|--------|-------------------------|--------------------------------------------------------|
| GET    | `/order`                | Formulario "Arma tu pedido" (multi-paso)                |
| POST   | `/order`                | Procesar pedido (guarda en sesión si hay que pagar)     |
| GET    | `/payment`              | Pantalla de pago (referencia / comprobante)             |
| POST   | `/payment`              | Confirmar pago y **crear el pedido** en la BD           |
| GET    | `/order-confirmation/:id` | Resumen del pedido completado                         |
| GET    | `/order-detail/:id`     | Detalle de un pedido del cliente                        |
| POST   | `/notification/:id/read`| Marcar notificación como leída                          |
| POST   | `/notification/:id/delete` | Eliminar notificación                               |
| POST   | `/notifications/delete-all` | Eliminar todas las notificaciones                    |

### Rutas de administrador
| Método | Ruta                              | Descripción                              |
|--------|-----------------------------------|------------------------------------------|
| GET    | `/admin`                          | Dashboard                                |
| GET    | `/admin/pizzas`                   | Listado de pizzas                        |
| GET/POST| `/admin/pizzas/add`              | Crear pizza                              |
| GET/POST| `/admin/pizzas/edit/:id`         | Editar pizza                             |
| POST   | `/admin/pizzas/delete/:id`        | Eliminar pizza                           |
| GET    | `/admin/sizes`                    | Listado de tamaños                       |
| POST   | `/admin/sizes/add`                | Agregar tamaño                           |
| GET/POST| `/admin/sizes/edit/:id`          | Editar tamaño                            |
| POST   | `/admin/sizes/delete/:id`         | Eliminar tamaño                          |
| GET    | `/admin/toppings`                 | Listado de ingredientes                  |
| POST   | `/admin/toppings/add`             | Agregar ingrediente                      |
| GET/POST| `/admin/toppings/edit/:id`       | Editar ingrediente                       |
| POST   | `/admin/toppings/delete/:id`      | Eliminar ingrediente                     |
| GET    | `/admin/bebidas`                  | Listado de bebidas                       |
| POST   | `/admin/bebidas/add`              | Agregar bebida                           |
| GET/POST| `/admin/bebidas/edit/:id`        | Editar bebida                            |
| POST   | `/admin/bebidas/delete/:id`       | Eliminar bebida                          |
| GET    | `/admin/orders`                   | Gestión de pedidos (con filtros)         |
| POST   | `/admin/orders/:id/status`        | Cambiar estado del pedido                |
| GET    | `/admin/orders/:id/print`         | Imprimir comanda                         |
| POST   | `/admin/orders/delete/:id`        | Eliminar pedido                          |
| POST   | `/admin/orders/delete-all`        | Eliminar todos los pedidos               |
| POST   | `/admin/orders/:id/payment`       | Confirmar / rechazar pago                |

> El acceso a rutas de administrador está protegido por el middleware `isAdmin` (role `admin`).

---

## Esquema de la base de datos

Creadas automáticamente por `database.js` (con `CREATE TABLE IF NOT EXISTS`):

| Tabla                | Descripción                                   |
|----------------------|-----------------------------------------------|
| `users`              | Usuarios (`customer` / `admin`)               |
| `pizzas`             | Pizzas del menú                               |
| `sizes`              | Tamaños (Mediana, Grande…)                    |
| `pizza_prices`       | Precio por pizza + tamaño                     |
| `toppings`           | Ingredientes extra                            |
| `orders`             | Pedidos (con datos de pago y estado)          |
| `order_items`        | Líneas de cada pedido (pizzas + tamaño + qty) |
| `order_item_toppings`| Ingredientes de cada línea de pizza           |
| `bebidas`            | Bebidas / acompañantes                        |
| `order_bebidas`      | Bebidas de cada pedido                        |
| `password_resets`    | Tokens para resetear contraseña               |
| `notifications`      | Notificaciones por usuario                    |
| `session`            | Sesiones (creada por `connect-pg-simple`)     |

---

## Flujo de un pedido

1. El cliente inicia sesión y entra a **`/order`**.
2. Arma el pedido en 4 pasos (pizzas, bebidas, datos de contacto y método de pago).
3. Al enviar (`POST /order`):
   - Si el método es **"Efectivo en local"**: el pedido se **crea de inmediato** y se muestra la confirmación.
   - Si el método requiere pago (Pago móvil, Transferencia, Zelle, Binance): el pedido se **guarda temporalmente en la sesión** y se redirige a **`/payment`**.
4. En **`/payment`** el cliente debe ingresar el **número de referencia** o subir un **comprobante** (imagen JPEG/PNG/WEBP).
   - **El pedido solo se crea en la base de datos** al confirmar esta pantalla. Si no se proporciona referencia ni comprobante, se muestra el error y **no se registra nada**.
5. Se redirige a la **confirmación** y se emiten eventos en tiempo real (`nuevo_pedido` / `pago_realizado`).
6. El administrador gestiona el pedido desde el panel: estado, impresión, confirmación/rechazo de pago → se generan **notificaciones** al cliente.

---

## Seguridad

- **Contraseñas**: cifradas con `bcrypt` (10 rondas).
- **CSRF**: protección con `csurf` en todos los formularios POST (campo oculto `_csrf`).
- **Sesiones**: cookie `httpOnly` + `sameSite: 'lax'`; la sesión se almacena en PostgreSQL (persistente entre reinicios).
- **Validaciones de entrada**: nombres (solo letras/espacios), teléfono (formato `0000-0000000` + código de área válido), hora de recogida (17:00–23:59), contraseñas con mayúscula + número + carácter especial.
- **Subida de archivos**: `multer` restringe a imágenes (`jpeg/jpg/png/webp`) con límite de 2 MB.
- **Autorización**: middleware `isAuthenticated` (sesión) y `isAdmin` (rol admin).
- **Errores de inyección SQL**: todas las consultas usan parámetros preparados (`$1`, `$2`, …).

---

## Sesiones y despliegue

Al migrar de la memoria a un **store persistente** (`connect-pg-simple`):
- Las sesiones **sobreviven a los reinicios del servidor** (útil en desarrollo con `nodemon`).
- En producción, las sesiones se comparten entre reinicios y múltiples instancias.

> **Nota sobre pruebas responsivas:** si al cambiar entre la vista móvil y de escritorio del inspector de Chrome se cierra la sesión, es un comportamiento del navegador (la emulación de dispositivo usa una cookie jar aislada y no comparte cookies). Para probar el diseño responsive sin perder la sesión, redimensiona la ventana en lugar de activar el modo dispositivo.

---

## Despliegue en Render (o similar)

1. Sube el código a un repositorio y crea un servicio **Web Service** en Render.
2. Añade una **PostgreSQL** (o apunta a Supabase) y configura las variables de entorno:
   - `SESSION_SECRET`
   - `DATABASE_URL`
3. **Build command:** `npm install`
4. **Start command:** `npm start`
5. El servicio generará las tablas automáticamente al iniciar (`database.js`).
6. Ejecuta `node seed-admin.js` (o crea manualmente el admin) para tener un usuario administrador.

> Si sirves sobre HTTPS detrás de un proxy, considera habilitar `trust proxy` y `cookie.secure: true` en las configuraciones de producción.

---

## Solución de problemas

| Problema                                         | Solución                                                                   |
|--------------------------------------------------|----------------------------------------------------------------------------|
| `Cannot read properties of undefined (reading 'prepare')` en `seed-admin.js` | Ejecuta la versión actualizada del script (usa PostgreSQL, no SQLite). |
| El pedido no aparece en la BD al pagar           | Verifica que se envió referencia (6 dígitos) o un comprobante válido.      |
| No se muestran los steppers en el móvil          | Usa los botones **− / +** de `order.ejs` (son táctiles).                   |
| La sesión se cierra al cambiar de vista          | Comportamiento del inspector de Chrome; usa redimensión de ventana.        |
| Errores de conexión a BD                         | Revisa `DATABASE_URL` y que el host permita conexiones SSL (`ssl: { rejectUnauthorized: false }`). |
| Archivos de comprobante no visibles              | Verifica que `public/uploads/` exista y tenga permisos de escritura.       |

---

## Créditos y licencia

Proyecto académico/portafolio. Las notificaciones en tiempo real usan **Socket.IO**; los estilos usan **TailwindCSS** y las fuentes **Playfair Display** e **Inter**.

Sin licencia formal especificada en el repositorio. Consulta al autor antes de usarlo comercialmente.
