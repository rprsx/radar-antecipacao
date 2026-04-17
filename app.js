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
  document.getElementById('mainTabs').classList.add('visible');
  const activeTab     = document.querySelector('.main-tab.active');
  const activeBlockId = activeTab ? activeTab.dataset.block : 'blocoDaily';
  ALL_BLOCK_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === activeBlockId) ? 'block' : 'none';
  });

  updateBlocoDaily();
  updateBlocoSemanal();
  updateBlocoMensal();
  updateBlocoDistrib();
  updateBlocoVelocidade();
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

// ─── TAB SELECTOR (transforma <select> em tab bar minimalista) ───
// ─── SWITCH BLOCK (navegação entre abas) ──────────────
const ALL_BLOCK_IDS = ['blocoDaily', 'blocoSemanal', 'blocoMensal', 'blocoDistrib', 'blocoVelocidade'];

function switchToBlock(blockId) {
  ALL_BLOCK_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === blockId) ? 'block' : 'none';
  });
  
  document.querySelectorAll('.main-tab').forEach(t => {
    const isActive = t.dataset.block === blockId;
    t.classList.toggle('active', isActive);
    if (isActive) {
      t.setAttribute('aria-selected', 'true');
    } else {
      t.removeAttribute('aria-selected');
    }
  });
  
  // Scroll suave pro topo do conteúdo (se necessário)
  try {
    document.getElementById(blockId).scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {}
}

