// ─── SETUP ─────────────────────────────────────────────
(function () {
  const d = new Date();
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  document.getElementById('today').textContent =
    `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
  document.getElementById('now').textContent =
    `${diasSemana[d.getDay()]} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
})();

const fmtBRL = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = v => Math.round(v).toLocaleString('pt-BR');
const fmtPct = v => (v == null || isNaN(v)) ? '—' : v.toFixed(2).replace('.', ',') + '%';
const fmtDec = (v, digits = 2) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(digits).replace('.', ',');

// ─── MÁSCARA MONETÁRIA BR ──────────────────────────────
// Usuário digita apenas dígitos → reformata pra 10.000,00 em tempo real
function maskMoneyBR(rawValue) {
  const digits = String(rawValue).replace(/\D/g, '');
  if (!digits) return '';
  const cents = parseInt(digits, 10);
  const reais = cents / 100;
  return reais.toLocaleString('pt-BR', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
}

function unmaskMoneyBR(maskedValue) {
  const digits = String(maskedValue).replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}


function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/R\$\s*/i, '').replace(/%/g, '').replace(/\s/g, '');
  if (!s) return null;
  
  let out;
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s)) {
    out = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    out = parseFloat(s.replace(/\./g, ''));
  } else if (/^\d+,\d{1,2}$/.test(s)) {
    out = parseFloat(s.replace(',', '.'));
  } else {
    out = parseFloat(s.replace(/,/g, ''));
  }
  
  return isNaN(out) ? null : out;
}

// ─── DATE PARSER ────────────────────────────────────────
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  
  let d = null;
  
  // dd/mm/yyyy ou dd/mm/yy
  const brMatch = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (brMatch) {
    let [, day, month, year] = brMatch;
    if (year.length === 2) year = '20' + year;
    d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  
  // yyyy-mm-dd
  if (!d) {
    const isoMatch = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
  }
  
  // Fallback: tentar Date.parse
  if (!d) {
    const parsed = Date.parse(s);
    if (!isNaN(parsed)) d = new Date(parsed);
  }
  
  return (d && !isNaN(d.getTime())) ? d : null;
}

// Calcular semana ISO do ano
function getWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const isPago      = d => norm(d.status_fechamento).includes('pago');
const isEmAberto  = d => { const sf = norm(d.status_fechamento); return sf === 'emaberto' || sf === 'aberto'; };

// ─── API LOADER ─────────────────────────────────────────
async function loadFromAPI() {
  setSyncBar('pending', 'Carregando…', 'conectando ao banco');
  document.getElementById('errorMsg').textContent = '';
  try {
    const res = await fetch('/api/pipeline');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    processRows(rows);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    setSyncBar('ok', `Sincronizado às ${hh}:${mm}`, `${allDealsData.length} deals carregados`);
  } catch (e) {
    setSyncBar('fail', 'Falha na sincronização', 'clique em Atualizar pra tentar novamente');
    document.getElementById('errorMsg').textContent = `Erro: ${e.message}`;
  }
}

// ─── ROW PROCESSOR ──────────────────────────────────────
function processRows(rows) {
  document.getElementById('errorMsg').textContent = '';

  if (!rows || rows.length === 0) {
    document.getElementById('errorMsg').textContent = 'Nenhum dado retornado pelo banco.';
    return;
  }

  const currentYear  = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  allDealsData = rows.map((r, idx) => {
    const get = (key) => (r[key] != null ? String(r[key]).trim() : '');

    const dataFechStr     = get('data_fechamento');
    const dataFech        = parseDate(dataFechStr);
    const dataAberturaStr = get('data_abertura');
    const dataAbertura    = parseDate(dataAberturaStr);
    const mesFechamentoRaw = parseNum(get('mes_fechamento'));

    const fech_mes    = mesFechamentoRaw
                     || (dataFech ? (dataFech.getMonth() + 1) : null)
                     || parseNum(get('mes'))
                     || currentMonth;
    const fech_ano    = dataFech
                     ? dataFech.getFullYear()
                     : (parseNum(get('ano')) || currentYear);
    const fech_semana = dataFech
                     ? getWeekNumber(dataFech)
                     : (parseNum(get('semana_fechamento')) || parseNum(get('semana')) || 0);
    const fech_dia    = dataFech ? dataFech.getDate() : null;

    return {
      deal:                 String(r._row || `#${idx + 1}`),
      cliente:              get('cliente') || '—',
      desagio_total:        parseNum(get('desagio_total')) || 0,
      status_fechamento:    get('status_fechamento').toLowerCase(),
      status_contrato:      get('status_do_contrato').toLowerCase(),
      yield_operacao_total: r.yield_operacao_total_ != null ? Number(r.yield_operacao_total_) : 0,
      yield_operacao_mes:   r.yield_operacao_mes_  != null ? Number(r.yield_operacao_mes_)  : 0,
      parcelas_antecipadas: parseNum(get('parcelas_antecipadas')) || 0,
      semana:               parseNum(get('semana')) || 0,
      semana_fechamento:    fech_semana,
      ano:                  fech_ano,
      mes:                  fech_mes,
      dia:                  fech_dia,
      data_fechamento:      dataFech,
      data_fechamento_str:  dataFechStr,
      data_abertura:        dataAbertura,
      data_abertura_str:    dataAberturaStr,
      mes_fechamento_raw:   mesFechamentoRaw,
      valor_contrato:       parseNum(get('valor_total'))   || 0,
      principal:            parseNum(get('valor_ofertado')) || 0,
    };
  }).filter(d => d.cliente !== '—' || d.status_fechamento || d.desagio_total > 0);

  document.getElementById('initialMsg').style.display = 'none';
  document.getElementById('sidebarNav').style.display = 'block';
  document.getElementById('radarHeader').style.display = 'block';
  document.getElementById('timeFilterBar').classList.add('visible');
  document.getElementById('kpiRow').classList.add('visible');
  document.getElementById('blocoMain').style.display = 'block';
  updateKPI();
  updateMainView();
}

// ─── DATA ───────────────────────────────────────────────
let allDealsData = [];

// ─── DRILL DRAWER ───────────────────────────────────────
let _projOprtd       = 0; // projeção em aberto (pipeline), compartilhada com Metas v2
let _drillDeals      = { oprtd: [], semStatus: [], pago: [] };
let _drillLabels     = { oprtd: 'Oportunidades em aberto', semStatus: 'Aguardando resposta do cliente', pago: 'Pago' };
let _periodDrillMap  = new Map(); // key -> { deals, label }
let _drillActive     = null;
let _drillInit       = false;
let _drillCurrentDeals = [];
let _drillSort       = { col: 2, dir: -1 }; // col index, dir: 1=asc, -1=desc
let _lastHistoryPeriods = [];
let _historySort     = { col: null, dir: -1 };

function openDrillDrawer(key) {
  const drawer   = document.getElementById('drillDrawer');
  const backdrop = document.getElementById('drillBackdrop');
  if (!drawer) return;

  document.querySelectorAll('.drill-trigger').forEach(el => el.classList.remove('drill-active'));

  if (_drillActive === key) { closeDrillDrawer(); return; }
  _drillActive = key;

  // Activate the triggering element (box or table row)
  document.querySelectorAll(`.drill-trigger[data-drill="${key}"]`)
    .forEach(el => el.classList.add('drill-active'));
  const activeRow = document.querySelector(`tr[data-pkey="${key}"]`);
  if (activeRow) activeRow.classList.add('drill-active');

  // Resolve deals + label from either fixed keys or period map
  let deals, drawerLabel, showDate;
  if (_periodDrillMap.has(key)) {
    const entry = _periodDrillMap.get(key);
    deals       = entry.deals;
    drawerLabel = entry.label;
    showDate    = true;
  } else {
    deals       = _drillDeals[key] || [];
    drawerLabel = _drillLabels[key] || key;
    showDate    = key === 'pago';
  }

  const total = deals.reduce((s, d) => s + d.desagio_total, 0);
  document.getElementById('drillDrawerTitle').textContent = drawerLabel;
  document.getElementById('drillDrawerSub').textContent =
    `${deals.length} caso${deals.length !== 1 ? 's' : ''} · R$ ${fmtBRL(total)}`;

  _drillCurrentDeals = deals;
  _drillSort = { col: 2, dir: -1 };
  renderDrillTable();

  drawer.classList.add('open');
  backdrop.classList.add('open');
}

function renderDrillTable() {
  const COLS = [
    { label: 'Cliente',        cls: '',    val: d => d.cliente },
    { label: 'Valor contrato', cls: 'num', val: d => d.valor_contrato || 0 },
    { label: 'Deságio',        cls: 'num', val: d => d.desagio_total || 0 },
    { label: 'Yield Total',    cls: 'num', val: d => d.valor_contrato > 0 ? (d.desagio_total / d.valor_contrato) * 100 : 0 },
    { label: 'Yield Mês',      cls: 'num', val: d => { const yt = d.valor_contrato > 0 ? (d.desagio_total / d.valor_contrato) * 100 : 0; return d.parcelas_antecipadas > 0 ? yt / d.parcelas_antecipadas : 0; } },
    { label: 'Parcelas',       cls: 'num', val: d => d.parcelas_antecipadas || 0 },
  ];

  const sorted = [..._drillCurrentDeals].sort((a, b) => {
    const col = COLS[_drillSort.col];
    const va = col.val(a), vb = col.val(b);
    if (typeof va === 'string') return _drillSort.dir * va.localeCompare(vb, 'pt');
    return _drillSort.dir * ((va || 0) - (vb || 0));
  });

  const heads = COLS.map((c, i) => {
    const active = i === _drillSort.col;
    const icon   = active ? (_drillSort.dir === 1 ? '▲' : '▼') : '↕';
    return `<th class="${c.cls} sortable${active ? ' sort-active' : ''}" data-scol="${i}">${c.label}<span class="sort-icon">${icon}</span></th>`;
  }).join('');

  const rows = sorted.map(d => {
    const yieldTot = d.valor_contrato > 0 ? (d.desagio_total / d.valor_contrato) * 100 : 0;
    const yieldMes = d.parcelas_antecipadas > 0 ? yieldTot / d.parcelas_antecipadas : 0;
    return `<tr>
      <td class="drill-cliente">${d.cliente}</td>
      <td class="num">${d.valor_contrato > 0 ? 'R$ ' + fmtBRL(d.valor_contrato) : '—'}</td>
      <td class="num">R$ ${fmtBRL(d.desagio_total)}</td>
      <td class="num">${yieldTot > 0 ? fmtPct(yieldTot) : '—'}</td>
      <td class="num">${yieldMes > 0 ? fmtPct(yieldMes) : '—'}</td>
      <td class="num">${d.parcelas_antecipadas || '—'}</td>
    </tr>`;
  }).join('');

  let tfootHTML = '';
  if (sorted.length > 1) {
    const sumValor   = sorted.reduce((s, d) => s + (d.valor_contrato || 0), 0);
    const sumDesagio = sorted.reduce((s, d) => s + (d.desagio_total  || 0), 0);
    const yieldTotAgg = sumValor > 0 ? (sumDesagio / sumValor) * 100 : 0;
    const { wNum, wDen } = sorted.reduce((acc, d) => {
      if ((d.parcelas_antecipadas || 0) > 0 && (d.valor_contrato || 0) > 0) {
        acc.wNum += d.valor_contrato * d.parcelas_antecipadas;
        acc.wDen += d.valor_contrato;
      }
      return acc;
    }, { wNum: 0, wDen: 0 });
    const avgParcelas = wDen > 0 ? wNum / wDen : 0;
    const yieldMesAgg = avgParcelas > 0 ? yieldTotAgg / avgParcelas : 0;
    tfootHTML = `<tfoot><tr class="drill-totals">
      <td class="drill-total-label">Σ ${sorted.length} casos</td>
      <td class="num">${sumValor > 0 ? 'R$ ' + fmtBRL(sumValor) : '—'}</td>
      <td class="num">R$ ${fmtBRL(sumDesagio)}</td>
      <td class="num">${yieldTotAgg > 0 ? fmtPct(yieldTotAgg) : '—'}</td>
      <td class="num">${yieldMesAgg > 0 ? fmtPct(yieldMesAgg) : '—'}</td>
      <td class="num">${avgParcelas > 0 ? fmtDec(avgParcelas, 1) + 'x' : '—'}</td>
    </tr></tfoot>`;
  }

  const body = document.getElementById('drillDrawerBody');
  body.innerHTML = `
    <table class="drill-table">
      <thead><tr>${heads}</tr></thead>
      <tbody>${rows}</tbody>
      ${tfootHTML}
    </table>`;

  body.querySelectorAll('th[data-scol]').forEach(th => {
    th.addEventListener('click', () => {
      const col = parseInt(th.dataset.scol);
      if (_drillSort.col === col) {
        _drillSort.dir *= -1;
      } else {
        _drillSort.col = col;
        _drillSort.dir = col === 0 ? 1 : -1;
      }
      renderDrillTable();
    });
  });
}

function closeDrillDrawer() {
  _drillActive = null;
  document.getElementById('drillDrawer').classList.remove('open');
  document.getElementById('drillBackdrop').classList.remove('open');
  document.querySelectorAll('.drill-trigger, tr[data-pkey]').forEach(el => el.classList.remove('drill-active'));
}

function bindHistorySort() {
  document.querySelectorAll('.history-table th[data-scol]').forEach(th => {
    const col = parseInt(th.dataset.scol);
    const active = col === _historySort.col;
    th.classList.toggle('sort-active', active);

    // Update or create the sort icon chip
    let icon = th.querySelector('.sort-icon');
    if (!icon) {
      icon = document.createElement('span');
      icon.className = 'sort-icon';
      th.appendChild(icon);
    }
    if (active) {
      icon.textContent = _historySort.dir === 1 ? '▲' : '▼';
    } else {
      icon.textContent = '↕';
    }

    th.onclick = () => {
      if (_historySort.col === col) {
        _historySort.dir *= -1;
      } else {
        _historySort.col = col;
        _historySort.dir = -1;
      }
      if (_drillActive) closeDrillDrawer();
      redrawHistoryTable();
    };
  });
}

function redrawHistoryTable() {
  const METRIC_FNS = [
    null,
    m => m.total,
    m => m.yieldTotal,
    m => m.yieldMes,
    m => m.clientesUnicos,
    m => m.parcelasMedio,
  ];
  let periods = _lastHistoryPeriods;
  let orderRecentFirst = true;

  if (_historySort.col !== null) {
    const metrics = periods.map(p => calcMetrics(p.deals));
    const fn = METRIC_FNS[_historySort.col];
    const indexed = periods.map((p, i) => ({ p, m: metrics[i], i }));
    if (fn) {
      indexed.sort((a, b) => _historySort.dir * ((fn(b.m) || 0) - (fn(a.m) || 0)));
    } else {
      // col 0: Período — sort by natural chronological index
      indexed.sort((a, b) => _historySort.dir * (b.i - a.i));
    }
    periods = indexed.map(x => x.p);
    orderRecentFirst = false;
  }

  document.getElementById('mainHistory').innerHTML = renderHistoryTable(periods, orderRecentFirst);
  bindHistorySort();
}

function initDrillListeners() {
  if (_drillInit) return;
  _drillInit = true;
  document.querySelectorAll('.drill-trigger').forEach(el => {
    el.addEventListener('click', () => openDrillDrawer(el.dataset.drill));
  });
  // Event delegation for history table rows (re-rendered on each period change)
  document.getElementById('mainHistory').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-pkey]');
    if (tr) openDrillDrawer(tr.dataset.pkey);
  });
  document.getElementById('drillDrawerClose').addEventListener('click', closeDrillDrawer);
  document.getElementById('drillBackdrop').addEventListener('click', closeDrillDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrillDrawer(); });
}

// ─── HELPERS: MÉTRICAS, TENDÊNCIAS E HISTÓRICO ─────────
function calcMetrics(deals) {
  const total = deals.reduce((s, d) => s + d.desagio_total, 0);
  const valorTotal = deals.reduce((s, d) => s + (d.valor_contrato || 0), 0);
  const clientesUnicos = new Set(deals.map(d => d.cliente)).size;
  const totalParcelas = deals.reduce((s, d) => s + (d.parcelas_antecipadas || 0), 0);
  const parcelasMedio = deals.length > 0 ? totalParcelas / deals.length : 0;
  const yieldTotal = valorTotal > 0 ? (total / valorTotal) * 100 : 0;
  const yieldMes = parcelasMedio > 0 ? yieldTotal / parcelasMedio : 0;
  return { total, valorTotal, clientesUnicos, totalParcelas, parcelasMedio, yieldTotal, yieldMes };
}

function calcTrend(current, previous) {
  if (previous == null || previous === 0 || current === 0) {
    return { icon: '', text: '', cls: '' };
  }
  const diff = current - previous;
  const pct = (diff / previous) * 100;
  if (Math.abs(pct) < 1) return { icon: '→', text: '±0%', cls: 'trend-flat' };
  if (pct > 0) return { icon: '↑', text: `+${pct.toFixed(0)}%`, cls: 'trend-up' };
  return { icon: '↓', text: `${pct.toFixed(0)}%`, cls: 'trend-down' };
}

function renderTrendHtml(current, previous) {
  const t = calcTrend(current, previous);
  if (!t.icon) return '';
  return `<span class="trend ${t.cls}">${t.icon} ${t.text}</span>`;
}

