// ─────────────────────────────────────────────
//  CotizaTrack – App Logic
// ─────────────────────────────────────────────

const ESTADOS = ['Por definir', 'Enviada', 'En seguimiento', 'Adjudicada', 'Perdida'];
const ESTADO_CSS = { 'Por definir': 'por-definir', 'Enviada': 'enviada', 'En seguimiento': 'seguimiento', 'Adjudicada': 'adjudicada', 'Perdida': 'perdida' };
const CSV_FILE = 'cotizaciones.csv';
const LS_KEY = 'cotizaciones_data';

let data = [];
let sortCol = null;
let sortAsc = true;
let contextIdx = -1;

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
  // Try localStorage first
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    data = JSON.parse(stored);
    return;
  }
  // Try fetching CSV
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

// ── Render everything ──
function render() {
  renderFunnel();
  renderStats();
  renderTable();
  renderMobileCards();
  populateFilterOptions();
}

// ── Funnel ──
function renderFunnel() {
  const counts = {};
  ESTADOS.forEach(e => counts[e] = 0);
  data.forEach(d => { if (counts[d.Estado] !== undefined) counts[d.Estado]++; });
  const total = data.length || 1;

  funnelBar.innerHTML = ESTADOS.map(e => {
    const pct = Math.max((counts[e] / total) * 100, 6);
    return `<div class="funnel-segment ${ESTADO_CSS[e]}" style="width:${pct}%" title="${e}: ${counts[e]}">${counts[e]}</div>`;
  }).join('');

  funnelLabels.innerHTML = ESTADOS.map(e => {
    const pct = Math.max((counts[e] / total) * 100, 6);
    return `<div class="funnel-label" style="width:${pct}%"><span class="count">${counts[e]}</span>${e}</div>`;
  }).join('');
}

