// ─────────────────────────────────────────────
//  CotizaTrack – App Logic
// ─────────────────────────────────────────────

const ESTADOS = ['Por definir', 'Enviada', 'En seguimiento', 'Adjudicada', 'Perdida'];
const ESTADO_CSS = { 'Por definir': 'por-definir', 'Enviada': 'enviada', 'En seguimiento': 'seguimiento', 'Adjudicada': 'adjudicada', 'Perdida': 'perdida' };
const ESTADOS_ACTIVOS = ['Por definir', 'Enviada', 'En seguimiento'];
const DIAS_ALERTA = 7;   // sin seguimiento hace más de N días → alerta
const DIAS_CRITICO = 14; // → crítico
const CSV_FILE = 'cotizaciones.csv';
const LS_KEY = 'cotizaciones_data';
const PALETTE = ['#6c5ce7', '#0984e3', '#00b894', '#fdcb6e', '#e17055', '#a29bfe', '#74b9ff'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

let data = [];
let sortCol = 'Fecha de envío';
let sortAsc = false;
let contextIdx = -1;
let followUpFilter = false; // filtro especial: solo cotizaciones que requieren seguimiento

// ── DOM refs ──
const $ = (s) => document.querySelector(s);
const tableBody = $('#table-body');
const mobileCards = $('#mobile-cards');
const funnelBar = $('#funnel-bar');
const funnelLabels = $('#funnel-labels');
const statsGrid = $('#stats-grid');
const modalOverlay = $('#modal-overlay');
const contextMenu = $('#context-menu');
const toastContainer = $('#toast-container');

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  render();
  bindEvents();
});

// ── Data: Load ──
async function loadData() {
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    data = JSON.parse(stored);
    return;
  }
  try {
    const res = await fetch(CSV_FILE);
    if (res.ok) {
      const text = await res.text();
      data = parseCSV(text);
      saveData();
    }
  } catch (e) {
    console.log('No CSV found, starting empty.');
  }
}

// ── Data: Save ──
function saveData() {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// ── CSV parser ──
function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
    return obj;
  });
}

// ── CSV generator ──
function toCSV() {
  if (!data.length) return '';
  const headers = ['Fuente', 'Proyecto', 'Tipo', 'Cliente', 'Razón social', 'Fecha de envío', 'Valor', 'Metraje', 'Observación', 'Estado', 'Fecha de último seguimiento'];
  const lines = [headers.join(',')];
  data.forEach(d => {
    lines.push(headers.map(h => (d[h] || '').replace(/,/g, ';')).join(','));
  });
  return lines.join('\n');
}

// ─────────────────────────────────────────────
//  Helpers de fechas / seguimiento
// ─────────────────────────────────────────────
function parseDate(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d) ? null : d;
}

