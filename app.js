'use strict';

// ============================================================================
// ESTADO GLOBAL
// ============================================================================
const state = {
  headers: [],
  actas: [],
  kpis: null,
  hallazgosPorAliado: [],
  usuario: localStorage.getItem('cce_usuario') || '',
  pin: localStorage.getItem('cce_pin') || '',
  filtros: { texto: '', aliado: '', supervision: '' },
  cargando: false,
  editandoId: null
};

// Campos que el usuario puede editar manualmente en el formulario de acta.
// (# se autogenera; Dif. Factor y Acuerdo T=U se calculan en el backend)
const CAMPOS_FORM = [
  { campo: 'Fecha', tipo: 'text', placeholder: 'YYYY-MM-DD' },
  { campo: 'Ciudad', tipo: 'text' },
  { campo: 'Aliado', tipo: 'text' },
  { campo: 'Técnico', tipo: 'text' },
  { campo: 'Serie Medidor', tipo: 'text' },
  { campo: 'Tipo Medida', tipo: 'select', opciones: ['directa', 'semidirecta', 'indirecta'] },
  { campo: 'V. Servicio', tipo: 'number' },
  { campo: 'V. Alta Trafo', tipo: 'number' },
  { campo: 'V. Baja Trafo', tipo: 'number' },
  { campo: 'Factor acta (K)', tipo: 'number' },
  { campo: 'Factor real (L)', tipo: 'number' },
  { campo: 'R01 Tensión', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'] },
  { campo: 'R03 Formato', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'] },
  { campo: 'R04 Foto Serial', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'] },
  { campo: 'R05 Foto Sistema', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'] },
  { campo: 'R06 Sellos', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'] },
  { campo: 'R07 Caja', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'] },
  { campo: 'Score', tipo: 'number' },
  { campo: 'Supervisión Manual (T)', tipo: 'select', opciones: ['PENDIENTE', 'CONFORME', 'NO CONFORMIDAD'] },
  { campo: 'Supervisión IA (U)', tipo: 'select', opciones: ['PENDIENTE', 'CONFORME', 'NO CONFORMIDAD'] },
  { campo: 'Fallos Detectados', tipo: 'textarea', span2: true },
  { campo: 'Tipo de acta', tipo: 'text' },
  { campo: 'Order ID', tipo: 'text' }
];

// ============================================================================
// ARRANQUE
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  configurarNavegacion();
  configurarModalUsuario();
  configurarModalActa();
  configurarFiltros();

  document.getElementById('btnRefrescar').addEventListener('click', () => cargarDatos(true));

  if (state.usuario && state.pin) {
    document.getElementById('usuarioActualLabel').textContent = '\ud83d\udc64 ' + state.usuario;
    iniciarSesion();
  } else {
    abrirModal('modalUsuario');
  }
});

// ============================================================================
// ACCESO — nombre + PIN compartido del equipo (validado en el servidor)
// ============================================================================
function configurarModalUsuario() {
  document.getElementById('btnEntrar').addEventListener('click', intentarEntrar);
  ['inputUsuario', 'inputPin'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') intentarEntrar();
    });
  });
}

async function intentarEntrar() {
  const nombre = document.getElementById('inputUsuario').value.trim();
  const pin = document.getElementById('inputPin').value.trim();
  const errorBox = document.getElementById('authError');
  errorBox.style.display = 'none';

  if (!nombre || !pin) {
    errorBox.textContent = 'Escribe tu nombre y el PIN de acceso.';
    errorBox.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btnEntrar');
  btn.disabled = true;
  btn.textContent = 'Verificando…';

  try {
    const resp = await fetch(CONFIG.API_URL + '?action=getData&pin=' + encodeURIComponent(pin));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    state.usuario = nombre;
    state.pin = pin;
    localStorage.setItem('cce_usuario', nombre);
    localStorage.setItem('cce_pin', pin);
    document.getElementById('usuarioActualLabel').textContent = '\ud83d\udc64 ' + nombre;
    cerrarModal('modalUsuario');

    state.headers = data.headers;
    state.actas = data.actas;
    state.kpis = data.kpis;
    state.hallazgosPorAliado = data.hallazgosPorAliado || [];
    renderTodo();
    marcarSync('live', 'Actualizado ' + new Date().toLocaleTimeString('es-CO'));

    setInterval(() => cargarDatos(false), CONFIG.POLL_INTERVAL_MS);
  } catch (err) {
    errorBox.textContent = err.message.includes('PIN')
      ? 'PIN incorrecto. Verifica con el administrador.'
      : 'No se pudo conectar: ' + err.message;
    errorBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function iniciarSesion() {
  cargarDatos(true);
  setInterval(() => cargarDatos(false), CONFIG.POLL_INTERVAL_MS);
}

// ============================================================================
// NAVEGACIÓN ENTRE VISTAS
// ============================================================================
function configurarNavegacion() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.getElementById('view-' + btn.dataset.view).classList.add('is-active');
    });
  });
}

