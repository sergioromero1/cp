// ─────────────────────────────────────────────
//  CotizaTrack – App Logic
//  Ciclo de vida: cotización → adjudicación → cuentas de cobro → recaudo
// ─────────────────────────────────────────────

const ESTADOS = ['Por definir', 'Enviada', 'En seguimiento', 'Adjudicada', 'Sin respuesta definitiva'];
const ESTADO_CSS = { 'Por definir': 'por-definir', 'Enviada': 'enviada', 'En seguimiento': 'seguimiento', 'Adjudicada': 'adjudicada', 'Sin respuesta definitiva': 'perdida' };
const ESTADOS_ACTIVOS = ['Por definir', 'Enviada', 'En seguimiento'];
const DIAS_ALERTA = 7;        // sin seguimiento hace más de N días → alerta
const DIAS_CRITICO = 14;      // → crítico
const DIAS_COBRO_ALERTA = 15; // cuenta remitida sin pago hace más de N días
const DIAS_POR_DEFINIR = 5;   // 'Por definir' sin resolverse hace más de N días
const CSV_FILE = 'cotizaciones.csv';
const LS_KEY = 'cotizaciones_data';
const PALETTE = ['#6c5ce7', '#0984e3', '#00b894', '#fdcb6e', '#e17055', '#a29bfe', '#74b9ff'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const COBRO_LABEL = {
  'sin-cuentas': 'Sin cuenta',
  'por-remitir': 'Por remitir',
  'en-cobro': 'En cobro',
  'cobrado': 'Cobrado'
};

let data = [];
let sortCol = 'Fecha de envío';
let sortAsc = false;
let contextIdx = -1;
let followUpFilter = false; // filtro especial: solo cotizaciones que requieren seguimiento
let view = 'cotizaciones';  // 'cotizaciones' | 'cobros'
let cobroFilter = '';       // '' | 'sin-cuentas' | 'por-remitir' | 'en-cobro' | 'cobrado'
let modalPagos = [];        // copia de trabajo de los hitos en el modal
let payingPago = null;      // 'idx:pidx' del hito cuyo pago se está confirmando (input de valor recibido)

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
const cobrosView = $('#cobros-view');
const flujoView = $('#flujo-view');

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
    normalizeData();
    return;
  }
  try {
    const res = await fetch(CSV_FILE);
    if (res.ok) {
      const text = await res.text();
      data = parseCSV(text);
      normalizeData();
      saveData();
    }
  } catch (e) {
    console.log('No CSV found, starting empty.');
  }
}

// Garantiza que cada registro tenga su lista de pagos y migra estados antiguos
function normalizeData() {
  data.forEach(d => {
    if (typeof d.Pagos === 'string') d.Pagos = parsePagosStr(d.Pagos);
    if (!Array.isArray(d.Pagos)) d.Pagos = [];
    if (d.Estado === 'Perdida') d.Estado = 'Sin respuesta definitiva';
    if (d.Tipo === 'Reforzamiento') d.Tipo = 'Reforzamiento Estructural';
  });
}

// ── Data: Save ──
function saveData() {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// ─────────────────────────────────────────────
//  CSV (la columna Pagos se serializa: hitos con '|', campos con '~')
// ─────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
    obj.Pagos = parsePagosStr(obj.Pagos || '');
    return obj;
  });
}

function toCSV() {
  if (!data.length) return '';
  const headers = ['Fuente', 'Proyecto', 'Tipo', 'Cliente', 'Razón social', 'Fecha de envío', 'Valor', 'Metraje', 'Observación', 'Estado', 'Fecha de último seguimiento', 'Pagos'];
  const lines = [headers.join(',')];
  data.forEach(d => {
    lines.push(headers.map(h => {
      const v = h === 'Pagos' ? pagosToStr(d.Pagos) : String(d[h] || '');
      return v.replace(/,/g, ';');
    }).join(','));
  });
  return lines.join('\n');
}

function parsePagosStr(str) {
  if (!str) return [];
  return str.split('|').filter(Boolean).map(p => {
    const [concepto = '', valor = '', remitida = '', pagada = '', recibido = ''] = p.split('~');
    return { concepto, valor, remitida, pagada, recibido };
  });
}

