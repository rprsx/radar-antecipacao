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

const MES_PT = { jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12 };

app.get('/api/metas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sheets_antecipacao.metas_web ORDER BY _row ASC'
    );
    const parsed = rows.map(r => {
      const parts = String(r.mes || '').toLowerCase().split('-');
      const abbr  = parts[1] ? parts[1].replace('.', '').trim() : '';
      const mes   = MES_PT[abbr] || null;
      const ano   = parseInt(r.ano);
      const sem   = [r.sem1, r.sem2, r.sem3, r.sem4, r.sem5]
                      .map(v => (v != null && v !== '') ? (parseFloat(v) || null) : null);
      return { ano, mes, valor: parseFloat(r.valor) || 0, sem };
    }).filter(r => r.mes && !isNaN(r.ano));
    res.json(parsed);
  } catch (err) {
    console.error('[api/metas]', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

app.get('/api/fin-auth', (req, res) => {
  const expected = process.env.FIN_PIN || '';
  if (!expected) return res.status(503).json({ ok: false, error: 'FIN_PIN não configurado' });
  if (req.query.pin === expected) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

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

app.get('/mutuo', (req, res) => {
  res.sendFile(path.join(__dirname, 'mutuo.html'));
});

app.get('/api/mutuo-stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sheets_antecipacao.pipeline_web ORDER BY _row ASC'
    );
    const pagos = rows.filter(r => r.status_fechamento && r.status_fechamento.toLowerCase().includes('pago'));
    const n = pagos.length;
    if (n === 0) return res.json({ kpis: {}, safras: [] });

    const totalPrincipal = pagos.reduce((s, d) => s + (parseFloat(d.valor_contrato) || 0), 0);
    const totalDesagio   = pagos.reduce((s, d) => s + (parseFloat(d.desagio_total)  || 0), 0);
    const avgYieldAm     = pagos.reduce((s, d) => s + (parseFloat(d.yield_operacao_mes)   || 0), 0) / n;
    const avgYieldTotal  = pagos.reduce((s, d) => s + (parseFloat(d.yield_operacao_total) || 0), 0) / n;
    const avgParc        = pagos.reduce((s, d) => s + (parseFloat(d.parcelas_antecipadas) || 1), 0) / n;

    const safraMap = {};
    pagos.forEach(d => {
      const ano = parseInt(d.ano), mes = parseInt(d.mes);
      if (!ano || !mes) return;
      const key = `${ano}-${String(mes).padStart(2,'0')}`;
      if (!safraMap[key]) safraMap[key] = { key, n: 0, principal: 0, desagio: 0, yamSum: 0, ytSum: 0 };
      const s = safraMap[key];
      s.n++;
      s.principal += parseFloat(d.valor_contrato) || 0;
      s.desagio   += parseFloat(d.desagio_total)  || 0;
      s.yamSum    += parseFloat(d.yield_operacao_mes)   || 0;
      s.ytSum     += parseFloat(d.yield_operacao_total) || 0;
    });

    const safras = Object.values(safraMap)
      .map(s => ({ key: s.key, n: s.n, principal: Math.round(s.principal), desagio: Math.round(s.desagio), yieldAm: s.yamSum / s.n, yieldTotal: s.ytSum / s.n }))
      .sort((a, b) => a.key.localeCompare(b.key));

    res.json({ kpis: { totalCases: n, totalPrincipal: Math.round(totalPrincipal), avgYieldAm, avgYieldTotal, avgParc }, safras });
  } catch (err) {
    console.error('[api/mutuo-stats]', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Radar server running at http://localhost:${PORT}`));
}

module.exports = app;
