require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType, BorderStyle,
} = require('docx');

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

app.get('/api/mutuo-auth', (req, res) => {
  const expected = process.env.MUTUO_PASS || 'projetomutuo';
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

app.get('/interno', (req, res) => {
  res.sendFile(path.join(__dirname, 'interno.html'));
});

app.get('/api/mutuo-stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sheets_antecipacao.pipeline_web ORDER BY _row ASC'
    );
    // LTM = last 12 months (current month + 11 prior)
    const now = new Date();
    const ltmMin = now.getFullYear() * 12 + (now.getMonth() + 1) - 11;
    const pagos = rows.filter(r => {
      if (!r.status_fechamento || !r.status_fechamento.toLowerCase().includes('pago')) return false;
      const ano = parseInt(r.ano), mes = parseInt(r.mes);
      if (!ano || !mes) return false;
      return (ano * 12 + mes) >= ltmMin;
    });
    const n = pagos.length;
    if (n === 0) return res.json({ kpis: {}, safras: [] });

    // Use same formula as app.js _makeSafraEntry:
    //   yieldTotal = sum(desagio) / sum(valor_total)  [weighted, face-value denominator]
    //   yieldAm    = yieldTotal / mean(parcelas)
    //   "principal" displayed = sum(valor_ofertado)   [the advance igual paid the client]
    const totalFaceValue = pagos.reduce((s, d) => s + (parseFloat(d.valor_total)    || 0), 0);
    const totalPrincipal = pagos.reduce((s, d) => s + (parseFloat(d.valor_ofertado) || 0), 0);
    const totalDesagio   = pagos.reduce((s, d) => s + (parseFloat(d.desagio_total)  || 0), 0);
    const totalParc      = pagos.reduce((s, d) => s + (parseFloat(d.parcelas_antecipadas) || 0), 0);
    const avgParc        = n > 0 ? totalParc / n : 1;
    const avgYieldTotal  = totalFaceValue > 0 ? totalDesagio / totalFaceValue : 0;
    const avgYieldAm     = avgParc > 0 ? avgYieldTotal / avgParc : 0;

    const safraMap = {};
    pagos.forEach(d => {
      const ano = parseInt(d.ano), mes = parseInt(d.mes);
      if (!ano || !mes) return;
      const key = `${ano}-${String(mes).padStart(2,'0')}`;
      if (!safraMap[key]) safraMap[key] = { key, n: 0, principal: 0, faceValue: 0, desagio: 0, parcTotal: 0 };
      const s = safraMap[key];
      s.n++;
      s.principal  += parseFloat(d.valor_ofertado) || 0;  // advance (what igual paid client)
      s.faceValue  += parseFloat(d.valor_total)    || 0;  // face value (yield denominator)
      s.desagio    += parseFloat(d.desagio_total)  || 0;
      s.parcTotal  += parseFloat(d.parcelas_antecipadas) || 0;
    });

    const safras = Object.values(safraMap)
      .map(s => {
        const ap  = s.n > 0 ? s.parcTotal / s.n : 1;
        const yt  = s.faceValue > 0 ? s.desagio / s.faceValue : 0;
        const ym  = ap > 0 ? yt / ap : 0;
        return { key: s.key, n: s.n, principal: Math.round(s.principal), desagio: Math.round(s.desagio), yieldAm: ym, yieldTotal: yt };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    const avgPayback = totalFaceValue > 0 ? (totalPrincipal / totalFaceValue) * avgParc : 0;
    res.json({ kpis: { totalCases: n, totalPrincipal: Math.round(totalPrincipal), totalDesagio: Math.round(totalDesagio), avgYieldAm, avgYieldTotal, avgParc, avgPayback }, safras });
  } catch (err) {
    console.error('[api/mutuo-stats]', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

// ─── /api/interno-stats (same logic as mutuo-stats, different auth) ──────────

app.get('/api/interno-stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sheets_antecipacao.pipeline_web ORDER BY _row ASC'
    );
    const now = new Date();
    const ltmMin = now.getFullYear() * 12 + (now.getMonth() + 1) - 11;

    const pagos = rows.filter(r => {
      if (!r.status_fechamento || !r.status_fechamento.toLowerCase().includes('pago')) return false;
      const ano = parseInt(r.ano), mes = parseInt(r.mes);
      if (!ano || !mes) return false;
      return (ano * 12 + mes) >= ltmMin;
    });

    const n = pagos.length;
    const totalFaceValue = pagos.reduce((s, d) => s + (parseFloat(d.valor_total)         || 0), 0);
    const totalDesagio   = pagos.reduce((s, d) => s + (parseFloat(d.desagio_total)        || 0), 0);
    const totalParc      = pagos.reduce((s, d) => s + (parseFloat(d.parcelas_antecipadas) || 0), 0);
    const avgParc        = n > 0 ? totalParc / n : 1;
    const avgYieldTotal  = totalFaceValue > 0 ? totalDesagio / totalFaceValue : 0;
    const avgYieldAm     = avgParc > 0 ? avgYieldTotal / avgParc : 0;

    res.json({ kpis: { totalCases: n, totalPrincipal: Math.round(totalFaceValue), avgYieldAm, avgYieldTotal, avgParc } });
  } catch (err) {
    console.error('[api/interno-stats]', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

// ─── DOCX EXPORT HELPERS ─────────────────────────────────

const CORAL  = 'C4603A';
const WHITE  = 'FFFFFF';
const INK    = '1E1C1A';
const SOFT   = '57534E';
const MUTED  = 'A8A29E';
const BORDER = 'E7E5E4';
const CORAL_BG = 'F9EDE7';

const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE };
const cellBorders = { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER }, left: noBorder, right: noBorder };

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text: String(text ?? ''), color: opts.color || SOFT, size: opts.size || 22, bold: opts.bold || false })],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { after: opts.spaceAfter ?? 120 },
  });
}