// ─── TAB SELECTOR (transforma <select> em tab bar minimalista) ───
function makeTabSelector(selectEl, options = {}) {
  if (!selectEl || selectEl.dataset.tabified === 'true') {
    if (selectEl && selectEl.dataset.tabified === 'true') {
      const container = selectEl.nextElementSibling;
      if (container && container.classList.contains('filter-tabs')) {
        container.querySelectorAll('.filter-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.value === selectEl.value);
        });
      }
    }
    return;
  }
  
  const container = document.createElement('div');
  container.className = 'filter-tabs';
  container.setAttribute('role', 'tablist');
  
  const labelMap = options.labels || {};
  
  Array.from(selectEl.options).forEach(opt => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'filter-tab';
    tab.textContent = labelMap[opt.value] || opt.textContent;
    tab.dataset.value = opt.value;
    tab.setAttribute('role', 'tab');
    if (opt.value === selectEl.value) {
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
    }
    tab.addEventListener('click', () => {
      if (selectEl.value === opt.value) return;
      selectEl.value = opt.value;
      container.querySelectorAll('.filter-tab').forEach(t => {
        t.classList.remove('active');
        t.removeAttribute('aria-selected');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
    container.appendChild(tab);
  });
  
  selectEl.style.display = 'none';
  selectEl.parentNode.insertBefore(container, selectEl.nextSibling);
  selectEl.dataset.tabified = 'true';
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
    return `<text x="${PAD.left - 8}" y="${(y + 3).toFixed(1)}" font-size="10" fill="#8A847B" text-anchor="end" font-family="Monaco, monospace">${valStr}</text>`;
  }).join('');
  
  // Linha de média (pontilhada)
  const avgY = yScale(avg);
  const avgLine = `<line x1="${PAD.left}" y1="${avgY.toFixed(1)}" x2="${W-PAD.right}" y2="${avgY.toFixed(1)}" stroke="#8A847B" stroke-dasharray="2,3" stroke-width="1" />`;
  const avgLabel = `<text x="${W - PAD.right + 6}" y="${(avgY + 3).toFixed(1)}" font-size="9" fill="#8A847B" text-anchor="start" font-weight="700" letter-spacing="1">MÉDIA</text>`;
  
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
    // Destaque por tamanho: current maior, demais iguais
    const r = p.isCurrent ? 6 : 4.5;
    const strokeW = p.isCurrent ? 2.5 : 2;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#D37B5A" stroke="white" stroke-width="${strokeW}" />`;
  }).join('');
  
  // Valor em destaque do período atual
  let currentValueLabel = '';
  const currentIdx = periods.findIndex(p => p.isCurrent);
  if (currentIdx >= 0 && metrics[currentIdx].total > 0) {
    const x = xPos(currentIdx);
    const y = yScale(metrics[currentIdx].total);
    const val = metrics[currentIdx].total;
    const valStr = val >= 1000 ? `R$ ${(val/1000).toFixed(1)}k` : `R$ ${Math.round(val)}`;
    currentValueLabel = `<text x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" font-size="11" font-weight="700" fill="#1A1816" text-anchor="middle">${valStr}</text>`;
  }
  
  // Labels do eixo X
  const xLabels = periods.map((p, i) => {
    return `<text x="${xPos(i).toFixed(1)}" y="${H - 14}" font-size="10" fill="#4A453F" text-anchor="middle" font-weight="700">${p.label}</text>`;
  }).join('');
  
  // Sub-labels (se existir)
  const subLabels = periods.map((p, i) => {
    if (!p.sublabel) return '';
    return `<text x="${xPos(i).toFixed(1)}" y="${H - 2}" font-size="9" fill="#8A847B" text-anchor="middle">${p.sublabel}</text>`;
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

// ─── BLOCO 1: DIÁRIO ───────────────────────────────────
function updateBlocoDaily() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  // Status Contrato considerados "com visão" (trabalhando):
  // assinado, enviado, enviar, gerar, em revisão
  const statusContTrabalhando = ['assinado', 'enviado', 'enviar', 'gerar', 'emrevisao', 'revisao'];
  
  const isEmAberto = d => {
    const sf = norm(d.status_fechamento);
    return sf === 'emaberto' || sf === 'aberto';
  };
  
  const isContratoTrabalhando = d => {
    const sc = norm(d.status_contrato);
    if (!sc) return false;
    return statusContTrabalhando.some(v => sc.includes(v));
  };

  // TRABALHANDO: em aberto + contrato em um dos 5 status definidos
  const trabalhandoDeals = allDealsData.filter(d => 
    isEmAberto(d) && isContratoTrabalhando(d)
  );
  const totalTrabalhando = trabalhandoDeals.reduce((s, d) => s + d.desagio_total, 0);
  const clientesTrabalhando = new Set(trabalhandoDeals.map(d => d.cliente)).size;
  const ticketTrabalhando = clientesTrabalhando > 0 ? totalTrabalhando / clientesTrabalhando : 0;

  // PAGO HOJE: status = pago + data_fechamento = hoje
  const pagoHojeDeals = allDealsData.filter(d => {
    const isPago = norm(d.status_fechamento).includes('pago');
    return isPago && d.data_fechamento && sameDay(d.data_fechamento, today);
  });
  const totalPagoHoje = pagoHojeDeals.reduce((s, d) => s + d.desagio_total, 0);
  const pagoHojeCasos = new Set(pagoHojeDeals.map(d => d.cliente)).size;

  // SEM VISÃO: em aberto + contrato NÃO está nos 5 status (vazio OU outros valores)
  const semVisaoDeals = allDealsData.filter(d => 
    isEmAberto(d) && !isContratoTrabalhando(d)
  );
  const totalSemVisao = semVisaoDeals.reduce((s, d) => s + d.desagio_total, 0);
  const semVisaoCasos = new Set(semVisaoDeals.map(d => d.cliente)).size;

  // Total em aberto (trabalhando + aguardando resposta) — pra sanity check
  console.log('=== DEBUG BLOCO 1 ===');
  console.log('Trabalhando:', trabalhandoDeals.length, 'deals · R$', fmtBRL(totalTrabalhando));
  console.log('Aguardando resposta:', semVisaoDeals.length, 'deals · R$', fmtBRL(totalSemVisao));
  console.log('Soma total em aberto:', fmtBRL(totalTrabalhando + totalSemVisao));
  console.log('Pago hoje:', pagoHojeDeals.length, 'deals · R$', fmtBRL(totalPagoHoje));

  document.getElementById('resultDiario').textContent = fmtBRL(totalTrabalhando);
  document.getElementById('countDiario').textContent = clientesTrabalhando;
  document.getElementById('ticketDiario').textContent = 'R$ ' + fmtInt(ticketTrabalhando);
  document.getElementById('pagoHoje').textContent = fmtBRL(totalPagoHoje);
  document.getElementById('pagoHojeCount').textContent = pagoHojeCasos;
  document.getElementById('projecaoDia').textContent = fmtBRL(totalTrabalhando + totalPagoHoje);
  document.getElementById('semDataDesagio').textContent = fmtBRL(totalSemVisao);
  document.getElementById('semDataCount').textContent = semVisaoCasos;

  document.getElementById('filtersDiario').textContent = 
    `Trabalhando: Em aberto + contrato Assinado/Enviado/Enviar/Gerar/Em revisão • Aguardando resposta: Em aberto + demais valores de contrato`;

  // ─── HISTÓRICO: últimos 5 dias corridos anteriores (sem hoje) ───
  // Calculo em ordem cronológica (antiga → recente) pra tendência ficar correta,
  // mas exibo com o dia mais recente no topo (orderRecentFirst = true)
  const diasSemanaAbbr = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const mesesAbbr = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const periods = [];
  
  for (let i = 5; i >= 1; i--) {
    const refDate = new Date(today);
    refDate.setDate(refDate.getDate() - i);
    refDate.setHours(0, 0, 0, 0);
    
    const dayDeals = allDealsData.filter(d => {
      const isPago = norm(d.status_fechamento).includes('pago');
      return isPago && d.data_fechamento && sameDay(d.data_fechamento, refDate);
    });
    
    const label = `${String(refDate.getDate()).padStart(2,'0')}/${mesesAbbr[refDate.getMonth()]}`;
    const sublabel = diasSemanaAbbr[refDate.getDay()];
    periods.push({ label, sublabel, deals: dayDeals, isCurrent: false });
  }
  
  document.getElementById('historyDaily').innerHTML = renderHistoryTable(periods, true);
  document.getElementById('chartDaily').innerHTML = renderLineChart(periods);

  // ─── COMPARATIVOS ───
  const mediaHistorica = historyAverage(periods);
  const compEl = document.getElementById('compDiario');
  let compHtml = '';
  if (mediaHistorica > 0 && totalPagoHoje > 0) {
    const t = calcTrend(totalPagoHoje, mediaHistorica);
    compHtml += `<span class="comp-badge ${t.cls.replace('trend-', '')}">Pago hoje ${t.icon} ${t.text} vs média 5 dias</span>`;
  }
  if (totalSemVisao > 0) {
    compHtml += `<span class="comp-badge flat">${semVisaoCasos} aguardando resposta</span>`;
  }
  compEl.innerHTML = compHtml;

  updateProgress('diaria', totalTrabalhando + totalPagoHoje);
}

// ─── BLOCO 2: SEMANAL ──────────────────────────────────
function updateBlocoSemanal() {
  const selectedYear = parseInt(document.getElementById('anoSemanalSelector').value);
  const selectedMonth = parseInt(document.getElementById('mesSemanalSelector').value);
  const selectedWeek = parseInt(document.getElementById('semanaSelector').value);
  const isAllMonths = selectedMonth === 0;

  console.log('=== DEBUG BLOCO 2 ===');
  console.log('Filtros semanal:', {selectedYear, selectedMonth, selectedWeek, isAllMonths});
  
  const semanalDeals = allDealsData.filter(d => {
    const matchAno = d.ano === selectedYear;
    const matchMes = isAllMonths ? true : d.mes === selectedMonth;
    const matchSemana = d.semana_fechamento === selectedWeek;
    const isPago = norm(d.status_fechamento).includes('pago');
    
    return matchAno && matchMes && matchSemana && isPago;
  });

  console.log('Deals semanal encontrados:', semanalDeals.length);

  const m = calcMetrics(semanalDeals);
  const yieldOperacaoMes = m.parcelasMedio > 0 ? m.yieldTotal / m.parcelasMedio : 0;

  document.getElementById('resultSemanal').textContent = fmtBRL(m.total);
  document.getElementById('yieldSemanalTotal').textContent = fmtPct(m.yieldTotal);
  document.getElementById('casosSemanal').textContent = m.clientesUnicos;
  document.getElementById('parcelasSemanal').textContent = fmtDec(m.parcelasMedio, 3);
  document.getElementById('yieldSemanalMes').textContent = fmtPct(yieldOperacaoMes);

  // ─── HISTÓRICO: últimas 5 semanas (selecionada + 4 anteriores), ordem antiga → recente ───
  const weekChain = [{ year: selectedYear, week: selectedWeek }];
  for (let i = 0; i < 4; i++) {
    const last = weekChain[weekChain.length - 1];
    weekChain.push(prevIsoWeek(last.year, last.week));
  }
  // Reverter pra ordem antiga → recente
  weekChain.reverse();
  
  const periods = weekChain.map(wk => {
    const deals = allDealsData.filter(d => {
      const isPago = norm(d.status_fechamento).includes('pago');
      return isPago && d.ano === wk.year && d.semana_fechamento === wk.week;
    });
    const isCurrent = wk.year === selectedYear && wk.week === selectedWeek;
    return {
      label: `Semana ${wk.week}`,
      sublabel: String(wk.year),
      deals,
      isCurrent
    };
  });
  
  document.getElementById('historyWeekly').innerHTML = renderHistoryTable(periods, true);
  document.getElementById('chartWeekly').innerHTML = renderLineChart(periods);

  // ─── COMPARATIVO: semana atual vs média das 5 semanas + vs semana anterior ───
  const compEl = document.getElementById('compSemanal');
  let compHtml = '';
  const mediaHistorica = historyAverage(periods);
  if (mediaHistorica > 0 && m.total > 0) {
    const t = calcTrend(m.total, mediaHistorica);
    compHtml += `<span class="comp-badge ${t.cls.replace('trend-', '')}">${t.icon} ${t.text} vs média 5 sem</span>`;
  }
  // Semana anterior
  const prevPeriod = periods[periods.length - 2];
  if (prevPeriod) {
    const prevM = calcMetrics(prevPeriod.deals);
    if (prevM.total > 0 && m.total > 0) {
      const t = calcTrend(m.total, prevM.total);
      compHtml += `<span class="comp-badge ${t.cls.replace('trend-', '')}">${t.icon} ${t.text} vs semana ${prevPeriod.label.replace('Semana ', '')}</span>`;
    }
  }
  compEl.innerHTML = compHtml;

  updateProgress('semanal', m.total);
}

// Repopula o seletor de semanas com base no mês/ano escolhido
function refreshWeekSelector() {
  const year = parseInt(document.getElementById('anoSemanalSelector').value);
  const month = parseInt(document.getElementById('mesSemanalSelector').value);
  const weekSel = document.getElementById('semanaSelector');
  const currentValue = parseInt(weekSel.value) || 0;
  
  const weeks = getWeeksOfMonth(year, month);
  weekSel.innerHTML = '';
  weeks.forEach(wk => {
    const opt = document.createElement('option');
    opt.value = wk.week;
    opt.dataset.year = wk.year;
    opt.textContent = `Semana ${wk.week}` + (wk.year !== year ? ` · ${wk.year}` : '');
    weekSel.appendChild(opt);
  });
  
  // Tentar manter a seleção anterior se ainda válida; senão, selecionar a primeira
  const stillValid = weeks.some(wk => wk.week === currentValue);
  if (stillValid) {
    weekSel.value = currentValue;
  } else {
    // Se o mês/ano é o atual, tenta selecionar a semana atual
    const now = new Date();
    const nowWeek = getWeekNumber(now);
    const matchCurrent = weeks.find(wk => wk.week === nowWeek && wk.year === now.getFullYear());
    if (matchCurrent) {
      weekSel.value = matchCurrent.week;
    } else {
      weekSel.value = weeks[0] ? weeks[0].week : 1;
    }
  }
}

// ─── BLOCO 3: MENSAL ───────────────────────────────────
function updateBlocoMensal() {
  const selectedMonth = parseInt(document.getElementById('mesSelector').value);
  const selectedYear = parseInt(document.getElementById('anoMensalSelector').value);
  const isYearly = selectedMonth === 0;

  console.log('=== DEBUG BLOCO 3 ===');
  console.log('Filtros mensal:', {selectedYear, selectedMonth, isYearly});

  const mensalDeals = allDealsData.filter(d => {
    const matchAno = d.ano === selectedYear;
    const matchMes = isYearly ? true : d.mes === selectedMonth;
    const isPago = norm(d.status_fechamento).includes('pago');
    
    return matchAno && matchMes && isPago;
  });

  console.log('Deals encontrados:', mensalDeals.length);
  
  const m = calcMetrics(mensalDeals);
  const yieldOperacaoMes = m.parcelasMedio > 0 ? m.yieldTotal / m.parcelasMedio : 0;

  // Atualizar label do painel principal conforme seleção
  const mesesNomesCurto = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const panelLabel = document.querySelector('#blocoMensal .result-panel .result-label');
  if (panelLabel) {
    panelLabel.textContent = isYearly 
      ? `Deságio do ano · ${selectedYear}` 
      : `Deságio do mês · ${mesesNomesCurto[selectedMonth]}/${selectedYear}`;
  }

  document.getElementById('resultMensal').textContent = fmtBRL(m.total);
  document.getElementById('yieldMensalTotal').textContent = fmtPct(m.yieldTotal);
  document.getElementById('casosMensal').textContent = m.clientesUnicos;
  document.getElementById('parcelasMensal').textContent = fmtDec(m.parcelasMedio, 3);
  document.getElementById('yieldMensalMes').textContent = fmtPct(yieldOperacaoMes);

  // ─── HISTÓRICO ───
  // Se visão anual: mostra TODOS os meses do ano (1-12)
  // Se mensal: últimos 3 meses anteriores ao selecionado
  const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const periods = [];
  
  if (isYearly) {
    // Todos os 12 meses do ano, cronológicos
    for (let mm = 1; mm <= 12; mm++) {
      const monthDeals = allDealsData.filter(d => {
        const isPago = norm(d.status_fechamento).includes('pago');
        return isPago && d.ano === selectedYear && d.mes === mm;
      });
      periods.push({
        label: mesesNomes[mm - 1],
        sublabel: String(selectedYear),
        deals: monthDeals,
        isCurrent: false
      });
    }
    // Atualizar header do histórico
    const histHeader = document.querySelector('#blocoMensal .history-header');
    if (histHeader) histHeader.textContent = `Todos os meses de ${selectedYear}`;
  } else {
    for (let i = 3; i >= 1; i--) {
      let mm = selectedMonth - i;
      let yy = selectedYear;
      while (mm <= 0) { mm += 12; yy -= 1; }
      
      const monthDeals = allDealsData.filter(d => {
        const isPago = norm(d.status_fechamento).includes('pago');
        return isPago && d.ano === yy && d.mes === mm;
      });
      
      periods.push({
        label: mesesNomes[mm - 1],
        sublabel: String(yy),
        deals: monthDeals,
        isCurrent: false
      });
    }
    const histHeader = document.querySelector('#blocoMensal .history-header');
    if (histHeader) histHeader.textContent = 'Últimos 3 meses';
  }
  
  document.getElementById('historyMonthly').innerHTML = renderHistoryTable(periods, true);
  document.getElementById('chartMonthly').innerHTML = renderLineChart(periods);

  // ─── COMPARATIVO ───
  const compEl = document.getElementById('compMensal');
  let compHtml = '';
  if (!isYearly) {
    const mediaHistorica = historyAverage(periods);
    if (mediaHistorica > 0 && m.total > 0) {
      const t = calcTrend(m.total, mediaHistorica);
      compHtml += `<span class="comp-badge ${t.cls.replace('trend-', '')}">${t.icon} ${t.text} vs média 3 meses</span>`;
    }
    const prevPeriod = periods[periods.length - 1];
    if (prevPeriod) {
      const prevM = calcMetrics(prevPeriod.deals);
      if (prevM.total > 0 && m.total > 0) {
        const t = calcTrend(m.total, prevM.total);
        compHtml += `<span class="comp-badge ${t.cls.replace('trend-', '')}">${t.icon} ${t.text} vs ${prevPeriod.label.toLowerCase()}</span>`;
      }
    }
  }
  compEl.innerHTML = compHtml;

  updateProgress('mensal', m.total);
}

// ─── BLOCO 4: DISTRIBUIÇÃO DE DESÁGIOS ─────────────────
function updateBlocoDistrib() {
  const selectedMonth = parseInt(document.getElementById('mesDistribSelector').value);
  const selectedYear = parseInt(document.getElementById('anoDistribSelector').value);
  
  // Filtrar deals pagos (todos ou do mês/ano selecionado)
  let deals = allDealsData.filter(d => norm(d.status_fechamento).includes('pago'));
  if (selectedMonth > 0) {
    deals = deals.filter(d => d.ano === selectedYear && d.mes === selectedMonth);
  } else {
    deals = deals.filter(d => d.ano === selectedYear);
  }
  
  // Faixas de yield total (em %)
  const bins = [
    { label: '< 5%', min: 0, max: 5 },
    { label: '5% – 10%', min: 5, max: 10 },
    { label: '10% – 15%', min: 10, max: 15 },
    { label: '15% – 20%', min: 15, max: 20 },
    { label: '20% – 25%', min: 20, max: 25 },
    { label: '≥ 25%', min: 25, max: Infinity },
  ];
  
  // Agrupar deals por faixa
  bins.forEach(b => { b.deals = []; });
  deals.forEach(d => {
    const y = d.yield_operacao_total || 0;
    const bin = bins.find(b => y >= b.min && y < b.max);
    if (bin) bin.deals.push(d);
  });
  
  const totalCount = deals.length;
  const totalValue = deals.reduce((s, d) => s + d.desagio_total, 0);
  const maxBinValue = Math.max(...bins.map(b => b.deals.reduce((s, d) => s + d.desagio_total, 0)));
  
  const container = document.getElementById('distribContainer');
  if (totalCount === 0) {
    container.innerHTML = '<div class="distrib-empty">Sem operações pagas no período selecionado</div>';
    return;
  }
  
  // Renderizar cada faixa
  const rows = bins.map(b => {
    const count = b.deals.length;
    const sum = b.deals.reduce((s, d) => s + d.desagio_total, 0);
    const pctCount = totalCount > 0 ? (count / totalCount) * 100 : 0;
    const pctValue = totalValue > 0 ? (sum / totalValue) * 100 : 0;
    const barW = maxBinValue > 0 ? (sum / maxBinValue) * 100 : 0;
    
    const emptyClass = count === 0 ? ' muted' : '';
    const labelPosition = barW > 20 ? '' : ' outside';
    const barLabel = count > 0 ? `<span class="distrib-bar-label${labelPosition}">${count} ${count === 1 ? 'caso' : 'casos'}</span>` : '';
    
    return `<div class="distrib-row">
      <div class="distrib-label">${b.label}</div>
      <div class="distrib-bar-wrap">
        <div class="distrib-bar${emptyClass}" style="width:${barW}%;">${barLabel}</div>
      </div>
      <div class="distrib-stats">
        <span>R$ ${fmtBRL(sum)}</span>
        <span class="count">${fmtDec(pctValue, 1)}%</span>
      </div>
    </div>`;
  }).join('');
  
  container.innerHTML = rows + `<div class="distrib-row total">
    <div class="distrib-label">Total</div>
    <div class="distrib-bar-wrap" style="background:transparent;"></div>
    <div class="distrib-stats">
      <span>R$ ${fmtBRL(totalValue)}</span>
      <span class="count">${totalCount} casos</span>
    </div>
  </div>`;
}

// ─── BLOCO 5: VELOCIDADE DE FECHAMENTO ─────────────────
function updateBlocoVelocidade() {
  const selectedMonth = parseInt(document.getElementById('mesVelocSelector').value);
  const selectedYear = parseInt(document.getElementById('anoVelocSelector').value);
  
  // Verificar se temos data_abertura nos dados
  const temDataAbertura = allDealsData.some(d => d.data_abertura);
  if (!temDataAbertura) {
    document.getElementById('velocidadeMissing').style.display = 'block';
    document.getElementById('velocidadeContent').style.display = 'none';
    return;
  }
  document.getElementById('velocidadeMissing').style.display = 'none';
  document.getElementById('velocidadeContent').style.display = 'block';
  
  // Filtrar deals pagos com ambas as datas
  let deals = allDealsData.filter(d => 
    norm(d.status_fechamento).includes('pago') &&
    d.data_abertura && d.data_fechamento
  );
  if (selectedMonth > 0) {
    deals = deals.filter(d => d.ano === selectedYear && d.mes === selectedMonth);
  } else {
    deals = deals.filter(d => d.ano === selectedYear);
  }
  
  // Calcular dias entre abertura e fechamento pra cada deal
  const durations = deals.map(d => {
    const diffMs = d.data_fechamento - d.data_abertura;
    return Math.max(0, Math.round(diffMs / 86400000));
  }).filter(v => v >= 0);
  
  if (durations.length === 0) {
    document.getElementById('velocMediaDias').textContent = '—';
    document.getElementById('velocMedianaDias').textContent = '—';
    document.getElementById('velocNCasos').textContent = '0';
    document.getElementById('velocContainer').innerHTML = '<div class="distrib-empty">Sem operações no período selecionado</div>';
    return;
  }
  
  // Média e mediana
  const media = durations.reduce((s, v) => s + v, 0) / durations.length;
  const sorted = [...durations].sort((a, b) => a - b);
  const mediana = sorted.length % 2 === 0
    ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2
    : sorted[Math.floor(sorted.length/2)];
  
  document.getElementById('velocMediaDias').textContent = fmtDec(media, 1);
  document.getElementById('velocMedianaDias').textContent = fmtDec(mediana, 0);
  document.getElementById('velocNCasos').textContent = durations.length;
  
  // Distribuição por faixa de dias
  const bins = [
    { label: '0 – 7 dias', min: 0, max: 7 },
    { label: '8 – 15 dias', min: 8, max: 15 },
    { label: '16 – 30 dias', min: 16, max: 30 },
    { label: '31 – 60 dias', min: 31, max: 60 },
    { label: '61 – 90 dias', min: 61, max: 90 },
    { label: '> 90 dias', min: 91, max: Infinity },
  ];
  
  bins.forEach(b => { b.count = 0; });
  durations.forEach(dur => {
    const bin = bins.find(b => dur >= b.min && dur <= b.max);
    if (bin) bin.count++;
  });
  
  const totalCount = durations.length;
  const maxBinCount = Math.max(...bins.map(b => b.count));
  
  const rows = bins.map(b => {
    const pct = totalCount > 0 ? (b.count / totalCount) * 100 : 0;
    const barW = maxBinCount > 0 ? (b.count / maxBinCount) * 100 : 0;
    const emptyClass = b.count === 0 ? ' muted' : '';
    const labelPosition = barW > 20 ? '' : ' outside';
    const barLabel = b.count > 0 ? `<span class="distrib-bar-label${labelPosition}">${b.count} ${b.count === 1 ? 'caso' : 'casos'}</span>` : '';
    
    return `<div class="distrib-row">
      <div class="distrib-label">${b.label}</div>
      <div class="distrib-bar-wrap">
        <div class="distrib-bar${emptyClass}" style="width:${barW}%;">${barLabel}</div>
      </div>
      <div class="distrib-stats">
        <span class="count">${fmtDec(pct, 1)}%</span>
      </div>
    </div>`;
  }).join('');
  
  document.getElementById('velocContainer').innerHTML = rows;
}

// ─── PROGRESS BARS ─────────────────────────────────────
function updateProgress(tipo, valor) {
  const metaId = tipo === 'diaria' ? 'metaDiaria' : 
                 tipo === 'semanal' ? 'metaSemanal' : 'metaMensal';
  const progressId = `progress${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`;
  const textId = `${progressId}Text`;

  const meta = unmaskMoneyBR(document.getElementById(metaId).value) || 1;
  const percent = Math.min(100, (valor / meta) * 100);

  const fillEl = document.getElementById(progressId);
  fillEl.style.width = percent + '%';
  fillEl.classList.toggle('over', percent >= 100);

  const label = tipo === 'diaria' ? 'diária' : 
                tipo === 'semanal' ? 'semanal' : 'mensal';
  document.getElementById(textId).textContent = 
    `${percent.toFixed(1)}% da meta ${label}`;
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

document.getElementById('syncBarBtn').addEventListener('click', () => loadFromAPI());

['metaDiaria', 'metaSemanal', 'metaMensal'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', e => {
    // Aplica máscara em tempo real e mantém cursor no final
    const masked = maskMoneyBR(e.target.value);
    e.target.value = masked;
    // Recalcula blocos se já tem dados
    if (allDealsData.length) {
      updateBlocoDaily();
      updateBlocoSemanal();
      updateBlocoMensal();
    }
  });
  el.addEventListener('focus', e => {
    // Ao focar, move cursor pro final
    setTimeout(() => {
      const len = e.target.value.length;
      e.target.setSelectionRange(len, len);
    }, 0);
  });
});

