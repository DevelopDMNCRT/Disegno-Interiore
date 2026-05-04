const { Pool } = require('pg')
require('dotenv').config()

const dbUrl = process.env.DATABASE_URL || ''
const useSSL = dbUrl.includes('neon.tech') || dbUrl.includes('sslmode=require')

const pool = new Pool({
  connectionString: dbUrl,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  options: '--search_path=public'
})

module.exports = pool