// ── Stats ──
function renderStats() {
  const total = data.length;
  const totalValor = data.reduce((s, d) => s + (parseFloat(d.Valor) || 0), 0);
  const adjudicadas = data.filter(d => d.Estado === 'Adjudicada');
  const valorAdj = adjudicadas.reduce((s, d) => s + (parseFloat(d.Valor) || 0), 0);
  const tasaConv = total > 0 ? ((adjudicadas.length / total) * 100).toFixed(1) : 0;

  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="label">Total Cotizaciones</div>
      <div class="value">${total}</div>
      <div class="sub">en el sistema</div>
    </div>
    <div class="stat-card">
      <div class="label">Valor Total</div>
      <div class="value">$${formatMoney(totalValor)}</div>
      <div class="sub">cotizado</div>
    </div>
    <div class="stat-card">
      <div class="label">Adjudicadas</div>
      <div class="value">$${formatMoney(valorAdj)}</div>
      <div class="sub">${adjudicadas.length} proyectos</div>
    </div>
    <div class="stat-card">
      <div class="label">Tasa Conversión</div>
      <div class="value">${tasaConv}%</div>
      <div class="sub">adjudicadas / total</div>
    </div>
  `;
}

// ── Filter logic ──
function getFiltered() {
  const search = ($('#search-input').value || '').toLowerCase();
  const estado = $('#filter-estado').value;
  const fuente = $('#filter-fuente').value;
  const tipo = $('#filter-tipo').value;

  let filtered = data.filter(d => {
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

// ── Table ──
function renderTable() {
  const filtered = getFiltered();
  if (!filtered.length) {
    tableBody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="icon">📋</div><p>No hay cotizaciones que mostrar</p></div></td></tr>`;
    return;
  }
  tableBody.innerHTML = filtered.map(d => {
    const idx = data.indexOf(d);
    const css = ESTADO_CSS[d.Estado] || '';
    return `<tr data-idx="${idx}">
      <td title="${d.Proyecto}">${d.Proyecto}</td>
      <td title="${d.Cliente}">${d.Cliente}</td>
      <td title="${d['Razón social']}">${d['Razón social'] || '—'}</td>
      <td>${d.Tipo}</td>
      <td>${d.Fuente}</td>
      <td>${d['Fecha de envío'] || '—'}</td>
      <td>${d['Fecha de último seguimiento'] || '—'}</td>
      <td>$${formatMoney(parseFloat(d.Valor) || 0)}</td>
      <td>${d.Metraje || '—'}</td>
      <td><span class="status-badge ${css}"><span class="dot"></span>${d.Estado}</span></td>
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
        <h4>${d.Proyecto}</h4>
        <span class="status-badge ${css}"><span class="dot"></span>${d.Estado}</span>
      </div>
      <div class="mobile-card-body">
        <div>Cliente: <strong>${d.Cliente}</strong></div>
        <div>Razón social: <strong>${d['Razón social'] || '—'}</strong></div>
        <div>Tipo: <strong>${d.Tipo}</strong></div>
        <div>Valor: <strong>$${formatMoney(parseFloat(d.Valor) || 0)}</strong></div>
        <div>Envío: <strong>${d['Fecha de envío'] || '—'}</strong></div>
        <div>Seguim: <strong>${d['Fecha de último seguimiento'] || '—'}</strong></div>
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

  selFuente.innerHTML = '<option value="">Todas las fuentes</option>' + fuentes.map(f => `<option value="${f}">${f}</option>`).join('');
  selTipo.innerHTML = '<option value="">Todos los tipos</option>' + tipos.map(t => `<option value="${t}">${t}</option>`).join('');

  selFuente.value = curFuente;
  selTipo.value = curTipo;
}

// ── Events ──
function bindEvents() {
  // New
  $('#btn-new').addEventListener('click', () => openModal());

  // Export
  $('#btn-export').addEventListener('click', exportCSV);

  // Import
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', importCSV);

  // Modal close
  $('#modal-close').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

  // Save
  $('#btn-save').addEventListener('click', saveEntry);

  // Delete
  $('#btn-delete').addEventListener('click', deleteEntry);

  // Filters
  $('#search-input').addEventListener('input', () => { renderTable(); renderMobileCards(); });
  $('#filter-estado').addEventListener('change', () => { renderTable(); renderMobileCards(); });
  $('#filter-fuente').addEventListener('change', () => { renderTable(); renderMobileCards(); });
  $('#filter-tipo').addEventListener('change', () => { renderTable(); renderMobileCards(); });

  // Sort
  document.querySelectorAll('.data-table thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; }
      renderTable();
    });
  });

  // Row click → edit
  tableBody.addEventListener('click', e => {
    const btn = e.target.closest('.btn-status');
    if (btn) { showContextMenu(e, parseInt(btn.dataset.idx)); return; }
    const tr = e.target.closest('tr[data-idx]');
    if (tr) openModal(parseInt(tr.dataset.idx));
  });

  // Mobile card click → edit
  mobileCards.addEventListener('click', e => {
    const card = e.target.closest('.mobile-card');
    if (card) openModal(parseInt(card.dataset.idx));
  });

  // Context menu
  contextMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (contextIdx >= 0 && contextIdx < data.length) {
        data[contextIdx].Estado = btn.dataset.status;
        saveData(); render();
        toast(`Estado actualizado a "${btn.dataset.status}"`);
      }
      hideContextMenu();
    });
  });

  document.addEventListener('click', e => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); hideContextMenu(); }
  });
}

// ── Modal ──
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
}

function closeModal() { modalOverlay.classList.remove('active'); }

// ── Save ──
function saveEntry() {
  const proyecto = $('#f-proyecto').value.trim();
  if (!proyecto) { toast('El nombre del proyecto es obligatorio', true); return; }

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
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
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
  el.innerHTML = `${isError ? '⚠' : '✓'} ${msg}`;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Format ──
function formatMoney(n) {
  return n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