// ============================================================================
// MODAL: ABRIR / CERRAR
// ============================================================================
function abrirModal(id) { document.getElementById(id).classList.add('is-active'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('is-active'); }

// ============================================================================
// CARGA DE DATOS (GET) + POLLING
// ============================================================================
async function cargarDatos(mostrarError) {
  if (state.cargando) return;
  state.cargando = true;
  marcarSync('saving', 'Sincronizando…');

  try {
    const resp = await fetch(CONFIG.API_URL + '?action=getData&pin=' + encodeURIComponent(state.pin));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.error) {
      if (data.error.includes('PIN')) {
        // El PIN guardado ya no es válido (lo cambiaron) -> pedirlo de nuevo
        localStorage.removeItem('cce_pin');
        state.pin = '';
        abrirModal('modalUsuario');
      }
      throw new Error(data.error);
    }

    state.headers = data.headers;
    state.actas = data.actas;
    state.kpis = data.kpis;
    state.hallazgosPorAliado = data.hallazgosPorAliado || [];

    renderTodo();
    marcarSync('live', 'Actualizado ' + new Date().toLocaleTimeString('es-CO'));
  } catch (err) {
    marcarSync('error', 'Sin conexión con la hoja');
    if (mostrarError) mostrarToast('No se pudo cargar la información: ' + err.message, 'error');
    console.error(err);
  } finally {
    state.cargando = false;
  }
}

function marcarSync(estado, texto) {
  const dot = document.querySelector('#syncIndicator .sync-dot');
  dot.className = 'sync-dot is-' + estado;
  document.getElementById('syncText').textContent = texto;
}

// ============================================================================
// RENDER GENERAL
// ============================================================================
function renderTodo() {
  renderDashboard();
  renderFiltroAliados();
  renderTablaDatos();
  renderTablaDesacuerdos();
}

// --- Dashboard --------------------------------------------------------------
function renderDashboard() {
  const k = state.kpis;
  if (!k) return;

  document.getElementById('tituloActualizacion').textContent =
    k.total + ' actas registradas · última sincronización ' + new Date().toLocaleString('es-CO');

  document.getElementById('kpiTotal').textContent = k.total;
  document.getElementById('kpiConformesManual').textContent = k.conformesManual;
  document.getElementById('kpiNoConformesManual').textContent = k.noConformesManual;
  document.getElementById('kpiConformesIA').textContent = k.conformesIA;
  document.getElementById('kpiNoConformesIA').textContent = k.noConformesIA;
  document.getElementById('kpiDesacuerdos').textContent = k.desacuerdos;

  // Conformidad por aliado — barra de marca (púrpura), roja solo si supera 20% NC
  renderBarras('chartAliados', k.porAliado.map(a => ({
    etiqueta: a.aliado, valor: a.pctNC, texto: (a.pctNC * 100).toFixed(1) + '%',
    clase: a.pctNC > 0.2 ? 'danger' : 'accent'
  })), 1);

  // Score por tipo de medida — púrpura de marca, rojo solo si score bajo
  const maxScore = Math.max(100, ...k.porTipoMedida.map(t => t.scoreProm));
  renderBarras('chartTipoMedida', k.porTipoMedida.map(t => ({
    etiqueta: t.tipo, valor: t.scoreProm, texto: t.scoreProm.toFixed(1),
    clase: t.scoreProm < 70 ? 'danger' : ''
  })), maxScore);

  // Acuerdo vs Desacuerdo (Manual vs IA)
  const totalAcuerdo = k.acuerdos + k.desacuerdos;
  renderBarras('chartAcuerdo', [
    { etiqueta: 'CONFORME (T=U)', valor: k.acuerdos, texto: String(k.acuerdos), clase: 'success' },
    { etiqueta: 'DESACUERDO (T≠U)', valor: k.desacuerdos, texto: String(k.desacuerdos), clase: 'danger' }
  ], totalAcuerdo || 1);

  // Concordancia Factor Acta (K) vs Factor Real (L) — calculado de las actas
  const factor = calcularConcordanciaFactor();
  renderBarras('chartFactor', [
    { etiqueta: 'Concuerda', valor: factor.concuerda, texto: String(factor.concuerda), clase: 'success' },
    { etiqueta: 'No concuerda', valor: factor.noConcuerda, texto: String(factor.noConcuerda), clase: 'danger' }
  ], Math.max(factor.concuerda, factor.noConcuerda, 1));

  // Hallazgos por aliado (opcional — solo si la pestaña "Hallazgos" existe)
  const panelHallazgos = document.getElementById('panelHallazgos');
  if (state.hallazgosPorAliado && state.hallazgosPorAliado.length) {
    panelHallazgos.style.display = '';
    const maxHallazgos = Math.max(...state.hallazgosPorAliado.map(h => h.hallazgos));
    renderBarras('chartHallazgos', state.hallazgosPorAliado.map(h => ({
      etiqueta: h.aliado, valor: h.hallazgos, texto: String(h.hallazgos), clase: 'accent'
    })), maxHallazgos);
  } else {
    panelHallazgos.style.display = 'none';
  }
}

