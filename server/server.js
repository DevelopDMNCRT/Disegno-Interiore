require('dotenv').config()
const express = require('express')
const cors = require('cors')
const pool = require('./db')
const authRouter = require('./routes/auth')
const usersRouter = require('./routes/users')
const categoriasRouter = require('./routes/categorias')
const productosRouter = require('./routes/productos')
const coloresRouter = require('./routes/colores')
const materialesRouter = require('./routes/materiales')
const tamaniosRouter = require('./routes/tamanios')
const uploadRouter  = require('./routes/upload')
const { verifyToken } = require('./middleware/auth')
const pedidosRouter = require('./routes/pedidos')

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
const devOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']
const prodOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : []
const allowedOrigins = [...devOrigins, ...prodOrigins]

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sin origin (Postman, server-to-server) y los orígenes registrados
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origen no permitido → ${origin}`))
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json({ limit: '15mb' }))
app.use(express.urlencoded({ extended: true, limit: '15mb' }))

// Crear tabla si no existe
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        usuario VARCHAR(50) UNIQUE NOT NULL,
        correo VARCHAR(150) UNIQUE NOT NULL,
        contrasena TEXT NOT NULL,
        rol VARCHAR(20) NOT NULL CHECK (rol IN ('Administrador', 'Asistente')),
        fecha_alta TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    console.log('✅ Tabla "usuarios" lista en Neon PostgreSQL')

    // Verificar tabla categorias
    await pool.query('SELECT id, nombre, fecha_de_alta FROM categorias LIMIT 1')
    console.log('✅ Tabla "categorias" accesible en Neon PostgreSQL')

    // Crear tabla pedidos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id VARCHAR(9) PRIMARY KEY,
        nombre_cliente VARCHAR(150) NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        ciudad_estado VARCHAR(150) NOT NULL,
        fecha_pedido TIMESTAMPTZ DEFAULT NOW(),
        estado VARCHAR(20) CHECK (estado IN ('Pendiente', 'En Proceso', 'Completado', 'Fallido', 'Reembolsado', 'Cancelado')) DEFAULT 'Pendiente'
      )
    `)
    
    // Agregar nuevas columnas si no existen
    await pool.query(`
      ALTER TABLE pedidos
      ADD COLUMN IF NOT EXISTS apellidos VARCHAR(150),
      ADD COLUMN IF NOT EXISTS correo VARCHAR(150),
      ADD COLUMN IF NOT EXISTS telefono VARCHAR(50),
      ADD COLUMN IF NOT EXISTS calle_numero VARCHAR(255),
      ADD COLUMN IF NOT EXISTS ciudad VARCHAR(100),
      ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(20),
      ADD COLUMN IF NOT EXISTS estado_republica VARCHAR(100),
      ADD COLUMN IF NOT EXISTS productos JSONB,
      ADD COLUMN IF NOT EXISTS notas TEXT,
      ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'Tarjeta'
    `)
    console.log('✅ Tabla "pedidos" lista en Neon PostgreSQL')

    // Ampliar codigo_hex de CHAR(1) a VARCHAR(7) si todavía es demasiado corto
    try {
      await pool.query(`
        ALTER TABLE "color"
        ALTER COLUMN codigo_hex TYPE VARCHAR(7)
        USING codigo_hex::VARCHAR(7)
      `)
      console.log('✅ Columna color.codigo_hex ampliada a VARCHAR(7)')
    } catch (e) {
      console.log('ℹ️  color.codigo_hex ya tiene el tipo correcto')
    }

  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err)
    // No llamar process.exit(1) en entorno serverless (Vercel)
  }
}

// Rutas públicas (sin autenticación)
app.use('/api/auth', authRouter)

// Ruta pública de productos para el client (sin JWT)
app.get('/api/public/productos', async (req, res) => {
  try {
    const pool = require('./db')
    const result = await pool.query(
      `SELECT id, nombre, precio, descripcion, descuento, stock,
              ancho, alto, profundidad,
              productos_relacionados, categorias,
              imagen_principal, galeria,
              es_variable, colores, materiales, tamanios,
              created_at, updated_at
       FROM productos
       WHERE deleted_at IS NULL
       ORDER BY id ASC`
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Error al obtener productos públicos:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

app.get('/api/public/productos/:id', async (req, res) => {
  try {
    const pool = require('./db')
    const result = await pool.query(
      `SELECT id, nombre, precio, descripcion, descuento, stock,
              ancho, alto, profundidad,
              productos_relacionados, categorias,
              imagen_principal, galeria,
              es_variable, colores, materiales, tamanios,
              created_at, updated_at
       FROM productos WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// Ruta pública para crear pedido desde el checkout
app.post('/api/public/pedidos', async (req, res) => {
  const { 
    nombre_cliente, apellidos, correo, telefono, 
    calle_numero, ciudad, codigo_postal, estado_republica, 
    productos, total, metodo_pago 
  } = req.body
  
  if (!nombre_cliente || !correo || !total) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' })
  }

  try {
    const pool = require('./db')
    
    let isUnique = false
    let newId = ''
    while (!isUnique) {
      newId = Math.floor(100000000 + Math.random() * 900000000).toString()
      const check = await pool.query('SELECT id FROM pedidos WHERE id = $1', [newId])
      if (check.rows.length === 0) isUnique = true
    }

    const ciudad_estado = `${ciudad || ''}, ${estado_republica || ''}`
    const mp = metodo_pago || 'Tarjeta'
    
    const result = await pool.query(
      `INSERT INTO pedidos (
        id, nombre_cliente, apellidos, correo, telefono, 
        calle_numero, ciudad, codigo_postal, estado_republica, 
        productos, total, ciudad_estado, estado, metodo_pago
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        newId, nombre_cliente, apellidos, correo, telefono,
        calle_numero, ciudad, codigo_postal, estado_republica,
        productos ? JSON.stringify(productos) : null, total, ciudad_estado, 'Pendiente', mp
      ]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Error al crear pedido público:', err)
    res.status(500).json({ error: 'Error interno del servidor al procesar el pedido' })
  }
})

// Rutas protegidas (requieren JWT válido)
app.use('/api/users', verifyToken, usersRouter)
app.use('/api/categorias', verifyToken, categoriasRouter)
app.use('/api/productos', verifyToken, productosRouter)
app.use('/api/colores', verifyToken, coloresRouter)
app.use('/api/materiales', verifyToken, materialesRouter)
app.use('/api/tamanios',   verifyToken, tamaniosRouter)
app.use('/api/upload',     verifyToken, uploadRouter)
app.use('/api/pedidos',    verifyToken, pedidosRouter)

// Ruta de salud
app.get('/api/health', (req, res) => {
  res.json({ estado: 'ok', hora: new Date().toISOString() })
})

// Arrancar servidor (solo en local, Vercel ignora app.listen)
if (process.env.VERCEL !== '1') {
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor API corriendo en http://localhost:${PORT}`)
    })
  })
} else {
  // En Vercel: inicializar BD en background sin bloquear
  initDB().catch(err => console.error('initDB error:', err))
}

// Exportar para Vercel serverless
module.exports = app