function heading(text, level = 2) {
  return new Paragraph({
    children: [new TextRun({ text, color: CORAL, bold: true, size: level === 1 ? 48 : level === 2 ? 32 : 26 })],
    spacing: { before: 320, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'EED3C8' } },
  });
}

function clauseTitle(text) {
  return new Paragraph({
    children: [new TextRun({ text, color: CORAL, bold: true, size: 22 })],
    spacing: { before: 280, after: 100 },
  });
}

function makeTable(headers, rows, colWidths) {
  const total = 9000;
  const widths = colWidths || headers.map(() => Math.floor(total / headers.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: { style: BorderStyle.SINGLE, size: 4, color: BORDER }, insideV: noBorder },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          shading: { fill: CORAL, type: ShadingType.CLEAR, color: 'auto' },
          borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
          children: [new Paragraph({ children: [new TextRun({ text: h, color: WHITE, bold: true, size: 18 })], spacing: { before: 60, after: 60 } })],
        })),
      }),
      ...rows.map(row => new TableRow({
        children: row.map((cell, i) => new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          borders: cellBorders,
          children: [new Paragraph({ children: [new TextRun({ text: String(cell ?? '—'), color: SOFT, size: 20 })], spacing: { before: 60, after: 60 } })],
        })),
      })),
    ],
  });
}

function defTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: { style: BorderStyle.SINGLE, size: 4, color: BORDER }, insideV: noBorder },
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 3000, type: WidthType.DXA },
          shading: { fill: 'FAFAF9', type: ShadingType.CLEAR, color: 'auto' },
          borders: cellBorders,
          children: [new Paragraph({ children: [new TextRun({ text: label, color: INK, bold: true, size: 20 })], spacing: { before: 60, after: 60 } })],
        }),
        new TableCell({
          borders: cellBorders,
          children: [new Paragraph({ children: [new TextRun({ text: value, color: SOFT, size: 20 })], spacing: { before: 60, after: 60 } })],
        }),
      ],
    })),
  });
}

function legal(text) {
  return new Paragraph({
    children: [new TextRun({ text, color: MUTED, size: 16, italics: true })],
    spacing: { before: 400, after: 0 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER } },
  });
}

function sendDocx(res, doc, filename) {
  return Packer.toBuffer(doc).then(buf => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  });
}