/** Compara Factor acta (K) vs Factor real (L) en todas las actas cargadas. */
function calcularConcordanciaFactor() {
  let concuerda = 0, noConcuerda = 0;
  state.actas.forEach(a => {
    const acta = a['Factor acta (K)'];
    const real = a['Factor real (L)'];
    if (acta === undefined || acta === '' || real === undefined || real === '') return;

    const realTexto = String(real).trim().toLowerCase();
    if (realTexto === 'ok') { concuerda++; return; } // "ok" = el auditor confirmó que coincide

    const actaNum = parseFloat(acta);
    const realNum = parseFloat(real);
    if (isNaN(actaNum) || isNaN(realNum)) return; // dato no comparable, se omite

    if (actaNum === realNum) concuerda++; else noConcuerda++;
  });
  return { concuerda, noConcuerda };
}

function renderBarras(contenedorId, items, maxValor) {
  const cont = document.getElementById(contenedorId);
  cont.innerHTML = '';
  items.forEach(item => {
    const pct = maxValor ? Math.min(100, (item.valor / maxValor) * 100) : 0;
    const clase = item.clase || '';
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <span class="bar-dot ${clase}"></span>
      <span class="bar-label" title="${escapeHtml(item.etiqueta)}">${escapeHtml(item.etiqueta)}</span>
      <span class="bar-track"><span class="bar-fill ${clase}" style="width:${pct}%"></span></span>
      <span class="bar-value ${clase}">${item.texto}</span>`;
    cont.appendChild(row);
  });
  if (!items.length) cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>';
}

// --- Filtro de aliados (select) ---------------------------------------------
function renderFiltroAliados() {
  const select = document.getElementById('filtroAliado');
  const actual = select.value;
  const aliados = [...new Set(state.actas.map(a => a['Aliado']).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Todos los aliados</option>' +
    aliados.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  select.value = actual;
}

function configurarFiltros() {
  document.getElementById('filtroTexto').addEventListener('input', e => {
    state.filtros.texto = e.target.value.toLowerCase();
    renderTablaDatos();
  });
  document.getElementById('filtroAliado').addEventListener('change', e => {
    state.filtros.aliado = e.target.value;
    renderTablaDatos();
  });
  document.getElementById('filtroSupervision').addEventListener('change', e => {
    state.filtros.supervision = e.target.value;
    renderTablaDatos();
  });
  document.getElementById('btnNuevaActa').addEventListener('click', () => abrirModalActa(null));
  configurarImportacionExcel();
}

// ============================================================================
// IMPORTAR DESDE EXCEL (.xlsx) — lee el archivo en el navegador con SheetJS,
// hace match con la hoja "Datos Completos" y sincroniza (upsert) por "#".
// ============================================================================
function configurarImportacionExcel() {
  const btn = document.getElementById('btnImportarExcel');
  const input = document.getElementById('inputExcel');

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    input.value = ''; // permite volver a elegir el mismo archivo más tarde
    if (!file) return;

    try {
      const actas = await parsearExcelActas(file);
      if (!actas.length) {
        mostrarToast('No se encontraron filas con "#" válido en el archivo.', 'error');
        return;
      }
      const confirmar = confirm(
        'Se encontraron ' + actas.length + ' actas en el archivo.\n' +
        'Se identifican por Fecha + Ciudad + Order ID: las que ya existan se ' +
        'actualizarán (sin duplicarse) y las nuevas se agregarán.\n\n' +
        '¿Continuar con la sincronización?'
      );
      if (!confirmar) return;

      btn.disabled = true;
      btn.textContent = 'Sincronizando…';
      const resp = await postAccion('bulkImport', { actas });
      mostrarToast(resp.mensaje || 'Importación completada.', 'success');
      await cargarDatos(false);
    } catch (err) {
      mostrarToast('Error al importar: ' + err.message, 'error');
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.textContent = '📤 Importar desde Excel';
    }
  });
}

function parsearExcelActas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });

        // Busca, entre TODAS las hojas del archivo, la primera que tenga una
        // fila cuya columna A sea exactamente "#" — así funciona sin importar
        // cómo se llame la pestaña (Datos Completos, Auditoria IA=Manual, etc.).
        let nombreHoja = null, idxEncabezado = -1, filas = null;
        for (const nombre of workbook.SheetNames) {
          const candidatas = XLSX.utils.sheet_to_json(workbook.Sheets[nombre], { header: 1, raw: true, defval: '' });
          const idx = candidatas.findIndex(f => String(f[0]).trim() === '#');
          if (idx !== -1) { nombreHoja = nombre; idxEncabezado = idx; filas = candidatas; break; }
        }
        if (!filas) {
          throw new Error('No se encontró ninguna hoja con una fila de encabezados que empiece en "#".');
        }
        const encabezados = filas[idxEncabezado].map(h => String(h || '').trim());

        const actas = [];
        for (let i = idxEncabezado + 1; i < filas.length; i++) {
          const fila = filas[i];
          const id = fila[0];
          if (typeof id !== 'number' || id <= 0) continue; // separadores / filas vacías
          const obj = {};
          encabezados.forEach((h, col) => {
            if (!h) return;
            let valor = fila[col];
            if (valor instanceof Date) valor = valor.toISOString().slice(0, 10);
            obj[h] = valor === undefined ? '' : valor;
          });
          actas.push(obj);
        }
        resolve(actas);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function actasFiltradas() {
  return state.actas.filter(a => {
    if (state.filtros.aliado && a['Aliado'] !== state.filtros.aliado) return false;
    if (state.filtros.supervision && (a['Supervisión Manual (T)'] || '') !== state.filtros.supervision) return false;
    if (state.filtros.texto) {
      const haystack = [a['Aliado'], a['Técnico'], a['Serie Medidor'], a['Ciudad'], a['Order ID']]
        .join(' ').toLowerCase();
      if (!haystack.includes(state.filtros.texto)) return false;
    }
    return true;
  });
}

// --- Tabla: Datos completos --------------------------------------------------
const COLUMNAS_TABLA = [
  '#', 'Fecha', 'Ciudad', 'Aliado', 'Técnico', 'Serie Medidor', 'Tipo Medida',
  'Score', 'Supervisión Manual (T)', 'Supervisión IA (U)', 'Acuerdo T=U', 'revisado'
];

function renderTablaDatos() {
  const filtradas = actasFiltradas();
  document.getElementById('datosSubtitle').textContent =
    filtradas.length + ' de ' + state.actas.length + ' actas mostradas';

  const thead = document.querySelector('#tablaDatos thead');
  thead.innerHTML = '<tr>' + COLUMNAS_TABLA.map(c => `<th>${c}</th>`).join('') + '<th>Acciones</th></tr>';

  const tbody = document.querySelector('#tablaDatos tbody');
  tbody.innerHTML = '';
  filtradas
    .slice()
    .sort((a, b) => (b['#'] || 0) - (a['#'] || 0))
    .forEach(acta => {
      const tr = document.createElement('tr');
      tr.innerHTML = COLUMNAS_TABLA.map(c => `<td>${celdaHtml(c, acta[c])}</td>`).join('') +
        `<td class="row-actions">
           <button class="btn btn-ghost btn-icon" data-editar="${acta['#']}">✎</button>
           <button class="btn btn-ghost btn-icon" data-eliminar="${acta['#']}">🗑</button>
         </td>`;
      tbody.appendChild(tr);
    });

  tbody.querySelectorAll('[data-editar]').forEach(btn =>
    btn.addEventListener('click', () => abrirModalActa(Number(btn.dataset.editar))));
  tbody.querySelectorAll('[data-eliminar]').forEach(btn =>
    btn.addEventListener('click', () => confirmarEliminar(Number(btn.dataset.eliminar))));
}

function celdaHtml(campo, valor) {
  const camposBadge = ['Supervisión Manual (T)', 'Supervisión IA (U)', 'Acuerdo T=U'];
  if (camposBadge.includes(campo) && valor) {
    const clase = 'badge-' + String(valor).toLowerCase().replace(/\s+/g, '').replace('í', 'i');
    return `<span class="badge ${clase}">${escapeHtml(valor)}</span>`;
  }
  return escapeHtml(valor === undefined || valor === null ? '' : valor);
}

// --- Tabla: Desacuerdos -------------------------------------------------------
function renderTablaDesacuerdos() {
  const desacuerdos = state.actas.filter(a => (a['Acuerdo T=U'] || '') === 'DESACUERDO');
  document.getElementById('desacuerdosSubtitle').textContent = desacuerdos.length + ' casos con desacuerdo activo';

  const tbody = document.querySelector('#tablaDesacuerdos tbody');
  tbody.innerHTML = '';
  desacuerdos.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${a['#']}</td>
      <td>${escapeHtml(a['Aliado'])}</td>
      <td>${escapeHtml(a['Técnico'])}</td>
      <td>${escapeHtml(a['Serie Medidor'])}</td>
      <td>${escapeHtml(a['Tipo Medida'])}</td>
      <td>${escapeHtml(a['Score'])}</td>
      <td>${celdaHtml('Supervisión Manual (T)', a['Supervisión Manual (T)'])}</td>
      <td>${celdaHtml('Supervisión IA (U)', a['Supervisión IA (U)'])}</td>
      <td>${escapeHtml(a['Fallos Detectados'])}</td>`;
    tbody.appendChild(tr);
  });
  if (!desacuerdos.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--ink-500);padding:20px;">No hay desacuerdos activos 🎉</td></tr>';
  }
}

