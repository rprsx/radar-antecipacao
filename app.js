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

// ─── API LOADER ─────────────────────────────────────────
async function loadFromAPI() {
  setSyncBar('pending', 'Carregando…', 'conectando ao banco');
  document.getElementById('errorMsg').textContent = '';
  try {
    const res = await fetch('/api/pipeline');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    processRows(rows);
    updateMetasView();
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
      valor_contrato:       parseNum(get('valor_total')) || 0,
    };
  }).filter(d => d.cliente !== '—' || d.status_fechamento || d.desagio_total > 0);

  document.getElementById('initialMsg').style.display = 'none';
  document.getElementById('viewTabs').style.display = 'flex';
  document.getElementById('timeFilterBar').classList.add('visible');
  document.getElementById('kpiRow').classList.add('visible');
  document.getElementById('blocoMain').style.display = 'block';
  updateKPI();
  updateMainView();
}

// ─── DATA ───────────────────────────────────────────────
let allDealsData = [];

// ─── HELPERS: MÉTRICAS, TENDÊNCIAS E HISTÓRICO ─────────
function calcMetrics(deals) {
  const total = deals.reduce((s, d) => s + d.desagio_total, 0);
  const valorTotal = deals.reduce((s, d) => s + (d.valor_contrato || 0), 0);
  const clientesUnicos = new Set(deals.map(d => d.cliente)).size;
  const totalParcelas = deals.reduce((s, d) => s + (d.parcelas_antecipadas || 0), 0);
  const parcelasMedio = clientesUnicos > 0 ? totalParcelas / clientesUnicos : 0;
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
    const trClass = rowClasses.length ? ` class="${rowClasses.join(' ')}"` : '';
    
    rows.push(`<tr${trClass}>
      <td class="label${zeroClass}">${p.label}${subHtml}</td>
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
  
  const W = 700, H = 180;
  const PAD = { top: 28, right: 60, bottom: 40, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  
  const xStep = periods.length > 1 ? chartW / (periods.length - 1) : 0;
  const yScale = v => PAD.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const xPos = i => PAD.left + i * xStep;
  
  // Grid horizontal (3 linhas de referência)
  const gridLines = [0.25, 0.5, 0.75, 1].map(frac => {
    const y = PAD.top + chartH - frac * chartH;
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W-PAD.right}" y2="${y.toFixed(1)}" stroke="#E5DFD4" stroke-width="1" />`;
  }).join('');
  
  // Labels do eixo Y (valor nos gridlines principais)
  const yLabels = [0, 0.5, 1].map(frac => {
    const y = PAD.top + chartH - frac * chartH;
    const val = frac * yMax;
    const valStr = val >= 1000 ? `R$ ${(val/1000).toFixed(0)}k` : `R$ ${Math.round(val)}`;
    return `<text x="${PAD.left - 8}" y="${(y + 3).toFixed(1)}" font-size="11" fill="#8A847B" text-anchor="end">${valStr}</text>`;
  }).join('');
  
  // Linha de média (pontilhada)
  const avgY = yScale(avg);
  const avgLine = `<line x1="${PAD.left}" y1="${avgY.toFixed(1)}" x2="${W-PAD.right}" y2="${avgY.toFixed(1)}" stroke="#8A847B" stroke-dasharray="2,3" stroke-width="1" />`;
  const avgLabel = `<text x="${W - PAD.right + 6}" y="${(avgY + 3).toFixed(1)}" font-size="10" fill="#8A847B" text-anchor="start" font-weight="700" letter-spacing="1">MÉDIA</text>`;
  
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
  const lineShape = linePath ? `<path d="${linePath.trim()}" stroke="#D37B5A" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round" />` : '';
  
  // Pontos (todos na mesma cor coral — destaque por tamanho)
  const dots = periods.map((p, i) => {
    const v = metrics[i].total;
    if (v === 0) return '';
    const y = yScale(v);
    const x = xPos(i);
    const r = p.isCurrent ? 6 : 4.5;
    const strokeW = p.isCurrent ? 2.5 : 2;
    const tipLbl = p.sublabel ? `${p.label} ${p.sublabel}` : p.label;
    const tipVal = `R$ ${fmtBRL(v)}`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#D37B5A" stroke="white" stroke-width="${strokeW}"/>
<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent" style="cursor:pointer"
  onmouseenter="showChartTip(event,'${tipLbl} · ${tipVal}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"/>`;
  }).join('');
  
  // Valor em destaque do período atual
  let currentValueLabel = '';
  const currentIdx = periods.findIndex(p => p.isCurrent);
  if (currentIdx >= 0 && metrics[currentIdx].total > 0) {
    const x = xPos(currentIdx);
    const y = yScale(metrics[currentIdx].total);
    const val = metrics[currentIdx].total;
    const valStr = val >= 1000 ? `R$ ${(val/1000).toFixed(1)}k` : `R$ ${Math.round(val)}`;
    currentValueLabel = `<text x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" font-size="12" font-weight="700" fill="#1A1816" text-anchor="middle">${valStr}</text>`;
  }
  
  // Labels do eixo X
  const xLabels = periods.map((p, i) => {
    return `<text x="${xPos(i).toFixed(1)}" y="${H - 14}" font-size="11" fill="#4A453F" text-anchor="middle" font-weight="700">${p.label}</text>`;
  }).join('');

  // Sub-labels (se existir)
  const subLabels = periods.map((p, i) => {
    if (!p.sublabel) return '';
    return `<text x="${xPos(i).toFixed(1)}" y="${H - 2}" font-size="10" fill="#8A847B" text-anchor="middle">${p.sublabel}</text>`;
  }).join('');
  
  return `
    <div class="line-chart-container">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="height:${H}px;">
        ${gradientDef}
        ${gridLines}
        ${yLabels}
        ${areaShape}
        ${avgLine}
        ${avgLabel}
        ${lineShape}
        ${dots}
        ${currentValueLabel}
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
  const isPago = d => norm(d.status_fechamento).includes('pago');

  if (periodType === 'day') {
    const today = new Date(); today.setHours(0,0,0,0);
    const periods = [];
    let daysBack = 1;
    while (periods.length < 5) {
      const ref = new Date(today); ref.setDate(today.getDate() - daysBack++); ref.setHours(0,0,0,0);
      if (ref.getDay() === 0 || ref.getDay() === 6) continue;
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
        isCurrent: wk.year === sy && wk.week === sw
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
      periods.push({ label: mesesNomes[mm-1], sublabel: String(yy), deals, isCurrent: yy === currentYear && mm === currentMonth });
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
      isCurrent: false
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
    periods.push({ label: mesesCompletos[mm-1], sublabel: String(yy), deals, isCurrent: yy === sy && mm === sm });
  }
  document.getElementById('mainHistHeader').textContent = 'Últimos 5 meses';
  return periods;
}

function updateMainView() {
  const isEmAberto = d => { const sf = norm(d.status_fechamento); return sf === 'emaberto' || sf === 'aberto'; };
  const isPago = d => norm(d.status_fechamento).includes('pago');

  // Open pipeline (no date filter — always shows current state)
  const oprtdDeals = allDealsData.filter(d => isEmAberto(d) && norm(d.status_contrato) !== '');
  const semStatusDeals = allDealsData.filter(d => isEmAberto(d) && norm(d.status_contrato) === '');
  const totalOprtd = oprtdDeals.reduce((s, d) => s + d.desagio_total, 0);
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

  const isDay = periodType === 'day';

  // Mostra/esconde projeção conforme o período
  document.querySelector('.today-summary-grid').classList.toggle('hide-proj', !isDay);

  // No seletor HOJE, "Oportunidades em aberto" é redundante com "Projeção do dia" — esconde
  document.getElementById('boxOprtd').style.display = isDay ? 'none' : '';
  document.querySelector('.today-summary-grid').classList.toggle('hide-oprtd', isDay);

  // Adaptive labels
  const pagoLabels = { day: 'Pago hoje', week: 'Pago na semana', month: 'Pago no mês', 'last-quarter': 'Pago no período', 'last-12-months': 'Pago nos 12 meses', year: 'Pago no ano', all: 'Pago total', custom: 'Pago no período' };

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
  document.getElementById('mainHistory').innerHTML = renderHistoryTable(periods, true);
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

  document.getElementById('kpiDesagio').textContent    = fmtBRL(m.total);
  document.getElementById('kpiYieldTotal').textContent = fmtPct(m.yieldTotal);
  document.getElementById('kpiYieldMes').textContent   = fmtPct(m.yieldMes);
  document.getElementById('kpiCasos').textContent      = m.clientesUnicos;
  document.getElementById('kpiTicket').textContent     = fmtBRL(ticket);

  setChange('kpiDesagioChange',    m.total,           pm.total);
  setChange('kpiYieldTotalChange', m.yieldTotal,      pm.yieldTotal);
  setChange('kpiYieldMesChange',   m.yieldMes,        pm.yieldMes);
  setChange('kpiCasosChange',      m.clientesUnicos,  pm.clientesUnicos);
  setChange('kpiTicketChange',     ticket,            prevTicket);
}

// ─── METAS VIEW ─────────────────────────────────────────
let metasYear  = new Date().getFullYear();
let metasMonth = new Date().getMonth() + 1;

const MESES_METAS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let goalsFromAPI = {}; // "ano_mes" → valor mensal

async function loadMetasFromAPI() {
  try {
    const res = await fetch('/api/metas');
    if (!res.ok) return;
    const data = await res.json();
    goalsFromAPI = {};
    data.forEach(({ ano, mes, valor }) => {
      goalsFromAPI[`${ano}_${mes}`] = valor;
    });
    updateMetasView();
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

function bizDaysInMonth(year, month) {
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    if (isBizDay(new Date(year, month - 1, d))) count++;
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

function loadGoals(y, m) {
  const metaMensal = goalsFromAPI[`${y}_${m}`] || 0;
  if (metaMensal === 0) return { meta_mensal: 0, semanas: {} };
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

function updateMetasView() {
  if (!allDealsData.length) return;

  const goals  = loadGoals(metasYear, metasMonth);
  const weeks  = getWeeksOfMonth(metasYear, metasMonth);
  const isPago = d => norm(d.status_fechamento).includes('pago');

  // Per-week results + accumulated totals
  let accumReal = 0, accumMeta = 0;
  let lastPastAccumReal = 0, lastPastAccumMeta = 0, hasPast = false;

  const weekRows = weeks.map(wk => {
    const resultado = allDealsData
      .filter(d => isPago(d) && d.ano === metasYear && d.mes === metasMonth && d.semana_fechamento === wk.week)
      .reduce((s, d) => s + d.desagio_total, 0);
    const meta   = goals.semanas[wk.week] || 0;
    accumReal   += resultado;
    accumMeta   += meta;
    const status = weekStatus(wk.year, wk.week);
    if (status === 'past') {
      lastPastAccumReal = accumReal;
      lastPastAccumMeta = accumMeta;
      hasPast = true;
    }
    return { week: wk.week, year: wk.year, resultado, meta, accumReal, accumMeta, status };
  });

  // Total realizado no mês
  const totalRealizado = allDealsData
    .filter(d => isPago(d) && d.ano === metasYear && d.mes === metasMonth)
    .reduce((s, d) => s + d.desagio_total, 0);

  const metaMensal  = goals.meta_mensal || 0;
  const atingimento = metaMensal > 0 ? (totalRealizado / metaMensal) * 100 : null;

  // Gap: acum real vs acum meta at end of last completed week
  const gap  = hasPast ? lastPastAccumReal - lastPastAccumMeta : null;
  const falta = metaMensal > 0 ? Math.max(0, metaMensal - totalRealizado) : null;
  const bizDays = remainingBizDays(metasYear, metasMonth);
  const porDia  = (falta != null && bizDays > 0) ? falta / bizDays : null;

  // ── Month label ──
  document.getElementById('metasMonthLabel').textContent =
    `${MESES_METAS[metasMonth - 1]} ${metasYear}`;

  // ── Hero vals ──
  document.getElementById('metasHeroVals').innerHTML = metaMensal > 0
    ? `Estamos hoje com <strong style="color:var(--coral)">R$ ${fmtBRL(totalRealizado)}</strong> de <strong>R$ ${fmtBRL(metaMensal)}</strong>`
    : '<em style="color:var(--ink-mute)">Meta não definida para este mês</em>';

  // ── Bar ──
  const fillPct  = metaMensal > 0 ? Math.min((totalRealizado / metaMensal) * 100, 100) : 0;
  const fillEl   = document.getElementById('metasBarFill');
  fillEl.style.width = fillPct + '%';

  const nowEl    = document.getElementById('metasBarNow');
  const nowPctEl = document.getElementById('metasBarNowPct');
  if (metaMensal > 0) {
    nowEl.style.left    = fillPct + '%';
    nowEl.style.display = 'block';
    nowPctEl.style.left    = fillPct + '%';
    nowPctEl.innerHTML     = `${Math.round(fillPct)}%<span class="mbar-sub">realizado</span>`;
    nowPctEl.style.display = 'block';
  } else {
    nowEl.style.display    = 'none';
    nowPctEl.style.display = 'none';
  }

  // ── Week milestone markers ──
  const trackEl = document.getElementById('metasBarTrack');
  trackEl.querySelectorAll('.metas-bar-wk').forEach(el => el.remove());
  if (metaMensal > 0) {
    const markers = weekRows
      .filter(wk => wk.accumMeta > 0)
      .map(wk => ({ wk, pct: Math.min((wk.accumMeta / metaMensal) * 100, 100) }));

    const MIN_GAP = 14; // % threshold before staggering to row 2
    markers.forEach(({ wk, pct }, i) => {
      const prevPct = i > 0 ? markers[i - 1].pct : -Infinity;
      const row = (pct - prevPct) < MIN_GAP ? 2 : 1;
      const cls = wk.status === 'future' ? 'wk-future' : wk.status === 'current' ? 'wk-current' : 'wk-past';
      const el  = document.createElement('div');
      el.className  = `metas-bar-wk row-${row} ${cls}`;
      el.style.left = pct + '%';
      el.innerHTML  = `<span class="metas-bar-wk-num">Sem ${wk.week}</span><span class="metas-bar-wk-amt">R$ ${fmtBRL(wk.accumMeta)}</span>`;
      trackEl.appendChild(el);
    });
  }

  const remWeeks = weekRows.filter(w => w.status !== 'past').length;
  document.getElementById('metasHeroSub').textContent =
    bizDays > 0
      ? `Ainda restam ${bizDays} dia${bizDays !== 1 ? 's' : ''} útei${bizDays !== 1 ? 's' : 'l'} e ${remWeeks} semana${remWeeks !== 1 ? 's' : ''}`
      : 'Mês encerrado';

  // ── Callout ──
  if (falta == null) {
    document.getElementById('metasFalta').textContent  = '—';
    document.getElementById('metasFalta').className    = 'myb-val';
    document.getElementById('metasPorDia').textContent = '—';
    document.getElementById('metasPorDia').className   = 'myb-val';
    document.getElementById('metasDiasLabel').textContent = '';
  } else if (falta === 0) {
    document.getElementById('metasFalta').textContent  = 'Meta batida!';
    document.getElementById('metasFalta').className    = 'myb-val goal-hit';
    document.getElementById('metasPorDia').textContent = 'Meta batida!';
    document.getElementById('metasPorDia').className   = 'myb-val goal-hit';
    document.getElementById('metasDiasLabel').textContent = '';
  } else {
    document.getElementById('metasFalta').textContent  = fmtBRL(falta);
    document.getElementById('metasFalta').className    = 'myb-val';
    document.getElementById('metasPorDia').textContent = porDia != null ? fmtBRL(porDia) : '—';
    document.getElementById('metasPorDia').className   = 'myb-val';
    document.getElementById('metasDiasLabel').textContent =
      bizDays > 0 ? `${bizDays} dia${bizDays !== 1 ? 's' : ''} útei${bizDays !== 1 ? 's' : 'l'} restante${bizDays !== 1 ? 's' : ''}` : '';
  }

  // ── Table ──
  document.getElementById('metasBody').innerHTML = weekRows.map(r => {
    const varAccum   = r.accumReal - r.accumMeta;
    const varPct     = r.accumMeta > 0 ? (varAccum / r.accumMeta) * 100 : null;
    const varCls     = varAccum > 0 ? 'v-pos' : varAccum < 0 ? 'v-neg' : 'v-zero';
    const varAccStr  = (r.accumMeta > 0 || r.accumReal > 0)
      ? (varAccum >= 0 ? '+' : '-') + 'R$ ' + fmtBRL(Math.abs(varAccum))
      : '—';
    const varPctStr  = varPct != null
      ? (varPct >= 0 ? '+' : '') + varPct.toFixed(0) + '%'
      : '—';

    const trCls      = r.status === 'current' ? 'wk-current' : r.status === 'future' ? 'wk-future' : '';
    const resStr     = r.resultado > 0 ? 'R$ ' + fmtBRL(r.resultado)
                     : r.status === 'future' ? '—' : 'R$ 0,00';
    const resCls     = r.meta > 0 && r.status !== 'future'
                     ? (r.resultado >= r.meta ? 'v-pos' : 'v-neg') : '';
    const metaStr    = r.meta > 0 ? 'R$ ' + fmtBRL(r.meta) : '—';
    const accMStr    = r.accumMeta > 0 ? 'R$ ' + fmtBRL(r.accumMeta) : '—';

    return `<tr class="${trCls}">
      <td class="wk">sem ${r.week}</td>
      <td class="r ${resCls}">${resStr}</td>
      <td class="r">${metaStr}</td>
      <td class="r">R$ ${fmtBRL(r.accumReal)}</td>
      <td class="r">${accMStr}</td>
      <td class="r ${varCls}">${varAccStr}</td>
      <td class="r ${varCls}">${varPctStr}</td>
    </tr>`;
  }).join('');

  // ── Chart ──
  document.getElementById('metasChart').innerHTML = renderMetasChart(weekRows, metaMensal);
}

function renderMetasChart(weekRows, metaMensal) {
  if (!weekRows.length) return '';

  const W = 700, H = 200;
  const PAD = { top: 36, right: 80, bottom: 36, left: 60 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const allVals = [
    metaMensal,
    ...weekRows.map(r => r.accumReal),
    ...weekRows.map(r => r.accumMeta),
  ].filter(v => v > 0);
  if (!allVals.length) return '<div style="padding:24px;color:var(--ink-mute);font-size:11px;text-align:center">Sem dados para o gráfico</div>';

  const maxVal = Math.max(...allVals) * 1.08;
  const yS = v => PAD.top + cH - (v / maxVal) * cH;
  const xP = i => weekRows.length > 1 ? PAD.left + i * (cW / (weekRows.length - 1)) : PAD.left + cW / 2;

  // Grid
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD.top + cH - f * cH;
    const v = f * maxVal;
    const lbl = v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${Math.round(v)}`;
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W-PAD.right}" y2="${y.toFixed(1)}" stroke="#E5DFD4" stroke-width="1"/>
            <text x="${PAD.left-6}" y="${(y+3).toFixed(1)}" font-size="11" fill="#8A847B" text-anchor="end">${lbl}</text>`;
  }).join('');

  // Bars (weekly resultado, light fill)
  const barW = Math.min(cW / weekRows.length * 0.4, 28);
  const bars = weekRows.map((r, i) => {
    if (r.resultado <= 0) return '';
    const x = xP(i), bH = PAD.top + cH - yS(r.resultado);
    const tip = `sem ${r.week} · resultado R$ ${fmtBRL(r.resultado)}`;
    return `<rect x="${(x - barW/2).toFixed(1)}" y="${yS(r.resultado).toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="#D37B5A" opacity="0.18" style="cursor:pointer"
  onmouseenter="showChartTip(event,'${tip}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"/>`;
  }).join('');

  // Meta line (dashed gray)
  let metaPath = '';
  weekRows.forEach((r, i) => {
    if (r.accumMeta <= 0) return;
    const cmd = (!metaPath || weekRows[i-1]?.accumMeta <= 0) ? 'M' : 'L';
    metaPath += `${cmd} ${xP(i).toFixed(1)} ${yS(r.accumMeta).toFixed(1)} `;
  });

  // Real line (coral)
  let realPath = '';
  weekRows.forEach((r, i) => {
    if (r.accumReal <= 0) return;
    const cmd = (!realPath || weekRows[i-1]?.accumReal <= 0) ? 'M' : 'L';
    realPath += `${cmd} ${xP(i).toFixed(1)} ${yS(r.accumReal).toFixed(1)} `;
  });

  // Dots on real line
  const dots = weekRows.map((r, i) => {
    if (r.accumReal <= 0) return '';
    const x = xP(i), y = yS(r.accumReal);
    const dotR = r.status === 'current' ? 5 : 3.5;
    const tip = `sem ${r.week} · acum. real R$ ${fmtBRL(r.accumReal)}`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#D37B5A" stroke="white" stroke-width="2"/>
<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent" style="cursor:pointer"
  onmouseenter="showChartTip(event,'${tip}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"/>`;
  }).join('');

  // End-of-line labels
  const lastReal = [...weekRows].reverse().find(r => r.accumReal > 0);
  const lastMeta = [...weekRows].reverse().find(r => r.accumMeta > 0);
  let labelReal = '', labelMeta = '';
  if (lastReal) {
    const i = weekRows.indexOf(lastReal), x = xP(i), y = yS(lastReal.accumReal);
    const v = lastReal.accumReal >= 1000 ? `R$${(lastReal.accumReal/1000).toFixed(0)}k` : `R$${Math.round(lastReal.accumReal)}`;
    labelReal = `<text x="${(x+8).toFixed(1)}" y="${(y+4).toFixed(1)}" font-size="10" font-weight="700" fill="#D37B5A">${v}</text>`;
  }
  if (lastMeta) {
    const i = weekRows.indexOf(lastMeta), x = xP(i), y = yS(lastMeta.accumMeta);
    const v = lastMeta.accumMeta >= 1000 ? `R$${(lastMeta.accumMeta/1000).toFixed(0)}k` : `R$${Math.round(lastMeta.accumMeta)}`;
    labelMeta = `<text x="${(x+8).toFixed(1)}" y="${(y+4).toFixed(1)}" font-size="10" fill="#8A847B">${v}</text>`;
  }

  // X labels
  const xLabels = weekRows.map((r, i) =>
    `<text x="${xP(i).toFixed(1)}" y="${H-8}" font-size="11" fill="#4A453F" text-anchor="middle" font-weight="700">sem ${r.week}</text>`
  ).join('');

  // Legend
  const lx = PAD.left, ly = 16;
  const legend = `
    <line x1="${lx}" y1="${ly}" x2="${lx+18}" y2="${ly}" stroke="#D37B5A" stroke-width="2.5"/>
    <text x="${lx+22}" y="${ly+4}" font-size="11" fill="#4A453F">acum. real</text>
    <line x1="${lx+100}" y1="${ly}" x2="${lx+118}" y2="${ly}" stroke="#8A847B" stroke-width="1.5" stroke-dasharray="4,3"/>
    <text x="${lx+122}" y="${ly+4}" font-size="11" fill="#8A847B">acum. meta</text>
    <rect x="${lx+216}" y="${ly-6}" width="14" height="10" fill="#D37B5A" opacity="0.3"/>
    <text x="${lx+234}" y="${ly+4}" font-size="11" fill="#4A453F">resultado sem.</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="height:${H}px;">
    ${grid}${bars}
    ${metaPath ? `<path d="${metaPath.trim()}" stroke="#8A847B" stroke-width="1.5" stroke-dasharray="5,3" fill="none"/>` : ''}
    ${realPath ? `<path d="${realPath.trim()}" stroke="#D37B5A" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${dots}${labelReal}${labelMeta}${xLabels}${legend}
  </svg>`;
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
function switchTab(tab) {
  document.querySelectorAll('.view-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  const isRadar = tab === 'radar';
  document.getElementById('timeFilterBar').classList.toggle('visible', isRadar);
  document.getElementById('kpiRow').classList.toggle('visible', isRadar);
  document.getElementById('blocoMain').style.display  = isRadar ? 'block' : 'none';
  document.getElementById('viewMetas').style.display  = isRadar ? 'none'  : 'block';
  if (!isRadar) updateMetasView();
}

// ─── METAS INIT ──────────────────────────────────────────
(function initMetas() {
  document.getElementById('metasPrevMonth').addEventListener('click', () => {
    metasMonth--;
    if (metasMonth < 1) { metasMonth = 12; metasYear--; }
    updateMetasView();
  });
  document.getElementById('metasNextMonth').addEventListener('click', () => {
    metasMonth++;
    if (metasMonth > 12) { metasMonth = 1; metasYear++; }
    updateMetasView();
  });
  document.querySelectorAll('.view-tab').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );
})();

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