function renderHistoryTable(periods, orderRecentFirst) {
  // periods: SEMPRE em ordem cronológica (antiga → recente)
  // orderRecentFirst: se true, inverte a ordem de EXIBIÇÃO (mas mantém tendências corretas)
  _periodDrillMap.clear();
  const rows = [];
  const allMetrics = periods.map(p => calcMetrics(p.deals));
  
  // Calcular média dos períodos com dados pra detectar outliers
  const nonZeroMetrics = allMetrics.filter(m => m.total > 0);
  const avgForOutlier = nonZeroMetrics.length > 0 
    ? nonZeroMetrics.reduce((s, m) => s + m.total, 0) / nonZeroMetrics.length 
    : 0;
  // Threshold: 30% de desvio vs média é considerado outlier (apenas quando há 3+ períodos com dados)
  const OUTLIER_THRESHOLD = 0.30;
  const enableOutliers = nonZeroMetrics.length >= 3 && avgForOutlier > 0;
  
  periods.forEach((p, i) => {
    const m = allMetrics[i];
    
    const isZero = p.deals.length === 0;
    const zeroClass = isZero ? ' zero' : '';
    const subHtml = p.sublabel ? `<span class="sub">${p.sublabel}</span>` : '';
    
    // Tendência comparando com período cronologicamente anterior
    const prevM = i > 0 ? allMetrics[i - 1] : null;
    const trendHtml = prevM ? renderTrendHtml(m.total, prevM.total) : '';
    
    // Detecção de outlier vs média histórica
    let rowClasses = [];
    if (p.isCurrent) rowClasses.push('current');
    if (enableOutliers && !isZero) {
      const deviation = (m.total - avgForOutlier) / avgForOutlier;
      if (deviation > OUTLIER_THRESHOLD) rowClasses.push('outlier-up');
      else if (deviation < -OUTLIER_THRESHOLD) rowClasses.push('outlier-down');
    }
    const pkey = `p_${i}`;
    if (p.deals.length > 0) {
      _periodDrillMap.set(pkey, {
        deals: p.deals,
        label: p.sublabel ? `${p.label} ${p.sublabel}` : p.label
      });
    }
    const pkeyAttr = p.deals.length > 0 ? ` data-pkey="${pkey}"` : '';
    const hint     = p.deals.length > 0 ? '<span class="row-expand-hint">↗</span>' : '';
    const trClass  = rowClasses.length ? ` class="${rowClasses.join(' ')}"` : '';

    rows.push(`<tr${trClass}${pkeyAttr}>
      <td class="label${zeroClass}">${p.label}${hint}${subHtml}</td>
      <td class="num${zeroClass}">R$ ${fmtBRL(m.total)}${trendHtml}</td>
      <td class="num${zeroClass}">${fmtPct(m.yieldTotal)}</td>
      <td class="num${zeroClass}">${fmtPct(m.yieldMes)}</td>
      <td class="num${zeroClass}">${m.clientesUnicos}</td>
      <td class="num${zeroClass}">${fmtDec(m.parcelasMedio, 2)}</td>
    </tr>`);
  });
  
  if (orderRecentFirst) rows.reverse();
  
  // Linha de média (sempre no final)
  if (nonZeroMetrics.length > 0) {
    const avgTotal = avgForOutlier;
    const avgYield = nonZeroMetrics.reduce((s, m) => s + m.yieldTotal, 0) / nonZeroMetrics.length;
    const avgYieldMes = nonZeroMetrics.reduce((s, m) => s + m.yieldMes, 0) / nonZeroMetrics.length;
    const avgCasos = nonZeroMetrics.reduce((s, m) => s + m.clientesUnicos, 0) / nonZeroMetrics.length;
    const avgParcelas = nonZeroMetrics.reduce((s, m) => s + m.parcelasMedio, 0) / nonZeroMetrics.length;
    
    rows.push(`<tr class="summary">
      <td class="label">Média<span class="sub">${nonZeroMetrics.length} de ${periods.length} períodos com dados</span></td>
      <td class="num">R$ ${fmtBRL(avgTotal)}</td>
      <td class="num">${fmtPct(avgYield)}</td>
      <td class="num">${fmtPct(avgYieldMes)}</td>
      <td class="num">${fmtDec(avgCasos, 1)}</td>
      <td class="num">${fmtDec(avgParcelas, 2)}</td>
    </tr>`);
  }
  
  return rows.join('');
}

function historyAverage(periods) {
  // Retorna a média do total dos períodos com dados (útil pra comparativos)
  const allMetrics = periods.map(p => calcMetrics(p.deals));
  const nonZero = allMetrics.filter(m => m.total > 0);
  if (!nonZero.length) return 0;
  return nonZero.reduce((s, m) => s + m.total, 0) / nonZero.length;
}


// ─── GRÁFICO DE LINHA (tendência) ──────────────────────
function renderLineChart(periods) {
  // periods: SEMPRE em ordem cronológica (antiga → recente)
  const metrics = periods.map(p => calcMetrics(p.deals));
  const values = metrics.map(m => m.total);
  const nonZero = values.filter(v => v > 0);
  
  if (nonZero.length < 2) {
    return '<div class="line-chart-empty">Poucos dados para gerar gráfico de tendência</div>';
  }
  
  const maxVal = Math.max(...values);
  const minVal = Math.min(...nonZero);
  const avg = nonZero.reduce((s, v) => s + v, 0) / nonZero.length;
  
  // Escala com margem visual (10% acima do max)
  const yMax = maxVal * 1.1;
  const yMin = 0;
  
  const W = 700, H = 140;
  const PAD = { top: 28, right: 60, bottom: 40, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  
  const xStep = periods.length > 1 ? chartW / (periods.length - 1) : 0;
  const yScale = v => PAD.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const xPos = i => PAD.left + i * xStep;
  
  // Grid horizontal (3 linhas de referência)
  const gridLines = [0.25, 0.5, 0.75, 1].map(frac => {
    const y = PAD.top + chartH - frac * chartH;
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W-PAD.right}" y2="${y.toFixed(1)}" stroke="#d0d0d0" stroke-width="0.4" opacity="0.3"/>`;
  }).join('');

  // Linha de média (pontilhada)
  const avgY = yScale(avg);
  const avgLine = `<line x1="${PAD.left}" y1="${avgY.toFixed(1)}" x2="${W-PAD.right}" y2="${avgY.toFixed(1)}" stroke="#8A847B" stroke-dasharray="1.5,2" stroke-width="0.6" />`;
  const avgLabel = `<text x="${W - PAD.right + 6}" y="${(avgY + 3).toFixed(1)}" font-size="7" fill="#8A847B" text-anchor="start" font-weight="400" letter-spacing="0.5" opacity="0.5">MÉDIA</text>`;
  
  // Path da linha + área preenchida (gradient suave)
  let linePath = '';
  let areaPath = '';
  let started = false;
  let firstX = 0, lastX = 0;
  
  periods.forEach((p, i) => {
    const v = metrics[i].total;
    if (v > 0) {
      const x = xPos(i);
      const y = yScale(v);
      if (!started) {
        linePath += `M ${x.toFixed(1)} ${y.toFixed(1)} `;
        areaPath += `M ${x.toFixed(1)} ${(PAD.top + chartH).toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)} `;
        firstX = x;
        started = true;
      } else {
        linePath += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
        areaPath += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
      }
      lastX = x;
    } else if (started) {
      // Fechar área parcial e resetar
      areaPath += `L ${lastX.toFixed(1)} ${(PAD.top + chartH).toFixed(1)} Z `;
      started = false;
    }
  });
  if (started) {
    areaPath += `L ${lastX.toFixed(1)} ${(PAD.top + chartH).toFixed(1)} Z`;
  }
  
  const gradientDef = `
    <defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#D37B5A" stop-opacity="0.18" />
        <stop offset="100%" stop-color="#D37B5A" stop-opacity="0" />
      </linearGradient>
    </defs>
  `;
  const areaShape = areaPath ? `<path d="${areaPath.trim()}" fill="url(#areaGrad)" />` : '';
  const lineShape = linePath ? `<path d="${linePath.trim()}" stroke="#D37B5A" stroke-width="1.3" fill="none" stroke-linejoin="round" stroke-linecap="round" />` : '';

  // Pontos (todos na mesma cor coral — destaque por tamanho)
  const dots = periods.map((p, i) => {
    const v = metrics[i].total;
    if (v === 0) return '';
    const y = yScale(v);
    const x = xPos(i);
    const r = p.isCurrent ? 4 : 3;
    const strokeW = p.isCurrent ? 1.6 : 1.3;
    const tipLbl = p.sublabel ? `${p.label} ${p.sublabel}` : p.label;
    const tipVal = `R$ ${fmtBRL(v)}`;
    const tipDays = p.businessDays ? ` · ${p.businessDays} dias úteis` : '';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#D37B5A" stroke="white" stroke-width="${strokeW}"/>
<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent" style="cursor:pointer"
  onmouseenter="showChartTip(event,'${tipLbl} · ${tipVal}${tipDays}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"/>`;
  }).join('');
  
  // Valores sobre todos os pontos
  const pointLabels = periods.map((p, i) => {
    const v = metrics[i].total;
    if (v === 0) return '';
    const x = xPos(i);
    const y = yScale(v);
    const valStr = v >= 1000 ? `R$ ${(v/1000).toFixed(1)}k` : `R$ ${Math.round(v)}`;
    return `<text x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="7" font-weight="400" fill="#1A1816" text-anchor="middle" opacity="0.55">${valStr}</text>`;
  }).join('');
  
  // Labels do eixo X
  const xLabels = periods.map((p, i) => {
    return `<text x="${xPos(i).toFixed(1)}" y="${H - 14}" font-size="7" fill="#4A453F" text-anchor="middle" font-weight="400" opacity="0.45">${p.label}</text>`;
  }).join('');

  // Sub-labels (se existir)
  const subLabels = periods.map((p, i) => {
    if (!p.sublabel) return '';
    return `<text x="${xPos(i).toFixed(1)}" y="${H - 4}" font-size="7" fill="#8A847B" text-anchor="middle" opacity="0.45">${p.sublabel}</text>`;
  }).join('');
  
  return `
    <div class="line-chart-container">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        ${gradientDef}
        ${gridLines}
        ${areaShape}
        ${avgLine}
        ${avgLabel}
        ${lineShape}
        ${dots}
        ${pointLabels}
        ${xLabels}
        ${subLabels}
      </svg>
    </div>
  `;
}

function sameDay(d1, d2) {
  if (!d1 || !d2) return false;
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

// Semana ISO anterior (handle de virada de ano)
function prevIsoWeek(year, week) {
  if (week > 1) return { year, week: week - 1 };
  // Semana 1 → última semana do ano anterior (28/dez sempre está na última semana ISO)
  const dec28 = new Date(year - 1, 11, 28);
  return { year: year - 1, week: getWeekNumber(dec28) };
}

// Semanas ISO que contêm pelo menos um dia do mês especificado
// Se month === 0: retorna todas as semanas do ano
function getWeeksOfMonth(year, month) {
  const weekMap = new Map();
  
  if (month === 0) {
    // Todas as semanas do ano
    for (let m = 1; m <= 12; m++) {
      const daysInM = new Date(year, m, 0).getDate();
      for (let d = 1; d <= daysInM; d++) {
        const date = new Date(year, m - 1, d);
        const w = getWeekNumber(date);
        let wYear = year;
        if (m === 1 && w >= 52) wYear = year - 1;
        else if (m === 12 && w === 1) wYear = year + 1;
        const key = `${wYear}-${w}`;
        if (!weekMap.has(key)) weekMap.set(key, { year: wYear, week: w });
      }
    }
  } else {
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const w = getWeekNumber(date);
      let wYear = date.getFullYear();
      if (month === 1 && w >= 52) wYear = year - 1;
      else if (month === 12 && w === 1) wYear = year + 1;
      else wYear = year;
      const key = `${wYear}-${w}`;
      if (!weekMap.has(key)) weekMap.set(key, { year: wYear, week: w });
    }
  }
  
  return Array.from(weekMap.values()).sort((a, b) => 
    a.year !== b.year ? a.year - b.year : a.week - b.week
  );
}

// ─── BLOCO PRINCIPAL: UNIFIED VIEW ────────────────────
function buildHistoryPeriods() {
  const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const mesesCompletos = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const diasAbr = ['dom','seg','ter','qua','qui','sex','sáb'];
  if (periodType === 'day') {
    const today = new Date(); today.setHours(0,0,0,0);
    const periods = [];
    let daysBack = 1;
    while (periods.length < 5) {
      const ref = new Date(today); ref.setDate(today.getDate() - daysBack++); ref.setHours(0,0,0,0);
      if (!isBizDay(ref)) continue;
      const deals = allDealsData.filter(d => isPago(d) && d.data_fechamento && sameDay(d.data_fechamento, ref));
      periods.unshift({ label: `${String(ref.getDate()).padStart(2,'0')}/${mesesNomes[ref.getMonth()].toLowerCase()}`, sublabel: diasAbr[ref.getDay()], deals, isCurrent: false });
    }
    document.getElementById('mainHistHeader').textContent = 'Últimos 5 dias úteis · fechados';
    return periods;
  }

  if (periodType === 'week') {
    const ref = (periodEnd && !isNaN(periodEnd)) ? periodEnd : new Date();
    const sy = ref.getFullYear(), sw = getWeekNumber(ref);
    const chain = [{ year: sy, week: sw }];
    for (let i = 0; i < 4; i++) { const l = chain[chain.length-1]; chain.push(prevIsoWeek(l.year, l.week)); }
    chain.reverse();
    document.getElementById('mainHistHeader').textContent = 'Últimas 5 semanas';
    return chain.map(wk => {
      const thu = isoWeekMonday(wk.year, wk.week);
      thu.setDate(thu.getDate() + 3);
      const wkMes = thu.getMonth() + 1;
      const wkAno = thu.getFullYear();
      return {
        label: `Semana ${wk.week}`, sublabel: String(wk.year),
        deals: allDealsData.filter(d => isPago(d) && d.ano === wkAno && d.mes === wkMes && d.semana_fechamento === wk.week),
        isCurrent: wk.year === sy && wk.week === sw,
        businessDays: bizDaysInRange(isoWeekMonday(wk.year, wk.week), isoWeekSunday(wk.year, wk.week))
      };
    });
  }

  if (periodType === 'last-quarter') {
    const now = new Date();
    const currentQ = Math.ceil((now.getMonth() + 1) / 3);
    const currentYear = now.getFullYear();
    const quarters = [];
    let q = currentQ, y = currentYear;
    for (let i = 0; i < 3; i++) {
      quarters.unshift({ q, y });
      q--; if (q === 0) { q = 4; y--; }
    }
    document.getElementById('mainHistHeader').textContent = 'Últimos 3 quarters';
    return quarters.map(({ q, y }) => {
      const startM = (q - 1) * 3 + 1;
      const endM   = q * 3;
      const deals = allDealsData.filter(d =>
        isPago(d) && d.ano === y && d.mes >= startM && d.mes <= endM
      );
      return { label: `Q${q}`, sublabel: String(y), deals, isCurrent: q === currentQ && y === currentYear };
    });
  }

  if (periodType === 'last-12-months') {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const periods = [];
    for (let i = 11; i >= 0; i--) {
      let mm = currentMonth - i, yy = currentYear;
      while (mm <= 0) { mm += 12; yy--; }
      const deals = allDealsData.filter(d => isPago(d) && d.ano === yy && d.mes === mm);
      periods.push({ label: mesesNomes[mm-1], sublabel: String(yy), deals, isCurrent: yy === currentYear && mm === currentMonth,
        businessDays: bizDaysInRange(new Date(yy, mm-1, 1), new Date(yy, mm, 0)) });
    }
    document.getElementById('mainHistHeader').textContent = 'Últimos 12 meses';
    return periods;
  }

  if (periodType === 'year' || periodType === 'all') {
    const ref = (periodEnd && !isNaN(periodEnd)) ? periodEnd : new Date();
    const sy = ref.getFullYear();
    document.getElementById('mainHistHeader').textContent = `Meses de ${sy}`;
    return Array.from({length: 12}, (_, i) => ({
      label: mesesNomes[i], sublabel: String(sy),
      deals: allDealsData.filter(d => isPago(d) && d.ano === sy && d.mes === i+1),
      isCurrent: false,
      businessDays: bizDaysInRange(new Date(sy, i, 1), new Date(sy, i+1, 0))
    }));
  }

  // month → last 5 months
  const ref = (periodEnd && !isNaN(periodEnd)) ? periodEnd : new Date();
  const sy = ref.getFullYear(), sm = ref.getMonth() + 1;
  const periods = [];
  for (let i = 4; i >= 0; i--) {
    let mm = sm - i, yy = sy;
    while (mm <= 0) { mm += 12; yy--; }
    const deals = allDealsData.filter(d => isPago(d) && d.ano === yy && d.mes === mm);
    periods.push({ label: mesesCompletos[mm-1], sublabel: String(yy), deals, isCurrent: yy === sy && mm === sm,
      businessDays: bizDaysInRange(new Date(yy, mm-1, 1), new Date(yy, mm, 0)) });
  }
  document.getElementById('mainHistHeader').textContent = 'Últimos 5 meses';
  return periods;
}

function updateMainView() {

  // Open pipeline (no date filter — always shows current state)
  const oprtdDeals = allDealsData.filter(d => isEmAberto(d) && norm(d.status_contrato) !== '');
  const semStatusDeals = allDealsData.filter(d => isEmAberto(d) && norm(d.status_contrato) === '');

  // Store for drill-down and close any open panel (data changed)
  _drillDeals.oprtd = oprtdDeals;
  _drillDeals.semStatus = semStatusDeals;
  closeDrillDrawer();
  initDrillListeners();
  const totalOprtd = oprtdDeals.reduce((s, d) => s + d.desagio_total, 0);
  _projOprtd = totalOprtd;
  const clientesOprtd = new Set(oprtdDeals.map(d => d.cliente)).size;
  const ticketOprtd = clientesOprtd > 0 ? totalOprtd / clientesOprtd : 0;
  const totalSemStatus = semStatusDeals.reduce((s, d) => s + d.desagio_total, 0);
  const semStatusCasos = new Set(semStatusDeals.map(d => d.cliente)).size;

  // Pago no período selecionado
  const pStart = periodStart || new Date();
  const pEnd   = periodEnd   || new Date();
  const pagoDeals = allDealsData.filter(d => {
    if (!isPago(d) || !d.data_fechamento) return false;
    if (periodType === 'day') return sameDay(d.data_fechamento, pEnd);
    return d.data_fechamento >= pStart && d.data_fechamento <= pEnd;
  });
  const totalPago = pagoDeals.reduce((s, d) => s + d.desagio_total, 0);
  const pagoCasos = new Set(pagoDeals.map(d => d.cliente)).size;
  const pagoLabels = { day: 'Pago hoje', week: 'Pago na semana', month: 'Pago no mês', 'last-quarter': 'Pago no período', 'last-12-months': 'Pago nos 12 meses', year: 'Pago no ano', all: 'Pago total', custom: 'Pago no período' };
  _drillDeals.pago  = pagoDeals;
  _drillLabels.pago = pagoLabels[periodType] || 'Pago';

  const isDay = periodType === 'day';

  // Mostra/esconde projeção conforme o período
  document.querySelector('.today-summary-grid').classList.toggle('hide-proj', !isDay);

  // No seletor HOJE, "Oportunidades em aberto" é redundante com "Projeção do dia" — esconde
  document.getElementById('boxOprtd').style.display = isDay ? 'none' : '';
  document.querySelector('.today-summary-grid').classList.toggle('hide-oprtd', isDay);

  document.getElementById('mainProjLabel').textContent = 'Projeção do dia';
  document.getElementById('mainProjSub').textContent = 'ofertas aceitas pelos clientes, aguardando pagamento';
  document.getElementById('mainProj').textContent = fmtBRL(totalOprtd);
  document.getElementById('mainPagoLabel').textContent = pagoLabels[periodType] || 'Pago';
  document.getElementById('mainPago').textContent = fmtBRL(totalPago);
  document.getElementById('mainPagoCount').textContent = pagoCasos;
  document.getElementById('mainOprtd').textContent = fmtBRL(totalOprtd);
  document.getElementById('mainOprtdCount').textContent = clientesOprtd;
  document.getElementById('mainOprtdTicket').textContent = 'R$ ' + fmtInt(ticketOprtd);
  document.getElementById('mainSemStatus').textContent = fmtBRL(totalSemStatus);
  document.getElementById('mainSemStatusCount').textContent = semStatusCasos;

  // Aviso no rodapé
  document.getElementById('mainFilters').textContent = isDay
    ? 'Projeção: em aberto com aceite do cliente (status de contrato definido), ainda não pagos · Sem aceite: em aberto sem status de contrato definido'
    : 'Oportunidades em aberto: em aberto com aceite do cliente · Sem aceite do cliente: em aberto sem status de contrato definido';

  // History
  const periods = buildHistoryPeriods();
  _lastHistoryPeriods = periods;
  _historySort = { col: null, dir: -1 };
  document.getElementById('mainHistory').innerHTML = renderHistoryTable(periods, true);
  bindHistorySort();
  document.getElementById('mainChart').innerHTML = renderLineChart(periods);

  // Comp badges
  const mediaHist = historyAverage(periods);
  let compHtml = '';
  if (mediaHist > 0 && totalPago > 0) {
    const t = calcTrend(totalPago, mediaHist);
    compHtml += `<span class="comp-badge ${t.cls.replace('trend-','')} ">${t.icon} ${t.text} vs média</span>`;
  }
  if (totalSemStatus > 0) {
    compHtml += `<span class="comp-badge flat">${semStatusCasos} aguardando resposta do cliente</span>`;
  }
  document.getElementById('mainComp').innerHTML = compHtml;
}

// ─── EVENT HANDLERS ─────────────────────────────────────

function setSyncBar(state, label, sub) {
  const bar = document.getElementById('syncBar');
  bar.className = 'sync-bar ' + state;
  document.getElementById('syncBarLabel').textContent = label || '';
  document.getElementById('syncBarSub').textContent = sub ? ' · ' + sub : '';
  const btn = document.getElementById('syncBarBtn');
  btn.disabled = (state === 'pending');
  btn.textContent = state === 'pending' ? 'Sincronizando…' : '⟳ Atualizar dados';
}

function hideSyncBar() {
  document.getElementById('syncBar').className = 'sync-bar hidden';
}

document.getElementById('syncBarBtn').addEventListener('click', () => { loadFromAPI(); loadMetasFromAPI(); });


// ─── PERÍODO GLOBAL ─────────────────────────────────────
let periodStart = null;
let periodEnd   = null;
let periodType  = 'month';

function getPresetDates(preset) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const today = new Date(year, month, now.getDate());

  switch (preset) {
    case 'today': return { start: today, end: today, type: 'day' };
    case 'this-week': {
      const dow = (now.getDay() + 6) % 7;
      const mon = new Date(today); mon.setDate(today.getDate() - dow);
      return { start: mon, end: today, type: 'week' };
    }
    case 'this-month':  return { start: new Date(year, month, 1), end: today, type: 'month' };
    case 'last-quarter': {
      const currentQ = Math.ceil((month + 1) / 3);
      let startQ = currentQ - 2, startY = year;
      while (startQ <= 0) { startQ += 4; startY--; }
      return { start: new Date(startY, (startQ - 1) * 3, 1), end: today, type: 'last-quarter' };
    }
    case 'last-12-months': {
      return { start: new Date(year, month - 11, 1), end: today, type: 'last-12-months' };
    }
    case 'all':  return { start: new Date(2020, 0, 1), end: today, type: 'all' };
    default:     return { start: new Date(year, month, 1), end: today, type: 'month' };
  }
}

function fmtDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function setPeriod(start, end, activePreset) {
  periodStart = start;
  periodEnd   = end;
  periodType  = getPresetDates(activePreset).type || 'month';

  document.querySelectorAll('.preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === activePreset)
  );
  document.getElementById('customStart').value = fmtDateInput(start);
  document.getElementById('customEnd').value   = fmtDateInput(end);

  if (allDealsData.length) {
    updateKPI();
    updateMainView();
  }
}

function applyCustomDates() {
  const sv = document.getElementById('customStart').value;
  const ev = document.getElementById('customEnd').value;
  if (!sv || !ev) return;
  const start = new Date(sv + 'T00:00:00');
  const end   = new Date(ev + 'T00:00:00');
  if (isNaN(start) || isNaN(end) || start > end) return;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  periodStart = start; periodEnd = end; periodType = 'custom';
  if (allDealsData.length) { updateKPI(); updateMainView(); }
}

// ─── KPI CARDS ──────────────────────────────────────────
function updateKPI() {
  const pStart = periodStart;
  const pEnd   = periodEnd;

  const deals = allDealsData.filter(d => {
    if (!norm(d.status_fechamento).includes('pago')) return false;
    if (d.data_fechamento) return d.data_fechamento >= pStart && d.data_fechamento <= pEnd;
    if (periodType === 'year' || periodType === 'all') return d.ano === pEnd.getFullYear();
    return d.ano === pEnd.getFullYear() && d.mes === pEnd.getMonth() + 1;
  });

  const duration = pEnd - pStart;
  const prevEnd   = new Date(pStart.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - duration);
  const prevDeals = allDealsData.filter(d => {
    if (!norm(d.status_fechamento).includes('pago')) return false;
    if (d.data_fechamento) return d.data_fechamento >= prevStart && d.data_fechamento <= prevEnd;
    return false;
  });

  const m  = calcMetrics(deals);
  const pm = calcMetrics(prevDeals);
  const ticket     = m.clientesUnicos  > 0 ? m.total  / m.clientesUnicos  : 0;
  const prevTicket = pm.clientesUnicos > 0 ? pm.total / pm.clientesUnicos : 0;

  function setChange(id, curr, prev) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!prev || prev === 0 || !curr) { el.className = 'kpi-change flat'; el.textContent = '—'; return; }
    const pct = ((curr - prev) / prev) * 100;
    const cls = pct > 1 ? 'up' : pct < -1 ? 'down' : 'flat';
    const arrow = cls === 'up' ? '↑' : cls === 'down' ? '↓' : '→';
    el.className = `kpi-change ${cls}`;
    el.textContent = `${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs anterior`;
  }

  document.getElementById('kpiDesagio').textContent        = fmtBRL(m.total);
  document.getElementById('kpiYieldTotal').textContent     = fmtPct(m.yieldTotal);
  document.getElementById('kpiYieldMes').textContent       = fmtPct(m.yieldMes);
  document.getElementById('kpiCasos').textContent          = m.clientesUnicos;
  document.getElementById('kpiTicket').textContent         = fmtBRL(ticket);
  document.getElementById('kpiParcelamento').textContent   = m.parcelasMedio.toFixed(1);

  setChange('kpiDesagioChange',       m.total,            pm.total);
  setChange('kpiYieldTotalChange',    m.yieldTotal,       pm.yieldTotal);
  setChange('kpiYieldMesChange',      m.yieldMes,         pm.yieldMes);
  setChange('kpiCasosChange',         m.clientesUnicos,   pm.clientesUnicos);
  setChange('kpiTicketChange',        ticket,             prevTicket);
  setChange('kpiParcelamentoChange',  m.parcelasMedio,    pm.parcelasMedio);
}

// ─── METAS VIEW ─────────────────────────────────────────
let metasYear  = new Date().getFullYear();
let metasMonth = new Date().getMonth() + 1;

const MESES_METAS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let goalsFromAPI = {}; // "ano_mes" → { mensal, sem: [v1..v5] }

async function loadMetasFromAPI() {
  try {
    const res = await fetch('/api/metas');
    if (!res.ok) return;
    const data = await res.json();
    goalsFromAPI = {};
    data.forEach(({ ano, mes, valor, sem }) => {
      goalsFromAPI[`${ano}_${mes}`] = { mensal: valor, sem: sem || [] };
    });
    if (_activeTab === 'metas2') updateMetasV2View();
  } catch(e) {
    console.warn('Falha ao carregar metas da API', e);
  }
}

function easterDate(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function brHolidays(year) {
  const easter = easterDate(year);
  const offset = (days) => { const d = new Date(easter); d.setDate(easter.getDate() + days); return d; };
  const fixed = [
    [0, 1], [3, 21], [4, 1], [8, 7], [9, 12], [10, 2], [10, 15], [10, 20], [11, 25],
  ].map(([mo, da]) => new Date(year, mo, da));
  const movable = [offset(-48), offset(-47), offset(-2), offset(60)]; // carnaval seg/ter, sexta-feira santa, corpus christi
  return new Set([...fixed, ...movable].map(d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`));
}

const _holidayCache = {};
function getHolidays(year) {
  if (!_holidayCache[year]) _holidayCache[year] = brHolidays(year);
  return _holidayCache[year];
}

function isBizDay(date) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  return !getHolidays(date.getFullYear()).has(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
}

function _bizDaysInMonth(year, month) {
  let count = 0;
  const days = new Date(year, month, 0).getDate();
  for (let d = 1; d <= days; d++) {
    if (isBizDay(new Date(year, month - 1, d))) count++;
  }
  return count;
}

function bizDaysInMonth(year, month) {
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    if (isBizDay(new Date(year, month - 1, d))) count++;
  }
  return count;
}