function daysSince(str) {
  const d = parseDate(str);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Días desde el último contacto (seguimiento o, si no hay, envío)
function diasSinContacto(d) {
  return daysSince(d['Fecha de último seguimiento']) ?? daysSince(d['Fecha de envío']);
}

function requiereSeguimiento(d) {
  if (!ESTADOS_ACTIVOS.includes(d.Estado)) return false;
  const dias = diasSinContacto(d);
  return dias === null || dias > DIAS_ALERTA;
}

function formatDate(str) {
  const d = parseDate(str);
  if (!d) return '—';
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = MESES[d.getMonth()];
  const yy = d.getFullYear() !== new Date().getFullYear() ? ` ${String(d.getFullYear()).slice(2)}` : '';
  return `${dia} ${mes}${yy}`;
}

function relTime(dias) {
  if (dias === null) return '';
  if (dias === 0) return 'hoy';
  if (dias < 0) return `en ${-dias}d`;
  return `hace ${dias}d`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function valor(d) { return parseFloat(d.Valor) || 0; }

// ── Render everything ──
function render() {
  renderStats();
  renderAlert();
  renderFunnel();
  renderCharts();
  renderTable();
  renderMobileCards();
  populateFilterOptions();
  updateFilterUI();
}

function renderList() {
  renderTable();
  renderMobileCards();
  updateFilterUI();
}

// ─────────────────────────────────────────────
//  KPIs
// ─────────────────────────────────────────────
function renderStats() {
  const abiertas = data.filter(d => ESTADOS_ACTIVOS.includes(d.Estado));
  const adjudicadas = data.filter(d => d.Estado === 'Adjudicada');
  const perdidas = data.filter(d => d.Estado === 'Perdida');
  const pendientes = data.filter(requiereSeguimiento);

  const valorPipeline = abiertas.reduce((s, d) => s + valor(d), 0);
  const valorAdj = adjudicadas.reduce((s, d) => s + valor(d), 0);
  const decididas = adjudicadas.length + perdidas.length;
  const tasaExito = decididas > 0 ? ((adjudicadas.length / decididas) * 100).toFixed(0) : '—';
  const ticket = adjudicadas.length > 0 ? valorAdj / adjudicadas.length : 0;

  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="label">Pipeline Abierto</div>
      <div class="value accent">$${formatMoney(valorPipeline)}</div>
      <div class="sub">${abiertas.length} cotizaciones activas</div>
    </div>
    <div class="stat-card">
      <div class="label">Adjudicado</div>
      <div class="value win">$${formatMoney(valorAdj)}</div>
      <div class="sub">${adjudicadas.length} proyectos ganados</div>
    </div>
    <div class="stat-card">
      <div class="label">Tasa de Éxito</div>
      <div class="value">${tasaExito}${tasaExito !== '—' ? '%' : ''}</div>
      <div class="sub">${adjudicadas.length} ganadas / ${perdidas.length} perdidas</div>
    </div>
    <div class="stat-card">
      <div class="label">Ticket Promedio</div>
      <div class="value">$${formatMoney(ticket)}</div>
      <div class="sub">por proyecto adjudicado</div>
    </div>
    <div class="stat-card clickable ${pendientes.length ? 'warn' : ''} ${followUpFilter ? 'active' : ''}" data-action="followup" title="Clic para filtrar">
      <div class="label">Requieren Seguimiento</div>
      <div class="value ${pendientes.length ? 'alert' : ''}">${pendientes.length}</div>
      <div class="sub">sin contacto hace +${DIAS_ALERTA} días</div>
    </div>
  `;
}

// ─────────────────────────────────────────────
//  Alerta de seguimientos críticos
// ─────────────────────────────────────────────
function renderAlert() {
  const banner = $('#alert-banner');
  const criticas = data.filter(d => {
    if (!ESTADOS_ACTIVOS.includes(d.Estado)) return false;
    const dias = diasSinContacto(d);
    return dias === null || dias > DIAS_CRITICO;
  });
  if (!criticas.length) { banner.innerHTML = ''; return; }

  const valorRiesgo = criticas.reduce((s, d) => s + valor(d), 0);
  banner.innerHTML = `
    <div class="alert-banner" data-action="followup">
      <span class="alert-icon">⚠</span>
      <span><strong>${criticas.length} cotización${criticas.length > 1 ? 'es' : ''}</strong> sin contacto hace más de ${DIAS_CRITICO} días
      ${valorRiesgo ? `— <strong>$${formatMoney(valorRiesgo)}</strong> en riesgo` : ''}</span>
      <span class="alert-cta">Ver →</span>
    </div>`;
}

// ─────────────────────────────────────────────
//  Funnel (clic = filtrar por estado)
// ─────────────────────────────────────────────
function renderFunnel() {
  const counts = {}, valores = {};
  ESTADOS.forEach(e => { counts[e] = 0; valores[e] = 0; });
  data.forEach(d => {
    if (counts[d.Estado] !== undefined) { counts[d.Estado]++; valores[d.Estado] += valor(d); }
  });
  const total = data.length || 1;
  const estadoActivo = $('#filter-estado').value;

  funnelBar.innerHTML = ESTADOS.map(e => {
    const pct = Math.max((counts[e] / total) * 100, 6);
    const sel = estadoActivo === e ? ' selected' : (estadoActivo ? ' dimmed' : '');
    return `<div class="funnel-segment ${ESTADO_CSS[e]}${sel}" data-estado="${e}" style="width:${pct}%" title="${e}: ${counts[e]} · $${formatMoney(valores[e])}">${counts[e]}</div>`;
  }).join('');

  funnelLabels.innerHTML = ESTADOS.map(e => {
    const pct = Math.max((counts[e] / total) * 100, 6);
    return `<div class="funnel-label" style="width:${pct}%">
      <span class="count">${counts[e]}</span>${e}
      <span class="flabel-valor">${valores[e] ? '$' + formatMoneyShort(valores[e]) : ''}</span>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
//  Charts (insights)
// ─────────────────────────────────────────────
function renderCharts() {
  renderChartMonthly();
  renderChartFuente();
  renderChartTipo();
  renderChartClientes();
}

// Evolución mensual: valor cotizado vs adjudicado por mes de envío
function renderChartMonthly() {
  const el = $('#chart-monthly');
  const meses = {};
  data.forEach(d => {
    const f = parseDate(d['Fecha de envío']);
    if (!f) return;
    const key = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
    if (!meses[key]) meses[key] = { cotizado: 0, adjudicado: 0, n: 0 };
    meses[key].cotizado += valor(d);
    meses[key].n++;
    if (d.Estado === 'Adjudicada') meses[key].adjudicado += valor(d);
  });

  const keys = Object.keys(meses).sort().slice(-8);
  if (!keys.length) { el.innerHTML = '<div class="chart-empty">Sin datos de fechas</div>'; return; }

  const max = Math.max(...keys.map(k => meses[k].cotizado), 1);
  el.innerHTML = `
    <div class="bar-chart">
      ${keys.map(k => {
        const m = meses[k];
        const [y, mo] = k.split('-');
        const label = `${MESES[parseInt(mo) - 1]}${y.slice(2) !== String(new Date().getFullYear()).slice(2) ? ' ' + y.slice(2) : ''}`;
        return `<div class="bar-group" title="${label}: cotizado $${formatMoney(m.cotizado)} · adjudicado $${formatMoney(m.adjudicado)} · ${m.n} cot.">
          <div class="bars">
            <div class="bar bar-cotizado" style="height:${(m.cotizado / max) * 100}%"></div>
            <div class="bar bar-adjudicado" style="height:${(m.adjudicado / max) * 100}%"></div>
          </div>
          <div class="bar-label">${label}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="chart-legend">
      <span><i style="background:var(--accent)"></i>Cotizado</span>
      <span><i style="background:var(--adjudicada)"></i>Adjudicado</span>
    </div>`;
}

// Rendimiento por fuente: volumen, valor y tasa de conversión
function renderChartFuente() {
  const el = $('#chart-fuente');
  const fuentes = {};
  data.forEach(d => {
    const f = d.Fuente || 'Sin fuente';
    if (!fuentes[f]) fuentes[f] = { n: 0, valor: 0, valorGanado: 0, ganadas: 0, perdidas: 0 };
    fuentes[f].n++;
    fuentes[f].valor += valor(d);
    if (d.Estado === 'Adjudicada') { fuentes[f].ganadas++; fuentes[f].valorGanado += valor(d); }
    if (d.Estado === 'Perdida') { fuentes[f].perdidas++; }
  });

  const keys = Object.keys(fuentes).sort((a, b) => fuentes[b].valor - fuentes[a].valor);
  if (!keys.length) { el.innerHTML = '<div class="chart-empty">Sin datos</div>'; return; }
  const max = Math.max(...keys.map(k => fuentes[k].valor), 1);

  el.innerHTML = keys.map(k => {
    const f = fuentes[k];
    const decididas = f.ganadas + f.perdidas;
    const conv = decididas > 0 ? Math.round((f.ganadas / decididas) * 100) : null;
    const convClass = conv === null ? '' : conv >= 60 ? 'good' : conv >= 30 ? 'mid' : 'bad';
    return `<div class="hbar-row" title="${esc(k)}: ${f.n} cotizaciones · $${formatMoney(f.valor)} · ${f.ganadas} ganadas, ${f.perdidas} perdidas">
      <div class="hbar-head">
        <span class="hbar-name">${esc(k)}</span>
        <span class="hbar-meta">${f.n} cot. · $${formatMoneyShort(f.valor)}
          ${conv !== null ? `<span class="conv-badge ${convClass}">${conv}% conv</span>` : '<span class="conv-badge">sin cerrar</span>'}
        </span>
      </div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(f.valor / max) * 100}%">
        <div class="hbar-fill-won" style="width:${f.valor ? (f.valorGanado / f.valor) * 100 : 0}%" title="Adjudicado: $${formatMoney(f.valorGanado)}"></div>
      </div></div>
    </div>`;
  }).join('');
}

// Donut por tipo de servicio (por valor cotizado)
function renderChartTipo() {
  const el = $('#chart-tipo');
  const tipos = {};
  data.forEach(d => {
    const t = d.Tipo || 'Sin tipo';
    if (!tipos[t]) tipos[t] = { n: 0, valor: 0 };
    tipos[t].n++;
    tipos[t].valor += valor(d);
  });

  const keys = Object.keys(tipos).sort((a, b) => tipos[b].valor - tipos[a].valor);
  const totalValor = keys.reduce((s, k) => s + tipos[k].valor, 0);
  if (!keys.length || !totalValor) { el.innerHTML = '<div class="chart-empty">Sin datos de valor</div>'; return; }

  let acc = 0;
  const stops = keys.map((k, i) => {
    const from = (acc / totalValor) * 360;
    acc += tipos[k].valor;
    const to = (acc / totalValor) * 360;
    return `${PALETTE[i % PALETTE.length]} ${from}deg ${to}deg`;
  }).join(', ');

  el.innerHTML = `
    <div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(${stops})"><div class="donut-hole">
        <span>$${formatMoneyShort(totalValor)}</span><small>total</small>
      </div></div>
      <div class="donut-legend">
        ${keys.map((k, i) => `<div class="legend-row" title="$${formatMoney(tipos[k].valor)}">
          <i style="background:${PALETTE[i % PALETTE.length]}"></i>
          <span class="legend-name">${esc(k)}</span>
          <span class="legend-val">${Math.round((tipos[k].valor / totalValor) * 100)}% · ${tipos[k].n}</span>
        </div>`).join('')}
      </div>
    </div>`;
}

// Top clientes por valor adjudicado
function renderChartClientes() {
  const el = $('#chart-clientes');
  const clientes = {};
  data.forEach(d => {
    if (d.Estado !== 'Adjudicada') return;
    const c = d['Razón social'] || d.Cliente || 'Sin cliente';
    if (!clientes[c]) clientes[c] = { n: 0, valor: 0 };
    clientes[c].n++;
    clientes[c].valor += valor(d);
  });

  const keys = Object.keys(clientes).sort((a, b) => clientes[b].valor - clientes[a].valor).slice(0, 5);
  if (!keys.length) { el.innerHTML = '<div class="chart-empty">Aún no hay proyectos adjudicados</div>'; return; }
  const max = clientes[keys[0]].valor || 1;

  el.innerHTML = keys.map((k, i) => {
    const c = clientes[k];
    return `<div class="hbar-row">
      <div class="hbar-head">
        <span class="hbar-name">${i + 1}. ${esc(k)}</span>
        <span class="hbar-meta">${c.n} proy. · $${formatMoneyShort(c.valor)}</span>
      </div>
      <div class="hbar-track"><div class="hbar-fill won" style="width:${(c.valor / max) * 100}%"></div></div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
//  Filter logic
// ─────────────────────────────────────────────
function getFiltered() {
  const search = ($('#search-input').value || '').toLowerCase();
  const estado = $('#filter-estado').value;
  const fuente = $('#filter-fuente').value;
  const tipo = $('#filter-tipo').value;

  let filtered = data.filter(d => {
    if (followUpFilter && !requiereSeguimiento(d)) return false;
    if (estado && d.Estado !== estado) return false;
    if (fuente && d.Fuente !== fuente) return false;
    if (tipo && d.Tipo !== tipo) return false;
    if (search) {
      const hay = [d.Proyecto, d.Cliente, d['Razón social']].join(' ').toLowerCase().includes(search);
      if (!hay) return false;
    }
    return true;
  });

  if (sortCol) {
    filtered.sort((a, b) => {
      let va = a[sortCol] || '', vb = b[sortCol] || '';
      if (sortCol === 'Valor' || sortCol === 'Metraje') {
        va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }
  return filtered;
}

function hasActiveFilters() {
  return !!($('#search-input').value || $('#filter-estado').value || $('#filter-fuente').value || $('#filter-tipo').value || followUpFilter);
}

function updateFilterUI() {
  const filtered = getFiltered();
  const valorTotal = filtered.reduce((s, d) => s + valor(d), 0);
  $('#results-count').innerHTML = followUpFilter
    ? `<span class="chip-followup">⚠ Requieren seguimiento <button id="chip-clear">✕</button></span> ${filtered.length} de ${data.length}`
    : `Mostrando <strong>${filtered.length}</strong> de ${data.length} cotizaciones`;
  $('#results-value').textContent = valorTotal ? `$${formatMoney(valorTotal)} en este filtro` : '';
  $('#btn-clear-filters').style.display = hasActiveFilters() ? 'inline-flex' : 'none';

  // indicadores de orden
  document.querySelectorAll('.data-table thead th[data-col]').forEach(th => {
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.textContent = th.dataset.col === sortCol ? (sortAsc ? ' ▲' : ' ▼') : '';
  });

  const chipBtn = $('#chip-clear');
  if (chipBtn) chipBtn.addEventListener('click', () => { followUpFilter = false; renderStats(); renderList(); });
}

// ─────────────────────────────────────────────
//  Table
// ─────────────────────────────────────────────
function seguimientoCell(d) {
  const fecha = d['Fecha de último seguimiento'] || d['Fecha de envío'];
  const dias = diasSinContacto(d);
  const activa = ESTADOS_ACTIVOS.includes(d.Estado);
  let cls = '';
  if (activa) {
    if (dias === null || dias > DIAS_CRITICO) cls = 'seg-critico';
    else if (dias > DIAS_ALERTA) cls = 'seg-alerta';
    else cls = 'seg-ok';
  }
  if (!fecha) return `<span class="seg-badge ${cls}">sin registro</span>`;
  return `${formatDate(fecha)} <span class="seg-badge ${cls}">${relTime(dias)}</span>`;
}

function renderTable() {
  const filtered = getFiltered();
  if (!filtered.length) {
    tableBody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="icon">📋</div><p>No hay cotizaciones que mostrar</p></div></td></tr>`;
    return;
  }
  tableBody.innerHTML = filtered.map(d => {
    const idx = data.indexOf(d);
    const css = ESTADO_CSS[d.Estado] || '';
    const obs = d['Observación'] ? ` title="${esc(d['Observación'])}"` : '';
    return `<tr data-idx="${idx}">
      <td class="cell-proyecto"${obs}><span>${esc(d.Proyecto)}</span>${d['Observación'] ? '<span class="obs-dot" title="Tiene observación">●</span>' : ''}</td>
      <td title="${esc(d.Cliente)}">${esc(d.Cliente) || '—'}</td>
      <td title="${esc(d['Razón social'])}">${esc(d['Razón social']) || '—'}</td>
      <td>${esc(d.Tipo)}</td>
      <td>${esc(d.Fuente)}</td>
      <td>${formatDate(d['Fecha de envío'])}</td>
      <td>${seguimientoCell(d)}</td>
      <td class="num">${valor(d) ? '$' + formatMoney(valor(d)) : '—'}</td>
      <td class="num">${parseFloat(d.Metraje) ? d.Metraje : '—'}</td>
      <td><span class="status-badge ${css}"><span class="dot"></span>${esc(d.Estado)}</span></td>
      <td><button class="btn-icon btn-status" data-idx="${idx}" title="Cambiar estado">⋮</button></td>
    </tr>`;
  }).join('');
}

// ── Mobile Cards ──
function renderMobileCards() {
  const filtered = getFiltered();
  if (!filtered.length) {
    mobileCards.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No hay cotizaciones</p></div>`;
    return;
  }
  mobileCards.innerHTML = filtered.map(d => {
    const idx = data.indexOf(d);
    const css = ESTADO_CSS[d.Estado] || '';
    return `<div class="mobile-card" data-idx="${idx}">
      <div class="mobile-card-header">
        <h4>${esc(d.Proyecto)}</h4>
        <span class="status-badge ${css}"><span class="dot"></span>${esc(d.Estado)}</span>
      </div>
      <div class="mobile-card-body">
        <div>Cliente: <strong>${esc(d.Cliente) || '—'}</strong></div>
        <div>Tipo: <strong>${esc(d.Tipo)}</strong></div>
        <div>Valor: <strong>${valor(d) ? '$' + formatMoney(valor(d)) : '—'}</strong></div>
        <div>Envío: <strong>${formatDate(d['Fecha de envío'])}</strong></div>
        <div class="mc-seg">Seguimiento: ${seguimientoCell(d)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Populate filter dropdowns ──
function populateFilterOptions() {
  const fuentes = [...new Set(data.map(d => d.Fuente).filter(Boolean))].sort();
  const tipos = [...new Set(data.map(d => d.Tipo).filter(Boolean))].sort();

  const selFuente = $('#filter-fuente');
  const selTipo = $('#filter-tipo');
  const curFuente = selFuente.value;
  const curTipo = selTipo.value;

  selFuente.innerHTML = '<option value="">Todas las fuentes</option>' + fuentes.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  selTipo.innerHTML = '<option value="">Todos los tipos</option>' + tipos.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

  selFuente.value = curFuente;
  selTipo.value = curTipo;
}

// ─────────────────────────────────────────────
//  Events
// ─────────────────────────────────────────────
function bindEvents() {
  $('#btn-new').addEventListener('click', () => openModal());
  $('#btn-export').addEventListener('click', exportCSV);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', importCSV);

  // Toggle insights
  $('#btn-insights').addEventListener('click', () => {
    const grid = $('#insights-grid');
    grid.classList.toggle('collapsed');
    $('#btn-insights').classList.toggle('active', !grid.classList.contains('collapsed'));
  });

  // Modal
  $('#modal-close').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  $('#btn-save').addEventListener('click', saveEntry);
  $('#btn-delete').addEventListener('click', deleteEntry);

  // Enter = guardar (excepto en textarea)
  modalOverlay.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); saveEntry(); }
  });

  // Filters
  $('#search-input').addEventListener('input', renderList);
  $('#filter-estado').addEventListener('change', () => { renderFunnel(); renderList(); });
  $('#filter-fuente').addEventListener('change', renderList);
  $('#filter-tipo').addEventListener('change', renderList);
  $('#btn-clear-filters').addEventListener('click', clearFilters);

  // KPI / banner → filtro de seguimiento
  statsGrid.addEventListener('click', e => {
    if (e.target.closest('[data-action="followup"]')) toggleFollowUpFilter();
  });
  $('#alert-banner').addEventListener('click', e => {
    if (e.target.closest('[data-action="followup"]')) { followUpFilter = true; renderStats(); renderList(); scrollToTable(); }
  });

  // Funnel → filtrar por estado
  funnelBar.addEventListener('click', e => {
    const seg = e.target.closest('.funnel-segment');
    if (!seg) return;
    const sel = $('#filter-estado');
    sel.value = sel.value === seg.dataset.estado ? '' : seg.dataset.estado;
    renderFunnel();
    renderList();
  });

  // Sort
  document.querySelectorAll('.data-table thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; }
      renderList();
    });
  });

  // Row click → edit
  tableBody.addEventListener('click', e => {
    const btn = e.target.closest('.btn-status');
    if (btn) { showContextMenu(e, parseInt(btn.dataset.idx)); return; }
    const tr = e.target.closest('tr[data-idx]');
    if (tr) openModal(parseInt(tr.dataset.idx));
  });

  mobileCards.addEventListener('click', e => {
    const card = e.target.closest('.mobile-card');
    if (card) openModal(parseInt(card.dataset.idx));
  });

  // Context menu
  contextMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (contextIdx >= 0 && contextIdx < data.length) {
        data[contextIdx].Estado = btn.dataset.status;
        // al cambiar estado registramos contacto de hoy
        data[contextIdx]['Fecha de último seguimiento'] = new Date().toISOString().slice(0, 10);
        saveData(); render();
        toast(`Estado actualizado a "${btn.dataset.status}"`);
      }
      hideContextMenu();
    });
  });

  document.addEventListener('click', e => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); hideContextMenu(); }
  });
}

function toggleFollowUpFilter() {
  followUpFilter = !followUpFilter;
  renderStats();
  renderList();
  if (followUpFilter) scrollToTable();
}

function clearFilters() {
  followUpFilter = false;
  $('#search-input').value = '';
  $('#filter-estado').value = '';
  $('#filter-fuente').value = '';
  $('#filter-tipo').value = '';
  renderStats();
  renderFunnel();
  renderList();
}

function scrollToTable() {
  $('.filter-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────
//  Modal
// ─────────────────────────────────────────────
function openModal(idx = -1) {
  const isEdit = idx >= 0;
  $('#modal-title').textContent = isEdit ? 'Editar Cotización' : 'Nueva Cotización';
  $('#edit-index').value = idx;
  $('#btn-delete').style.display = isEdit ? 'inline-flex' : 'none';

  if (isEdit) {
    const d = data[idx];
    $('#f-fuente').value = d.Fuente || '';
    $('#f-tipo').value = d.Tipo || '';
    $('#f-proyecto').value = d.Proyecto || '';
    $('#f-cliente').value = d.Cliente || '';
    $('#f-razon').value = d['Razón social'] || '';
    $('#f-fecha').value = d['Fecha de envío'] || '';
    $('#f-seguimiento').value = d['Fecha de último seguimiento'] || '';
    $('#f-estado').value = d.Estado || 'Por definir';
    $('#f-valor').value = d.Valor || '';
    $('#f-metraje').value = d.Metraje || '';
    $('#f-obs').value = d['Observación'] || '';
  } else {
    ['f-proyecto', 'f-cliente', 'f-razon', 'f-valor', 'f-metraje', 'f-obs'].forEach(id => $(`#${id}`).value = '');
    $('#f-fuente').value = 'Referido';
    $('#f-tipo').value = 'Peritaje Estructural';
    $('#f-estado').value = 'Por definir';
    $('#f-fecha').value = new Date().toISOString().slice(0, 10);
    $('#f-seguimiento').value = '';
  }

  modalOverlay.classList.add('active');
  setTimeout(() => $('#f-proyecto').focus(), 100);
}

function closeModal() { modalOverlay.classList.remove('active'); }

// ── Save ──
function saveEntry() {
  const proyecto = $('#f-proyecto').value.trim();
  if (!proyecto) { toast('El nombre del proyecto es obligatorio', true); $('#f-proyecto').focus(); return; }

  const entry = {
    Fuente: $('#f-fuente').value,
    Proyecto: proyecto,
    Tipo: $('#f-tipo').value,
    Cliente: $('#f-cliente').value.trim(),
    'Razón social': $('#f-razon').value.trim(),
    'Fecha de envío': $('#f-fecha').value,
    Valor: $('#f-valor').value,
    Metraje: $('#f-metraje').value,
    'Observación': $('#f-obs').value.trim(),
    Estado: $('#f-estado').value,
    'Fecha de último seguimiento': $('#f-seguimiento').value
  };

  const idx = parseInt($('#edit-index').value);
  if (idx >= 0) {
    data[idx] = entry;
    toast('Cotización actualizada');
  } else {
    data.push(entry);
    toast('Cotización creada');
  }

  saveData();
  render();
  closeModal();
}

// ── Delete ──
function deleteEntry() {
  const idx = parseInt($('#edit-index').value);
  if (idx >= 0 && confirm('¿Eliminar esta cotización?')) {
    data.splice(idx, 1);
    saveData();
    render();
    closeModal();
    toast('Cotización eliminada');
  }
}

// ── Context Menu ──
function showContextMenu(event, idx) {
  event.stopPropagation();
  contextIdx = idx;
  const x = Math.min(event.clientX, window.innerWidth - 200);
  const y = Math.min(event.clientY, window.innerHeight - 250);
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('visible');
}

function hideContextMenu() { contextMenu.classList.remove('visible'); contextIdx = -1; }

// ── Export CSV ──
function exportCSV() {
  const csv = toCSV();
  if (!csv) { toast('No hay datos para exportar', true); return; }
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cotizaciones.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado');
}

// ── Import CSV ──
function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const imported = parseCSV(ev.target.result);
    if (imported.length) {
      data = imported;
      saveData();
      render();
      toast(`${imported.length} cotizaciones importadas`);
    } else {
      toast('No se encontraron datos en el archivo', true);
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// ── Toast ──
function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderLeft = `3px solid ${isError ? 'var(--perdida)' : 'var(--adjudicada)'}`;
  el.innerHTML = `${isError ? '⚠' : '✓'} ${esc(msg)}`;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Format ──
function formatMoney(n) {
  return n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatMoneyShort(n) {
  if (n >= 1e6) return (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}