// ============================================================================
// MODAL: CREAR / EDITAR ACTA
// ============================================================================
function configurarModalActa() {
  document.getElementById('btnCancelarActa').addEventListener('click', () => cerrarModal('modalActa'));
  document.getElementById('formActa').addEventListener('submit', onGuardarActa);
}

function abrirModalActa(id) {
  state.editandoId = id;
  document.getElementById('modalActaTitulo').textContent = id ? 'Editar acta #' + id : 'Nueva acta';

  const acta = id ? state.actas.find(a => a['#'] === id) : {};
  const form = document.getElementById('formActa');
  form.innerHTML = CAMPOS_FORM.map(f => campoHtml(f, acta ? acta[f.campo] : '')).join('');

  abrirModal('modalActa');
}

function campoHtml(f, valor) {
  valor = valor === undefined || valor === null ? '' : valor;
  const spanClass = f.span2 ? ' span-2' : '';
  let control;
  if (f.tipo === 'select') {
    control = `<select name="${f.campo}">` +
      f.opciones.map(op => `<option value="${op}" ${op === valor ? 'selected' : ''}>${op}</option>`).join('') +
      `</select>`;
  } else if (f.tipo === 'textarea') {
    control = `<textarea name="${f.campo}" rows="3">${escapeHtml(valor)}</textarea>`;
  } else {
    control = `<input type="${f.tipo}" name="${f.campo}" value="${escapeHtml(valor)}" ${f.placeholder ? `placeholder="${f.placeholder}"` : ''}>`;
  }
  return `<div class="form-field${spanClass}"><label>${f.campo}</label>${control}</div>`;
}