const fmtBRL = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const fmtPct = (v, d = 1) => (v * 100).toFixed(d) + '%';
const fmtCpct = v => v >= 1e6 ? 'R$ ' + (v/1e6).toFixed(1).replace('.',',') + 'M' : v >= 1e3 ? 'R$ ' + Math.round(v/1e3) + 'K' : fmtBRL(v);

// ─── EXPORT: LÂMINA ──────────────────────────────────────
app.get('/api/export/lamina', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sheets_antecipacao.pipeline_web ORDER BY _row ASC');
    const now = new Date();
    const ltmMin = now.getFullYear() * 12 + (now.getMonth() + 1) - 11;
    const pagos = rows.filter(r => {
      if (!r.status_fechamento || !r.status_fechamento.toLowerCase().includes('pago')) return false;
      const ano = parseInt(r.ano), mes = parseInt(r.mes);
      if (!ano || !mes) return false;
      return (ano * 12 + mes) >= ltmMin;
    });
    const n = pagos.length;
    const totalFace   = pagos.reduce((s,d) => s + (parseFloat(d.valor_total)||0), 0);
    const totalDes    = pagos.reduce((s,d) => s + (parseFloat(d.desagio_total)||0), 0);
    const totalParc   = pagos.reduce((s,d) => s + (parseFloat(d.parcelas_antecipadas)||0), 0);
    const avgParc     = n > 0 ? totalParc / n : 1;
    const yieldTot    = totalFace > 0 ? totalDes / totalFace : 0;
    const yieldAm     = avgParc > 0 ? yieldTot / avgParc : 0;

    const safraMap = {};
    pagos.forEach(d => {
      const ano = parseInt(d.ano), mes = parseInt(d.mes);
      if (!ano || !mes) return;
      const key = ano + '-' + String(mes).padStart(2,'0');
      if (!safraMap[key]) safraMap[key] = { n:0, fv:0, des:0, parc:0, princ:0 };
      const s = safraMap[key];
      s.n++; s.fv += parseFloat(d.valor_total)||0; s.des += parseFloat(d.desagio_total)||0;
      s.parc += parseFloat(d.parcelas_antecipadas)||0; s.princ += parseFloat(d.valor_ofertado)||0;
    });
    const safras = Object.entries(safraMap).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,s]) => {
      const ap = s.n > 0 ? s.parc/s.n : 1;
      const yt = s.fv > 0 ? s.des/s.fv : 0;
      return [k, String(s.n), fmtBRL(s.princ), fmtBRL(s.des), fmtPct(yt,1), fmtPct(ap>0?yt/ap:0,2)];
    });

    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'IGUAL ANTECIPAÇÃO', color: CORAL, bold: true, size: 20 })], spacing: { after: 60 } }),
      new Paragraph({ children: [new TextRun({ text: 'Lâmina do Investidor — Veículo de Mútuo', color: INK, bold: true, size: 52 })], spacing: { after: 120 } }),
      p('CDI + 6% ao ano · 12 meses · juros no vencimento · aval pessoal dos sócios', { color: SOFT }),
      p('Últimos 12 meses (LTM)', { color: MUTED, size: 18 }),

      heading('1. Como funciona a operação'),
      makeTable(['Etapa','Descrição'],[
        ['01 — causa ganha','Cliente obtém condenação judicial e tem direito a receber honorários em parcelas futuras.'],
        ['02 — oferta igual','A igual identifica o caso e propõe antecipar o valor, descontando o deságio na transferência.'],
        ['03 — contrato assinado','A igual desembolsa o principal ao cliente com deságio já descontado e assume o risco de recebimento.'],
        ['04 — recebimento','A igual recebe o valor de face do devedor judicial conforme as parcelas cedidas são pagas.'],
      ], [2200, 6800]),

      heading('2. Indicadores LTM'),
      makeTable(['Indicador','Valor'],[
        ['Casos antecipados (LTM)', String(n)],
        ['Yield a.m. médio',        fmtPct(yieldAm)],
        ['Yield total médio',       fmtPct(yieldTot,1)],
        ['Parcelamento médio',      avgParc.toFixed(1) + 'x'],
        ['Total originado (face)',  fmtCpct(totalFace)],
        ['Perdas definitivas',      '0'],
      ], [4000, 5000]),

      heading('3. Performance por safra (LTM)'),
      makeTable(['Safra','Casos','Principal','Deságio','Yield total','Yield a.m.'], safras, [1400,1000,1800,1800,1500,1500]),

      heading('4. Condições do mútuo'),
      defTable([
        ['Remuneração','CDI + 6% ao ano — spread fixo de 0,5% a.m. sobre o CDI acumulado do mês'],
        ['Prazo','12 meses'],
        ['Modalidade de recebimento','Juros no vencimento — acumulado no mês 12 junto com o principal'],
        ['Amortização do principal','Integral no vencimento (bullet)'],
        ['Volume total alvo','R$ 1.000.000'],
        ['IR (pessoa física)','17,5% único no vencimento (operação >360 dias) — retido na fonte'],
        ['IOF','Não incide para mutuante PF · PJ: confirmar com assessoria'],
        ['Garantia','Aval pessoal e solidário dos sócios da igual'],
        ['Natureza jurídica','Mútuo privado — arts. 586–592 Código Civil · Não regulado pela CVM'],
        ['Resgate antecipado','30 dias de aviso, sem penalidade'],
      ]),

      heading('5. Retorno estimado — pessoa física (CDI ref. 14,40% a.a.)'),
      p('CDI de 14,40% a.a. (maio/2026). Remuneração bruta: CDI + 6% a.a. (~21,4% a.a.).', { color: MUTED, size: 18 }),
      defTable([
        ['IR retido na fonte', '17,5% único no vencimento (operação >360 dias)'],
        ['Líquido estimado', '~17,7% a.a.'],
        ['vs. CDI líquido (10,8%)', '~163% do CDI'],
      ]),

      heading('6. Riscos e mitigantes'),
      makeTable(['Risco','Descrição','Mitigante'],[
        ['Crédito da igual','A igual pode não honrar os pagamentos do mútuo.','Aval pessoal e solidário dos sócios. 0 perdas em todo o histórico.'],
        ['Atraso judicial','O devedor judicial pode atrasar parcelas.','Crédito executado judicialmente. Atrasos refletidos no payback histórico.'],
        ['Perda definitiva','Devedor insolvente sem pagamento.','0 casos de perda definitiva desde abr/2024.'],
        ['Variação do CDI','Queda da Selic reduz o retorno mensal.','Spread de 0,5% a.m. fixo. Investidor beneficia se CDI subir.'],
        ['Liquidez','Capital imobilizado por 12 meses.','Resgate antecipado com 30 dias de aviso, sem penalidade.'],
        ['Sem FGC','Não coberto pelo Fundo Garantidor.','Aval pessoal dos sócios como proteção direta.'],
      ], [1600, 3800, 3600]),

      legal('Este documento é destinado exclusivamente a investidores convidados pela igual e não constitui oferta pública de valores mobiliários. Trata-se de mútuo privado nos termos dos arts. 586–592 do Código Civil. Não registrado na CVM. Rentabilidade passada não garante rentabilidade futura. Recomenda-se assessoria jurídica e fiscal independente.'),
    ]}]});
    await sendDocx(res, doc, 'Lamina_Investidor_Igual.docx');
  } catch (err) {
    console.error('[export/lamina]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── EXPORT: GUIA ────────────────────────────────────────
app.get('/api/export/guia', async (req, res) => {
  try {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'IGUAL ANTECIPAÇÃO', color: CORAL, bold: true, size: 20 })], spacing: { after: 60 } }),
      new Paragraph({ children: [new TextRun({ text: 'Guia do Mutuante', color: INK, bold: true, size: 52 })], spacing: { after: 120 } }),
      p('Tudo que você precisa saber antes de investir. Linguagem simples, sem jargão financeiro desnecessário.', { color: SOFT }),

      heading('1. O que é isso, em uma frase?'),
      p('Você empresta dinheiro para a igual por 12 meses. A igual usa esse dinheiro para financiar a operação de antecipação de recebíveis judiciais. Em troca, você recebe os juros acumulados no vencimento, junto com o principal.'),
      p('Analogia simples: é parecido com um CDB de banco — você empresta e pega o principal de volta no vencimento. A diferença é que aqui o retorno é maior e o risco é diferente (sem FGC, mas com aval pessoal dos sócios).', { color: MUTED }),

      heading('2. Quanto recebo e quando?'),
      p('A remuneração é de CDI + 6% ao ano, calculada mensalmente. O valor acompanha a taxa de juros do mercado.'),
      p('Fórmula mensal: taxa mensal equivalente ao CDI anual (regime composto) + spread fixo de 0,5% ao mês', { color: INK, bold: true }),
      p('Com CDI atual de ~14,40% a.a. → CDI mensal equiv. ~1,13% + spread 0,50% = ~1,63% bruto/mês', { color: MUTED }),
      p('Os juros são acumulados durante os 12 meses e pagos no vencimento, junto com o principal. A alíquota de IR é de 17,5% — faixa mais favorável da tabela regressiva, válida para operações acima de 360 dias.'),
      defTable([
        ['Pagamento dos juros','Acumulado no mês 12, junto com a devolução do principal'],
        ['IR retido na fonte','17,5% único sobre o total de juros acumulados'],
        ['Juros líquidos estimados (R$ 100k)','~R$ 17.655 no mês 12'],
      ]),
      p('Outras condições de pagamento podem ser discutidas na assinatura.', { color: MUTED, size: 18 }),
      p('Para mutuantes pessoa física, não há IOF nesta operação. Para PJ, o IOF pode incidir — confirmar com assessoria jurídica.'),

      heading('3. O que acontece mês a mês?'),
      makeTable(['Quando','O que acontece','Fluxo'],[
        ['Dia 0','Você transfere o principal para a igual via TED/PIX.','↑ SAI o principal'],
        ['Meses 1–11','Juros acumulados internamente. Nenhum pagamento neste período.','— acumulando'],
        ['Mês 12','A igual devolve o principal integral + 12 meses de juros líquidos (IR de 17,5% já descontado).','↓ ENTRA principal + juros'],
        ['A qualquer momento','Resgata avisando com 30 dias. Recebe principal + juros pro rata die já líquidos.','↓ ENTRA principal'],
      ], [1800, 5000, 2200]),
      p('Atenção: o principal não é devolvido aos poucos — fica com a igual durante os 12 meses e volta de uma vez no vencimento junto com todos os juros acumulados.', { color: MUTED }),

      heading('4. Exemplo concreto — R$ 100.000 investidos'),
      p('CDI ~14,40% a.a. (maio/2026) → ~1,63% bruto/mês.'),
      makeTable(['Item','Valor'],[
        ['Juros brutos acumulados (fator composto 12m)','~R$ 21.400,00'],
        ['IR único no vencimento (17,5%)','– R$ 3.745,00'],
        ['Juros líquidos no mês 12','~R$ 17.655,00'],
        ['Principal devolvido no mês 12','R$ 100.000,00'],
        ['Total recebido no mês 12','~R$ 117.655,00'],
      ], [5500, 3500]),

      heading('5. Como isso se compara com outras opções?'),
      makeTable(['Produto','Taxa bruta a.a.','Taxa líquida a.a.','Liquidez','FGC'],[
        ['Tesouro Selic','~14,9%','~10,8%','Diária','não'],
        ['CDB banco grande 12m','~10,8%','~10,8%','No vencimento','sim (R$ 250K)'],
        ['CDB banco médio 12m','~13,5%','~11,1%','No vencimento','sim (R$ 250K)'],
        ['LCI / LCA 12m','~12,5%','~12,5% (isento)','No vencimento','sim (R$ 250K)'],
        ['CRI / CRA isentos','~14,5%','~14,5% (isento)','Sec. secundário','não'],
        ['Mútuo igual','~21,4%','~17,7%','30 dias de aviso','não (aval sócios)'],
      ], [2400, 1600, 1800, 1800, 1400]),

      heading('6. E se eu precisar do dinheiro antes?'),
      p('É possível resgatar antes do vencimento. Basta avisar a igual com 30 dias de antecedência. A igual devolve o principal integral mais os juros calculados pro rata die sobre o período decorrido, sem penalidade.'),

      heading('7. Quais são as garantias?'),
      p('Aval pessoal dos sócios: os sócios da igual assinam como avalistas solidários. Se a empresa não honrar o pagamento, os sócios respondem pessoalmente pela dívida com seus bens — garantia direta e juridicamente executável, sem benefício de ordem.'),
      p('Recebíveis judiciais como lastro operacional: os recursos são alocados em antecipações lastreadas em condenações judiciais transitadas em julgado, diversificadas em dezenas de operações por mês.'),

      heading('8. Preciso declarar no Imposto de Renda?'),
      p('Sim, mas é simples. O IR é retido na fonte pela igual. Na declaração anual (IRPF), informe os juros brutos na ficha Rendimentos Sujeitos à Tributação Exclusiva/Definitiva. A igual envia o Informe de Rendimentos até fevereiro do ano seguinte com tudo preenchido.'),

      heading('9. Quais são os riscos?'),
      makeTable(['Risco','O que significa na prática'],[
        ['A igual não consegue pagar','Risco principal. Mitigante: aval pessoal dos sócios. Histórico: 0 casos de perda definitiva desde o início das operações (abr/2024).'],
        ['Atraso nos juros','A igual pode atrasar um pagamento. O contrato prevê multa de 2% e juros moratórios de 1% a.m.'],
        ['CDI cai muito','Se o Banco Central reduzir os juros, o rendimento mensal diminui. Spread de 0,5% a.m. fixo sempre garantido.'],
        ['Sem liquidez imediata','Diferente de um CDB, você não resgata a qualquer momento. Prazo mínimo de aviso: 30 dias.'],
        ['Sem FGC','Este mútuo não é coberto pelo Fundo Garantidor de Créditos.'],
        ['Histórico curto','A operação tem pouco mais de 1 ano. Histórico positivo, mas curto para ciclos adversos.'],
      ], [2800, 6200]),

      legal('Este documento é informativo e destinado exclusivamente a investidores convidados pela igual. Não constitui oferta pública de valores mobiliários. Não é produto regulado pelo Banco Central ou pela CVM. Rentabilidade passada não garante rentabilidade futura. Recomenda-se assessoria jurídica e fiscal independente antes da assinatura.'),
    ]}]});
    await sendDocx(res, doc, 'Guia_Mutuante_Igual.docx');
  } catch (err) {
    console.error('[export/guia]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── EXPORT: CONTRATO ────────────────────────────────────
app.get('/api/export/contrato', async (req, res) => {
  try {
    const cl = (title, ...paras) => [
      clauseTitle(title),
      ...paras.map(t => new Paragraph({ children: [new TextRun({ text: t, color: SOFT, size: 20 })], spacing: { after: 100 } })),
    ];

    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'CONTRATO DE MÚTUO COM RENDIMENTO INDEXADO AO CDI', color: INK, bold: true, size: 40 })], alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
      new Paragraph({ children: [new TextRun({ text: 'Operação de Antecipação de Recebíveis Judiciais', color: MUTED, italics: true, size: 22 })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

      new Paragraph({ children: [new TextRun({ text: 'QUALIFICAÇÃO DAS PARTES', color: CORAL, bold: true, size: 26 })], spacing: { before: 200, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'EED3C8' } } }),
      p('Mutuária (tomadora dos recursos)', { color: MUTED, size: 18, bold: true }),
      defTable([['Razão Social','[RAZÃO SOCIAL DA IGUAL]'],['CNPJ','[CNPJ]'],['Endereço','[ENDEREÇO COMPLETO]'],['Representante Legal','[NOME], [CARGO], CPF [CPF], RG [RG]']]),
      p('Mutuante (investidor) — Pessoa Física', { color: MUTED, size: 18, bold: true }),
      defTable([['Nome completo','[NOME COMPLETO]'],['CPF','[CPF]'],['RG','[RG] — Órgão: [ÓRGÃO]'],['Endereço','[ENDEREÇO COMPLETO]'],['E-mail','[E-MAIL]'],['Telefone','[TELEFONE]']]),
      p('Mutuante (investidor) — Pessoa Jurídica (quando aplicável)', { color: MUTED, size: 18, bold: true }),
      defTable([['Razão Social','[RAZÃO SOCIAL]'],['CNPJ','[CNPJ]'],['Endereço','[ENDEREÇO COMPLETO]'],['Representante Legal','[NOME], [CARGO], CPF [CPF]'],['E-mail','[E-MAIL]']]),

      p('As partes acima qualificadas celebram o presente Contrato de Mútuo com Rendimento Indexado ao CDI ("Contrato"), nos termos dos artigos 586 a 592 do Código Civil Brasileiro (Lei n.º 10.406/2002).', { spaceAfter: 80 }),
      p('A Mutuária atua no segmento de antecipação de recebíveis judiciais, adiantando a pessoas físicas o valor líquido de créditos oriundos de processos trabalhistas e cíveis com condenação transitada em julgado.', { spaceAfter: 200 }),

      ...cl('Cláusula 1ª — Objeto',
        'O presente Contrato tem por objeto o empréstimo, pelo Mutuante à Mutuária, do valor descrito na Cláusula 2ª ("Principal"), a ser utilizado exclusivamente na operação de antecipação de recebíveis judiciais.',
        '1.1. O Mutuante declara ciência de que os recursos serão empregados na atividade de antecipação de recebíveis, não cabendo ao Mutuante qualquer ingerência na seleção dos casos ou na condução operacional da Mutuária.'),

      clauseTitle('Cláusula 2ª — Valor, Prazo e Condições Financeiras'),
      defTable([
        ['Valor do Principal (R$)','[____________]'],['Data de Desembolso','[DD/MM/AAAA]'],
        ['Prazo','12 (doze) meses'],['Data de Vencimento','[DD/MM/AAAA]'],
        ['Remuneração','CDI + 6% (seis por cento) ao ano, acumulada mensalmente e paga no vencimento conforme Cláusula 2.2'],
        ['Modalidade de recebimento','No vencimento — acumulado no mês 12 junto com o principal'],
        ['Amortização do Principal','Integral no vencimento (bullet)'],
        ['Conta para Recebimento','[BANCO] — Ag. [____] — Cc. [__________] — [CPF/CNPJ]'],
      ]),
      p('2.1. O desembolso do Principal será realizado pelo Mutuante em favor da Mutuária em até 2 (dois) dias úteis após a assinatura do presente Contrato.', { spaceAfter: 80 }),
      p('2.2. A remuneração será calculada pela taxa mensal equivalente ao CDI anual divulgado pela B3 S.A., pelo regime de capitalização composta, acrescida de spread fixo de 0,5% (zero vírgula cinco por cento) ao mês. As taxas mensais assim apuradas serão acumuladas de forma composta ao longo dos 12 meses, e o total será pago integralmente na Data de Vencimento. A variação do CDI entre os períodos mensais será automaticamente refletida no valor dos juros devidos.', { spaceAfter: 80 }),
      p('2.3. Na hipótese de atraso: (i) multa moratória de 2%; (ii) juros de mora de 1% ao mês, pro rata die; (iii) atualização pelo IPCA.', { spaceAfter: 80 }),
      p('2.4. O Mutuante poderá solicitar antecipação do vencimento com 30 dias de notificação, caso em que a Mutuária devolverá o Principal acrescido dos juros calculados pro rata die sobre o período decorrido, sem penalidade.'),

      ...cl('Cláusula 3ª — Retenção na Fonte e Obrigações Fiscais',
        'Sobre os juros pagos ao Mutuante pessoa física, incidirá IRRF à alíquota de 17,5% sobre o total de juros acumulados, retida na data de vencimento, dado que a operação tem prazo superior a 360 dias (tabela regressiva — faixa de 361 a 720 dias). O principal devolvido não está sujeito a IR.',
        '3.2. Para Mutuante PF, não há incidência de IOF. Para PJ, poderá incidir IOF sobre crédito.',
        '3.3. Eventuais alterações na legislação tributária serão automaticamente aplicadas.'),

      ...cl('Cláusula 4ª — Declarações e Garantias do Mutuante',
        'O Mutuante declara e garante que: é maior de 18 anos e capaz (PF) ou regularmente constituída (PJ); tem plena ciência dos riscos; os recursos são de origem lícita; não está impedido de celebrar o Contrato; entende que a operação não constitui valor mobiliário regulado pela CVM.'),

      ...cl('Cláusula 5ª — Declarações e Obrigações da Mutuária',
        'A Mutuária declara e se obriga a: empregar os recursos exclusivamente na antecipação de recebíveis judiciais; manter escrituração contábil regular; notificar o Mutuante com 15 dias sobre eventos que possam impactar sua capacidade de pagamento; manter obrigações tributárias, previdenciárias e trabalhistas em dia.'),

      ...cl('Cláusula 6ª — Vencimento Antecipado',
        'A Mutuária estará sujeita ao vencimento antecipado nas hipóteses de: decretação de falência ou recuperação judicial; dissolução ou liquidação; inadimplemento de qualquer obrigação pecuniária prevista neste Contrato por prazo superior a 30 dias; descumprimento de obrigação relevante não sanado em 15 dias após notificação; falsidade em qualquer declaração prestada.'),

      ...cl('Cláusula 7ª — Confidencialidade',
        'As partes comprometem-se a manter em sigilo todas as informações obtidas em razão deste Contrato pelo prazo de 5 anos após o término da vigência.'),

      ...cl('Cláusula 8ª — Cessão',
        'O Contrato não poderá ser cedido sem o prévio consentimento escrito da outra parte, salvo em caso de reorganização societária da Mutuária.'),

      clauseTitle('Cláusula 9ª — Aval e Garantia Pessoal'),
      p('Os sócios da Mutuária abaixo qualificados prestam aval solidário, incondicional e irrevogável, obrigando-se como principais pagadores pelo integral cumprimento de todas as obrigações pecuniárias assumidas pela Mutuária.'),
      defTable([['Avalista 1','Nome: [NOME] · CPF: [CPF] · RG: [RG]'],['Avalista 2','Nome: [NOME] · CPF: [CPF] · RG: [RG]']]),
      p('9.1. O aval é incondicional e independente de benefício de ordem — o Mutuante pode exigir o cumprimento diretamente dos avalistas.', { spaceAfter: 80 }),
      p('9.2. A garantia não será extinta por novação, prorrogação ou renegociação, salvo anuência expressa dos avalistas.', { spaceAfter: 80 }),
      p('9.3. Avalista casado em regime de comunhão deverá ter o cônjuge como outorgante neste instrumento.'),

      ...cl('Cláusula 10ª — Disposições Gerais',
        'Este Contrato representa a totalidade do acordo entre as partes. Alterações somente valem se formalizadas por escrito e assinadas por ambas. A tolerância de uma parte não implica novação ou renúncia.'),

      ...cl('Cláusula 11ª — Foro',
        'Fica eleito o foro da Comarca de [CIDADE/UF], com renúncia expressa a qualquer outro, para dirimir quaisquer dúvidas ou litígios decorrentes do presente Contrato.'),

      p('[CIDADE], [DD] de [MÊS] de [ANO].', { spaceAfter: 400 }),
      makeTable(['MUTUÁRIA','MUTUANTE'],[
        ['[RAZÃO SOCIAL DA IGUAL]\n[NOME DO REPRESENTANTE] · [CARGO]\nCPF: [CPF]', '[NOME COMPLETO / RAZÃO SOCIAL]\nCPF/CNPJ: [CPF/CNPJ]'],
        ['AVALISTA 1 — [NOME]\nCPF: [CPF]', 'AVALISTA 2 — [NOME]\nCPF: [CPF]'],
        ['TESTEMUNHA 1 — [NOME]\nCPF: [CPF]', 'TESTEMUNHA 2 — [NOME]\nCPF: [CPF]'],
      ], [4500, 4500]),

      legal('Este instrumento constitui mútuo privado entre partes, celebrado nos termos dos artigos 586 a 592 do Código Civil. Não se trata de valor mobiliário nem de produto financeiro regulado pela CVM ou pelo Banco Central. Recomenda-se que ambas as partes obtenham assessoria jurídica e fiscal independente antes da assinatura.'),
    ]}]});
    await sendDocx(res, doc, 'Contrato_Mutuo_Igual.docx');
  } catch (err) {
    console.error('[export/contrato]', err.message);
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Radar server running at http://localhost:${PORT}`));
}

module.exports = app;