// Initialize selectors with current date and dynamic year options
(function initializeSelectors() {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Populate year selectors dynamically
  ['anoSemanalSelector', 'anoMensalSelector', 'anoDistribSelector', 'anoVelocSelector'].forEach(id => {
    const sel = document.getElementById(id);
    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === currentYear) opt.selected = true;
      sel.appendChild(opt);
    }
  });
  
  document.getElementById('mesSelector').value = now.getMonth() + 1;
  document.getElementById('mesSemanalSelector').value = now.getMonth() + 1;
  document.getElementById('mesDistribSelector').value = 0; // "Todos os meses" por padrão
  document.getElementById('mesVelocSelector').value = 0;
  
  // Popular seletor de semanas com as semanas do mês selecionado
  refreshWeekSelector();
  
  // Transformar selects de MÊS em tabs horizontais (UX friendly)
  // Ano e Semana ficam como dropdown inline minimalista
  ['mesSelector', 'mesSemanalSelector', 'mesDistribSelector', 'mesVelocSelector']
    .forEach(id => makeTabSelector(document.getElementById(id)));
  
  // Listeners: Bloco 2
  document.getElementById('mesSemanalSelector').addEventListener('change', () => {
    refreshWeekSelector();
    if (allDealsData.length) updateBlocoSemanal();
  });
  document.getElementById('anoSemanalSelector').addEventListener('change', () => {
    refreshWeekSelector();
    if (allDealsData.length) updateBlocoSemanal();
  });
  document.getElementById('semanaSelector').addEventListener('change', () => {
    if (allDealsData.length) updateBlocoSemanal();
  });
  
  // Listeners: Bloco 3
  document.getElementById('mesSelector').addEventListener('change', () => {
    if (allDealsData.length) updateBlocoMensal();
  });
  document.getElementById('anoMensalSelector').addEventListener('change', () => {
    if (allDealsData.length) updateBlocoMensal();
  });
  
  // Listeners: Bloco 4 (distribuição)
  document.getElementById('mesDistribSelector').addEventListener('change', () => {
    if (allDealsData.length) updateBlocoDistrib();
  });
  document.getElementById('anoDistribSelector').addEventListener('change', () => {
    if (allDealsData.length) updateBlocoDistrib();
  });
  
  // Listeners: Bloco 5 (velocidade)
  document.getElementById('mesVelocSelector').addEventListener('change', () => {
    if (allDealsData.length) updateBlocoVelocidade();
  });
  document.getElementById('anoVelocSelector').addEventListener('change', () => {
    if (allDealsData.length) updateBlocoVelocidade();
  });
  
  // Listeners: abas principais (navegação entre blocos)
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchToBlock(tab.dataset.block);
    });
  });
  
  loadFromAPI();
})();