function pagosToStr(pagos) {
  if (!Array.isArray(pagos) || !pagos.length) return '';
  return pagos.map(p =>
    [p.concepto, p.valor, p.remitida, p.pagada, p.recibido].map(v => String(v || '').replace(/[|~,]/g, ' ')).join('~')
  ).join('|');
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

function hoy() { return new Date().toISOString().slice(0, 10); }

// Días entre dos fechas (str a → str b). null si falta alguna.
function daysBetween(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

// Días que tardó en pagarse una cuenta desde su remisión
function diasEnPagar(p) {
  if (!p.pagada || !p.remitida) return null;
  return Math.max(daysBetween(p.remitida, p.pagada), 0);
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
function valorPago(p) { return parseFloat(p.valor) || 0; }

// Valor que realmente llegó: si no se indicó, se asume el valor completo de la cuenta
function recibidoPago(p) {
  if (!p.pagada) return 0;
  const r = parseFloat(p.recibido);
  return (p.recibido === '' || p.recibido == null || isNaN(r)) ? valorPago(p) : r;
}

// Diferencia entre lo facturado y lo recibido (retefuente, ICA, etc.)
function retencionPago(p) {
  if (!p.pagada) return 0;
  return Math.max(valorPago(p) - recibidoPago(p), 0);
}

// ─────────────────────────────────────────────
//  Lógica de cobros
// ─────────────────────────────────────────────
// Estado de un hito: 'pendiente' (no remitida) | 'remitida' (esperando pago) | 'pagada'
function pagoEstado(p) {
  if (p.pagada) return 'pagada';
  if (p.remitida) return 'remitida';
  return 'pendiente';
}

// Resumen de cobro de un proyecto
function cobroResumen(d) {
  const pagos = d.Pagos || [];
  const total = valor(d);
  let cobrado = 0, recibido = 0, remitido = 0, porRemitir = 0, nPagados = 0;
  let sumDias = 0, nConTiempo = 0;
  pagos.forEach(p => {
    const v = valorPago(p);
    const e = pagoEstado(p);
    if (e === 'pagada') { cobrado += v; recibido += recibidoPago(p); nPagados++; }
    else if (e === 'remitida') remitido += v;
    else porRemitir += v;
    const dp = diasEnPagar(p);
    if (dp !== null) { sumDias += dp; nConTiempo++; }
  });
  const retenciones = Math.max(cobrado - recibido, 0);
  const diasPromedio = nConTiempo ? Math.round(sumDias / nConTiempo) : null;
  let estado;
  if (!pagos.length) estado = 'sin-cuentas';
  else if (nPagados === pagos.length) estado = 'cobrado';
  else if (remitido > 0) estado = 'en-cobro';
  else estado = 'por-remitir';
  return { pagos, total, cobrado, recibido, retenciones, remitido, porRemitir, nPagados, nHitos: pagos.length, estado, diasPromedio };
}

// ── Render everything ──
function render() {
  renderStats();
  renderAlert();
  renderFunnel();
  renderCharts();
  renderTable();
  renderMobileCards();
  renderCobros();
  renderFlujo();
  populateFilterOptions();
  updateFilterUI();
  updateTabBadge();
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
  const perdidas = data.filter(d => d.Estado === 'Sin respuesta definitiva');
  const pendientes = data.filter(requiereSeguimiento);

  const valorPipeline = abiertas.reduce((s, d) => s + valor(d), 0);
  const valorAdj = adjudicadas.reduce((s, d) => s + valor(d), 0);
  const decididas = adjudicadas.length + perdidas.length;
  const tasaExito = decididas > 0 ? ((adjudicadas.length / decididas) * 100).toFixed(0) : '—';

  let cobrado = 0, remitido = 0, retenciones = 0;
  adjudicadas.forEach(d => {
    const r = cobroResumen(d);
    cobrado += r.cobrado;
    remitido += r.remitido;
    retenciones += r.retenciones;
  });
  const porCobrar = Math.max(valorAdj - cobrado, 0);

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
    <div class="stat-card clickable" data-action="cobros" title="Clic para ver cobros">
      <div class="label">Por Cobrar</div>
      <div class="value ${porCobrar ? 'alert' : ''}">$${formatMoney(porCobrar)}</div>
      <div class="sub">${remitido ? '$' + formatMoneyShort(remitido) + ' remitido en espera' : 'cartera pendiente'}</div>
    </div>
    <div class="stat-card clickable" data-action="cobros" title="Clic para ver cobros">
      <div class="label">Cobrado</div>
      <div class="value win">$${formatMoney(cobrado)}</div>
      <div class="sub">${retenciones
        ? `neto recibido $${formatMoneyShort(cobrado - retenciones)} · ret. $${formatMoneyShort(retenciones)}`
        : (valorAdj ? Math.round((cobrado / valorAdj) * 100) + '% del adjudicado' : 'sin adjudicados')}</div>
    </div>
    <div class="stat-card">
      <div class="label">Tasa de Éxito</div>
      <div class="value">${tasaExito}${tasaExito !== '—' ? '%' : ''}</div>
      <div class="sub">${adjudicadas.length} ganadas / ${perdidas.length} sin respuesta</div>
    </div>
    <div class="stat-card clickable ${pendientes.length ? 'warn' : ''} ${followUpFilter ? 'active' : ''}" data-action="followup" title="Clic para filtrar">
      <div class="label">Req. Seguimiento</div>
      <div class="value ${pendientes.length ? 'alert' : ''}">${pendientes.length}</div>
      <div class="sub">sin contacto hace +${DIAS_ALERTA} días</div>
    </div>
  `;
}

// ─────────────────────────────────────────────
//  Alertas (seguimiento + cobros)
// ─────────────────────────────────────────────
function renderAlert() {
  const banner = $('#alert-banner');
  const banners = [];

  // Cotizaciones activas sin contacto reciente
  const criticas = data.filter(d => {
    if (!ESTADOS_ACTIVOS.includes(d.Estado)) return false;
    const dias = diasSinContacto(d);
    return dias === null || dias > DIAS_CRITICO;
  });
  if (criticas.length) {
    const valorRiesgo = criticas.reduce((s, d) => s + valor(d), 0);
    banners.push(`
      <div class="alert-banner" data-action="followup">
        <span class="alert-icon">⚠</span>
        <span><strong>${criticas.length} cotización${criticas.length > 1 ? 'es' : ''}</strong> sin contacto hace más de ${DIAS_CRITICO} días
        ${valorRiesgo ? `— <strong>$${formatMoney(valorRiesgo)}</strong> en riesgo` : ''}</span>
        <span class="alert-cta">Ver →</span>
      </div>`);
  }

  // 'Por definir' estancadas hace más de N días
  const porDefinir = data.filter(d => {
    if (d.Estado !== 'Por definir') return false;
    const dias = diasSinContacto(d);
    return dias === null || dias > DIAS_POR_DEFINIR;
  });
  if (porDefinir.length) {
    const valorPD = porDefinir.reduce((s, d) => s + valor(d), 0);
    banners.push(`
      <div class="alert-banner pordefinir" data-action="pordefinir">
        <span class="alert-icon">⏳</span>
        <span><strong>${porDefinir.length} cotización${porDefinir.length > 1 ? 'es' : ''} "Por definir"</strong> sin resolverse hace más de ${DIAS_POR_DEFINIR} días
        ${valorPD ? `— <strong>$${formatMoney(valorPD)}</strong> esperando decisión` : ''}</span>
        <span class="alert-cta">Ver →</span>
      </div>`);
  }

  // Cuentas remitidas sin pago hace demasiado
  let cuentasVencidas = 0, valorVencido = 0;
  data.filter(d => d.Estado === 'Adjudicada').forEach(d => {
    (d.Pagos || []).forEach(p => {
      if (pagoEstado(p) === 'remitida' && (daysSince(p.remitida) ?? 0) > DIAS_COBRO_ALERTA) {
        cuentasVencidas++;
        valorVencido += valorPago(p);
      }
    });
  });
  if (cuentasVencidas) {
    banners.push(`
      <div class="alert-banner cobro" data-action="cobros-vencidos">
        <span class="alert-icon">💰</span>
        <span><strong>${cuentasVencidas} cuenta${cuentasVencidas > 1 ? 's' : ''} de cobro</strong> remitida${cuentasVencidas > 1 ? 's' : ''} sin pago hace más de ${DIAS_COBRO_ALERTA} días
        ${valorVencido ? `— <strong>$${formatMoney(valorVencido)}</strong> por recaudar` : ''}</span>
        <span class="alert-cta">Ver →</span>
      </div>`);
  }

  // Adjudicadas sin ninguna cuenta de cobro
  const sinCuenta = data.filter(d => d.Estado === 'Adjudicada' && cobroResumen(d).estado === 'sin-cuentas');
  if (sinCuenta.length) {
    const valorSin = sinCuenta.reduce((s, d) => s + valor(d), 0);
    banners.push(`
      <div class="alert-banner cobro" data-action="cobros-sincuenta">
        <span class="alert-icon">🧾</span>
        <span><strong>${sinCuenta.length} proyecto${sinCuenta.length > 1 ? 's' : ''} adjudicado${sinCuenta.length > 1 ? 's' : ''}</strong> sin cuenta de cobro registrada
        ${valorSin ? `— <strong>$${formatMoney(valorSin)}</strong> sin facturar` : ''}</span>
        <span class="alert-cta">Ver →</span>
      </div>`);
  }

  banner.innerHTML = banners.join('');
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
  renderChartCartera();
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
    if (d.Estado === 'Sin respuesta definitiva') { fuentes[f].perdidas++; }
  });

  const keys = Object.keys(fuentes).sort((a, b) => fuentes[b].valor - fuentes[a].valor);
  if (!keys.length) { el.innerHTML = '<div class="chart-empty">Sin datos</div>'; return; }
  const max = Math.max(...keys.map(k => fuentes[k].valor), 1);

  el.innerHTML = keys.map(k => {
    const f = fuentes[k];
    const decididas = f.ganadas + f.perdidas;
    const conv = decididas > 0 ? Math.round((f.ganadas / decididas) * 100) : null;
    const convClass = conv === null ? '' : conv >= 60 ? 'good' : conv >= 30 ? 'mid' : 'bad';
    return `<div class="hbar-row" title="${esc(k)}: ${f.n} cotizaciones · $${formatMoney(f.valor)} · ${f.ganadas} ganadas, ${f.perdidas} sin respuesta">
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

// Estado de cartera: cobrado / remitido en espera / por facturar (sobre adjudicado)
function renderChartCartera() {
  const el = $('#chart-cartera');
  const adjudicadas = data.filter(d => d.Estado === 'Adjudicada');
  const valorAdj = adjudicadas.reduce((s, d) => s + valor(d), 0);
  if (!valorAdj) { el.innerHTML = '<div class="chart-empty">Aún no hay valor adjudicado</div>'; return; }

  let cobrado = 0, remitido = 0, retenciones = 0;
  adjudicadas.forEach(d => {
    const r = cobroResumen(d);
    cobrado += r.cobrado;
    remitido += r.remitido;
    retenciones += r.retenciones;
  });
  const porFacturar = Math.max(valorAdj - cobrado - remitido, 0);
  const total = cobrado + remitido + porFacturar || 1;

  const segs = [
    { label: 'Cobrado', valor: cobrado, color: 'var(--adjudicada)' },
    { label: 'Remitido en espera', valor: remitido, color: 'var(--enviada)' },
    { label: 'Por facturar', valor: porFacturar, color: 'var(--por-definir)' }
  ];

  el.innerHTML = `
    <div class="stack-bar">
      ${segs.filter(s => s.valor > 0).map(s =>
        `<div class="stack-seg" style="width:${(s.valor / total) * 100}%;background:${s.color}" title="${s.label}: $${formatMoney(s.valor)}"></div>`
      ).join('')}
    </div>
    <div class="stack-legend">
      ${segs.map(s => `<div class="legend-row">
        <i style="background:${s.color}"></i>
        <span class="legend-name">${s.label}</span>
        <span class="legend-val">$${formatMoneyShort(s.valor)} · ${Math.round((s.valor / total) * 100)}%</span>
      </div>`).join('')}
      ${retenciones ? `<div class="cartera-nota">Del cobrado, $${formatMoney(retenciones)} fueron retenciones — neto recibido $${formatMoney(cobrado - retenciones)}</div>` : ''}
    </div>`;
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

function cobroCell(d) {
  if (d.Estado !== 'Adjudicada') return '—';
  const r = cobroResumen(d);
  if (r.estado === 'sin-cuentas') return `<span class="seg-badge seg-alerta">sin cuenta</span>`;
  const pct = r.total ? Math.min(Math.round((r.cobrado / r.total) * 100), 100) : (r.nPagados === r.nHitos ? 100 : 0);
  return `<div class="mini-cobro" title="Cobrado $${formatMoney(r.cobrado)} de $${formatMoney(r.total)} · ${r.nPagados}/${r.nHitos} cuentas pagadas${r.retenciones ? ` · neto recibido $${formatMoney(r.recibido)} (ret. $${formatMoney(r.retenciones)})` : ''}">
    <div class="mini-track"><div class="mini-fill" style="width:${pct}%"></div></div>
    <span class="mini-label">${pct}%</span>
  </div>`;
}

function renderTable() {
  const filtered = getFiltered();
  if (!filtered.length) {
    tableBody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="icon">📋</div><p>No hay cotizaciones que mostrar</p></div></td></tr>`;
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
      <td>${cobroCell(d)}</td>
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
    const cobro = d.Estado === 'Adjudicada' ? `<div class="mc-seg">Cobro: ${cobroCell(d)}</div>` : '';
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
        ${cobro}
      </div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
//  Vista Cobros
// ─────────────────────────────────────────────
function renderCobros() {
  const adjudicadas = data.filter(d => d.Estado === 'Adjudicada');
  if (!adjudicadas.length) {
    cobrosView.innerHTML = `<div class="empty-state"><div class="icon">💰</div><p>Aún no hay proyectos adjudicados.<br>Cuando adjudiques una cotización aparecerá aquí para gestionar sus cuentas de cobro.</p></div>`;
    return;
  }

  // Conteos para los chips de filtro
  const counts = { '': adjudicadas.length, 'sin-cuentas': 0, 'por-remitir': 0, 'en-cobro': 0, 'cobrado': 0 };
  adjudicadas.forEach(d => counts[cobroResumen(d).estado]++);

  const chips = ['', 'sin-cuentas', 'por-remitir', 'en-cobro', 'cobrado'].map(k =>
    `<button class="chip ${cobroFilter === k ? 'active' : ''}" data-cfilter="${k}">${k ? COBRO_LABEL[k] : 'Todos'} <span>${counts[k]}</span></button>`
  ).join('');

  const visibles = adjudicadas.filter(d => !cobroFilter || cobroResumen(d).estado === cobroFilter);

  const cards = visibles.map(d => {
    const idx = data.indexOf(d);
    const r = cobroResumen(d);
    const pct = r.total ? Math.min(Math.round((r.cobrado / r.total) * 100), 100) : (r.nHitos && r.nPagados === r.nHitos ? 100 : 0);

    const hitos = r.pagos.map((p, i) => {
      const e = pagoEstado(p);
      let estadoHtml = '', accion = '';
      if (e === 'pendiente') {
        estadoHtml = `<span class="hito-chip pendiente">Por remitir</span>`;
        accion = `<button class="btn-mini" data-action="remitir" data-idx="${idx}" data-pidx="${i}" title="Marcar como remitida hoy">✉ Remitir</button>`;
      } else if (e === 'remitida') {
        const dias = daysSince(p.remitida);
        const vencida = (dias ?? 0) > DIAS_COBRO_ALERTA;
        estadoHtml = `<span class="hito-chip remitida ${vencida ? 'vencida' : ''}" title="Remitida el ${formatDate(p.remitida)}">Remitida ${relTime(dias)}</span>`;
        if (payingPago === `${idx}:${i}`) {
          accion = `<span class="pay-confirm">
            <input type="number" class="pay-recibido" value="${valorPago(p) || ''}" placeholder="Valor recibido" title="Valor que llegó realmente (después de retenciones)">
            <button class="btn-mini ok" data-action="confirmar-pago" data-idx="${idx}" data-pidx="${i}" title="Confirmar pago con el valor recibido">✓</button>
            <button class="btn-mini" data-action="cancelar-pago" title="Cancelar">✕</button>
          </span>`;
        } else {
          accion = `<button class="btn-mini ok" data-action="pagar" data-idx="${idx}" data-pidx="${i}" title="Registrar pago (podrás indicar el valor recibido)">✓ Pagada</button>`;
        }
      } else {
        const ret = retencionPago(p);
        const dpago = diasEnPagar(p);
        estadoHtml = `<span class="hito-chip pagada" title="Pagada el ${formatDate(p.pagada)} · recibido $${formatMoney(recibidoPago(p))}">✓ Pagada ${formatDate(p.pagada)}</span>`
          + (dpago !== null ? `<span class="hito-chip tiempo ${dpago > DIAS_COBRO_ALERTA ? 'lento' : ''}" title="Remitida ${formatDate(p.remitida)} → pagada ${formatDate(p.pagada)}">⏱ ${dpago === 0 ? 'mismo día' : dpago + 'd en pagar'}</span>` : '')
          + (ret ? `<span class="hito-chip ret" title="Recibido $${formatMoney(recibidoPago(p))} de $${formatMoney(valorPago(p))} facturados">ret. $${formatMoneyShort(ret)}</span>` : '');
      }
      return `<div class="hito-row ${e}">
        <span class="hito-concepto" title="${esc(p.concepto)}">${esc(p.concepto) || 'Cuenta de cobro'}</span>
        <span class="hito-valor">${valorPago(p) ? '$' + formatMoney(valorPago(p)) : '—'}</span>
        ${estadoHtml}
        <span class="hito-actions">${accion}<button class="btn-mini del" data-action="delpago" data-idx="${idx}" data-pidx="${i}" title="Eliminar cuenta">✕</button></span>
      </div>`;
    }).join('');

    const diff = r.total - (r.cobrado + r.remitido + r.porRemitir);

    return `<div class="cobro-card estado-${r.estado}">
      <div class="cobro-head" data-idx="${idx}" title="Clic para editar el proyecto">
        <div class="cobro-head-info">
          <h4>${esc(d.Proyecto)}</h4>
          <span class="cobro-cliente">${esc(d['Razón social'] || d.Cliente) || '—'}</span>
        </div>
        <div class="cobro-head-right">
          <span class="cobro-estado-chip ${r.estado}">${COBRO_LABEL[r.estado]}</span>
          <span class="cobro-valor">$${formatMoney(r.total)}</span>
        </div>
      </div>
      <div class="cobro-progress">
        <div class="cobro-track">
          <div class="cobro-fill" style="width:${pct}%"></div>
          <div class="cobro-fill-remitido" style="width:${r.total ? Math.min(((r.cobrado + r.remitido) / r.total) * 100, 100) : 0}%"></div>
        </div>
        <span class="cobro-pct">${pct}% cobrado · $${formatMoneyShort(r.cobrado)} de $${formatMoneyShort(r.total)}${r.retenciones ? ` · neto recibido $${formatMoneyShort(r.recibido)} <span class="ret-nota">(ret. $${formatMoneyShort(r.retenciones)})</span>` : ''}${r.diasPromedio !== null ? ` · <span class="tiempo-nota">⏱ ${r.nPagados > 1 ? 'prom. ' : ''}${r.diasPromedio === 0 ? 'pago mismo día' : r.diasPromedio + 'd en cobrar'}</span>` : ''}</span>
      </div>
      <div class="cobro-hitos">
        ${hitos || '<div class="hito-empty">Sin cuentas de cobro registradas</div>'}
        ${diff > 0 && r.nHitos ? `<div class="hito-resto">Sin asignar a cuentas: $${formatMoney(diff)}</div>` : ''}
      </div>
      <div class="hito-add">
        <input type="text" class="add-concepto" placeholder="Concepto (ej. Anticipo 50%)">
        <input type="number" class="add-valor" placeholder="Valor $">
        <button class="btn-mini add" data-action="addpago" data-idx="${idx}" title="Agregar cuenta de cobro">＋ Agregar</button>
      </div>
    </div>`;
  }).join('');

  cobrosView.innerHTML = `
    <div class="cobro-filters">${chips}</div>
    <div class="cobros-grid">${cards || '<div class="empty-state"><div class="icon">💰</div><p>Ningún proyecto en este estado</p></div>'}</div>`;
}

function updateTabBadge() {
  const pendientes = data.filter(d => d.Estado === 'Adjudicada' && cobroResumen(d).estado !== 'cobrado').length;
  const badge = $('#tab-cobros-badge');
  badge.textContent = pendientes || '';
  badge.style.display = pendientes ? 'inline-flex' : 'none';
}

// ─────────────────────────────────────────────
//  Vista Flujo de caja (entradas mensuales = cuentas pagadas)
// ─────────────────────────────────────────────
function renderFlujo() {
  // Recolectar todas las cuentas de cobro pagadas con fecha de pago válida
  const pagos = [];
  data.forEach(d => {
    (d.Pagos || []).forEach(p => {
      if (!p.pagada || !parseDate(p.pagada)) return;
      pagos.push({
        proyecto: d.Proyecto,
        cliente: d['Razón social'] || d.Cliente || '',
        concepto: p.concepto,
        fecha: p.pagada,
        facturado: valorPago(p),
        recibido: recibidoPago(p),
        retencion: retencionPago(p)
      });
    });
  });

  if (!pagos.length) {
    flujoView.innerHTML = `<div class="empty-state"><div class="icon">📈</div><p>Aún no hay cuentas de cobro pagadas.<br>Cuando registres pagos en la pestaña Cobros, verás aquí el flujo de caja mensual.</p></div>`;
    return;
  }

  // Agrupar por mes de pago
  const meses = {};
  pagos.forEach(p => {
    const f = parseDate(p.fecha);
    const key = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
    if (!meses[key]) meses[key] = { recibido: 0, facturado: 0, retencion: 0, n: 0, items: [] };
    const m = meses[key];
    m.recibido += p.recibido;
    m.facturado += p.facturado;
    m.retencion += p.retencion;
    m.n++;
    m.items.push(p);
  });

  const keysAsc = Object.keys(meses).sort();
  const totalRecibido = pagos.reduce((s, p) => s + p.recibido, 0);
  const totalRetencion = pagos.reduce((s, p) => s + p.retencion, 0);
  const promedioMensual = totalRecibido / keysAsc.length;
  const mejorKey = keysAsc.reduce((a, b) => meses[b].recibido > meses[a].recibido ? b : a, keysAsc[0]);

  const labelMes = (key, full = false) => {
    const [y, mo] = key.split('-');
    const idx = parseInt(mo) - 1;
    return full ? `${MESES_FULL[idx]} ${y}` : `${MESES[idx]} ${y.slice(2)}`;
  };

  // KPIs del flujo
  const summary = `
    <div class="flujo-kpis">
      <div class="flujo-kpi"><div class="label">Total Recibido</div><div class="value win">$${formatMoney(totalRecibido)}</div><div class="sub">neto en caja · ${pagos.length} pagos</div></div>
      <div class="flujo-kpi"><div class="label">Retenciones</div><div class="value warn-txt">$${formatMoney(totalRetencion)}</div><div class="sub">descontado del facturado</div></div>
      <div class="flujo-kpi"><div class="label">Promedio Mensual</div><div class="value">$${formatMoney(promedioMensual)}</div><div class="sub">en ${keysAsc.length} ${keysAsc.length === 1 ? 'mes' : 'meses'} con ingresos</div></div>
      <div class="flujo-kpi"><div class="label">Mejor Mes</div><div class="value">$${formatMoneyShort(meses[mejorKey].recibido)}</div><div class="sub">${labelMes(mejorKey, true)}</div></div>
    </div>`;

  // Gráfica de barras apiladas (recibido + retención = facturado) — últimos 12 meses
  const chartKeys = keysAsc.slice(-12);
  const maxFact = Math.max(...chartKeys.map(k => meses[k].facturado), 1);
  const chart = `
    <div class="insight-card flujo-chart-card">
      <h3>Entradas mensuales de caja</h3>
      <div class="bar-chart flujo-bar-chart">
        ${chartKeys.map(k => {
          const m = meses[k];
          const hFact = (m.facturado / maxFact) * 100;
          const hRet = m.facturado ? (m.retencion / m.facturado) * hFact : 0;
          const hRec = hFact - hRet;
          return `<div class="bar-group" title="${labelMes(k, true)}: recibido $${formatMoney(m.recibido)}${m.retencion ? ` · retención $${formatMoney(m.retencion)}` : ''} · ${m.n} pago${m.n > 1 ? 's' : ''}">
            <div class="flujo-bar-val">$${formatMoneyShort(m.recibido)}</div>
            <div class="bars flujo-bars">
              <div class="flujo-stack" style="height:${hFact}%">
                ${m.retencion ? `<div class="flujo-seg-ret" style="height:${(hRet / hFact) * 100}%"></div>` : ''}
                <div class="flujo-seg-rec" style="height:${(hRec / hFact) * 100}%"></div>
              </div>
            </div>
            <div class="bar-label">${labelMes(k)}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="chart-legend">
        <span><i style="background:var(--adjudicada)"></i>Recibido (neto)</span>
        ${totalRetencion ? '<span><i style="background:var(--seguimiento)"></i>Retención</span>' : ''}
      </div>
    </div>`;

  // Gráfico de líneas: recaudo acumulado en el tiempo
  const lineChart = buildLineChart(chartKeys, meses, labelMes);

  // Detalle por mes (más reciente primero)
  const detalle = keysAsc.slice().reverse().map(k => {
    const m = meses[k];
    const items = m.items.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).map(it => `
      <div class="flujo-row">
        <span class="flujo-fecha">${formatDate(it.fecha)}</span>
        <span class="flujo-proy" title="${esc(it.proyecto)}${it.cliente ? ' · ' + esc(it.cliente) : ''}">${esc(it.proyecto)}${it.concepto ? ` <span class="flujo-concepto">· ${esc(it.concepto)}</span>` : ''}</span>
        <span class="flujo-monto">
          <strong>$${formatMoney(it.recibido)}</strong>
          ${it.retencion ? `<span class="flujo-ret" title="Facturado $${formatMoney(it.facturado)} · retención $${formatMoney(it.retencion)}">ret. $${formatMoneyShort(it.retencion)}</span>` : ''}
        </span>
      </div>`).join('');
    return `
      <div class="flujo-month">
        <div class="flujo-month-head">
          <h4>${labelMes(k, true)}</h4>
          <div class="flujo-month-tot">
            <strong>$${formatMoney(m.recibido)}</strong>
            <span>${m.n} pago${m.n > 1 ? 's' : ''}${m.retencion ? ` · ret. $${formatMoneyShort(m.retencion)}` : ''}</span>
          </div>
        </div>
        <div class="flujo-rows">${items}</div>
      </div>`;
  }).join('');

  flujoView.innerHTML = summary + chart + lineChart + `<div class="flujo-detalle">${detalle}</div>`;
}

// Gráfico de líneas (SVG) del recaudo neto acumulado mes a mes
function buildLineChart(chartKeys, meses, labelMes) {
  // Acumulado del recibido neto a lo largo de los meses mostrados
  let acc = 0;
  const pts = chartKeys.map(k => { acc += meses[k].recibido; return { key: k, acum: acc, mes: meses[k].recibido }; });
  const maxAcum = Math.max(acc, 1);

  const W = 720, H = 210, padX = 12, padTop = 20, padBottom = 12;
  const innerW = W - padX * 2, innerH = H - padTop - padBottom;
  const baseY = H - padBottom;
  const x = i => pts.length === 1 ? W / 2 : padX + (i * innerW) / (pts.length - 1);
  const y = v => baseY - (v / maxAcum) * innerH;

  const coords = pts.map((p, i) => ({ x: x(i), y: y(p.acum), ...p }));
  const linePath = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = coords.length
    ? `M${coords[0].x.toFixed(1)} ${baseY} ` + coords.map(c => `L${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ') + ` L${coords[coords.length - 1].x.toFixed(1)} ${baseY} Z`
    : '';

  const dots = coords.map(c =>
    `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" class="line-dot" vector-effect="non-scaling-stroke">
       <title>${labelMes(c.key, true)}: acumulado $${formatMoney(c.acum)} · mes $${formatMoney(c.mes)}</title>
     </circle>`).join('');

  const labels = chartKeys.map(k => `<span>${labelMes(k)}</span>`).join('');

  return `
    <div class="insight-card flujo-line-card">
      <h3>Recaudo acumulado <span class="line-total">$${formatMoney(acc)}</span></h3>
      <div class="line-chart-wrap">
        <svg class="line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
          <defs>
            <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#6c5ce7" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#6c5ce7" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${areaPath ? `<path d="${areaPath}" fill="url(#lineFill)"/>` : ''}
          <path class="line-path" d="${linePath}" fill="none" stroke-width="2.5"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          ${dots}
        </svg>
        <div class="line-labels">${labels}</div>
      </div>
    </div>`;
}

// ── Cambio de vista ──
function switchView(v) {
  view = v;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  const cotiz = ['funnel-section', 'insights-grid', 'filter-bar', 'results-bar', 'table-container', 'mobile-cards'];
  cotiz.forEach(id => document.getElementById(id).classList.toggle('view-hidden', v !== 'cotizaciones'));
  cobrosView.classList.toggle('view-hidden', v !== 'cobros');
  flujoView.classList.toggle('view-hidden', v !== 'flujo');
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

  // Tabs
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
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

  // Hitos en el modal
  $('#btn-add-pago').addEventListener('click', () => {
    modalPagos.push({ concepto: '', valor: '', remitida: '', pagada: '', recibido: '' });
    renderModalPagos();
    const rows = document.querySelectorAll('#pagos-list .pago-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.p-concepto').focus();
  });

  $('#pagos-list').addEventListener('input', e => {
    const row = e.target.closest('.pago-row');
    if (!row) return;
    const i = parseInt(row.dataset.pidx);
    const map = { 'p-concepto': 'concepto', 'p-valor': 'valor', 'p-remitida': 'remitida', 'p-pagada': 'pagada', 'p-recibido': 'recibido' };
    for (const cls in map) {
      if (e.target.classList.contains(cls)) { modalPagos[i][map[cls]] = e.target.value; break; }
    }
    // actualizar chip de estado del hito en vivo
    const chip = row.querySelector('.hito-chip');
    if (chip) {
      const est = pagoEstado(modalPagos[i]);
      chip.className = 'hito-chip ' + est;
      chip.textContent = { pendiente: 'Por remitir', remitida: 'Remitida', pagada: '✓ Pagada' }[est];
    }
    updatePagosSummary();
  });

  $('#pagos-list').addEventListener('click', e => {
    const del = e.target.closest('.p-del');
    if (!del) return;
    const row = del.closest('.pago-row');
    modalPagos.splice(parseInt(row.dataset.pidx), 1);
    renderModalPagos();
  });

  $('#f-valor').addEventListener('input', updatePagosSummary);

  // Filters
  $('#search-input').addEventListener('input', renderList);
  $('#filter-estado').addEventListener('change', () => { renderFunnel(); renderList(); });
  $('#filter-fuente').addEventListener('change', renderList);
  $('#filter-tipo').addEventListener('change', renderList);
  $('#btn-clear-filters').addEventListener('click', clearFilters);

  // KPI / banner
  statsGrid.addEventListener('click', e => {
    if (e.target.closest('[data-action="followup"]')) { switchView('cotizaciones'); toggleFollowUpFilter(); return; }
    if (e.target.closest('[data-action="cobros"]')) switchView('cobros');
  });
  $('#alert-banner').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'followup') {
      switchView('cotizaciones');
      followUpFilter = true;
      renderStats(); renderList(); scrollToTable();
    } else if (action === 'pordefinir') {
      switchView('cotizaciones');
      followUpFilter = false;
      $('#filter-estado').value = 'Por definir';
      renderStats(); renderFunnel(); renderList(); scrollToTable();
    } else if (action === 'cobros-vencidos') {
      cobroFilter = 'en-cobro'; renderCobros(); switchView('cobros');
    } else if (action === 'cobros-sincuenta') {
      cobroFilter = 'sin-cuentas'; renderCobros(); switchView('cobros');
    }
  });

  // Vista cobros: chips + acciones de hitos
  cobrosView.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-cfilter]');
    if (chip) { cobroFilter = chip.dataset.cfilter; renderCobros(); return; }

    const btn = e.target.closest('[data-action]');
    if (btn) {
      const idx = parseInt(btn.dataset.idx);
      const action = btn.dataset.action;
      if (action === 'addpago') {
        const card = btn.closest('.cobro-card');
        const concepto = card.querySelector('.add-concepto').value.trim();
        const vlr = card.querySelector('.add-valor').value;
        if (!concepto && !vlr) { toast('Indica concepto o valor de la cuenta', true); return; }
        data[idx].Pagos.push({ concepto, valor: vlr, remitida: '', pagada: '', recibido: '' });
        saveData(); render();
        toast('Cuenta de cobro agregada');
      } else if (action === 'remitir') {
        data[idx].Pagos[parseInt(btn.dataset.pidx)].remitida = hoy();
        saveData(); render();
        toast('Cuenta marcada como remitida hoy');
      } else if (action === 'pagar') {
        payingPago = `${idx}:${btn.dataset.pidx}`;
        renderCobros();
        const input = cobrosView.querySelector('.pay-recibido');
        if (input) { input.focus(); input.select(); }
      } else if (action === 'confirmar-pago') {
        const pago = data[idx].Pagos[parseInt(btn.dataset.pidx)];
        const input = btn.closest('.pay-confirm').querySelector('.pay-recibido');
        pago.pagada = hoy();
        pago.recibido = input.value;
        payingPago = null;
        saveData(); render();
        const ret = retencionPago(pago);
        toast(ret ? `💰 Pago registrado · retención de $${formatMoney(ret)}` : '💰 Pago registrado');
      } else if (action === 'cancelar-pago') {
        payingPago = null;
        renderCobros();
      } else if (action === 'delpago') {
        if (confirm('¿Eliminar esta cuenta de cobro?')) {
          data[idx].Pagos.splice(parseInt(btn.dataset.pidx), 1);
          saveData(); render();
          toast('Cuenta eliminada');
        }
      }
      return;
    }

    const head = e.target.closest('.cobro-head');
    if (head) openModal(parseInt(head.dataset.idx));
  });

  // Enter en el alta rápida de hitos = agregar; Enter en valor recibido = confirmar pago
  cobrosView.addEventListener('keydown', e => {
    if (e.key === 'Escape' && payingPago) { payingPago = null; renderCobros(); return; }
    if (e.key !== 'Enter') return;
    if (e.target.classList.contains('add-concepto') || e.target.classList.contains('add-valor')) {
      e.preventDefault();
      const btn = e.target.closest('.hito-add').querySelector('[data-action="addpago"]');
      if (btn) btn.click();
    } else if (e.target.classList.contains('pay-recibido')) {
      e.preventDefault();
      const btn = e.target.closest('.pay-confirm').querySelector('[data-action="confirmar-pago"]');
      if (btn) btn.click();
    }
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
        data[contextIdx]['Fecha de último seguimiento'] = hoy();
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
  $('#filter-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    modalPagos = JSON.parse(JSON.stringify(d.Pagos || []));
  } else {
    ['f-proyecto', 'f-cliente', 'f-razon', 'f-valor', 'f-metraje', 'f-obs'].forEach(id => $(`#${id}`).value = '');
    $('#f-fuente').value = 'Referido';
    $('#f-tipo').value = 'Peritaje Estructural';
    $('#f-estado').value = 'Por definir';
    $('#f-fecha').value = hoy();
    $('#f-seguimiento').value = '';
    modalPagos = [];
  }

  renderModalPagos();
  modalOverlay.classList.add('active');
  setTimeout(() => $('#f-proyecto').focus(), 100);
}

function closeModal() { modalOverlay.classList.remove('active'); }

// ── Hitos dentro del modal ──
function renderModalPagos() {
  const list = $('#pagos-list');
  if (!modalPagos.length) {
    list.innerHTML = '<div class="pagos-empty">Sin cuentas de cobro. Agrega hitos de pago (anticipo, entregas, saldo…)</div>';
  } else {
    list.innerHTML = modalPagos.map((p, i) => `
      <div class="pago-row" data-pidx="${i}">
        <div class="pago-main">
          <input type="text" class="p-concepto" placeholder="Concepto (ej. Anticipo 50%)" value="${esc(p.concepto)}">
          <input type="number" class="p-valor" placeholder="Valor $" value="${esc(p.valor)}">
          <button type="button" class="btn-mini del p-del" title="Eliminar cuenta">✕</button>
        </div>
        <div class="pago-dates">
          <label>Remitida <input type="date" class="p-remitida" value="${esc(p.remitida)}"></label>
          <label>Pagada <input type="date" class="p-pagada" value="${esc(p.pagada)}"></label>
          <label>Recibido $ <input type="number" class="p-recibido" value="${esc(p.recibido)}" placeholder="= valor" title="Valor que llegó realmente (si hubo retenciones). Vacío = valor completo"></label>
          <span class="hito-chip ${pagoEstado(p)}">${{ pendiente: 'Por remitir', remitida: 'Remitida', pagada: '✓ Pagada' }[pagoEstado(p)]}</span>
        </div>
      </div>`).join('');
  }
  updatePagosSummary();
}

function updatePagosSummary() {
  const summary = $('#pagos-summary');
  if (!modalPagos.length) { summary.textContent = ''; return; }
  const totalHitos = modalPagos.reduce((s, p) => s + valorPago(p), 0);
  const valorProy = parseFloat($('#f-valor').value) || 0;
  const cobrado = modalPagos.filter(p => p.pagada).reduce((s, p) => s + valorPago(p), 0);
  const retenciones = modalPagos.reduce((s, p) => s + retencionPago(p), 0);
  let txt = `Total en cuentas: $${formatMoney(totalHitos)}`;
  if (valorProy) {
    const diff = valorProy - totalHitos;
    txt += diff === 0 ? ' · cubre el valor del proyecto ✓'
      : diff > 0 ? ` · faltan $${formatMoney(diff)} por asignar`
      : ` · excede el valor del proyecto en $${formatMoney(-diff)}`;
  }
  if (cobrado) txt += ` · cobrado $${formatMoney(cobrado)}`;
  if (retenciones) txt += ` · retenciones $${formatMoney(retenciones)} (neto $${formatMoney(cobrado - retenciones)})`;
  summary.textContent = txt;
}

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
    'Fecha de último seguimiento': $('#f-seguimiento').value,
    Pagos: modalPagos.filter(p => (p.concepto || '').trim() || valorPago(p))
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
      normalizeData();
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