function elapsedBizDaysInMonth(year, month) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const firstDay = new Date(year, month - 1, 1);
  const cap = new Date(year, month, 0); // last day of month
  const lastDay = today < cap ? today : cap;
  let count = 0;
  const d = new Date(firstDay);
  while (d <= lastDay) {
    if (isBizDay(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function bizDaysInWeekOfMonth(wkYear, week, month, year) {
  const mon = isoWeekMonday(wkYear, week);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    if (isBizDay(d)) count++;
  }
  return count;
}

// Operational ramp: first weeks slow (pipeline building), middle weeks peak,
// penultimate week winds down, last week = end-of-month push if enough days.
function rampFactor(position, total, daysInWeek) {
  if (total <= 2) {
    if (position === 1 && daysInWeek <= 2) return 0.4;
    return position === 1 ? 0.8 : 1.2;
  }
  if (position === 1 && daysInWeek <= 2) return 0.25; // partial start: barely open
  if (position === 1)                    return 0.85;  // first full week: ramping up
  if (position === total && daysInWeek <= 2) return 0.55; // last days: transitioning out
  if (position === total)                return 1.20;  // last week: end-of-month push
  if (total === 3 && position === 2)     return 1.20;  // only middle week
  if (position === total - 1)            return 0.70;  // penultimate: wind-down
  // inner middle weeks: smooth sine peak
  const innerRange = Math.max(total - 3, 1);
  const innerPos   = position - 1;
  const t          = innerRange > 1 ? (innerPos - 0.5) / innerRange : 0.5;
  return 1.0 + 0.3 * Math.sin(Math.PI * t);
}

// Manual weekly distributions for months already reported (fractions of monthly meta)
const MANUAL_WEEKLY = {
  '2026_3': { 10: 0.200, 11: 0.300, 12: 0.300, 13: 0.150, 14: 0.050 },
  '2026_4': { 14: 2500/130000, 15: 40000/130000, 16: 40000/130000, 17: 15000/130000, 18: 32500/130000 },
};

function loadGoals(y, m) {
  const entry = goalsFromAPI[`${y}_${m}`];
  const metaMensal = entry ? entry.mensal : 0;
  if (metaMensal === 0) return { meta_mensal: 0, semanas: {} };

  // Sheet weekly overrides take highest priority (sem1…sem5 colunas na planilha)
  const apiSem = (entry && entry.sem) ? entry.sem : [];
  if (apiSem.some(v => v != null && v > 0)) {
    const weeks = getWeeksOfMonth(y, m);
    const semanas = {};
    weeks.forEach((wk, i) => {
      const val = apiSem[i];
      if (val != null && val > 0) semanas[wk.week] = val;
    });
    return { meta_mensal: metaMensal, semanas };
  }

  // Manual overrides para meses já reportados
  const manual = MANUAL_WEEKLY[`${y}_${m}`];
  if (manual) {
    const semanas = {};
    Object.entries(manual).forEach(([wk, frac]) => { semanas[parseInt(wk)] = metaMensal * frac; });
    return { meta_mensal: metaMensal, semanas };
  }

  // Algoritmo de distribuição por dias úteis + curva de ramp
  const weeks = getWeeksOfMonth(y, m);
  const weekData = weeks.map((wk, i) => {
    const biz = bizDaysInWeekOfMonth(wk.year, wk.week, m, y);
    return { wk, biz, factor: rampFactor(i + 1, weeks.length, biz) };
  });
  const weightedSum = weekData.reduce((s, w) => s + w.biz * w.factor, 0);
  const semanas = {};
  weekData.forEach(({ wk, biz, factor }) => {
    if (biz > 0 && weightedSum > 0)
      semanas[wk.week] = metaMensal * (biz * factor) / weightedSum;
  });
  return { meta_mensal: metaMensal, semanas };
}

function bizDaysInRange(start, end) {
  let count = 0;
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(0, 0, 0, 0);
  while (d <= e) {
    if (isBizDay(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Monday of ISO week
function isoWeekMonday(year, week) {
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7; // 0=Mon
  const d = new Date(year, 0, 4 - jan4Dow + (week - 1) * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoWeekSunday(year, week) {
  const d = isoWeekMonday(year, week);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function weekStatus(year, week) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mon = isoWeekMonday(year, week);
  const sun = isoWeekSunday(year, week); sun.setHours(0, 0, 0, 0);
  if (today > sun) return 'past';
  if (today >= mon && today <= sun) return 'current';
  return 'future';
}


function remainingBizDays(year, month) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lastDay = new Date(year, month, 0); lastDay.setHours(0, 0, 0, 0);
  if (lastDay < today) return 0;
  let count = 0;
  const d = new Date(today);
  while (d <= lastDay) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ─── CHART TOOLTIP ──────────────────────────────────────
function showChartTip(e, text) {
  const tip = document.getElementById('chartTooltip');
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.left = (e.clientX + 14) + 'px';
  tip.style.top  = (e.clientY - 38) + 'px';
}
function moveChartTip(e) {
  const tip = document.getElementById('chartTooltip');
  if (tip.style.display === 'block') {
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 38) + 'px';
  }
}
function hideChartTip() {
  document.getElementById('chartTooltip').style.display = 'none';
}


// ─── TAB SWITCHING ───────────────────────────────────────
let _activeTab = 'radar';
function switchTab(tab) {
  _activeTab = tab;
  closeDrillDrawer();
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  const isRadar      = tab === 'radar';
  const isMetas2     = tab === 'metas2';
  const isFinanceiro = tab === 'financeiro';
  const isPrec       = tab === 'precificacao';
  document.getElementById('radarHeader').style.display      = isRadar  ? 'block' : 'none';
  document.getElementById('timeFilterBar').classList.toggle('visible', isRadar);
  document.getElementById('kpiRow').classList.toggle('visible', isRadar);
  document.getElementById('blocoMain').style.display        = isRadar  ? 'block' : 'none';
  document.getElementById('viewMetasV2').style.display      = isMetas2 ? 'block' : 'none';
  document.getElementById('viewFinanceiro').style.display   = 'none';
  document.getElementById('viewPrecificacao').style.display = 'none';
  if (isMetas2)     updateMetasV2View();
  if (isFinanceiro) openFinanceiroTab();
  if (isPrec)       openPrecificacaoTab();
}

async function requireFinAuth() {
  if (sessionStorage.getItem('finAuth') === '1') return true;
  const pin = window.prompt('🔒 Acesso restrito. Digite a senha:');
  if (!pin) return false;
  try {
    const r = await fetch(`/api/fin-auth?pin=${encodeURIComponent(pin)}`);
    if (r.ok) {
      const data = await r.json();
      if (data.ok) { sessionStorage.setItem('finAuth', '1'); return true; }
    }
  } catch {}
  alert('Senha incorreta.');
  return false;
}

async function openFinanceiroTab() {
  if (!(await requireFinAuth())) {
    switchTab('radar');
    return;
  }
  if (!_finInitialized) {
    document.querySelectorAll('.fin-filter-btn').forEach(btn =>
      btn.addEventListener('click', () => { _finPeriod = btn.dataset.period; updateFinanceiroView(); })
    );
    document.getElementById('finSafraBody').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-pkey]');
      if (tr) openDrillDrawer(tr.dataset.pkey);
    });
    _finInitialized = true;
  }
  document.getElementById('viewFinanceiro').style.display = 'block';
  updateFinanceiroView();
}

// ─── METAS V2 ────────────────────────────────────────────

function last3BizDaysAvg(year, month) {
  const holidays = brHolidays(year);
  const isWorkday = d => {
    if (d.getDay() === 0 || d.getDay() === 6) return false;
    return !holidays.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  };
  const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  const bizDays = [];
  while (bizDays.length < 3) {
    if (cursor.getFullYear() !== year || cursor.getMonth() + 1 !== month) break;
    if (isWorkday(cursor)) bizDays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  if (!bizDays.length) return null;
  const total = allDealsData
    .filter(deal => isPago(deal) && deal.data_fechamento &&
      bizDays.some(day => sameDay(deal.data_fechamento, day)))
    .reduce((s, deal) => s + deal.desagio_total, 0);
  return total / bizDays.length;
}

function buildTrendText(weekRows) {
  const past = weekRows.filter(w => w.status === 'past' && w.meta > 0);
  if (past.length < 2) return null;
  const varPcts = past.map(w => w.accumMeta > 0 ? ((w.accumReal - w.accumMeta) / w.accumMeta) * 100 : null);
  const last = varPcts[varPcts.length - 1];
  const prev = varPcts.length > 1 ? varPcts[varPcts.length - 2] : null;
  const lastRes = past[past.length - 1].resultado;
  const prevRes = past.length > 1 ? past[past.length - 2].resultado : null;
  if (last !== null && last >= 0) {
    return prev !== null && last > prev
      ? 'Atingimento acumulado acima da meta e em aceleração nas últimas semanas.'
      : 'Atingimento acumulado dentro ou acima da meta.';
  }
  if (last !== null && prev !== null) {
    if (last > prev) return `Tendência de recuperação nas últimas ${Math.min(past.length, 3)} semanas — variação acumulada melhorando.`;
    if (last < prev) return 'Variação acumulada piorando semana a semana — ritmo abaixo do necessário.';
  }
  if (prevRes !== null && lastRes > prevRes) return 'Resultado da última semana superior à anterior — sinal positivo de curto prazo.';
  return null;
}

function buildMonthNarrative(weekRows, totalRealizado, metaMensal, falta, porDia, bizDays, isCurrentMonth, isPastMonth, avg3, currMetrics, prevMetrics) {
  if (!metaMensal || !weekRows.length) return null;

  const MESES_N = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const mes     = MESES_N[metasMonth - 1];
  const prevMes = MESES_N[(metasMonth - 2 + 12) % 12];
  const mesNome = mes.charAt(0).toUpperCase() + mes.slice(1);

  const atingimento = metaMensal > 0 ? (totalRealizado / metaMensal) * 100 : 0;
  const past      = weekRows.filter(w => w.status === 'past' && w.meta > 0);
  const current   = weekRows.find(w => w.status === 'current');
  const weeksOk   = past.filter(w => w.resultado >= w.meta);
  const weeksFail = past.filter(w => w.resultado < w.meta);
  const bestWeek  = past.length ? past.reduce((a, b) => b.resultado > a.resultado ? b : a) : null;

  const R    = v => `R$ ${fmtBRL(v)}`;
  const hi   = (txt, cls) => `<strong class="${cls}">${txt}</strong>`;
  const bold = txt => `<strong>${txt}</strong>`;
  const fmtP = v => v.toFixed(2).replace('.', ',') + '%';

  // ── Parágrafo 1: o que aconteceu ──

  let p1;
  if (isPastMonth) {
    p1 = atingimento >= 100
      ? `${bold(mesNome)} encerrou ${hi('acima da meta', 'hl-green')}: ${bold(R(totalRealizado))} realizados de ${bold(R(metaMensal))}, atingindo ${bold(Math.round(atingimento) + '%')} do objetivo.`
      : `${bold(mesNome)} encerrou ${hi('abaixo da meta', 'hl-coral')}: ${bold(R(totalRealizado))} realizados de ${bold(R(metaMensal))} — ${bold(Math.round(atingimento) + '%')} do que foi projetado.`;
  } else if (atingimento >= 100) {
    p1 = `${bold(mesNome)} ${hi('já atingiu a meta', 'hl-green')}: ${bold(R(totalRealizado))} realizados de ${bold(R(metaMensal))} (${bold(Math.round(atingimento) + '%')}).`;
  } else {
    p1 = `${bold(mesNome)} acumula ${bold(R(totalRealizado))} até agora — ${bold(Math.round(atingimento) + '%')} da meta de ${bold(R(metaMensal))}.`;
  }

  if (past.length > 0) {
    let wkStr;
    if (weeksOk.length === past.length) {
      wkStr = `Das ${bold(past.length)} semanas encerradas, ${hi('todas bateram', 'hl-green')} a meta semanal`;
      if (bestWeek && past.length > 1) wkStr += `, com destaque para a ${bold('sem ' + bestWeek.week)} (${bold(R(bestWeek.resultado))})`;
    } else if (weeksOk.length === 0) {
      wkStr = `Das ${bold(past.length)} semanas encerradas, ${hi('nenhuma', 'hl-coral')} atingiu a meta semanal`;
      if (bestWeek) wkStr += ` — a melhor foi a ${bold('sem ' + bestWeek.week)}, com ${bold(R(bestWeek.resultado))}`;
    } else {
      wkStr = `Das ${bold(past.length)} semanas encerradas, ${hi(weeksOk.length + ' bateram a meta', 'hl-green')} e ${hi(weeksFail.length + ' ficaram abaixo', 'hl-coral')}`;
      if (bestWeek && past.length > 1) wkStr += `, com a ${bold('sem ' + bestWeek.week)} como melhor semana (${bold(R(bestWeek.resultado))})`;
    }
    p1 += ' ' + wkStr + '.';
  }

  if (current && current.meta > 0 && isCurrentMonth) {
    const wkPct = Math.round((current.resultado / current.meta) * 100);
    if (current.resultado >= current.meta) {
      p1 += ` A semana atual (${bold('sem ' + current.week)}) ${hi('já bateu a meta semanal', 'hl-green')} com ${bold(R(current.resultado))}.`;
    } else if (current.resultado > 0) {
      p1 += ` Na semana atual (${bold('sem ' + current.week)}), o acumulado é de ${bold(R(current.resultado))} — ${bold(wkPct + '%')} da meta semanal.`;
    } else {
      p1 += ` A semana atual (${bold('sem ' + current.week)}) ainda não tem fechamentos registrados.`;
    }
  }

  // ── Parágrafo 2: perspectiva + qualidade ──
  let p2Parts = [];

  if (isCurrentMonth && falta != null) {
    if (falta <= 0) {
      p2Parts.push(`A meta do mês ${hi('já está garantida', 'hl-green')}, com ${bold(R(totalRealizado - metaMensal))} de superávit.`);
    } else {
      const nDias = `${bizDays} dia${bizDays !== 1 ? 's' : ''} útil${bizDays !== 1 ? 'eis' : ''}`;
      let fwd = `Para fechar no azul, o ritmo necessário é de ${bold(R(porDia) + '/dia')} nos ${bold(nDias)} restantes`;
      if (avg3 != null) {
        const ritmoOk = avg3 >= porDia;
        fwd += ` — a média das últimas 3 d.u. foi de ${bold(R(avg3))}, ${ritmoOk ? hi('suficiente para bater a meta nesse ritmo', 'hl-green') : hi('ainda insuficiente para virar o resultado', 'hl-coral')}`;
      }
      p2Parts.push(fwd + '.');
    }
  }

  if (currMetrics && currMetrics.total > 0) {
    const nC = currMetrics.clientesUnicos;
    const contracts = `${bold(nC + ' contrato' + (nC !== 1 ? 's' : ''))}`;
    if (prevMetrics && prevMetrics.total > 0) {
      const dC = nC - prevMetrics.clientesUnicos;
      const dY = currMetrics.yieldTotal - prevMetrics.yieldTotal;
      const volChg = dC > 0
        ? `, ${hi('+' + dC + ' a mais', 'hl-green')} que em ${prevMes}`
        : dC < 0
        ? `, ${hi(Math.abs(dC) + ' a menos', 'hl-coral')} que em ${prevMes}`
        : `, mesmo volume que em ${prevMes}`;
      const yieldComp = `yield total de ${bold(fmtP(currMetrics.yieldTotal))} (${dY > 0.05 ? 'acima' : dY < -0.05 ? 'abaixo' : 'em linha'} dos ${fmtP(prevMetrics.yieldTotal)} de ${prevMes})`;
      p2Parts.push(`O mês tem ${contracts} fechados${volChg}, com yield a.m. de ${bold(fmtP(currMetrics.yieldMes))} — ${yieldComp}.`);
    } else {
      p2Parts.push(`O mês tem ${contracts} fechados, com yield a.m. de ${bold(fmtP(currMetrics.yieldMes))} e yield total de ${bold(fmtP(currMetrics.yieldTotal))}.`);
    }
  }

  const parts = [p1];
  if (p2Parts.length) parts.push(p2Parts.join(' '));
  return parts.map(p => `<p class="v2-narrative-text">${p}</p>`).join('');
}

function buildCarteiraPerfilHTML(pagos, prevPagos) {
  if (!pagos || pagos.length < 3) return null;

  const fmtP = (v, d=1) => v.toFixed(d) + '%';
  const R    = v => `R$ ${fmtBRL(v)}`;
  const hi   = (txt, cls) => `<strong class="${cls}">${txt}</strong>`;
  const bold = txt => `<strong>${txt}</strong>`;
  const YM_MIN = 0.10;

  const n            = pagos.length;
  const totalDesagio = pagos.reduce((s, d) => s + d.desagio_total, 0);
  const totalValor   = pagos.reduce((s, d) => s + d.valor_contrato, 0);
  const portYield    = totalValor > 0 ? totalDesagio / totalValor : 0;
  const portParc     = pagos.reduce((s, d) => s + Math.max(1, d.parcelas_antecipadas || 1), 0) / n;

  const okYm          = pagos.filter(d => d.yield_operacao_mes >= YM_MIN);
  const desagioOkBoth = okYm.reduce((s, d) => s + d.desagio_total, 0);
  const pctDealsOk    = (okYm.length / n) * 100;
  const pctDesagioOk  = totalDesagio > 0 ? (desagioOkBoth / totalDesagio) * 100 : 0;

  // Distribuição por parcelas
  const groups = {};
  pagos.forEach(d => {
    const p = Math.max(1, d.parcelas_antecipadas || 1);
    const key = p >= 5 ? '5+' : String(p);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  // 5+ parcelas
  const highParc        = pagos.filter(d => (d.parcelas_antecipadas || 1) >= 5);
  const highParcDesagio = highParc.reduce((s, d) => s + d.desagio_total, 0);
  const highParcAvgYM   = highParc.length > 0
    ? highParc.reduce((s, d) => s + d.yield_operacao_mes, 0) / highParc.length : 0;

  // Mês anterior
  const prevN       = prevPagos ? prevPagos.length : 0;
  const prevDesagio = prevPagos ? prevPagos.reduce((s, d) => s + d.desagio_total, 0) : 0;
  const prevValor   = prevPagos ? prevPagos.reduce((s, d) => s + d.valor_contrato, 0) : 0;
  const prevYield   = prevValor > 0 ? prevDesagio / prevValor : null;
  const prevParc    = prevN > 0 ? prevPagos.reduce((s, d) => s + Math.max(1, d.parcelas_antecipadas || 1), 0) / prevN : null;
  const prevOkYm    = prevPagos ? prevPagos.filter(d => d.yield_operacao_mes >= YM_MIN) : [];
  const prevPctOk   = prevN > 0 ? (prevOkYm.length / prevN) * 100 : null;

  // ── 1. Boxes de saúde ──
  const portYieldAm  = pagos.reduce((s, d) => s + (d.yield_operacao_mes || 0), 0) / n;
  const parcColor    = portParc <= 3 ? 'var(--green)' : portParc <= 4 ? 'var(--amber)' : 'var(--coral)';
  const dealsOkColor = pctDealsOk >= 60 ? 'var(--green)' : pctDealsOk >= 40 ? 'var(--amber)' : 'var(--coral)';
  const desOkColor   = pctDesagioOk >= 60 ? 'var(--green)' : pctDesagioOk >= 40 ? 'var(--amber)' : 'var(--coral)';
  const yamAvgColor  = portYieldAm >= 0.10 ? 'var(--green)' : portYieldAm >= 0.08 ? 'var(--ink-soft)' : portYieldAm >= 0.07 ? 'var(--amber)' : 'var(--coral)';
  const yamAvgBadge  = portYieldAm >= 0.10 ? ' ✓' : portYieldAm < 0.07 ? ' ✕' : '';

  const statsHTML = `<div class="v2-carteira-stats">
    <div class="v2-cs-box v2-cs-box--highlight">
      <div class="v2-cs-label">Yield a.m. médio <span class="v2-cs-criteria">(meta ≥ 10%)</span></div>
      <div class="v2-cs-val" style="color:${yamAvgColor}">${fmtP(portYieldAm * 100, 2)}${yamAvgBadge}</div>
      <div class="v2-cs-sub">média ponderada da carteira paga</div>
    </div>
    <div class="v2-cs-box">
      <div class="v2-cs-label">Deals com qualidade <span class="v2-cs-criteria">(yield a.m. ≥ 10%)</span></div>
      <div class="v2-cs-val" style="color:${dealsOkColor}">${okYm.length} de ${n}</div>
      <div class="v2-cs-sub">${fmtP(pctDealsOk)} do volume de deals</div>
    </div>
    <div class="v2-cs-box">
      <div class="v2-cs-label">Deságio com qualidade</div>
      <div class="v2-cs-val" style="color:${desOkColor}">${fmtP(pctDesagioOk)}</div>
      <div class="v2-cs-sub">${R(desagioOkBoth)} de ${R(totalDesagio)}</div>
    </div>
    <div class="v2-cs-box">
      <div class="v2-cs-label">Yield total do portfólio</div>
      <div class="v2-cs-val">${fmtP(portYield * 100)}</div>
      <div class="v2-cs-sub">retorno total sobre o capital antecipado</div>
    </div>
    <div class="v2-cs-box">
      <div class="v2-cs-label">Parcelas médio</div>
      <div class="v2-cs-val" style="color:${parcColor}">${portParc.toFixed(2)}x</div>
      <div class="v2-cs-sub">${portParc <= 3 ? 'saudável — yield a.m. protegido' : portParc <= 4 ? 'atenção — pressiona yield a.m.' : 'alto — compromete yield a.m.'}</div>
    </div>
  </div>`;

  // ── 2. Tabela por parcelas ──
  const bucketOrder = ['1','2','3','4','5+'];
  const tableRows = bucketOrder.filter(k => groups[k]).map(k => {
    const g   = groups[k];
    const gN  = g.length;
    const gVal = g.reduce((s, d) => s + d.valor_contrato, 0);
    const gDes = g.reduce((s, d) => s + d.desagio_total, 0);
    const gYT  = g.reduce((s, d) => s + d.yield_operacao_total, 0) / gN;
    const gYM  = g.reduce((s, d) => s + d.yield_operacao_mes, 0) / gN;
    const ymCls = gYM >= YM_MIN ? 'v-pos' : 'v-neg';
    const label = k === '5+' ? '5+ parcelas' : `${k} parcela${k !== '1' ? 's' : ''}`;
    return `<tr>
      <td class="v2-wk">${label}</td>
      <td class="r">${gN} <span style="color:var(--ink-mute);font-size:10px">(${fmtP((gN/n)*100, 0)})</span></td>
      <td class="r">R$ ${fmtBRL(gVal / gN)}</td>
      <td class="r">R$ ${fmtBRL(gDes)}</td>
      <td class="r">${fmtP(gYT * 100)}</td>
      <td class="r ${ymCls}">${fmtP(gYM * 100)}</td>
    </tr>`;
  }).join('');

  const tableHTML = `<div class="v2-carteira-table-wrap">
    <div class="v2-carteira-section-label">Distribuição por parcelas</div>
    <div style="overflow-x:auto"><table class="v2-tbl">
      <thead><tr>
        <th>Faixa</th><th class="r">Deals</th><th class="r">Ticket médio</th>
        <th class="r">Deságio</th><th class="r">Yield total</th><th class="r">Yield mês</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
  </div>`;

  // ── 3. Insight ──
  const insightParts = [];

  if (pctDealsOk < 40) {
    insightParts.push(`Apenas ${bold(fmtP(pctDealsOk, 0))} dos deals atingiram yield a.m. ≥ 10%, respondendo por ${bold(fmtP(pctDesagioOk, 0))} do deságio — o crescimento está concentrado em operações abaixo do padrão de qualidade.`);
  } else if (pctDealsOk < 65) {
    insightParts.push(`${bold(fmtP(pctDealsOk, 0))} dos deals atingiram yield a.m. ≥ 10%, gerando ${bold(fmtP(pctDesagioOk, 0))} do deságio — carteira parcialmente dentro do padrão, com espaço relevante para melhoria.`);
  } else {
    insightParts.push(`${bold(fmtP(pctDealsOk, 0))} dos deals atingiram yield a.m. ≥ 10%, gerando ${bold(fmtP(pctDesagioOk, 0))} do deságio — ${hi('carteira com boa saúde', 'hl-green')}.`);
  }

  if (highParc.length > 0) {
    const pctHP = (highParc.length / n) * 100;
    insightParts.push(`Deals com ${bold('5+ parcelas')} representaram ${bold(fmtP(pctHP, 0))} do volume (${highParc.length} deal${highParc.length !== 1 ? 's' : ''}, ${R(highParcDesagio)} em deságio) com yield a.m. médio de ${bold(fmtP(highParcAvgYM * 100))} — ${highParcAvgYM < YM_MIN ? hi('abaixo do critério de yield a.m.', 'hl-coral') : hi('yield a.m. dentro do critério', 'hl-green')}.`);
  }

  if (prevYield != null && prevPctOk != null) {
    const dY  = portYield - prevYield;
    const dP  = portParc - (prevParc || portParc);
    const dOk = pctDealsOk - prevPctOk;
    const yComp = Math.abs(dY) > 0.003
      ? `yield total do portfólio ${dY > 0 ? hi('melhorou', 'hl-green') : hi('caiu', 'hl-coral')} ${bold(fmtP(Math.abs(dY * 100)))} vs mês anterior (${fmtP(prevYield * 100)})`
      : `yield total do portfólio estável vs mês anterior (${fmtP(prevYield * 100)})`;
    const pComp = Math.abs(dP) > 0.1
      ? `, parcelas médio ${dP > 0 ? hi('subiu', 'hl-coral') : hi('caiu', 'hl-green')} de ${(prevParc || portParc).toFixed(2)}x para ${portParc.toFixed(2)}x`
      : '';
    const okComp = Math.abs(dOk) > 2
      ? ` A proporção de deals com yield a.m. ≥ 10% ${dOk > 0 ? hi('melhorou', 'hl-green') : hi('piorou', 'hl-coral')} ${bold(fmtP(Math.abs(dOk), 0))} (era ${fmtP(prevPctOk, 0)}).`
      : ` A proporção de deals com yield a.m. ≥ 10% ficou estável (${fmtP(prevPctOk, 0)} → ${fmtP(pctDealsOk, 0)}).`;
    insightParts.push(`Comparando com o mês anterior: ${yComp}${pComp}.${okComp}`);
  }

  const bestBuckets = bucketOrder.filter(k => groups[k]).map(k => {
    const g = groups[k];
    const okRate = g.filter(d => d.yield_operacao_mes >= YM_MIN).length / g.length;
    return { k, okRate };
  }).filter(x => x.okRate >= 0.5).sort((a, b) => b.okRate - a.okRate);

  if (bestBuckets.length > 0) {
    const bestLabel = bestBuckets.slice(0, 2).map(x => x.k === '5+' ? '5+ parcelas' : `${x.k} parcela${x.k !== '1' ? 's' : ''}`).join(' e ');
    insightParts.push(`O perfil com maior taxa de qualidade está nos deals de ${bold(bestLabel)}, onde a maioria dos contratos atinge yield a.m. ≥ 10%. Concentrar volume nessa faixa é a alavanca mais direta para melhorar a saúde do portfólio.`);
  }

  const insightHTML = `<div class="v2-carteira-insight">${insightParts.map(p => `<p class="v2-carteira-insight-p">${p}</p>`).join('')}</div>`;

  return statsHTML + tableHTML + insightHTML;
}

function renderMetasV2Chart(weekRows, metaMensal, isCurrentMonth) {
  if (!weekRows.length) return '';
  const W = 700, H = 140;
  const PAD = { top: 28, right: 82, bottom: 28, left: 62 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const allVals = [metaMensal, ...weekRows.map(r => r.accumReal), ...weekRows.map(r => r.accumMeta)].filter(v => v > 0);
  if (!allVals.length) return '<div style="padding:20px;color:#8E8E9C;font-size:11px;text-align:center">Sem dados</div>';
  const maxVal = Math.max(...allVals) * 1.08;
  const yS = v => PAD.top + cH - (v / maxVal) * cH;
  const xStep = weekRows.length > 1 ? cW / (weekRows.length - 1) : cW;
  const xP = i => weekRows.length > 1 ? PAD.left + i * xStep : PAD.left + cW / 2;

  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD.top + cH - f * cH;
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W-PAD.right}" y2="${y.toFixed(1)}" stroke="#d0d0d0" stroke-width="0.4" opacity="0.2"/>`;
  }).join('');


  let metaPath = '', realPath = '';
  weekRows.forEach((r, i) => {
    if (r.accumMeta > 0) metaPath += `${(!metaPath || weekRows[i-1]?.accumMeta <= 0) ? 'M' : 'L'} ${xP(i).toFixed(1)} ${yS(r.accumMeta).toFixed(1)} `;
    if (r.accumReal > 0) realPath += `${(!realPath || weekRows[i-1]?.accumReal <= 0) ? 'M' : 'L'} ${xP(i).toFixed(1)} ${yS(r.accumReal).toFixed(1)} `;
  });

  const makeTip = r => {
    const real = r.accumReal >= 1000 ? `R$${(r.accumReal/1000).toFixed(0)}k` : `R$${Math.round(r.accumReal)}`;
    const meta = r.accumMeta >= 1000 ? `R$${(r.accumMeta/1000).toFixed(0)}k` : `R$${Math.round(r.accumMeta)}`;
    const pct  = r.accumMeta > 0 ? Math.round((r.accumReal / r.accumMeta) * 100) : null;
    const pctStr = pct != null ? ` · ${pct}% da meta` : '';
    return `sem ${r.week} · real ${real} / meta ${meta}${pctStr}`;
  };

  const dots = weekRows.map((r, i) => {
    const x = xP(i);
    let out = '';
    if (r.accumReal > 0) {
      const y = yS(r.accumReal);
      const dotR = r.status === 'current' ? 3.5 : 2.5;
      const col  = r.accumMeta > 0 && r.accumReal >= r.accumMeta ? '#5A8F6B' : '#E37B5A';
      const tip  = makeTip(r);
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="${col}" stroke="white" stroke-width="1.3"/>
<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent" style="cursor:pointer"
  onmouseenter="showChartTip(event,'${tip}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"/>`;
    }
    if (r.accumMeta > 0) {
      const y = yS(r.accumMeta);
      const tip = makeTip(r);
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#D0CCC6" stroke="white" stroke-width="0.8"/>
<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent" style="cursor:pointer"
  onmouseenter="showChartTip(event,'${tip}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"/>`;
    }
    return out;
  }).join('');

  const realLabels = weekRows.map((r, i) => {
    if (r.accumReal <= 0) return '';
    const x = xP(i), y = yS(r.accumReal);
    const v = r.accumReal >= 1000 ? `R$${(r.accumReal/1000).toFixed(0)}k` : `R$${Math.round(r.accumReal)}`;
    const col = r.accumMeta > 0 && r.accumReal >= r.accumMeta ? '#5A8F6B' : '#E37B5A';
    return `<text x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="9" font-weight="600" fill="${col}" text-anchor="middle" opacity="1">${v}</text>`;
  }).join('');

  const metaLabels = weekRows.map((r, i) => {
    if (r.accumMeta <= 0) return '';
    const x = xP(i);
    const yMeta = yS(r.accumMeta);
    const yReal = r.accumReal > 0 ? yS(r.accumReal) : null;
    const v = r.accumMeta >= 1000 ? `R$${(r.accumMeta/1000).toFixed(0)}k` : `R$${Math.round(r.accumMeta)}`;
    // anti-colisão: se os pontos estiverem a menos de 14 unidades de distância,
    // empurra o label da meta para o lado oposto ao real
    let labelY;
    if (yReal != null && Math.abs(yMeta - yReal) < 14) {
      labelY = yMeta > yReal ? yMeta + 10 : yMeta - 12;
    } else {
      labelY = yMeta - 6;
    }
    return `<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="7.5" font-weight="400" fill="#D0CCC6" text-anchor="middle" opacity="0.85">${v}</text>`;
  }).join('');

  const xLabels = weekRows.map((r, i) =>
    `<text x="${xP(i).toFixed(1)}" y="${H-8}" font-size="6" fill="#4E4E58" text-anchor="middle" font-weight="700" opacity="0.45">sem ${r.week}</text>`
  ).join('');

  const lx = PAD.left, ly = 16;
  const legend = `<g opacity="1">
    <line x1="${lx}" y1="${ly}" x2="${lx+12}" y2="${ly}" stroke="#E37B5A" stroke-width="1.6"/>
    <text x="${lx+16}" y="${ly+3}" font-size="6" fill="#4E4E58">acum. real</text>
    <line x1="${lx+74}" y1="${ly}" x2="${lx+86}" y2="${ly}" stroke="#D0CCC6" stroke-width="1" stroke-dasharray="3,2"/>
    <text x="${lx+90}" y="${ly+3}" font-size="6" fill="#D0CCC6">acum. meta</text>
  </g>`;

  const hint = `<text x="${W - PAD.right}" y="8" font-size="4" fill="#8E8E9C" text-anchor="end" opacity="0.7">passe o mouse nos pontos para ver real vs meta</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${grid}
    ${metaPath ? `<path d="${metaPath.trim()}" stroke="#D0CCC6" stroke-width="1" stroke-dasharray="4,2.5" fill="none" opacity="0.4"/>` : ''}
    ${realPath ? `<path d="${realPath.trim()}" stroke="#E37B5A" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${dots}${realLabels}${metaLabels}${xLabels}${legend}${hint}
  </svg>`;
}

function updateMetasV2View() {
  if (!allDealsData.length) return;
  const goals   = loadGoals(metasYear, metasMonth);
  const weeks   = getWeeksOfMonth(metasYear, metasMonth);

  let accumReal = 0, accumMeta = 0;
  const weekRows = weeks.map(wk => {
    const resultado = allDealsData
      .filter(d => isPago(d) && d.ano === metasYear && d.mes === metasMonth && d.semana_fechamento === wk.week)
      .reduce((s, d) => s + d.desagio_total, 0);
    const meta = goals.semanas[wk.week] || 0;
    accumReal += resultado; accumMeta += meta;
    const status = weekStatus(wk.year, wk.week);
    const businessDays = bizDaysInWeekOfMonth(wk.year, wk.week, metasMonth, metasYear);
    return { week: wk.week, year: wk.year, resultado, meta, accumReal, accumMeta, status, businessDays };
  });

  const totalRealizado = allDealsData
    .filter(d => isPago(d) && d.ano === metasYear && d.mes === metasMonth)
    .reduce((s, d) => s + d.desagio_total, 0);
  const metaMensal  = goals.meta_mensal || 0;
  const atingimento = metaMensal > 0 ? (totalRealizado / metaMensal) * 100 : null;

  const _today = new Date();
  const _ty = _today.getFullYear(), _tm = _today.getMonth() + 1;
  const isPastMonth    = metasYear < _ty || (metasYear === _ty && metasMonth < _tm);
  const isFutureMonth  = metasYear > _ty || (metasYear === _ty && metasMonth > _tm);
  const isCurrentMonth = !isPastMonth && !isFutureMonth;

  const falta   = metaMensal > 0 ? Math.max(0, metaMensal - totalRealizado) : null;
  const bizDays = isFutureMonth ? bizDaysInMonth(metasYear, metasMonth) : remainingBizDays(metasYear, metasMonth);
  const porDia  = (falta != null && falta > 0 && bizDays > 0) ? falta / bizDays : null;

  document.getElementById('v2MonthLabel').textContent = `${MESES_METAS[metasMonth - 1]} ${metasYear}`;

  // ── Camada 1: banner de status ──
  const banner = document.getElementById('v2StatusBanner');

  // Pace-based status: compara realizado com o esperado proporcional aos dias úteis decorridos
  const totalBizDays   = bizDaysInMonth(metasYear, metasMonth);
  const elapsedBizDays = isCurrentMonth ? elapsedBizDaysInMonth(metasYear, metasMonth) : totalBizDays;
  const pctMes         = totalBizDays > 0 ? elapsedBizDays / totalBizDays : 0;
  const esperado       = metaMensal * pctMes;
  const paceRatio      = (isCurrentMonth && esperado > 0) ? totalRealizado / esperado : null;
  const pctMesFmt      = Math.round(pctMes * 100);
  const pctFeitoFmt    = metaMensal > 0 ? Math.round(atingimento || 0) : null;

  let statusLabel, statusColor, statusBg, statusSub;
  if (atingimento === null) {
    statusLabel = 'Sem meta'; statusColor = '--ink-mute'; statusBg = '--paper-2';
    statusSub   = 'Defina uma meta mensal para ver o status';
  } else if (isFutureMonth) {
    statusLabel = 'Não iniciado'; statusColor = '--ink-mute'; statusBg = '--paper-2';
    statusSub   = 'Mês ainda não começou';
  } else if (atingimento >= 100) {
    statusLabel = 'Meta Batida'; statusColor = '--green'; statusBg = '--green-soft';
    statusSub   = isPastMonth
      ? `Encerrou com ${pctFeitoFmt}% da meta`
      : `${pctFeitoFmt}% feito · ${pctMesFmt}% do mês decorrido`;
  } else if (isPastMonth) {
    statusLabel = 'Não atingida'; statusColor = '--coral'; statusBg = '--coral-soft';
    statusSub   = `Encerrou com ${pctFeitoFmt}% da meta`;
  } else if (elapsedBizDays < 3) {
    // Muito cedo no mês — não há dados suficientes para avaliar ritmo
    statusLabel = 'Início de mês'; statusColor = '--ink-mute'; statusBg = '--paper-2';
    statusSub   = `Dia ${elapsedBizDays} útil — cedo demais para avaliar ritmo`;
  } else if (paceRatio >= 1.0) {
    statusLabel = 'On track'; statusColor = '--ink-soft'; statusBg = '--paper-2';
    statusSub   = `${pctFeitoFmt}% feito · ${pctMesFmt}% do mês decorrido`;
  } else if (paceRatio >= 0.8) {
    statusLabel = 'Atenção'; statusColor = '--amber'; statusBg = '--paper-2';
    statusSub   = `${pctFeitoFmt}% feito · ${pctMesFmt}% do mês decorrido · levemente abaixo do ritmo`;
  } else {
    statusLabel = 'Em risco'; statusColor = '--coral'; statusBg = '--coral-soft';
    statusSub   = `${pctFeitoFmt}% feito · ${pctMesFmt}% do mês decorrido · ritmo insuficiente para bater a meta`;
  }
  banner.style.setProperty('--v2-sc', `var(${statusColor})`);
  banner.style.setProperty('--v2-sb', `var(${statusBg})`);
  document.getElementById('v2StatusChip').textContent = statusLabel;
  document.getElementById('v2StatusSub').textContent  = statusSub;
  document.getElementById('v2StatusPct').textContent  = atingimento != null ? `${Math.round(atingimento)}%` : '—';

  // Legenda do box Atingimento
  let atingSub;
  if (isFutureMonth)          atingSub = 'Mês ainda não iniciado';
  else if (atingimento >= 100) atingSub = isPastMonth ? 'Meta encerrada acima do objetivo' : 'Meta já atingida neste mês';
  else if (isPastMonth)        atingSub = 'Resultado final do mês';
  else if (elapsedBizDays < 3) atingSub = 'Cedo demais para avaliar';
  else                         atingSub = `esperado ${Math.round(pctMes * 100)}% para esse ponto do mês`;
  document.getElementById('v2AtingSub').textContent = atingSub;

  document.getElementById('v2StatusVals').innerHTML = metaMensal > 0
    ? `<span style="color:var(--coral)">R$ ${fmtBRL(totalRealizado)}</span> <span class="v2-of">de</span> R$ ${fmtBRL(metaMensal)}`
    : '<em>Meta não definida</em>';

  // Legenda do box Realizado / Meta
  let valsSub;
  if (!metaMensal)               valsSub = 'Defina uma meta para ver o gap';
  else if (isFutureMonth)        valsSub = 'Mês ainda não iniciado';
  else if (atingimento >= 100)   valsSub = `+R$ ${fmtBRL(totalRealizado - metaMensal)} acima da meta`;
  else if (isPastMonth)          valsSub = 'Encerrou abaixo da meta';
  else if (falta != null && falta > 0) valsSub = `faltam R$ ${fmtBRL(falta)} para a meta`;
  else                           valsSub = '';
  document.getElementById('v2ValsSub').textContent = valsSub;
  // ── Camada 2: gráfico + cards laterais ──
  document.getElementById('v2ChartArea').innerHTML = renderMetasV2Chart(weekRows, metaMensal, isCurrentMonth);

  // Gap total
  const gapTotalEl  = document.getElementById('v2GapTotalVal');
  const gapTotalSub = document.getElementById('v2GapTotalSub');
  const metaBatida  = falta === 0 || (atingimento != null && atingimento >= 100);
  if (falta != null && falta > 0) {
    gapTotalEl.textContent  = `R$ ${fmtBRL(falta)}`;
    gapTotalEl.style.color  = '';
    gapTotalSub.textContent = 'valor que falta para bater a meta';
  } else if (metaBatida && metaMensal > 0) {
    gapTotalEl.textContent  = `+R$ ${fmtBRL(totalRealizado - metaMensal)}`;
    gapTotalEl.style.color  = 'var(--green)';
    gapTotalSub.textContent = 'superamos a meta em';
  } else {
    gapTotalEl.textContent  = '—';
    gapTotalEl.style.color  = '';
    gapTotalSub.textContent = 'valor que falta para bater a meta';
  }

  // Gap menos projeção do dia
  const liquidoCardEl  = document.getElementById('v2LiquidoCardVal');
  const liquidoCardSub = document.getElementById('v2LiquidoCardSub');
  if (!isCurrentMonth) {
    liquidoCardEl.textContent  = '—';
    liquidoCardEl.style.color  = '';
    liquidoCardSub.textContent = 'disponível apenas para o mês corrente';
  } else if (falta != null && falta > 0) {
    const liquido = falta - _projOprtd;
    if (liquido <= 0) {
      liquidoCardEl.textContent  = 'pipeline cobre';
      liquidoCardEl.style.color  = 'var(--green)';
    } else {
      liquidoCardEl.textContent  = `R$ ${fmtBRL(liquido)}`;
      liquidoCardEl.style.color  = '';
    }
    liquidoCardSub.textContent = 'valor que falta descontando o que temos previsto pra fechar hoje';
  } else {
    liquidoCardEl.textContent  = '—';
    liquidoCardEl.style.color  = '';
    liquidoCardSub.textContent = 'valor que falta descontando o que temos previsto pra fechar hoje';
  }

  // Gap por dia
  const diaCardEl   = document.getElementById('v2DiaCardVal');
  const diaCardDesc = document.getElementById('v2DiaCardDesc');
  const diaCardSub  = document.getElementById('v2DiaCardSub');
  const avg3 = isCurrentMonth ? last3BizDaysAvg(metasYear, metasMonth) : null;
  if (porDia != null && porDia > 0) {
    diaCardEl.textContent   = `R$ ${fmtBRL(porDia)}`;
    diaCardEl.style.color   = '';
    diaCardDesc.textContent = 'valor que temos que fazer por cada dia útil que resta no mês';
    let subParts = [`${bizDays} dia${bizDays !== 1 ? 's' : ''} útil${bizDays !== 1 ? 'eis' : ''} restante${bizDays !== 1 ? 's' : ''}`];
    if (avg3 != null) subParts.push(`média últ. 3 d.u.: R$ ${fmtBRL(avg3)}`);
    diaCardSub.textContent = subParts.join(' · ');
  } else if (metaBatida) {
    diaCardEl.textContent   = 'meta batida';
    diaCardEl.style.color   = 'var(--green)';
    diaCardDesc.textContent = isCurrentMonth ? 'nenhum valor adicional necessário' : 'mês encerrado acima da meta';
    diaCardSub.textContent  = avg3 != null ? `média últ. 3 d.u.: R$ ${fmtBRL(avg3)}` : '';
  } else {
    diaCardEl.textContent   = '—';
    diaCardEl.style.color   = '';
    diaCardDesc.textContent = 'valor que temos que fazer por cada dia útil que resta no mês';
    diaCardSub.textContent  = avg3 != null ? `média últ. 3 d.u.: R$ ${fmtBRL(avg3)}` : '';
  }


  // ── Camada 3: texto interpretativo + tabela ──
  const trendText = buildTrendText(weekRows);
  const trendEl = document.getElementById('v2TrendText');
  trendEl.textContent    = trendText || '';
  trendEl.style.display  = trendText ? 'block' : 'none';

  document.getElementById('v2Body').innerHTML = weekRows.map((r, idx) => {
    const varAccum  = r.accumReal - r.accumMeta;
    const varPct    = r.accumMeta > 0 ? (varAccum / r.accumMeta) * 100 : null;
    const varCls    = varAccum > 0 ? 'v-pos' : varAccum < 0 ? 'v-neg' : 'v-zero';
    const varAccStr = (r.accumMeta > 0 || r.accumReal > 0)
      ? (varAccum >= 0 ? '+' : '-') + 'R$ ' + fmtBRL(Math.abs(varAccum)) : '—';
    const varPctStr = varPct != null ? (varPct >= 0 ? '+' : '') + varPct.toFixed(0) + '%' : '—';

    let trendIcon = '';
    if (idx > 0 && varPct !== null && r.status !== 'future') {
      const prev = weekRows[idx - 1];
      const prevVP = prev.accumMeta > 0 && prev.status !== 'future'
        ? ((prev.accumReal - prev.accumMeta) / prev.accumMeta) * 100 : null;
      if (prevVP !== null) {
        trendIcon = varPct > prevVP ? '<span class="v2-ti-up">↑</span>'
                  : varPct < prevVP ? '<span class="v2-ti-dn">↓</span>'
                  : '<span class="v2-ti-flat">→</span>';
      }
    }

    const rowOk     = r.meta > 0 && r.status !== 'future' && r.resultado >= r.meta;
    const rowBehind = r.meta > 0 && r.status !== 'future' && r.resultado < r.meta;
    const trCls = [
      r.status === 'current' ? 'wk-current' : r.status === 'future' ? 'wk-future' : '',
      rowOk ? 'v2-row-ok' : rowBehind ? 'v2-row-behind' : ''
    ].filter(Boolean).join(' ');
    const resStr = r.resultado > 0 ? 'R$ ' + fmtBRL(r.resultado) : r.status === 'future' ? '—' : 'R$ 0,00';
    let wkBadge = '';
    if (r.meta > 0 && r.status === 'past') {
      wkBadge = rowOk
        ? '<span class="v2-wk-badge v2-wk-ok">meta batida</span>'
        : '<span class="v2-wk-badge v2-wk-no">meta não batida</span>';
    } else if (r.status === 'current' && r.meta > 0) {
      wkBadge = '<span class="v2-wk-badge v2-wk-cur">em andamento</span>';
    }
    return `<tr class="${trCls}">
      <td class="v2-wk">sem ${r.week}${wkBadge}</td>
      <td class="r">${r.businessDays ?? '—'}</td>
      <td class="r">${resStr}</td>
      <td class="r">${r.meta > 0 ? 'R$ ' + fmtBRL(r.meta) : '—'}</td>
      <td class="r">R$ ${fmtBRL(r.accumReal)}</td>
      <td class="r">${r.accumMeta > 0 ? 'R$ ' + fmtBRL(r.accumMeta) : '—'}</td>
      <td class="r">${varAccStr}</td>
      <td class="r ${varCls}">${varPctStr}${trendIcon}</td>
    </tr>`;
  }).join('');

  // ── Narrativa do mês ──
  const dealsThisMonth = allDealsData.filter(d => isPago(d) && d.ano === metasYear && d.mes === metasMonth);
  const prevM = metasMonth === 1 ? 12 : metasMonth - 1;
  const prevY = metasMonth === 1 ? metasYear - 1 : metasYear;
  const dealsPrevMonth = allDealsData.filter(d => isPago(d) && d.ano === prevY && d.mes === prevM);
  const currMetrics = calcMetrics(dealsThisMonth);
  const prevMetrics = calcMetrics(dealsPrevMonth);
  const narrative = buildMonthNarrative(weekRows, totalRealizado, metaMensal, falta, porDia, bizDays, isCurrentMonth, isPastMonth, avg3, currMetrics, prevMetrics);
  const narrativeEl = document.getElementById('v2Narrative');
  const narrativeText = document.getElementById('v2NarrativeText');
  if (narrative) {
    document.getElementById('v2NarrativeLabel').textContent = `Leitura do mês — ${MESES_METAS[metasMonth - 1]} ${metasYear}`;
    narrativeText.innerHTML = narrative;
    narrativeEl.style.display = 'block';
  } else {
    narrativeEl.style.display = 'none';
  }

}

// ─── REPORT | FINANCEIRO ─────────────────────────────────

const MESES_SHORT_FIN = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
let _finPeriod = 'all';
let _finInitialized = false;

function _makeSafraEntry(key, label, deals) {
  const n         = deals.length;
  const principal = deals.reduce((s, d) => s + d.principal, 0);
  const desagio   = deals.reduce((s, d) => s + d.desagio_total, 0);
  const faceValue = deals.reduce((s, d) => s + d.valor_contrato, 0);
  const parcTotal = deals.reduce((s, d) => s + d.parcelas_antecipadas, 0);
  const avgParc     = n > 0 ? parcTotal / n : 0;
  const yieldTotAvg = faceValue > 0 ? desagio / faceValue : 0;
  const yieldAmAvg  = avgParc   > 0 ? yieldTotAvg / avgParc : 0;
  const payback     = faceValue > 0 ? (principal / faceValue) * avgParc : 0;

  // Business days in the period
  let bizDays = 0;
  if (key.includes('-Q')) {
    const [yr, qStr] = key.split('-');
    const year = parseInt(yr), q = parseInt(qStr.slice(1));
    const startM = (q - 1) * 3 + 1;
    for (let i = 0; i < 3; i++) bizDays += _bizDaysInMonth(year, startM + i);
  } else {
    const [yr, mn] = key.split('-').map(Number);
    bizDays = _bizDaysInMonth(yr, mn);
  }

  return { key, label, n, principal, desagio, faceValue, avgParc, yieldAmAvg, yieldTotAvg, payback, bizDays, deals };
}

function buildSafraData(deals) {
  const map = new Map();
  deals.forEach(d => {
    const key = `${d.ano}-${String(d.mes).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, ds]) => {
      const [yr, mn] = key.split('-').map(Number);
      return _makeSafraEntry(key, `${MESES_SHORT_FIN[mn - 1]}/${String(yr).slice(2)}`, ds);
    });
}

function buildSafraDataByQuarter(deals) {
  const map = new Map();
  deals.forEach(d => {
    const q   = Math.ceil(d.mes / 3);
    const key = `${d.ano}-Q${q}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, ds]) => {
      const [yrStr, qStr] = key.split('-');
      return _makeSafraEntry(key, `Q${qStr.slice(1)}/${String(yrStr).slice(2)}`, ds);
    });
}

function _getFinPagos() {
  const pagos = allDealsData.filter(d => isPago(d));
  if (_finPeriod === 'ltm') {
    const cutDate = new Date();
    cutDate.setMonth(cutDate.getMonth() - 12);
    const cutY = cutDate.getFullYear(), cutM = cutDate.getMonth() + 1;
    return pagos.filter(d => d.ano > cutY || (d.ano === cutY && d.mes >= cutM));
  }
  return pagos;
}

function renderFinLTMChart(safras) {
  if (safras.length < 2) return '<div class="line-chart-empty">Poucos dados para gerar gráfico</div>';
  const W = 700, H = 140;
  const PAD = { top: 28, right: 24, bottom: 32, left: 24 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const n = safras.length;
  const gap = 6;
  const barW = (chartW - gap * (n - 1)) / n;

  const allTops = safras.map(s => s.principal + Math.max(0, s.desagio));
  const allBots = safras.map(s => Math.min(0, s.desagio));
  const yMax = Math.max(...allTops) * 1.18;
  const yMin = Math.min(0, ...allBots);
  const range = yMax - yMin || 1;
  const baseY = PAD.top + chartH * (yMax / range);

  const grid = [0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD.top + chartH - f * (chartH * yMax / range);
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W-PAD.right}" y2="${y.toFixed(1)}" stroke="#d0d0d0" stroke-width="0.4" opacity="0.25"/>`;
  }).join('');

  const K = v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : Math.round(v).toString();

  const bars = safras.map((s, i) => {
    const x  = PAD.left + i * (barW + gap);
    const pH = Math.max(1, (s.principal / range) * chartH);
    const pY = baseY - pH;

    let desEl = '';
    if (s.desagio > 0) {
      const dH = Math.max(1, (s.desagio / range) * chartH);
      const dY = pY - dH;
      desEl = `<rect x="${x.toFixed(1)}" y="${dY.toFixed(1)}" width="${barW.toFixed(1)}" height="${dH.toFixed(1)}" fill="#E37B5A" opacity="0.75" rx="1.5"/>
<text x="${(x+barW/2).toFixed(1)}" y="${(dY-4).toFixed(1)}" font-size="7" font-weight="400" fill="#E37B5A" text-anchor="middle" opacity="0.9">${K(s.desagio)}</text>`;
    } else if (s.desagio < 0) {
      const dH = Math.max(1, (Math.abs(s.desagio) / range) * chartH);
      desEl = `<rect x="${x.toFixed(1)}" y="${baseY.toFixed(1)}" width="${barW.toFixed(1)}" height="${dH.toFixed(1)}" fill="#E37B5A" opacity="0.5" rx="1.5"/>
<text x="${(x+barW/2).toFixed(1)}" y="${(baseY+dH+9).toFixed(1)}" font-size="7" font-weight="400" fill="#E37B5A" text-anchor="middle" opacity="0.7">${K(s.desagio)}</text>`;
    }

    const pLabelY = s.desagio <= 0 ? pY - 4 : pY + pH * 0.6;
    const pFill   = s.desagio <= 0 ? '#4A453F' : '#4A453F';
    const pOp     = '0.75';
    return `<rect x="${x.toFixed(1)}" y="${pY.toFixed(1)}" width="${barW.toFixed(1)}" height="${pH.toFixed(1)}" fill="#D0CCC6" opacity="0.55" rx="1.5"/>
${desEl}
<text x="${(x+barW/2).toFixed(1)}" y="${pLabelY.toFixed(1)}" font-size="7" font-weight="400" fill="${pFill}" text-anchor="middle" opacity="${pOp}">${K(s.principal)}</text>`;
  }).join('');

  const xLabels = safras.map((s, i) =>
    `<text x="${(PAD.left + i*(barW+gap) + barW/2).toFixed(1)}" y="${H-6}" font-size="7" fill="#4A453F" text-anchor="middle" font-weight="400" opacity="0.45">${s.label}</text>`
  ).join('');

  const baseline = yMin < 0
    ? `<line x1="${PAD.left}" y1="${baseY.toFixed(1)}" x2="${W-PAD.right}" y2="${baseY.toFixed(1)}" stroke="#d0d0d0" stroke-width="0.6"/>`
    : '';

  // Centered legend
  const ly = 14;
  const legend = `<g font-size="6" fill="#4E4E58">
    <rect x="${(W/2 - 72).toFixed(1)}" y="${ly-4}" width="8" height="5" fill="#B8B2AB" opacity="0.85" rx="1"/>
    <text x="${(W/2 - 60).toFixed(1)}" y="${ly}" fill="#4E4E58">principal</text>
    <rect x="${(W/2 + 6).toFixed(1)}" y="${ly-4}" width="8" height="5" fill="#E37B5A" opacity="0.75" rx="1"/>
    <text x="${(W/2 + 18).toFixed(1)}" y="${ly}" fill="#E37B5A">deságio</text>
  </g>`;

  return `<div class="line-chart-container"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${baseline}${bars}${xLabels}${legend}</svg></div>`;
}

function renderFinYieldPaybackChart(safras) {
  if (safras.length < 2) return '<div class="line-chart-empty">Poucos dados para gerar gráfico</div>';
  const W = 700, H = 140;
  const PAD = { top: 28, right: 24, bottom: 28, left: 24 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const n = safras.length;
  const gap = 6;
  const barW = (chartW - gap * (n - 1)) / n;
  const xCenter = i => PAD.left + i * (barW + gap) + barW / 2;

  // Separate scales: payback (months) for bars, yield a.m. for line
  const maxPb = Math.max(...safras.map(s => s.payback)) * 1.25 || 1;
  const maxYm = Math.max(...safras.map(s => s.yieldAmAvg)) * 1.25 || 1;

  const grid = [0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD.top + chartH - f * chartH;
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W-PAD.right}" y2="${y.toFixed(1)}" stroke="#d0d0d0" stroke-width="0.4" opacity="0.2"/>`;
  }).join('');

  // Payback bars
  const pbBars = safras.map((s, i) => {
    const x  = PAD.left + i * (barW + gap);
    const bH = Math.max(1, (s.payback / maxPb) * chartH);
    const bY = PAD.top + chartH - bH;
    const labelY = bH > 14 ? bY + bH * 0.6 : bY - 4;
    const labelFill = bH > 14 ? '#B8B2AB' : '#9A948D';
    return `<rect x="${x.toFixed(1)}" y="${bY.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="#D0CCC6" opacity="0.55" rx="1.5"/>
<text x="${xCenter(i).toFixed(1)}" y="${labelY.toFixed(1)}" font-size="7" font-weight="400" fill="${labelFill}" text-anchor="middle" opacity="0.8">${s.payback.toFixed(1)}m</text>`;
  }).join('');

  // Yield line + gradient area
  let yieldPath = '';
  safras.forEach((s, i) => {
    const x = xCenter(i);
    const y = PAD.top + chartH - (s.yieldAmAvg / maxYm) * chartH;
    yieldPath += (i === 0 ? 'M' : 'L') + ` ${x.toFixed(1)} ${y.toFixed(1)} `;
  });
  const areaPath = yieldPath.trim()
    + ` L ${xCenter(n-1).toFixed(1)} ${(PAD.top+chartH).toFixed(1)}`
    + ` L ${xCenter(0).toFixed(1)} ${(PAD.top+chartH).toFixed(1)} Z`;

  const yieldDots = safras.map((s, i) => {
    const x = xCenter(i);
    const y = PAD.top + chartH - (s.yieldAmAvg / maxYm) * chartH;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#E37B5A" stroke="white" stroke-width="1.3"/>
<text x="${x.toFixed(1)}" y="${(y-6).toFixed(1)}" font-size="7" font-weight="400" fill="#E37B5A" text-anchor="middle" opacity="0.9">${(s.yieldAmAvg*100).toFixed(2)}%</text>`;
  }).join('');

  const xLabels = safras.map((s, i) =>
    `<text x="${xCenter(i).toFixed(1)}" y="${H-6}" font-size="7" fill="#4A453F" text-anchor="middle" font-weight="400" opacity="0.45">${s.label}</text>`
  ).join('');

  // Centered legend
  const ly = 14;
  const legend = `<g font-size="6">
    <line x1="${(W/2 - 76).toFixed(1)}" y1="${ly-2}" x2="${(W/2 - 64).toFixed(1)}" y2="${ly-2}" stroke="#E37B5A" stroke-width="1.6"/>
    <text x="${(W/2 - 60).toFixed(1)}" y="${ly}" fill="#4E4E58">yield a.m.</text>
    <rect x="${(W/2 + 8).toFixed(1)}" y="${ly-5}" width="8" height="5" fill="#D0CCC6" opacity="0.7" rx="1"/>
    <text x="${(W/2 + 20).toFixed(1)}" y="${ly}" fill="#9A948D">payback (meses)</text>
  </g>`;

  return `<div class="line-chart-container"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="finYpGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#E37B5A" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="#E37B5A" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}${pbBars}
    <path d="${areaPath}" fill="url(#finYpGrad)"/>
    <path d="${yieldPath.trim()}" stroke="#E37B5A" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
    ${yieldDots}${xLabels}${legend}
  </svg></div>`;
}

function updateFinanceiroView() {
  document.querySelectorAll('.fin-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.period === _finPeriod)
  );

  const pagos  = _getFinPagos();
  if (!pagos.length) return;
  const safras = _finPeriod === 'quarter' ? buildSafraDataByQuarter(pagos) : buildSafraData(pagos);
  if (!safras.length) return;

  // Portfolio totals (all computed from raw sums — consistent with Operação view)
  const totalN     = safras.reduce((s, x) => s + x.n, 0);
  const totalPrinc = safras.reduce((s, x) => s + x.principal, 0);
  const totalDes   = safras.reduce((s, x) => s + x.desagio, 0);
  const totalFace  = safras.reduce((s, x) => s + x.faceValue, 0);
  const totalParc  = safras.reduce((s, x) => s + x.avgParc * x.n, 0);
  const portYieldT  = totalFace  > 0 ? totalDes / totalFace : 0;
  const portAvgParc = totalN     > 0 ? totalParc / totalN : 0;
  const portYieldAm = portAvgParc > 0 ? portYieldT / portAvgParc : 0;
  const portPayback = totalFace  > 0 ? (totalPrinc / totalFace) * portAvgParc : 0;

  // KPIs
  document.getElementById('finKpiPrincipal').textContent = fmtBRL(totalPrinc);
  document.getElementById('finKpiDesagio').textContent   = fmtBRL(totalDes);
  document.getElementById('finKpiYieldTot').textContent  = (portYieldT  * 100).toFixed(2) + '%';
  document.getElementById('finKpiYieldAm').textContent   = (portYieldAm * 100).toFixed(2) + '%';
  document.getElementById('finKpiCasos').textContent     = totalN;
  document.getElementById('finKpiPayback').textContent   = portPayback.toFixed(1);

  // Chart headers
  const ltmNote = _finPeriod === 'ltm' ? ' — últimos 12 meses' : _finPeriod === 'quarter' ? ' — por quarter' : ' — todo o histórico';
  document.getElementById('finLTMHeader').textContent = 'Evolução da operação' + ltmNote;
  document.getElementById('finYPHeader').textContent  = 'Yield a.m. e Payback' + ltmNote;

  // Charts
  document.getElementById('finLTMChart').innerHTML = renderFinLTMChart(safras);
  document.getElementById('finYPChart').innerHTML  = renderFinYieldPaybackChart(safras);

  // Table rows (newest first)
  const periodLabel = _finPeriod === 'quarter' ? 'quarters' : 'safras';
  document.getElementById('finTableHeader').textContent =
    `Performance por ${periodLabel} — ${safras.length} ${periodLabel} · ${totalN} casos`;

  // Populate drill map for each safra so drawer can show deal details
  safras.forEach(s => _periodDrillMap.set(s.key, { deals: s.deals, label: `${s.label} — ${s.n} caso${s.n !== 1 ? 's' : ''}` }));

  const _yamColor = v => v >= 0.10 ? 'var(--green)' : v >= 0.08 ? 'var(--ink-soft)' : v >= 0.07 ? 'var(--amber)' : 'var(--coral)';
  const _yamBg    = v => v >= 0.10 ? 'var(--green-soft)' : v >= 0.07 ? '' : 'rgba(227,123,90,0.07)';

  document.getElementById('finSafraBody').innerHTML = [...safras].reverse().map(s => {
    const yamC  = _yamColor(s.yieldAmAvg);
    const yamBg = _yamBg(s.yieldAmAvg);
    const yamBadge = s.yieldAmAvg >= 0.10 ? ' ✓' : s.yieldAmAvg < 0.07 ? ' ✕' : '';
    return `<tr data-pkey="${s.key}">
    <td class="label">${s.label}<span class="row-expand-hint">↗</span></td>
    <td class="num">${s.n}</td>
    <td class="num">${s.bizDays}</td>
    <td class="num">R$ ${fmtBRL(s.principal)}</td>
    <td class="num">R$ ${fmtBRL(s.desagio)}</td>
    <td class="num">${(s.yieldTotAvg * 100).toFixed(2)}%</td>
    <td class="num" style="color:${yamC};background:${yamBg};font-weight:600">${(s.yieldAmAvg * 100).toFixed(2)}%${yamBadge}</td>
    <td class="num">${s.payback.toFixed(1)}</td>
    <td class="num">${s.avgParc.toFixed(1)}x</td>
  </tr>`;
  }).join('');

  const totalBizDays = safras.reduce((s, x) => s + x.bizDays, 0);

  // Summary row (portfolio-level totals)
  document.getElementById('finSafraTfoot').innerHTML = `<tr class="summary">
    <td class="label">Total / Portfólio</td>
    <td class="num">${totalN}</td>
    <td class="num">${totalBizDays}</td>
    <td class="num">R$ ${fmtBRL(totalPrinc)}</td>
    <td class="num">R$ ${fmtBRL(totalDes)}</td>
    <td class="num">${(portYieldT  * 100).toFixed(2)}%</td>
    <td class="num">${(portYieldAm * 100).toFixed(2)}%</td>
    <td class="num">${portPayback.toFixed(1)}</td>
    <td class="num">${portAvgParc.toFixed(1)}x</td>
  </tr>`;

  // ── Análise do Perfil da Carteira ──
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const prevM = curM === 1 ? 12 : curM - 1;
  const prevY = curM === 1 ? curY - 1 : curY;
  const carteiraDeals     = allDealsData.filter(d => isPago(d) && d.ano === curY && d.mes === curM);
  const carteiraPrevDeals = allDealsData.filter(d => isPago(d) && d.ano === prevY && d.mes === prevM);
  const carteiraEl   = document.getElementById('v2CarteiraPerfil');
  const carteiraHTML = buildCarteiraPerfilHTML(carteiraDeals, carteiraPrevDeals);
  if (carteiraHTML) {
    document.getElementById('v2CarteiraTitle').textContent =
      `Análise do Perfil da Carteira — ${MESES_METAS[curM - 1]} ${curY}`;
    document.getElementById('v2CarteiraBody').innerHTML = carteiraHTML;
    carteiraEl.style.display = 'block';
  } else {
    carteiraEl.style.display = 'none';
  }
}

(function initMetasV2() {
  document.getElementById('v2PrevMonth').addEventListener('click', () => {
    metasMonth--; if (metasMonth < 1) { metasMonth = 12; metasYear--; }
    updateMetasV2View();
  });
  document.getElementById('v2NextMonth').addEventListener('click', () => {
    metasMonth++; if (metasMonth > 12) { metasMonth = 1; metasYear++; }
    updateMetasV2View();
  });
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );
})();

// ─── PRECIFICAÇÃO DINÂMICA ───────────────────────────────

let _precInit = false;

function _computeIRR(advance, payment, n) {
  if (advance <= 0 || payment <= 0 || n < 1) return 0;
  let r = 0.15;
  for (let iter = 0; iter < 200; iter++) {
    let pv = 0, dpv = 0;
    for (let k = 1; k <= n; k++) {
      const disc = Math.pow(1 + r, k);
      pv  += payment / disc;
      dpv -= k * payment / ((1 + r) * disc);
    }
    const f = pv - advance;
    if (Math.abs(f) < 0.001) break;
    if (Math.abs(dpv) < 1e-10) break;
    r -= f / dpv;
    if (r < -0.99) r = -0.99;
    if (r > 50) r = 50;
  }
  return r;
}

function _calcPricing(P, N, base, monthly) {
  if (N < 1 || P <= 0 || base < 0 || monthly <= 0) return null;
  const face     = P * N;
  const desconto = base + Math.pow(1 + monthly, N) - 1;
  if (desconto >= 1) return { invalid: true, N, desconto };
  const advance  = face * (1 - desconto);
  const desagio  = face - advance;
  const taxaMensalEfetiva = Math.pow(1 + desconto, 1 / N) - 1;
  const yieldTotal = desconto;
  const yieldAm    = yieldTotal / N;
  const payback    = (1 - desconto) * N;
  const roi        = _computeIRR(advance, P, N);
  return { N, P, face, desconto, advance, desagio, taxaMensalEfetiva, yieldTotal, yieldAm, payback, roi };
}

function _precBadgeInfo(yieldAm, N) {
  if (yieldAm >= 0.10) return { cls: 'prec-ym-ok',   icon: '✓', label: 'excelente' };
  if (yieldAm >= 0.08) return { cls: 'prec-ym-ok',   icon: '✓', label: 'ok' };
  if (yieldAm >= 0.07) return { cls: 'prec-ym-warn',  icon: '⚠', label: 'atenção' };
  return                      { cls: 'prec-ym-alert', icon: '✕', label: 'abaixo do mínimo' };
}

function renderPrecResults() {
  const P        = parseFloat(document.getElementById('precValorParcela').value) || 0;
  const scenarios = [1,2,3].map(i => ({
    n:       parseInt(document.getElementById(`precN${i}`).value) || 0,
    base:    (parseFloat(document.getElementById(`precBase${i}`).value) || 0) / 100,
    monthly: (parseFloat(document.getElementById(`precMonthly${i}`).value) || 0) / 100,
  })).filter(s => s.n > 0);

  const container = document.getElementById('precResults');
  if (!P || scenarios.length === 0) {
    container.innerHTML = '<div class="prec-empty">Preencha o valor da parcela para ver as comparações.</div>';
    return;
  }

  const B = v => 'R$ ' + fmtBRL(v);
  const T = v => (v * 100).toFixed(2).replace('.', ',') + '%';

  const cards = scenarios.map(({ n, base, monthly }) => {
    const r = _calcPricing(P, n, base, monthly);
    if (!r || r.invalid) {
      return `<div class="prec-card prec-card-na">
        <div class="prec-card-n">${n} parcela${n > 1 ? 's' : ''}</div>
        <div class="prec-card-na-msg">Desconto &gt; 100% — inviável com esses parâmetros.</div>
      </div>`;
    }
    const bi = _precBadgeInfo(r.yieldAm, n);
    return `<div class="prec-card">
      <div class="prec-card-header">
        <span class="prec-card-n">${n} parcela${n > 1 ? 's' : ''}</span>
        <span class="prec-card-face">Face ${B(r.face)}</span>
      </div>
      <div class="prec-card-hero">
        <div class="prec-card-hero-val">${T(r.yieldAm)}</div>
        <div class="prec-card-hero-sub">
          <span class="prec-card-hero-label">yield a.m.</span>
          <span class="prec-ym ${bi.cls}">${bi.icon} ${bi.label}</span>
        </div>
      </div>
      <div class="prec-card-metrics">
        <div class="prec-card-metric">
          <div class="prec-card-metric-val">${T(r.yieldTotal)}</div>
          <div class="prec-card-metric-label">yield total</div>
        </div>
        <div class="prec-card-metric">
          <div class="prec-card-metric-val">${r.payback.toFixed(1)}m</div>
          <div class="prec-card-metric-label">payback</div>
        </div>
        <div class="prec-card-metric">
          <div class="prec-card-metric-val">${B(r.desagio)}</div>
          <div class="prec-card-metric-label">deságio</div>
        </div>
      </div>
      <div class="prec-card-detail-section">Para o cliente</div>
      <div class="prec-card-row-sm"><span>Valor a receber</span><strong>${B(r.advance)}</strong></div>
      <div class="prec-card-row-sm"><span>Desconto aplicado</span><span>${T(r.desconto)}</span></div>
      <div class="prec-card-detail-section">Para a operação</div>
      <div class="prec-card-row-sm"><span>Taxa mensal efetiva</span><span>${T(r.taxaMensalEfetiva)}</span></div>
      <div class="prec-card-row-sm"><span>ROI mensal do investidor</span><span>${T(r.roi)}</span></div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="prec-cards">${cards}</div>`;
}

async function openPrecificacaoTab() {
  if (!(await requireFinAuth())) { switchTab('radar'); return; }
  document.getElementById('viewPrecificacao').style.display = 'block';
  _initPrecSubnav();
  _switchPrecSubtab('caso');
}

function _initPrecSubnav() {
  if (document.getElementById('precSubCaso')._precSubnavReady) return;
  document.querySelectorAll('.prec-subtab').forEach(btn => {
    btn.addEventListener('click', () => _switchPrecSubtab(btn.dataset.prectab));
  });
  // Proposta Rápida inputs
  const prOpts = '<option value="0">—</option>' +
    Array.from({length:24},(_,i)=>i+1).map(n=>`<option value="${n}">${n} parcela${n>1?'s':''}</option>`).join('');
  document.getElementById('prN').innerHTML = prOpts;
  document.getElementById('prN').value = '3';
  ['prP','prN','prBase','prMonthly'].forEach(id => {
    document.getElementById(id).addEventListener('input',  renderPropRapida);
    document.getElementById(id).addEventListener('change', renderPropRapida);
  });
  // Análise de Caso inputs
  document.getElementById('casoNTotal').innerHTML = prOpts;
  document.getElementById('casoNTotal').value = '6';
  ['casoTotal','casoNTotal','casoBase','casoMonthly'].forEach(id => {
    document.getElementById(id).addEventListener('input',  renderCasoCompleto);
    document.getElementById(id).addEventListener('change', renderCasoCompleto);
  });
  // Negociação inputs
  document.getElementById('negN').innerHTML = prOpts;
  document.getElementById('negN').value = '3';
  ['negP','negN'].forEach(id => {
    document.getElementById(id).addEventListener('input',  _updateNegSetup);
    document.getElementById(id).addEventListener('change', _updateNegSetup);
  });
  document.getElementById('negSlider').addEventListener('input', _updateNegResult);
  document.getElementById('precSubCaso')._precSubnavReady = true;
}

function _switchPrecSubtab(tab) {
  document.querySelectorAll('.prec-subtab').forEach(b => b.classList.toggle('active', b.dataset.prectab === tab));
  ['precSubRapida','precSubCaso','precSubNegociacao','precSubSimulador'].forEach(id =>
    document.getElementById(id).style.display = 'none'
  );
  const map = { rapida:'precSubRapida', caso:'precSubCaso', negociacao:'precSubNegociacao', simulador:'precSubSimulador' };
  document.getElementById(map[tab]).style.display = 'block';
  if (tab === 'rapida')     renderPropRapida();
  if (tab === 'caso')       renderCasoCompleto();
  if (tab === 'negociacao') _updateNegSetup();
  if (tab === 'simulador')  initPrecificacao();
}

// ── Análise de Caso ──────────────────────────────────────
let _casoOptions = [];

function renderCasoCompleto() {
  const totalFace = parseFloat(document.getElementById('casoTotal').value)   || 0;
  const NTotal    = parseInt(document.getElementById('casoNTotal').value)     || 0;
  const base      = (parseFloat(document.getElementById('casoBase').value)    || 0) / 100;
  const monthly   = (parseFloat(document.getElementById('casoMonthly').value) || 0) / 100;
  const container = document.getElementById('casoResult');
  if (!totalFace || !NTotal) { container.innerHTML = ''; _casoOptions = []; return; }

  const P  = totalFace / NTotal;
  const B  = v => 'R$ ' + fmtBRL(v);
  const T  = v => (v * 100).toFixed(2).replace('.', ',') + '%';
  const Tp = v => (v * 100).toFixed(1).replace('.', ',') + '%';

  _casoOptions = [];
  for (let n = 1; n <= NTotal; n++) {
    const r = _calcPricing(P, n, base, monthly);
    if (r && !r.invalid) _casoOptions.push({ n, NTotal, P, ...r });
  }
  if (!_casoOptions.length) {
    container.innerHTML = '<div class="prec-empty">Inviável com esses parâmetros.</div>';
    return;
  }

  const recOk    = [..._casoOptions].reverse().find(o => o.yieldAm >= 0.08);
  const recExcel = [..._casoOptions].reverse().find(o => o.yieldAm >= 0.10);
  const rec      = recOk || _casoOptions[0];

  const now        = new Date();
  const curY       = now.getFullYear();
  const curM       = now.getMonth() + 1;
  const metaKey    = `${curY}_${curM}`;
  const metaMensal = (goalsFromAPI[metaKey] || {}).mensal || 0;
  const realizado  = allDealsData
    .filter(d => isPago(d) && d.ano === curY && d.mes === curM)
    .reduce((s, d) => s + (d.desagio_total || 0), 0);
  const metaRestante = Math.max(0, metaMensal - realizado);
  const mes        = now.toLocaleString('pt-BR', { month: 'long' });
  const bi         = _precBadgeInfo(rec.yieldAm, rec.n);

  // Meta bar — mostra saldo restante após fechar o deal
  let metaBar = '';
  if (metaMensal > 0) {
    const aposDesio = metaRestante - rec.desagio;
    const pct = Math.min(100, Math.max(0, (metaMensal - Math.max(0, aposDesio)) / metaMensal * 100));
    const aposLabel = aposDesio > 0
      ? `com esse deal, reduzimos a meta para <strong>${B(aposDesio)}</strong>`
      : `com esse deal, a meta de ${mes} é atingida`;
    metaBar = `<div class="caso-meta-strip">
      <div class="caso-meta-label">Meta de ${mes}: ${B(metaMensal)} · já realizado: ${B(realizado)}</div>
      <div class="caso-meta-bar-wrap">
        <div class="caso-meta-bar" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="caso-meta-text">${aposLabel}</div>
    </div>`;
  }

  // Recommendation banner (clickable)
  let recHtml = `<div class="caso-rec caso-rec-clickable" data-caso-n="${rec.n}" title="Ver detalhes completos da proposta">
    <div class="caso-rec-col">
      <div class="caso-rec-eyebrow">Oferta recomendada</div>
      <div class="caso-rec-n">${rec.n} de ${NTotal} parcela${NTotal>1?'s':''}</div>
      <div class="caso-rec-sub">parcela de ${B(P)} · face ${B(rec.face)}</div>
    </div>
    <div class="caso-rec-col">
      <div class="caso-rec-eyebrow">Cliente recebe</div>
      <div class="caso-rec-val">${B(rec.advance)}</div>
      <div class="caso-rec-sub">${Tp(rec.desconto)} de desconto</div>
    </div>
    <div class="caso-rec-col">
      <div class="caso-rec-eyebrow">Yield a.m.</div>
      <div class="caso-rec-ym">
        <span class="caso-rec-ym-val">${T(rec.yieldAm)}</span>
        <span class="prec-ym ${bi.cls}">${bi.icon} ${bi.label}</span>
      </div>
    </div>
    <div class="caso-rec-col">
      <div class="caso-rec-eyebrow">Deságio gerado</div>
      <div class="caso-rec-val caso-rec-desagio">${B(rec.desagio)}</div>
      ${metaMensal > 0 ? `<div class="caso-rec-sub">${metaRestante - rec.desagio > 0 ? 'faltaria ' + B(metaRestante - rec.desagio) : 'meta atingida'}</div>` : ''}
    </div>
    <div class="caso-rec-cta">Ver proposta<br>completa ↗</div>
  </div>`;

  // Ajuste de valor redondo — pré-calcula o arredondado mais próximo (múltiplo de 50)
  const ajusteRounded = Math.round(rec.advance / 50) * 50;
  const ajusteHtml = `<div class="caso-ajuste">
    <div class="caso-ajuste-left">
      <span class="caso-ajuste-icon">⇄</span>
      <span class="caso-ajuste-label">Oferta arredondada — cliente recebe:</span>
      <div class="caso-ajuste-input-wrap">
        <span class="caso-ajuste-prefix">R$</span>
        <input type="number" id="casoAjusteVal" class="caso-ajuste-input" value="${ajusteRounded}" step="50" min="1">
      </div>
    </div>
    <div id="casoAjusteResult" class="caso-ajuste-result"></div>
  </div>`;

  // Options table (each row clickable)
  const rows = _casoOptions.map(o => {
    const ob       = _precBadgeInfo(o.yieldAm, o.n);
    const isRec    = o.n === rec.n;
    const isExcel  = recExcel && recExcel.n !== rec.n && o.n === recExcel.n;
    const rowCls = isRec ? 'caso-row-rec' :
      o.yieldAm >= 0.10 ? 'caso-row-excel' :
      o.yieldAm >= 0.08 ? 'caso-row-ok'    :
      o.yieldAm >= 0.07 ? 'caso-row-warn'  : 'caso-row-alert';
    const tags = isRec   ? ' <span class="caso-rec-tag">recomendado</span>' :
                 isExcel ? ' <span class="caso-rec-tag caso-excel-tag">máx. excelente</span>' : '';
    return `<tr class="${rowCls} caso-row-click" data-caso-n="${o.n}" title="Ver detalhes">
      <td>${o.n} parcela${o.n>1?'s':''}${tags}</td>
      <td class="r">${B(o.advance)}</td>
      <td class="r">${Tp(o.desconto)}</td>
      <td class="r">${B(o.desagio)}</td>
      <td class="r">${T(o.yieldAm)}</td>
      <td class="r">${o.payback.toFixed(1)}m</td>
      <td class="r"><span class="prec-ym ${ob.cls}">${ob.icon} ${ob.label}</span></td>
      <td class="r caso-row-expand">↗</td>
    </tr>`;
  }).join('');

  // Legend
  const legend = `<div class="caso-legend">
    <span class="caso-legend-title">Legenda do yield a.m.</span>
    <div class="caso-legend-items">
      <div class="caso-legend-item"><span class="prec-ym prec-ym-ok">✓ excelente</span><span class="caso-legend-thresh">≥ 10% a.m. — operação ideal</span></div>
      <div class="caso-legend-item"><span class="prec-ym prec-ym-ok">✓ ok</span><span class="caso-legend-thresh">≥ 8% a.m. — aceitável</span></div>
      <div class="caso-legend-item"><span class="prec-ym prec-ym-warn">⚠ atenção</span><span class="caso-legend-thresh">≥ 7% a.m. — requer aprovação</span></div>
      <div class="caso-legend-item"><span class="prec-ym prec-ym-alert">✕ abaixo do mínimo</span><span class="caso-legend-thresh">&lt; 7% a.m. — não aprovado</span></div>
    </div>
  </div>`;

  container.innerHTML = `${recHtml}${ajusteHtml}${metaBar}
    <div class="caso-table-wrap">
      <table class="caso-table">
        <thead>
          <tr>
            <th>Parcelas antecipadas</th>
            <th class="r">Cliente recebe</th>
            <th class="r">Desconto</th>
            <th class="r">Deságio</th>
            <th class="r">Yield a.m.</th>
            <th class="r">Payback</th>
            <th class="r">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${legend}`;

  // Click handlers
  container.querySelectorAll('[data-caso-n]').forEach(el => {
    el.addEventListener('click', () => {
      const n = parseInt(el.dataset.casoN);
      const opt = _casoOptions.find(o => o.n === n);
      if (opt) _openPrecDetailDrawer(opt, metaMensal, metaRestante, realizado, mes);
    });
  });

  // Ajuste de valor redondo
  const ajusteInput  = container.querySelector('#casoAjusteVal');
  const ajusteResult = container.querySelector('#casoAjusteResult');

  function _runAjuste() {
    const target = parseFloat(ajusteInput.value);
    if (!target) { ajusteResult.innerHTML = ''; return; }
    const newBase = 2 - (target / rec.face) - Math.pow(1 + monthly, rec.n);
    if (newBase < 0) {
      ajusteResult.innerHTML = `<span class="caso-ajuste-err">valor muito alto — máximo possível é ${B(rec.advance)}</span>`;
      return;
    }
    const r = _calcPricing(P, rec.n, newBase, monthly);
    if (!r || r.invalid) { ajusteResult.innerHTML = `<span class="caso-ajuste-err">inviável com esses parâmetros</span>`; return; }
    const bi2 = _precBadgeInfo(r.yieldAm, rec.n);
    ajusteResult.innerHTML =
      `taxa base: <strong>${T(newBase)}</strong> &nbsp;·&nbsp; yield a.m.: <strong>${T(r.yieldAm)}</strong> <span class="prec-ym ${bi2.cls}">${bi2.icon} ${bi2.label}</span> &nbsp;·&nbsp; deságio: <strong>${B(r.desagio)}</strong>`;
  }

  ajusteInput.addEventListener('input', _runAjuste);
  _runAjuste(); // calcula imediatamente com o valor pré-preenchido
}

function _openPrecDetailDrawer(opt, metaMensal, metaRestante, realizado, mes) {
  const drawer   = document.getElementById('drillDrawer');
  const backdrop = document.getElementById('drillBackdrop');
  if (!drawer) return;
  _drillActive = null;

  const B  = v => 'R$ ' + fmtBRL(v);
  const T  = v => (v * 100).toFixed(2).replace('.', ',') + '%';
  const bi = _precBadgeInfo(opt.yieldAm, opt.n);

  document.getElementById('drillDrawerTitle').textContent =
    `${opt.n} de ${opt.NTotal} parcela${opt.NTotal>1?'s':''} · parcela de R$ ${fmtBRL(opt.P)}`;
  document.getElementById('drillDrawerSub').textContent =
    `Face total: R$ ${fmtBRL(opt.face)} · caso com ${opt.NTotal} parcelas`;

  let metaHtml = '';
  if (metaMensal > 0) {
    const aposDesio = metaRestante - opt.desagio;
    const pct = Math.min(100, Math.max(0, (metaMensal - Math.max(0, aposDesio)) / metaMensal * 100));
    const aposLabel = aposDesio > 0
      ? `com esse deal, reduzimos a meta para <strong>R$ ${fmtBRL(aposDesio)}</strong>`
      : `com esse deal, a meta de ${mes} é atingida`;
    metaHtml = `<div class="pd-section">Meta de ${mes} (meta: R$ ${fmtBRL(metaMensal)} · já realizado: R$ ${fmtBRL(realizado)})</div>
      <div class="pd-meta-bar-wrap"><div class="pd-meta-bar" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="pd-meta-text">${aposLabel}</div>`;
  }

  document.getElementById('drillDrawerBody').innerHTML = `
    <div class="pd-hero">
      <div class="pd-hero-eyebrow">Cliente recebe</div>
      <div class="pd-hero-val">${B(opt.advance)}</div>
      <div class="pd-hero-sub">${T(opt.desconto)} de desconto sobre ${B(opt.face)}</div>
      <div class="pd-hero-badge"><span class="prec-ym ${bi.cls} pr-badge-lg">${bi.icon} ${bi.label}</span></div>
    </div>
    <div class="pd-metrics">
      <div class="pd-metric"><div class="pd-metric-val">${T(opt.yieldAm)}</div><div class="pd-metric-label">yield a.m.</div></div>
      <div class="pd-metric"><div class="pd-metric-val">${T(opt.yieldTotal)}</div><div class="pd-metric-label">yield total</div></div>
      <div class="pd-metric"><div class="pd-metric-val">${opt.payback.toFixed(1)}m</div><div class="pd-metric-label">payback</div></div>
    </div>
    <div class="pd-section">Para o cliente</div>
    <div class="pd-row"><span>Valor a receber hoje</span><strong>${B(opt.advance)}</strong></div>
    <div class="pd-row"><span>Desconto aplicado</span><span>${T(opt.desconto)}</span></div>
    <div class="pd-section">Para a operação</div>
    <div class="pd-row"><span>Deságio (receita)</span><strong>${B(opt.desagio)}</strong></div>
    <div class="pd-row"><span>Yield total</span><span>${T(opt.yieldTotal)}</span></div>
    <div class="pd-row"><span>Taxa mensal efetiva</span><span>${T(opt.taxaMensalEfetiva)}</span></div>
    <div class="pd-row"><span>ROI mensal do investidor</span><span>${T(opt.roi)}</span></div>
    ${metaHtml}`;

  drawer.classList.add('open');
  backdrop.classList.add('open');
}

// ── Proposta Rápida ──────────────────────────────────────
function renderPropRapida() {
  const P       = parseFloat(document.getElementById('prP').value) || 0;
  const N       = parseInt(document.getElementById('prN').value)   || 0;
  const base    = (parseFloat(document.getElementById('prBase').value)    || 0) / 100;
  const monthly = (parseFloat(document.getElementById('prMonthly').value) || 0) / 100;
  const container = document.getElementById('prResult');
  if (!P || !N) { container.innerHTML = ''; return; }
  const r = _calcPricing(P, N, base, monthly);
  if (!r || r.invalid) {
    container.innerHTML = '<div class="prec-empty">Inviável com esses parâmetros.</div>';
    return;
  }
  const bi = _precBadgeInfo(r.yieldAm, N);
  const B  = v => 'R$ ' + fmtBRL(v);
  const T  = v => (v * 100).toFixed(2).replace('.', ',') + '%';

  const now = new Date();
  const metaKey = `${now.getFullYear()}_${now.getMonth() + 1}`;
  const metaMensal = (goalsFromAPI[metaKey] || {}).mensal || 0;
  let metaHtml = '';
  if (metaMensal > 0) {
    const pct = (r.desagio / metaMensal * 100).toFixed(1);
    const mes = now.toLocaleString('pt-BR', { month: 'long' });
    metaHtml = `<div class="pr-meta-strip">
      <div class="pr-meta-left">
        <div class="pr-meta-label">Contribuição para meta de ${mes}</div>
        <div class="pr-meta-val">este deal traz <strong>${B(r.desagio)}</strong> de deságio — <strong>${pct}%</strong> da meta mensal de ${B(metaMensal)}</div>
      </div>
      <div class="pr-meta-bar-wrap"><div class="pr-meta-bar" style="width:${Math.min(100,parseFloat(pct))}%"></div></div>
    </div>`;
  }

  container.innerHTML = `<div class="pr-result pr-result-${bi.cls.replace('prec-ym-','')}">
    <div class="pr-result-top">
      <div class="pr-result-hero">
        <div class="pr-result-hero-label">Cliente recebe</div>
        <div class="pr-result-hero-val">${B(r.advance)}</div>
        <div class="pr-result-hero-sub">de ${B(r.face)} em recebíveis · ${N} parcela${N>1?'s':''} × ${B(P)}</div>
      </div>
      <div class="pr-result-badge-col">
        <span class="prec-ym ${bi.cls} pr-badge-lg">${bi.icon} ${bi.label}</span>
      </div>
    </div>
    <div class="pr-result-metrics">
      <div class="pr-result-metric">
        <div class="pr-result-metric-val">${T(r.yieldAm)}</div>
        <div class="pr-result-metric-label">yield a.m.</div>
      </div>
      <div class="pr-result-metric">
        <div class="pr-result-metric-val">${T(r.yieldTotal)}</div>
        <div class="pr-result-metric-label">yield total</div>
      </div>
      <div class="pr-result-metric pr-result-metric-hl">
        <div class="pr-result-metric-val">${B(r.desagio)}</div>
        <div class="pr-result-metric-label">deságio gerado</div>
      </div>
      <div class="pr-result-metric">
        <div class="pr-result-metric-val">${r.payback.toFixed(1)}m</div>
        <div class="pr-result-metric-label">payback</div>
      </div>
    </div>
    ${metaHtml}
  </div>`;
}

// ── Modo Negociação ──────────────────────────────────────
function _updateNegSetup() {
  const P = parseFloat(document.getElementById('negP').value) || 0;
  const N = parseInt(document.getElementById('negN').value)   || 0;
  const sec = document.getElementById('negSliderSection');
  if (!P || !N) { sec.style.display = 'none'; document.getElementById('negFace').textContent = ''; return; }

  const face = P * N;
  document.getElementById('negFace').textContent =
    `Face: R ${fmtBRL(face)} · ${N} × R ${fmtBRL(P)}`;
  sec.style.display = 'block';

  const slider = document.getElementById('negSlider');
  const SLMIN = 20, SLMAX = 97, span = SLMAX - SLMIN;

  // Zone boundaries: advance as % of face where yield thresholds hit
  const toPos = ratio => Math.max(0, Math.min(100, ((ratio * 100) - SLMIN) / span * 100));
  const p1 = toPos(1 - N * 0.10); // excelente/ok boundary
  const p2 = toPos(1 - N * 0.08); // ok/atenção boundary
  const p3 = toPos(1 - N * 0.07); // atenção/abaixo boundary

  document.getElementById('negTrack').style.background =
    `linear-gradient(to right,` +
    `#5A8F6B 0%,#5A8F6B ${p1.toFixed(1)}%,` +
    `#88C89A ${p1.toFixed(1)}%,#88C89A ${p2.toFixed(1)}%,` +
    `#D4A43A ${p2.toFixed(1)}%,#D4A43A ${p3.toFixed(1)}%,` +
    `#E37B5A ${p3.toFixed(1)}%,#E37B5A 100%)`;

  // Zone labels positioned by midpoint of each zone
  const zones = [
    { label: 'excelente', from: 0,  to: p1 },
    { label: 'ok',        from: p1, to: p2 },
    { label: 'atenção',   from: p2, to: p3 },
    { label: 'abaixo',    from: p3, to: 100 },
  ].filter(z => z.to > z.from);
  document.getElementById('negZoneLabels').innerHTML = zones.map(z =>
    `<span style="left:${((z.from+z.to)/2).toFixed(1)}%">${z.label}</span>`
  ).join('');

  // Set slider to a sensible default (ok zone midpoint)
  const defaultPos = Math.max(SLMIN, Math.min(SLMAX,
    Math.round((1 - N * 0.085) * 100)
  ));
  slider.value = defaultPos;
  _updateNegResult();
}

function _updateNegResult() {
  const P    = parseFloat(document.getElementById('negP').value) || 0;
  const N    = parseInt(document.getElementById('negN').value)   || 0;
  if (!P || !N) return;
  const face        = P * N;
  const advanceRatio = parseFloat(document.getElementById('negSlider').value) / 100;
  const advance     = face * advanceRatio;
  const desagio     = face - advance;
  const desconto    = desagio / face;
  const yieldAm     = desconto / N;
  const bi = _precBadgeInfo(yieldAm, N);
  const B  = v => 'R$ ' + fmtBRL(v);
  const T  = v => (v * 100).toFixed(2).replace('.', ',') + '%';

  document.getElementById('negResult').innerHTML = `<div class="neg-panels">
    <div class="neg-panel-client">
      <div class="neg-panel-eyebrow">Cliente recebe</div>
      <div class="neg-panel-hero">${B(advance)}</div>
      <div class="neg-panel-sub">${T(desconto)} de desconto · face ${B(face)}</div>
    </div>
    <div class="neg-panel-op">
      <div class="neg-panel-eyebrow">Para a operação</div>
      <div class="neg-op-ym">
        <span class="neg-ym-val">${T(yieldAm)}</span>
        <span class="prec-ym ${bi.cls}">${bi.icon} ${bi.label}</span>
      </div>
      <div class="neg-op-rows">
        <div class="neg-op-row"><span>Yield total</span><span>${T(desconto)}</span></div>
        <div class="neg-op-row"><span>Deságio gerado</span><span>${B(desagio)}</span></div>
      </div>
    </div>
  </div>`;
}

function initPrecificacao() {
  if (_precInit) { renderPrecResults(); return; }
  _precInit = true;
  const emptyOpt = '<option value="0">— não comparar —</option>';
  const opts = Array.from({ length: 24 }, (_, i) => i + 1)
    .map(n => `<option value="${n}">${n} parcela${n > 1 ? 's' : ''}</option>`)
    .join('');
  document.getElementById('precN1').innerHTML = emptyOpt + opts;
  document.getElementById('precN2').innerHTML = emptyOpt + opts;
  document.getElementById('precN3').innerHTML = emptyOpt + opts;
  document.getElementById('precN1').value = '1';
  document.getElementById('precN2').value = '3';
  document.getElementById('precN3').value = '6';
  ['precValorParcela',
   'precN1','precBase1','precMonthly1',
   'precN2','precBase2','precMonthly2',
   'precN3','precBase3','precMonthly3',
  ].forEach(id => {
    document.getElementById(id).addEventListener('input',  renderPrecResults);
    document.getElementById(id).addEventListener('change', renderPrecResults);
  });
}

// ─── INICIALIZAÇÃO ──────────────────────────────────────
(function initializeSelectors() {
  const { start, end } = getPresetDates('today');
  periodStart = start; periodEnd = end; periodType = 'day';
  document.getElementById('customStart').value = fmtDateInput(start);
  document.getElementById('customEnd').value   = fmtDateInput(end);
  document.querySelector('[data-preset="today"]').classList.add('active');

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = getPresetDates(btn.dataset.preset);
      setPeriod(d.start, d.end, btn.dataset.preset);
    });
  });

  document.getElementById('customStart').addEventListener('change', applyCustomDates);
  document.getElementById('customEnd').addEventListener('change', applyCustomDates);

  loadFromAPI();
  loadMetasFromAPI();
})();
