const { Pool } = require('pg')
require('dotenv').config()

const dbUrl = process.env.DATABASE_URL || ''
const useSSL = dbUrl.includes('neon.tech') || dbUrl.includes('sslmode=require')

const pool = new Pool({
  connectionString: dbUrl,
  ssl: useSSL ? { rejectUnauthorized: false } : false
})

// Forzar search_path=public en cada conexión (Neon pooler no soporta 'options')
pool.on('connect', client => {
  client.query('SET search_path = public').catch(() => {})
})

module.exports = pool