async function onGuardarActa(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const cambios = {};
  CAMPOS_FORM.forEach(f => { cambios[f.campo] = formData.get(f.campo) || ''; });

  const btn = document.getElementById('btnGuardarActa');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    if (state.editandoId) {
      await postAccion('updateActa', { id: state.editandoId, cambios, usuario: state.usuario });
      mostrarToast('Acta #' + state.editandoId + ' actualizada.', 'success');
    } else {
      const resp = await postAccion('addActa', { acta: cambios, usuario: state.usuario });
      mostrarToast('Acta #' + resp.id + ' creada.', 'success');
    }
    cerrarModal('modalActa');
    await cargarDatos(false);
  } catch (err) {
    mostrarToast('Error al guardar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

function confirmarEliminar(id) {
  if (!confirm('¿Eliminar el acta #' + id + '? Esta acción no se puede deshacer.')) return;
  postAccion('deleteActa', { id })
    .then(() => { mostrarToast('Acta #' + id + ' eliminada.', 'success'); cargarDatos(false); })
    .catch(err => mostrarToast('Error al eliminar: ' + err.message, 'error'));
}

// ============================================================================
// COMUNICACIÓN CON EL BACKEND (POST)
// ============================================================================
async function postAccion(action, payload) {
  const resp = await fetch(CONFIG.API_URL, {
    method: 'POST',
    // text/plain evita el preflight OPTIONS, que Apps Script no maneja.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, pin: state.pin, ...payload })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ============================================================================
// UTILIDADES
// ============================================================================
function escapeHtml(valor) {
  return String(valor === undefined || valor === null ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mostrarToast(mensaje, tipo) {
  const cont = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast' + (tipo ? ' toast-' + tipo : '');
  toast.textContent = mensaje;
  cont.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}
