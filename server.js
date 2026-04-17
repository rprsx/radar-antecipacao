require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({
  host:     process.env.PG_HOST,
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

function basicAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const b64 = header.startsWith('Basic ') ? header.slice(6) : '';
  const [user, pass] = Buffer.from(b64, 'base64').toString().split(':');
  if (user === process.env.AUTH_USER && pass === process.env.AUTH_PASS) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Radar Antecipação"');
  res.status(401).send('Unauthorized');
}

app.use(basicAuth);
app.use(express.static(path.join(__dirname)));

app.get('/api/pipeline', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sheets_antecipacao.pipeline_web ORDER BY _row ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('[api/pipeline]', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Radar server running at http://localhost:${PORT}`));
