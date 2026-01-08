const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: '109526',
  database: 'piscinas_iot'
});

module.exports = pool;
