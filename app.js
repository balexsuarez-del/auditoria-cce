'use strict';

// ============================================================================
// ESTADO GLOBAL
// ============================================================================
const state = {
  headers: [],
  actas: [],
  kpis: null,
  hallazgosPorAliado: [],
  hallazgosDetalle: [],
  usuario: localStorage.getItem('cce_usuario') || '',
  pin: localStorage.getItem('cce_pin') || '',
  filtros: { texto: '', aliado: '', supervision: '', fechaDesde: '', fechaHasta: '' },
  filtroHallazgosTipo: '',
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
  configurarAsistente();
  configurarSelectoresVista();
  configurarSelectorColumnas();
  configurarVistas();
  aplicarVisibilidadPaneles();

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
    state.hallazgosDetalle = data.hallazgosDetalle || [];
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

  configurarBuscadorGlobal();
}

/**
 * Buscador accesible desde cualquier vista (barra lateral): busca en todas
 * las actas, te lleva a "Datos completos" con el filtro ya aplicado, y
 * resalta la primera coincidencia para que la ubiques de inmediato.
 */
function configurarBuscadorGlobal() {
  document.getElementById('formBuscadorGlobal').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('inputBuscadorGlobal');
    const consulta = input.value.trim();
    if (!consulta) return;

    state.filtros.texto = consulta.toLowerCase();
    document.getElementById('filtroTexto').value = consulta;

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
    document.querySelector('[data-view="datos"]').classList.add('is-active');
    document.getElementById('view-datos').classList.add('is-active');
    renderTablaDatos();

    const coincidencias = actasFiltradas();
    if (!coincidencias.length) {
      mostrarToast(`Sin resultados para "${consulta}".`, 'error');
      return;
    }
    const primeraFila = document.querySelector(`#tablaDatos tbody tr[data-fila-id="${coincidencias[0]['#']}"]`);
    if (primeraFila) {
      primeraFila.scrollIntoView({ behavior: 'smooth', block: 'center' });
      primeraFila.classList.add('fila-resaltada');
      setTimeout(() => primeraFila.classList.remove('fila-resaltada'), 2600);
    }
    mostrarToast(`${coincidencias.length} resultado(s) para "${consulta}".`, 'success');
  });
}

// ============================================================================
// MODAL: ABRIR / CERRAR
// ============================================================================
function abrirModal(id) { document.getElementById(id).classList.add('is-active'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('is-active'); }

/**
 * Hace scroll hasta la fila de una acta en "Datos completos" y la resalta
 * un momento (para que el asistente "señale" visualmente de qué está
 * hablando), antes de abrir el formulario de edición.
 */
/**
 * Va al Dashboard y resalta un panel completo (por su data-panel-nombre) —
 * útil para que el asistente "señale" de cuál gráfica está hablando.
 */
function irYResaltarPanel(nombrePanel) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('is-active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
  document.querySelector('[data-view="dashboard"]').classList.add('is-active');
  document.getElementById('view-dashboard').classList.add('is-active');

  // Si el panel estaba oculto por una Vista guardada, se vuelve a mostrar
  // para poder señalarlo (si no, no habría nada que resaltar).
  const visibles = obtenerPanelesVisibles();
  if (!visibles.includes(nombrePanel)) {
    guardarPanelesVisibles([...visibles, nombrePanel]);
    aplicarVisibilidadPaneles();
  }

  setTimeout(() => {
    const panel = document.querySelector(`#view-dashboard [data-panel-nombre="${nombrePanel}"]`);
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    panel.classList.add('panel-resaltado');
    setTimeout(() => panel.classList.remove('panel-resaltado'), 2600);
  }, 50);
}

function irYResaltarActa(id) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('is-active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
  document.querySelector('[data-view="datos"]').classList.add('is-active');
  document.getElementById('view-datos').classList.add('is-active');

  // Si hay filtros activos (aliado, supervisión, fechas) que podrían excluir
  // justo la fila que se quiere señalar, se limpian para garantizar que
  // siempre sea visible — si no, el resaltado fallaría en silencio.
  const acta = state.actas.find(a => Number(a['#']) === Number(id));
  const filtrosBloqueando =
    (state.filtros.aliado && acta && acta['Aliado'] !== state.filtros.aliado) ||
    (state.filtros.supervision && acta && (acta['Supervisión Manual (T)'] || '') !== state.filtros.supervision) ||
    state.filtros.fechaDesde || state.filtros.fechaHasta;
  if (filtrosBloqueando) {
    state.filtros = { texto: '', aliado: '', supervision: '', fechaDesde: '', fechaHasta: '' };
    document.getElementById('filtroTexto').value = '';
    document.getElementById('filtroAliado').value = '';
    document.getElementById('filtroSupervision').value = '';
    document.getElementById('filtroFechaDesde').value = '';
    document.getElementById('filtroFechaHasta').value = '';
  }

  renderTablaDatos();

  const fila = document.querySelector(`#tablaDatos tbody tr[data-fila-id="${id}"]`);
  if (fila) {
    fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fila.classList.add('fila-resaltada');
    setTimeout(() => fila.classList.remove('fila-resaltada'), 2600);
  }

  setTimeout(() => abrirModalActa(id), fila ? 550 : 0);
}

// ============================================================================
// ASISTENTE CCE — escaneo de discrepancias basado en reglas (sin IA externa)
// ============================================================================
function configurarAsistente() {
  const panel = document.getElementById('panelAsistente');
  const overlay = document.getElementById('asistenteOverlay');
  const btnAsistente = document.getElementById('btnAsistente');

  configurarArrastreBoton(btnAsistente);

  btnAsistente.addEventListener('click', () => {
    if (btnAsistente.dataset.arrastrado === '1') { btnAsistente.dataset.arrastrado = '0'; return; }
    panel.classList.add('is-active');
    overlay.classList.add('is-active');
    renderAsistente();
  });
  const cerrar = () => { panel.classList.remove('is-active'); overlay.classList.remove('is-active'); };
  document.getElementById('btnCerrarAsistente').addEventListener('click', cerrar);
  overlay.addEventListener('click', cerrar);

  document.getElementById('btnAsistenteActualizar').addEventListener('click', async () => {
    await cargarDatos(true);
    renderAsistente();
    mostrarToast('Datos actualizados.', 'success');
  });
  document.getElementById('btnAsistenteImportar').addEventListener('click', () => {
    cerrar();
    document.getElementById('inputExcel').click();
  });
  document.getElementById('btnAsistentePreferencias').addEventListener('click', () => {
    renderPreferenciasGraficas();
  });
  document.getElementById('btnAsistenteBuscarGraficar').addEventListener('click', () => {
    renderBuscadorGraficas();
  });

  document.getElementById('formPreguntaAsistente').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('inputPreguntaAsistente');
    const pregunta = input.value.trim();
    if (!pregunta) return;
    renderRespuestaPregunta(pregunta);
  });
}

/**
 * Lista de gráficas que se pueden personalizar, con sus opciones válidas
 * (deben coincidir con las de los <select class="selector-vista"> del HTML).
 */
const GRAFICAS_PERSONALIZABLES = [
  { target: 'chartDona', nombre: 'Conformidad general', nombrePanel: 'Conformidad general', opciones: ['dona', 'apilada', 'barras'] },
  { target: 'chartApilada', nombre: 'Actas por tipo de medida', nombrePanel: 'Actas por tipo de medida', opciones: ['apilada', 'dona', 'barras'] },
  { target: 'chartAcuerdo', nombre: 'Acuerdo vs Desacuerdo', nombrePanel: 'Acuerdo vs Desacuerdo', opciones: ['barras', 'dona', 'apilada'] },
  { target: 'chartFactor', nombre: 'Concordancia Factor Acta vs Real', nombrePanel: 'Concordancia Factor', opciones: ['barras', 'dona', 'apilada'] },
  { target: 'chartHallazgos', nombre: 'Hallazgos por aliado', nombrePanel: 'Hallazgos por aliado', opciones: ['barras', 'dona'] }
];
const NOMBRE_TIPO_GRAFICA = { barras: '📊 Barras', dona: '🍩 Dona', apilada: '▬ Apilada' };

/** Cuántas categorías tiene ahora mismo cada gráfica (para poder recomendar el tipo). */
function calcularNumCategorias(target) {
  const k = state.kpis;
  switch (target) {
    case 'chartDona': return 3; // Conforme / No conforme / Pendiente
    case 'chartApilada': return (k && k.porTipoMedida) ? k.porTipoMedida.length : 2;
    case 'chartAcuerdo': return 2; // Conforme / Desacuerdo
    case 'chartFactor': return 2; // Concuerda / No concuerda
    case 'chartHallazgos': return hallazgosPorAliadoFiltrados().length || 1;
    default: return 3;
  }
}

/**
 * Recomienda el tipo de gráfica más fácil de leer según cuántas categorías
 * hay: pocas categorías (≤4) se leen mejor como dona; muchas, como barras
 * (una dona con 8+ tajadas finitas es difícil de comparar a simple vista).
 */
function recomendarTipoGrafica(n, opciones) {
  if (n <= 4) {
    const tipo = opciones.includes('dona') ? 'dona' : (opciones.includes('apilada') ? 'apilada' : 'barras');
    return { tipo, motivo: `${n} categorías — con pocas partes, una ${NOMBRE_TIPO_GRAFICA[tipo]} se lee de un vistazo` };
  }
  return { tipo: 'barras', motivo: `${n} categorías — con varias partes, las barras comparan mejor que una dona saturada` };
}

/** El asistente pregunta, gráfica por gráfica, cómo la quieres ver — y lo recuerda. */
function renderPreferenciasGraficas() {
  const cont = document.getElementById('asistenteContenido');

  let html = `<div class="asistente-resumen">
    <span class="emoji">🎨</span>
    <div><strong>¿Cómo quieres ver cada gráfica?</strong>
    <span>Te marco con ⭐ la que recomiendo — y tu elección se guarda</span></div>
  </div>`;

  GRAFICAS_PERSONALIZABLES.forEach(g => {
    const actual = obtenerVistaGuardada(g.target, g.opciones[0]);
    const n = calcularNumCategorias(g.target);
    const recomendacion = recomendarTipoGrafica(n, g.opciones);
    html += `<div class="hallazgo-grupo">
      <h4>${escapeHtml(g.nombre)}
        <button type="button" class="btn-ver-panel" data-panel="${escapeHtml(g.nombrePanel)}" title="Señalar este panel en el Dashboard">👉 Ver</button>
      </h4>
      <p class="panel-note" style="margin:0 0 8px;">💡 ${escapeHtml(recomendacion.motivo)}</p>
      <div class="preferencia-opciones" data-target="${g.target}">
        ${g.opciones.map(op => `
          <button type="button" class="btn-opcion-grafica ${op === actual ? 'is-active' : ''}" data-target="${g.target}" data-tipo="${op}">
            ${NOMBRE_TIPO_GRAFICA[op]}${op === recomendacion.tipo ? ' ⭐' : ''}
          </button>`).join('')}
      </div>
    </div>`;
  });

  html += `<button class="btn btn-ghost btn-block" id="btnVolverDiagnosticoPreferencias" style="margin-top:10px;">← Volver al diagnóstico</button>`;
  cont.innerHTML = html;

  cont.querySelectorAll('.btn-ver-panel').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      irYResaltarPanel(btn.dataset.panel);
      document.getElementById('panelAsistente').classList.remove('is-active');
      document.getElementById('asistenteOverlay').classList.remove('is-active');
    });
  });

  cont.querySelectorAll('.btn-opcion-grafica').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const tipo = btn.dataset.tipo;
      localStorage.setItem('cce_vista_' + target, tipo);

      // Refleja el cambio de inmediato: en el propio panel y en el <select> del Dashboard
      cont.querySelectorAll(`.btn-opcion-grafica[data-target="${target}"]`).forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const selectDashboard = document.querySelector(`.selector-vista[data-target="${target}"]`);
      if (selectDashboard) selectDashboard.value = tipo;
      renderDashboard();
      mostrarToast(`"${GRAFICAS_PERSONALIZABLES.find(g => g.target === target).nombre}" se mostrará como ${NOMBRE_TIPO_GRAFICA[tipo]} de ahora en adelante.`, 'success');
    });
  });

  document.getElementById('btnVolverDiagnosticoPreferencias').addEventListener('click', renderAsistente);
}

// ============================================================================
// SUB-PANEL: BUSCAR Y GRAFICAR CUALQUIER CAMPO de "Datos completos"
// ============================================================================
const CAMPOS_GRAFICABLES = [
  { claves: ['aliado'], campo: 'Aliado' },
  { claves: ['ciudad'], campo: 'Ciudad' },
  { claves: ['tipo medida', 'tipo de medida'], campo: 'Tipo Medida' },
  { claves: ['tecnico', 'técnico'], campo: 'Técnico' },
  { claves: ['supervision manual', 'supervisión manual', 'manual'], campo: 'Supervisión Manual (T)' },
  { claves: ['supervision ia', 'supervisión ia', ' ia'], campo: 'Supervisión IA (U)' },
  { claves: ['acuerdo'], campo: 'Acuerdo T=U' },
  { claves: ['tipo acta', 'tipo de acta'], campo: 'Tipo de acta' },
  { claves: ['revisado'], campo: 'revisado' },
  { claves: ['score', 'puntaje'], campo: 'Score', esNumerico: true }
];
const PALETA_MULTICOLOR = ['var(--purple-500)', 'var(--orange-500)', 'var(--green-600)', 'var(--blue-600)', 'var(--red-600)', 'var(--amber-700)', 'var(--purple-900)'];

function buscarCampoGraficable(texto) {
  const q = texto.toLowerCase().trim();
  return CAMPOS_GRAFICABLES.find(c => c.claves.some(k => q.includes(k)));
}

/** Cuenta cuántas actas caen en cada valor distinto de un campo categórico. */
function agregarPorCategoria(campo) {
  const conteo = {};
  state.actas.forEach(a => {
    const v = (a[campo] || '').toString().trim() || 'Sin dato';
    conteo[v] = (conteo[v] || 0) + 1;
  });
  return Object.keys(conteo).map(k => ({ etiqueta: k, valor: conteo[k] })).sort((a, b) => b.valor - a.valor);
}

/** El sub-panel donde escribes un campo y el asistente lo busca y grafica solo. */
function renderBuscadorGraficas() {
  const cont = document.getElementById('asistenteContenido');
  cont.innerHTML = `
    <div class="asistente-resumen">
      <span class="emoji">📈</span>
      <div><strong>Busca y grafica cualquier campo</strong>
      <span>Ej: aliado, ciudad, tipo medida, técnico, score, acuerdo…</span></div>
    </div>
    <form id="formBuscadorGraficas" class="asistente-pregunta" style="padding:0 0 14px;">
      <input type="text" id="inputBuscadorGraficas" placeholder="Escribe un campo de Datos completos…">
      <button type="submit" class="btn btn-primary btn-icon">Graficar</button>
    </form>
    <div id="resultadoBuscadorGraficas"></div>
    <button class="btn btn-ghost btn-block" id="btnVolverDesdeBuscador" style="margin-top:10px;">← Volver al diagnóstico</button>
  `;
  document.getElementById('btnVolverDesdeBuscador').addEventListener('click', renderAsistente);
  document.getElementById('formBuscadorGraficas').addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = document.getElementById('inputBuscadorGraficas').value.trim();
    if (!texto) return;
    ejecutarBusquedaGrafica(texto);
  });
}

/** Encuentra el campo pedido, elige el mejor tipo de gráfica, y la dibuja ahí mismo dentro del asistente. */
function ejecutarBusquedaGrafica(texto) {
  const resultadoCont = document.getElementById('resultadoBuscadorGraficas');
  const campoInfo = buscarCampoGraficable(texto);

  if (!campoInfo) {
    resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">🤔</span>
      No reconozco "${escapeHtml(texto)}". Prueba con: aliado, ciudad, tipo medida, técnico,
      supervisión manual, supervisión IA, acuerdo, tipo de acta, revisado, o score.</div>`;
    return;
  }

  const idContenedor = 'graficaBusquedaResultado';

  if (campoInfo.esNumerico) {
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>${escapeHtml(campoInfo.campo)} <span class="severidad-pill sev-baja">histograma</span></h4>
      <p class="panel-note" style="margin:0 0 10px;">💡 Es un valor numérico — un histograma muestra mejor cómo se distribuye que una dona o barras por valor único.</p>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
    </div>`;
    renderHistograma(idContenedor);
    return;
  }

  const datos = agregarPorCategoria(campoInfo.campo);
  if (!datos.length) {
    resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">📭</span>No hay datos cargados en "${escapeHtml(campoInfo.campo)}" todavía.</div>`;
    return;
  }
  const rec = recomendarTipoGrafica(datos.length, ['dona', 'apilada', 'barras']);

  resultadoCont.innerHTML = `<div class="hallazgo-grupo">
    <h4>${escapeHtml(campoInfo.campo)} <span class="severidad-pill sev-baja">${datos.length} valores</span></h4>
    <p class="panel-note" style="margin:0 0 10px;">💡 ${escapeHtml(rec.motivo)} — mostrando como ${NOMBRE_TIPO_GRAFICA[rec.tipo]}</p>
    <div id="${idContenedor}" class="chart-svg-wrap"></div>
  </div>`;

  const coloreados = datos.map((d, i) => ({ ...d, color: PALETA_MULTICOLOR[i % PALETA_MULTICOLOR.length] }));
  if (rec.tipo === 'dona') {
    renderDona(idContenedor, coloreados);
  } else if (rec.tipo === 'apilada') {
    renderBarraApilada(idContenedor, coloreados);
  } else {
    const max = Math.max(...datos.map(d => d.valor), 1);
    renderBarras(idContenedor, datos.map(d => ({ etiqueta: d.etiqueta, valor: d.valor, texto: String(d.valor) })), max);
  }
}

/**
 * Deja arrastrar el botón flotante del asistente a cualquier parte de la
 * pantalla (mouse y touch), recordando la última posición elegida.
 */
function configurarArrastreBoton(btn) {
  const posGuardada = JSON.parse(localStorage.getItem('cce_asistente_pos') || 'null');
  if (posGuardada) {
    btn.style.left = posGuardada.left + 'px';
    btn.style.top = posGuardada.top + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }

  let arrastrando = false, offsetX = 0, offsetY = 0, movioLoSuficiente = false;

  const iniciar = (clientX, clientY) => {
    const rect = btn.getBoundingClientRect();
    offsetX = clientX - rect.left;
    offsetY = clientY - rect.top;
    arrastrando = true;
    movioLoSuficiente = false;
  };

  const mover = (clientX, clientY) => {
    if (!arrastrando) return;
    movioLoSuficiente = true;
    let left = clientX - offsetX;
    let top = clientY - offsetY;
    left = Math.max(4, Math.min(window.innerWidth - btn.offsetWidth - 4, left));
    top = Math.max(4, Math.min(window.innerHeight - btn.offsetHeight - 4, top));
    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  };

  const terminar = () => {
    if (!arrastrando) return;
    arrastrando = false;
    if (movioLoSuficiente) {
      btn.dataset.arrastrado = '1'; // evita que el click de soltar abra el panel
      const rect = btn.getBoundingClientRect();
      localStorage.setItem('cce_asistente_pos', JSON.stringify({ left: rect.left, top: rect.top }));
    }
  };

  btn.addEventListener('mousedown', (e) => { iniciar(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', (e) => mover(e.clientX, e.clientY));
  document.addEventListener('mouseup', terminar);

  btn.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; iniciar(t.clientX, t.clientY);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!arrastrando) return;
    const t = e.touches[0]; mover(t.clientX, t.clientY);
  }, { passive: true });
  document.addEventListener('touchend', terminar);
}

/** Recorre las actas cargadas y agrupa discrepancias por tipo, con severidad. */
function ejecutarDiagnostico() {
  const grupos = [];

  const r01 = state.actas.filter(a => (a['R01 Tensión'] || '').toString().toUpperCase() === 'FALLA');
  if (r01.length) grupos.push({
    titulo: 'Tensión inconsistente (R01)', icono: '⚡', severidad: 'alta',
    items: r01.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`,
      detalle: `${a['Ciudad']} · Serie ${a['Serie Medidor']} · ${a['Tipo Medida']}` }))
  });

  // Patrón conocido "indirecta con tensión digitada en baja" — esto NO se
  // corrige solo (el valor real hay que confirmarlo con la foto), pero sí se
  // le puede generar al aliado una nota lista para copiar y enviarle, para
  // que no repita el mismo error de digitación en futuras actas.
  const patronVServicioBaja = state.actas.filter(a => {
    if ((a['R01 Tensión'] || '').toString().toUpperCase() !== 'FALLA') return false;
    if ((a['Tipo Medida'] || '').toLowerCase() !== 'indirecta') return false;
    const vServ = parseFloat(a['V. Servicio']), vAlta = parseFloat(a['V. Alta Trafo']);
    return !isNaN(vServ) && !isNaN(vAlta) && vServ < 100 && vAlta >= 1;
  });
  if (patronVServicioBaja.length) grupos.push({
    titulo: 'Patrón de digitación — avisar al aliado (no se corrige solo)', icono: '📣', severidad: 'alta',
    items: patronVServicioBaja.map(a => ({
      id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']} (Técnico: ${a['Técnico'] || 'sin dato'})`,
      detalle: `V. Servicio quedó en ${a['V. Servicio']} (parece ser la tensión de BAJA). En indirecta debe ir la tensión por ALTA (${a['V. Alta Trafo']}).`,
      notaAliado: `Estimado equipo de ${a['Aliado']}: en el acta #${a['#']} (Serie ${a['Serie Medidor'] || 'N/D'}, técnico ${a['Técnico'] || 'N/D'}), la "Tensión del Servicio" quedó registrada en ${a['V. Servicio']}, que corresponde a la tensión por BAJA. Para medida indirecta, ese campo debe llevar la tensión por ALTA (en este caso ${a['V. Alta Trafo']}). Por favor verificar en campo y tenerlo en cuenta en las próximas instalaciones para evitar que se repita. Gracias.`
    }))
  });

  const r03 = state.actas.filter(a => {
    const v = (a['R03 Formato'] || '').toString().toUpperCase();
    return v && v !== 'OK' && v !== 'PENDIENTE';
  });
  if (r03.length) grupos.push({
    titulo: 'Formato de tensión (R03)', icono: '📏', severidad: 'media',
    items: r03.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`, detalle: a['R03 Formato'] }))
  });

  const factorMismatch = [];
  state.actas.forEach(a => {
    const acta = a['Factor acta (K)'], real = a['Factor real (L)'];
    if (acta === undefined || acta === '' || real === undefined || real === '') return;
    if (String(real).trim().toLowerCase() === 'ok') return;
    const an = parseFloat(acta), rn = parseFloat(real);
    if (isNaN(an) || isNaN(rn) || an === rn) return;
    factorMismatch.push(a);
  });
  if (factorMismatch.length) grupos.push({
    titulo: 'Factor acta ≠ Factor real', icono: '🔢', severidad: 'alta',
    items: factorMismatch.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`,
      detalle: `Acta: ${a['Factor acta (K)']} · Real: ${a['Factor real (L)']}` }))
  });

  const grupoDuplicados = {};
  state.actas.forEach(a => {
    if (!a['Serie Medidor']) return;
    const clave = [a['Fecha'], a['Ciudad'], a['Serie Medidor']]
      .map(v => String(v || '').trim().toLowerCase()).join('|');
    (grupoDuplicados[clave] = grupoDuplicados[clave] || []).push(a);
  });
  const duplicados = Object.values(grupoDuplicados).filter(arr => arr.length > 1);
  if (duplicados.length) grupos.push({
    titulo: 'Duplicadas por fecha/ciudad/serie', icono: '🧩', severidad: 'alta',
    items: duplicados.map(arr => ({
      id: arr[0]['#'],
      idsEliminables: arr.slice(1).map(a => a['#']), // se conserva la primera, se ofrece borrar el resto
      texto: `${arr.length} actas con misma fecha/ciudad/serie — ${arr[0]['Aliado']}`,
      detalle: `# ${arr.map(a => a['#']).join(', ')} · ${normalizarFechaCliente(arr[0]['Fecha'])} · Serie ${arr[0]['Serie Medidor']}` }))
  });

  // Duplicados por Order ID: mismo Order ID + misma Fecha + misma Ciudad = duplicado real.
  // Mismo Order ID pero fecha distinta puede ser un re-trámite legítimo del mismo servicio,
  // así que se marca por separado con severidad más baja para no generar falsas alarmas.
  const grupoOrderId = {};
  state.actas.forEach(a => {
    const orderId = (a['Order ID'] || '').toString().trim();
    if (!orderId) return;
    (grupoOrderId[orderId.toLowerCase()] = grupoOrderId[orderId.toLowerCase()] || []).push(a);
  });
  const ordenesRepetidas = Object.values(grupoOrderId).filter(arr => arr.length > 1);
  const ordenesDuplicadasReales = [], ordenesReTramite = [];
  ordenesRepetidas.forEach(arr => {
    const mismaFechaCiudad = arr.every(a =>
      normalizarFechaCliente(a['Fecha']) === normalizarFechaCliente(arr[0]['Fecha']) &&
      (a['Ciudad'] || '') === (arr[0]['Ciudad'] || ''));
    (mismaFechaCiudad ? ordenesDuplicadasReales : ordenesReTramite).push(arr);
  });
  if (ordenesDuplicadasReales.length) grupos.push({
    titulo: 'Order ID duplicado (misma fecha)', icono: '🆔', severidad: 'alta',
    items: ordenesDuplicadasReales.map(arr => ({
      id: arr[0]['#'],
      idsEliminables: arr.slice(1).map(a => a['#']),
      texto: `${arr.length} actas con el mismo Order ID — ${arr[0]['Aliado']}`,
      detalle: `# ${arr.map(a => a['#']).join(', ')} · Order ID ${arr[0]['Order ID']}` }))
  });
  if (ordenesReTramite.length) grupos.push({
    titulo: 'Order ID repetido en otra fecha (revisar si es re-trámite)', icono: '🔁', severidad: 'media',
    items: ordenesReTramite.map(arr => ({
      id: arr[0]['#'],
      texto: `${arr.length} actas — ${arr[0]['Aliado']}`,
      detalle: `# ${arr.map(a => a['#']).join(', ')} · fechas: ${arr.map(a => normalizarFechaCliente(a['Fecha'])).join(', ')}` }))
  });

  const incompletas = state.actas.filter(a => !a['Serie Medidor'] || a['Factor acta (K)'] === '' || a['Factor acta (K)'] === undefined);
  if (incompletas.length) grupos.push({
    titulo: 'Campos incompletos', icono: '📋', severidad: 'media',
    items: incompletas.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`,
      detalle: 'Falta Serie Medidor o Factor acta (K)' }))
  });

  // Pendientes de supervisión manual, separando las más antiguas (más urgentes)
  const HOY = new Date();
  const pendientes = state.actas.filter(a => (a['Supervisión Manual (T)'] || '') === 'PENDIENTE');
  const pendientesAntiguos = pendientes.filter(a => {
    const f = normalizarFechaCliente(a['Fecha']);
    if (!f) return false;
    const dias = Math.floor((HOY - new Date(f)) / 86400000);
    return dias > 15;
  });
  if (pendientesAntiguos.length) grupos.push({
    titulo: 'Pendientes con más de 15 días sin revisar', icono: '⏰', severidad: 'alta',
    items: pendientesAntiguos.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`,
      detalle: `Registrada el ${normalizarFechaCliente(a['Fecha'])} — lleva más de 15 días esperando revisión` }))
  });
  const pendientesRecientes = pendientes.filter(a => !pendientesAntiguos.includes(a));
  if (pendientesRecientes.length) grupos.push({
    titulo: 'Pendientes de supervisión manual', icono: '⏳', severidad: 'baja',
    items: pendientesRecientes.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`,
      detalle: normalizarFechaCliente(a['Fecha']) }))
  });

  // Outliers: Score muy por debajo del promedio de su mismo tipo de medida
  const scorePorTipo = {};
  state.actas.forEach(a => {
    const tipo = (a['Tipo Medida'] || '').trim();
    const s = parseFloat(a['Score']);
    if (!tipo || isNaN(s)) return;
    (scorePorTipo[tipo] = scorePorTipo[tipo] || []).push(s);
  });
  const promedioPorTipo = {};
  Object.keys(scorePorTipo).forEach(t => {
    promedioPorTipo[t] = scorePorTipo[t].reduce((s, v) => s + v, 0) / scorePorTipo[t].length;
  });
  const outliers = state.actas.filter(a => {
    const tipo = (a['Tipo Medida'] || '').trim();
    const s = parseFloat(a['Score']);
    if (!tipo || isNaN(s) || promedioPorTipo[tipo] === undefined) return false;
    return s <= promedioPorTipo[tipo] - 20;
  });
  if (outliers.length) grupos.push({
    titulo: 'Score muy por debajo del promedio de su tipo', icono: '📉', severidad: 'media',
    items: outliers.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`,
      detalle: `Score ${a['Score']} vs promedio ${promedioPorTipo[(a['Tipo Medida']||'').trim()].toFixed(1)} de "${a['Tipo Medida']}"` }))
  });

  // Cruce Hallazgo (formulario) vs Supervisión Manual: si hay un hallazgo reportado
  // para esa serie pero la Manual dice CONFORME, hay una posible inconsistencia.
  if (state.hallazgosDetalle && state.hallazgosDetalle.length) {
    const seriesConHallazgo = new Set(state.hallazgosDetalle.map(h => (h.serie || '').toString().trim()).filter(Boolean));
    const inconsistentes = state.actas.filter(a =>
      seriesConHallazgo.has((a['Serie Medidor'] || '').toString().trim()) &&
      (a['Supervisión Manual (T)'] || '') === 'CONFORME'
    );
    if (inconsistentes.length) grupos.push({
      titulo: 'Hallazgo reportado pero Manual dice CONFORME', icono: '🧭', severidad: 'media',
      items: inconsistentes.map(a => ({ id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']}`,
        detalle: `Serie ${a['Serie Medidor']} tiene un hallazgo en el formulario, pero quedó marcada CONFORME` }))
    });
  }

  // Patrón repetido: mismo aliado con el mismo tipo de falla 3+ veces (candidato a capacitación)
  const patronesPorAliado = {};
  state.actas.forEach(a => {
    const aliado = a['Aliado'];
    if (!aliado) return;
    ['R01 Tensión', 'R03 Formato'].forEach(campo => {
      const v = (a[campo] || '').toString().toUpperCase();
      if (v && v !== 'OK' && v !== 'PENDIENTE') {
        const clave = aliado + '|' + campo;
        (patronesPorAliado[clave] = patronesPorAliado[clave] || []).push(a);
      }
    });
  });
  const patronesFrecuentes = Object.entries(patronesPorAliado).filter(([, arr]) => arr.length >= 3);
  if (patronesFrecuentes.length) grupos.push({
    titulo: 'Patrón repetido — candidato a capacitación', icono: '🎓', severidad: 'media',
    items: patronesFrecuentes.map(([clave, arr]) => {
      const [aliado, campo] = clave.split('|');
      return { id: arr[0]['#'], texto: `${aliado} — ${campo} fallando ${arr.length} veces`,
        detalle: `Actas # ${arr.map(a => a['#']).join(', ')}` };
    })
  });

  return grupos;
}

function renderAsistente() {
  const cont = document.getElementById('asistenteContenido');
  const grupos = ejecutarDiagnostico();
  const totalItems = grupos.reduce((s, g) => s + g.items.length, 0);
  const criticos = grupos.filter(g => g.severidad === 'alta').reduce((s, g) => s + g.items.length, 0);

  if (!totalItems) {
    cont.innerHTML = `<div class="asistente-vacio"><span class="emoji">🎉</span>
      No encontré discrepancias en las ${state.actas.length} actas cargadas. ¡Cero estrés!</div>`;
    return;
  }

  const emoji = criticos > 0 ? '🔎' : '🙂';
  let html = `<div class="asistente-resumen">
    <span class="emoji">${emoji}</span>
    <div><strong>${totalItems} hallazgo(s) en ${grupos.length} categoría(s)</strong>
    <span>${criticos ? criticos + ' de atención prioritaria' : 'nada urgente, solo revisiones pendientes'}</span></div>
  </div>`;

  grupos.forEach(g => {
    html += `<div class="hallazgo-grupo">
      <h4>${g.icono} ${escapeHtml(g.titulo)} <span class="severidad-pill sev-${g.severidad}">${g.items.length}</span></h4>`;
    g.items.slice(0, 25).forEach((it, idx) => {
      const puedeEliminar = it.idsEliminables && it.idsEliminables.length;
      const tieneNota = it.notaAliado;
      html += `<div class="hallazgo-item sev-${g.severidad}" data-acta-id="${it.id}">
        <b>${escapeHtml(it.texto)}</b>
        <span class="hallazgo-detalle">${escapeHtml(it.detalle)}</span>
        ${puedeEliminar ? `<button class="btn-eliminar-duplicado" type="button"
            data-ids="${it.idsEliminables.join(',')}" data-grupo="${g.titulo}-${idx}">
            🗑 Conservar #${it.id} y eliminar ${it.idsEliminables.length} duplicado(s)</button>` : ''}
        ${tieneNota ? `<button class="btn-copiar-nota" type="button" data-nota="${escapeHtml(it.notaAliado)}">
            📣 Copiar nota para el aliado</button>` : ''}
      </div>`;
    });
    if (g.items.length > 25) html += `<p class="panel-note">…y ${g.items.length - 25} más.</p>`;
    html += `</div>`;
  });

  cont.innerHTML = html;

  cont.querySelectorAll('.hallazgo-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.btn-eliminar-duplicado') || e.target.closest('.btn-copiar-nota')) return;
      const id = Number(el.dataset.actaId);
      document.getElementById('panelAsistente').classList.remove('is-active');
      document.getElementById('asistenteOverlay').classList.remove('is-active');
      irYResaltarActa(id);
    });
  });

  cont.querySelectorAll('.btn-eliminar-duplicado').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ids = btn.dataset.ids.split(',').map(Number).filter(Boolean);
      if (!confirm(`¿Eliminar ${ids.length} acta(s) duplicada(s) (# ${ids.join(', ')})? Esta acción no se puede deshacer.`)) return;

      btn.disabled = true;
      btn.textContent = 'Eliminando…';
      try {
        for (const id of ids) {
          await postAccion('deleteActa', { id });
        }
        mostrarToast(`${ids.length} duplicado(s) eliminado(s).`, 'success');
        await cargarDatos(false);
        renderAsistente();
      } catch (err) {
        mostrarToast('Error al eliminar: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '🗑 Reintentar';
      }
    });
  });

  cont.querySelectorAll('.btn-copiar-nota').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nota = btn.dataset.nota;
      try {
        await navigator.clipboard.writeText(nota);
        btn.textContent = '✅ Copiada — pégala en tu correo o chat';
        mostrarToast('Nota copiada al portapapeles.', 'success');
        setTimeout(() => { btn.textContent = '📣 Copiar nota para el aliado'; }, 2500);
      } catch (err) {
        // Si el navegador bloquea el portapapeles, se muestra para copiar a mano
        prompt('Copia este texto manualmente (Ctrl+C):', nota);
      }
    });
  });
}

/**
 * Interpreta una pregunta en lenguaje natural sencillo (por palabras clave,
 * no es un modelo de IA) y devuelve las actas que coinciden con lo detectado:
 * aliado, ciudad, tipo de medida, estado (desacuerdo/conforme/pendiente),
 * mes/año, o número de acta puntual.
 */
function interpretarPregunta(textoOriginal) {
  const q = textoOriginal.toLowerCase().trim();
  let resultado = state.actas.slice();
  const criterios = [];

  const aliados = [...new Set(state.actas.map(a => a['Aliado']).filter(Boolean))];
  const aliadoMatch = aliados.find(al => q.includes(al.toLowerCase())) ||
    aliados.find(al => al.toLowerCase().split(' ').some(palabra => palabra.length > 3 && q.includes(palabra)));
  if (aliadoMatch) { resultado = resultado.filter(a => a['Aliado'] === aliadoMatch); criterios.push(`aliado: ${aliadoMatch}`); }

  const ciudades = [...new Set(state.actas.map(a => a['Ciudad']).filter(Boolean))];
  const ciudadMatch = ciudades.find(c => q.includes(c.toLowerCase()));
  if (ciudadMatch) { resultado = resultado.filter(a => a['Ciudad'] === ciudadMatch); criterios.push(`ciudad: ${ciudadMatch}`); }

  ['semidirecta', 'indirecta', 'directa'].forEach(t => {
    if (q.includes(t)) { resultado = resultado.filter(a => (a['Tipo Medida'] || '').toLowerCase() === t); criterios.push(`tipo: ${t}`); }
  });

  if (q.includes('desacuerdo')) { resultado = resultado.filter(a => (a['Acuerdo T=U'] || '') === 'DESACUERDO'); criterios.push('desacuerdo T≠U'); }
  if (q.includes('no conform')) { resultado = resultado.filter(a => (a['Supervisión Manual (T)'] || '') === 'NO CONFORMIDAD'); criterios.push('no conformidad'); }
  else if (q.includes('conforme')) { resultado = resultado.filter(a => (a['Supervisión Manual (T)'] || '') === 'CONFORME'); criterios.push('conforme'); }
  if (q.includes('pendiente')) { resultado = resultado.filter(a => (a['Supervisión Manual (T)'] || '') === 'PENDIENTE'); criterios.push('pendiente'); }
  if (q.includes('revisad')) { resultado = resultado.filter(a => (a['revisado'] || '').trim() !== ''); criterios.push('revisadas'); }

  const meses = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };
  const mesEncontrado = Object.keys(meses).find(m => q.includes(m));
  if (mesEncontrado) {
    const mm = meses[mesEncontrado];
    resultado = resultado.filter(a => normalizarFechaCliente(a['Fecha']).slice(5, 7) === mm);
    criterios.push(`mes: ${mesEncontrado}`);
  }
  const anioMatch = q.match(/20\d{2}/);
  if (anioMatch) { resultado = resultado.filter(a => normalizarFechaCliente(a['Fecha']).startsWith(anioMatch[0])); criterios.push(`año: ${anioMatch[0]}`); }

  const actaNumMatch = q.match(/acta\s*#?\s*(\d+)|#\s*(\d+)/);
  if (actaNumMatch) {
    const num = Number(actaNumMatch[1] || actaNumMatch[2]);
    resultado = resultado.filter(a => Number(a['#']) === num);
    criterios.push(`# ${num}`);
  }

  // Técnico (igual que aliado: coincidencia por nombre completo o por una palabra distintiva)
  const tecnicos = [...new Set(state.actas.map(a => a['Técnico']).filter(Boolean))];
  const tecnicoMatch = tecnicos.find(t => q.includes(t.toLowerCase())) ||
    tecnicos.find(t => t.toLowerCase().split(' ').some(palabra => palabra.length > 3 && q.includes(palabra)));
  if (tecnicoMatch) { resultado = resultado.filter(a => a['Técnico'] === tecnicoMatch); criterios.push(`técnico: ${tecnicoMatch}`); }

  // Serie de medidor u Order ID: números largos (5+ dígitos) o UUID
  const uuidMatch = q.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    resultado = resultado.filter(a => (a['Order ID'] || '').toLowerCase() === uuidMatch[0].toLowerCase());
    criterios.push(`Order ID: ${uuidMatch[0]}`);
  }
  const serieMatch = q.match(/\b\d{5,}\b/);
  if (serieMatch && !actaNumMatch) {
    resultado = resultado.filter(a => (a['Serie Medidor'] || '').toString().includes(serieMatch[0]));
    criterios.push(`serie medidor: ${serieMatch[0]}`);
  }

  // Reglas R01-R07: "r01 falla", "sellos pendiente", "caja falla", etc.
  const reglas = [
    { claves: ['r01', 'tension', 'tensión'], campo: 'R01 Tensión' },
    { claves: ['r03', 'formato'], campo: 'R03 Formato' },
    { claves: ['r04', 'foto serial'], campo: 'R04 Foto Serial' },
    { claves: ['r05', 'foto sistema'], campo: 'R05 Foto Sistema' },
    { claves: ['r06', 'sello'], campo: 'R06 Sellos' },
    { claves: ['r07', 'caja'], campo: 'R07 Caja' }
  ];
  reglas.forEach(regla => {
    if (regla.claves.some(k => q.includes(k))) {
      if (q.includes('falla')) { resultado = resultado.filter(a => (a[regla.campo] || '').toString().toUpperCase().includes('FALLA')); criterios.push(`${regla.campo}: FALLA`); }
      else if (q.includes('pendiente')) { resultado = resultado.filter(a => (a[regla.campo] || '').toString().toUpperCase() === 'PENDIENTE'); criterios.push(`${regla.campo}: PENDIENTE`); }
      else if (q.includes(' ok') || q.endsWith('ok')) { resultado = resultado.filter(a => (a[regla.campo] || '').toString().toUpperCase() === 'OK'); criterios.push(`${regla.campo}: OK`); }
    }
  });

  // Respaldo: si no se detectó ningún criterio específico, se busca el texto tal
  // cual en TODOS los campos de texto libre (igual que el buscador de la tabla),
  // para que nunca se quede sin buscar algo si no coincide con las reglas de arriba.
  if (!criterios.length) {
    const haystackCampos = ['Aliado', 'Técnico', 'Ciudad', 'Serie Medidor', 'Order ID', 'Fallos Detectados', 'Tipo de acta', 'Tipo Medida'];
    resultado = resultado.filter(a => haystackCampos.some(c => (a[c] || '').toString().toLowerCase().includes(q)));
    if (resultado.length) criterios.push(`texto libre: "${textoOriginal.trim()}"`);
  }

  const esPromedio = /promedio|score/.test(q);
  const esConteo = /cu[aá]nt[oa]s?/.test(q);

  return { resultado, criterios, esPromedio, esConteo };
}

function renderRespuestaPregunta(pregunta) {
  const { resultado, criterios, esPromedio, esConteo } = interpretarPregunta(pregunta);
  const cont = document.getElementById('asistenteContenido');

  let html = `<div class="asistente-resumen">
    <span class="emoji">💬</span>
    <div><strong>"${escapeHtml(pregunta)}"</strong>
    <span>${criterios.length ? 'Detecté: ' + criterios.join(' · ') : 'No detecté filtros específicos, muestro coincidencias generales'}</span></div>
  </div>`;

  if (esPromedio) {
    const scores = resultado.map(a => parseFloat(a['Score'])).filter(n => !isNaN(n));
    const prom = scores.length ? (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1) : '—';
    html += `<div class="asistente-resumen"><span class="emoji">📊</span>
      <div><strong>Score promedio: ${prom}</strong><span>calculado sobre ${resultado.length} acta(s)</span></div></div>`;
  } else if (esConteo) {
    html += `<div class="asistente-resumen"><span class="emoji">🔢</span>
      <div><strong>${resultado.length} acta(s) encontradas</strong></div></div>`;
  }

  if (!resultado.length) {
    html += `<div class="asistente-vacio"><span class="emoji">🤔</span>
      No encontré actas que coincidan. Prueba mencionando un aliado, ciudad, tipo de medida
      (semidirecta/indirecta/directa), un mes, un estado (desacuerdo, conforme, pendiente) o un número de acta (#42).</div>`;
  } else {
    html += `<div class="hallazgo-grupo"><h4>📄 Resultados <span class="severidad-pill sev-baja">${resultado.length}</span></h4>`;
    resultado.slice(0, 40).forEach(a => {
      html += `<div class="hallazgo-item" data-acta-id="${a['#']}">
        <b>Acta #${a['#']} — ${escapeHtml(a['Aliado'])}</b>
        <span class="hallazgo-detalle">${escapeHtml(a['Ciudad'])} · ${escapeHtml(a['Tipo Medida'])} · ${escapeHtml(normalizarFechaCliente(a['Fecha']))} · Score ${escapeHtml(a['Score'])}</span>
      </div>`;
    });
    if (resultado.length > 40) html += `<p class="panel-note">…y ${resultado.length - 40} más — afina la pregunta para acotar.</p>`;
    html += `</div>`;
  }

  html += `<button class="btn btn-ghost btn-block" id="btnVolverDiagnostico" style="margin-top:10px;">← Volver al diagnóstico</button>`;
  cont.innerHTML = html;

  cont.querySelectorAll('.hallazgo-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.actaId);
      document.getElementById('panelAsistente').classList.remove('is-active');
      document.getElementById('asistenteOverlay').classList.remove('is-active');
      irYResaltarActa(id);
    });
  });

  document.getElementById('btnVolverDiagnostico').addEventListener('click', () => {
    document.getElementById('inputPreguntaAsistente').value = '';
    renderAsistente();
  });
}

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
    state.hallazgosDetalle = data.hallazgosDetalle || [];

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

  renderPanelFlexible('chartDona', [
    { etiqueta: 'Conforme', valor: k.conformesManual, clase: 'success' },
    { etiqueta: 'No conforme', valor: k.noConformesManual, clase: 'danger' },
    { etiqueta: 'Pendiente', valor: k.pendientesManual, clase: 'accent' }
  ], 'dona');

  renderLineaTendencia('chartLinea', calcularActasPorMes());
  renderAreaChart('chartArea', calcularScorePromedioPorMes(), '');
  renderHistograma('chartHistograma');

  renderPanelFlexible('chartApilada', k.porTipoMedida.map((t, i) => ({
    etiqueta: t.tipo, valor: t.actas, clase: ['', 'accent', 'success'][i % 3]
  })), 'apilada');

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
  renderPanelFlexible('chartAcuerdo', [
    { etiqueta: 'CONFORME (T=U)', valor: k.acuerdos, clase: 'success' },
    { etiqueta: 'DESACUERDO (T≠U)', valor: k.desacuerdos, clase: 'danger' }
  ], 'barras');

  // Concordancia Factor Acta (K) vs Factor Real (L) — calculado de las actas
  const factor = calcularConcordanciaFactor();
  renderPanelFlexible('chartFactor', [
    { etiqueta: 'Concuerda', valor: factor.concuerda, clase: 'success' },
    { etiqueta: 'No concuerda', valor: factor.noConcuerda, clase: 'danger' }
  ], 'barras');

  // Hallazgos por aliado (opcional — solo si la pestaña "Hallazgos" existe)
  const panelHallazgos = document.getElementById('panelHallazgos');
  if (state.hallazgosPorAliado && state.hallazgosPorAliado.length) {
    panelHallazgos.style.display = '';
    const porAliado = hallazgosPorAliadoFiltrados();
    if (porAliado.length) {
      renderPanelFlexible('chartHallazgos', porAliado.map(h => ({
        etiqueta: h.aliado, valor: h.hallazgos, clase: 'accent'
      })), 'barras');
    } else {
      renderBarras('chartHallazgos', [], 1);
    }
  } else {
    panelHallazgos.style.display = 'none';
  }
}

/**
 * Recalcula "hallazgos por aliado" aplicando el filtro de Tipo de Medida
 * (semidirecta/indirecta), cruzando cada hallazgo (por Serie Medidor) con
 * el Tipo de Medida registrado en la hoja de actas.
 */
function hallazgosPorAliadoFiltrados() {
  if (!state.filtroHallazgosTipo) return state.hallazgosPorAliado;
  if (!state.hallazgosDetalle || !state.hallazgosDetalle.length) return state.hallazgosPorAliado;

  const serieATipo = {};
  state.actas.forEach(a => {
    const serie = (a['Serie Medidor'] || '').toString().trim();
    if (serie) serieATipo[serie] = (a['Tipo Medida'] || '').toString().trim().toLowerCase();
  });

  const conteo = {};
  state.hallazgosDetalle.forEach(h => {
    const tipo = serieATipo[(h.serie || '').toString().trim()];
    if (tipo !== state.filtroHallazgosTipo) return; // no coincide el tipo de medida, o el medidor no se encontró en Datos
    conteo[h.aliado] = (conteo[h.aliado] || 0) + 1;
  });

  return Object.keys(conteo)
    .map(aliado => ({ aliado, hallazgos: conteo[aliado] }))
    .sort((a, b) => b.hallazgos - a.hallazgos);
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

/**
 * Gráfico de dona (pastel con hueco) — el más fácil de leer para mostrar
 * proporciones de un total (ej. cuántas actas están conformes/pendientes).
 * segmentos: [{ etiqueta, valor, color }], total opcional (si no, se suma).
 */
function renderDona(contenedorId, segmentos, total) {
  const cont = document.getElementById(contenedorId);
  const suma = total || segmentos.reduce((s, x) => s + x.valor, 0);
  if (!suma) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }

  const r = 60, cx = 80, cy = 80, grosor = 22;
  const circunferencia = 2 * Math.PI * r;
  let acumulado = 0;

  const arcos = segmentos.filter(s => s.valor > 0).map(s => {
    const pct = s.valor / suma;
    const largo = pct * circunferencia;
    const offset = -acumulado * circunferencia;
    acumulado += pct;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:${s.color}"
      stroke-width="${grosor}" stroke-dasharray="${largo} ${circunferencia - largo}"
      stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
  }).join('');

  const svg = `<svg viewBox="0 0 160 160" width="180" height="180">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--ink-100)" stroke-width="${grosor}"></circle>
    ${arcos}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="dona-centro-valor">${suma}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="dona-centro-label">actas</text>
  </svg>`;

  const leyenda = segmentos.map(s => `
    <span class="chart-leyenda-item">
      <span class="chart-leyenda-dot" style="background:${s.color}"></span>
      ${escapeHtml(s.etiqueta)}: <b>${s.valor}</b> (${suma ? ((s.valor / suma) * 100).toFixed(0) : 0}%)
    </span>`).join('');

  cont.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">${svg}<div class="chart-leyenda">${leyenda}</div></div>`;
}

/** Agrupa las actas cargadas por mes (YYYY-MM) y cuenta cuántas hay en cada uno. */
function calcularActasPorMes() {
  const conteo = {};
  state.actas.forEach(a => {
    const mes = normalizarFechaCliente(a['Fecha']).slice(0, 7); // "2026-07"
    if (!mes) return;
    conteo[mes] = (conteo[mes] || 0) + 1;
  });
  return Object.keys(conteo).sort().map(mes => ({ mes, cantidad: conteo[mes] }));
}

/**
 * Gráfico de línea — el más fácil de leer para mostrar una tendencia en el
 * tiempo (ej. cuántas actas se registraron cada mes).
 * puntos: [{ mes: "2026-07", cantidad: 12 }]
 */
function renderLineaTendencia(contenedorId, puntos) {
  const cont = document.getElementById(contenedorId);
  if (!puntos.length) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }

  const w = 320, h = 160, padding = 26;
  const max = Math.max(...puntos.map(p => p.cantidad), 1);
  const pasoX = puntos.length > 1 ? (w - padding * 2) / (puntos.length - 1) : 0;

  const coords = puntos.map((p, i) => {
    const x = padding + i * pasoX;
    const y = h - padding - (p.cantidad / max) * (h - padding * 2);
    return { x, y, p };
  });

  const linea = coords.map(c => `${c.x},${c.y}`).join(' ');
  const area = `${padding},${h - padding} ${linea} ${coords[coords.length - 1].x},${h - padding}`;

  const puntosSvg = coords.map(c => `
    <circle cx="${c.x}" cy="${c.y}" r="4" fill="var(--purple-500)"></circle>
    <text x="${c.x}" y="${c.y - 10}" text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--ink-700)">${c.p.cantidad}</text>
    <text x="${c.x}" y="${h - 8}" text-anchor="middle" font-size="9.5" fill="var(--ink-500)">${c.p.mes.slice(5)}/${c.p.mes.slice(2, 4)}</text>
  `).join('');

  const svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="180" preserveAspectRatio="xMidYMid meet">
    <polygon points="${area}" fill="var(--purple-100)"></polygon>
    <polyline points="${linea}" fill="none" stroke="var(--purple-500)" stroke-width="2.5"></polyline>
    ${puntosSvg}
  </svg>`;

  cont.innerHTML = svg;
}

/** Agrupa las actas por mes y calcula el Score promedio de cada mes. */
function calcularScorePromedioPorMes() {
  const grupos = {};
  state.actas.forEach(a => {
    const mes = normalizarFechaCliente(a['Fecha']).slice(0, 7);
    const score = parseFloat(a['Score']);
    if (!mes || isNaN(score)) return;
    (grupos[mes] = grupos[mes] || []).push(score);
  });
  return Object.keys(grupos).sort().map(mes => ({
    mes, valor: grupos[mes].reduce((s, v) => s + v, 0) / grupos[mes].length
  }));
}

/**
 * Gráfica de área — como la de línea, pero pensada para mostrar la
 * evolución de un promedio/indicador (no un conteo) con el área rellena
 * dando sensación de "volumen acumulado" a simple vista.
 */
function renderAreaChart(contenedorId, puntos, sufijo) {
  const cont = document.getElementById(contenedorId);
  if (!puntos.length) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }

  const w = 320, h = 160, padding = 26;
  const max = Math.max(...puntos.map(p => p.valor), 1);
  const min = Math.min(...puntos.map(p => p.valor), 0);
  const rango = (max - min) || 1;
  const pasoX = puntos.length > 1 ? (w - padding * 2) / (puntos.length - 1) : 0;

  const coords = puntos.map((p, i) => {
    const x = padding + i * pasoX;
    const y = h - padding - ((p.valor - min) / rango) * (h - padding * 2);
    return { x, y, p };
  });

  const linea = coords.map(c => `${c.x},${c.y}`).join(' ');
  const area = `${padding},${h - padding} ${linea} ${coords[coords.length - 1].x},${h - padding}`;

  const puntosSvg = coords.map(c => `
    <circle cx="${c.x}" cy="${c.y}" r="4" fill="var(--orange-500)"></circle>
    <text x="${c.x}" y="${c.y - 10}" text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--ink-700)">${c.p.valor.toFixed(1)}${sufijo || ''}</text>
    <text x="${c.x}" y="${h - 8}" text-anchor="middle" font-size="9.5" fill="var(--ink-500)">${c.p.mes.slice(5)}/${c.p.mes.slice(2, 4)}</text>
  `).join('');

  const svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="180" preserveAspectRatio="xMidYMid meet">
    <polygon points="${area}" fill="var(--orange-100)"></polygon>
    <polyline points="${linea}" fill="none" stroke="var(--orange-500)" stroke-width="2.5"></polyline>
    ${puntosSvg}
  </svg>`;

  cont.innerHTML = svg;
}

/**
 * Histograma — agrupa el Score de todas las actas en rangos (0-59, 60-69...
 * 90-100) y muestra cuántas actas caen en cada rango. Es la forma más clara
 * de ver si tus actas se concentran en scores altos o bajos.
 */
function renderHistograma(contenedorId) {
  const cont = document.getElementById(contenedorId);
  const cortes = [
    { desde: 0, hasta: 59, etiqueta: '0-59' },
    { desde: 60, hasta: 69, etiqueta: '60-69' },
    { desde: 70, hasta: 79, etiqueta: '70-79' },
    { desde: 80, hasta: 89, etiqueta: '80-89' },
    { desde: 90, hasta: 100, etiqueta: '90-100' }
  ];
  const conteo = cortes.map(c => ({ ...c, cantidad: 0 }));

  state.actas.forEach(a => {
    const score = parseFloat(a['Score']);
    if (isNaN(score)) return;
    const bucket = conteo.find(c => score >= c.desde && score <= c.hasta);
    if (bucket) bucket.cantidad++;
  });

  if (!conteo.some(c => c.cantidad > 0)) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }

  const w = 320, h = 160, padding = 30;
  const max = Math.max(...conteo.map(c => c.cantidad), 1);
  const anchoBarra = (w - padding * 2) / conteo.length;

  const barras = conteo.map((c, i) => {
    const alturaBarra = (c.cantidad / max) * (h - padding * 2);
    const x = padding + i * anchoBarra;
    const y = h - padding - alturaBarra;
    const color = c.desde < 70 ? 'var(--red-600)' : c.desde < 90 ? 'var(--amber-700)' : 'var(--green-600)';
    return `
      <rect x="${x + 4}" y="${y}" width="${anchoBarra - 8}" height="${alturaBarra}" fill="${color}" rx="3"></rect>
      <text x="${x + anchoBarra / 2}" y="${y - 6}" text-anchor="middle" font-size="10.5" font-family="var(--font-mono)" fill="var(--ink-700)">${c.cantidad}</text>
      <text x="${x + anchoBarra / 2}" y="${h - 10}" text-anchor="middle" font-size="9.5" fill="var(--ink-500)">${c.etiqueta}</text>
    `;
  }).join('');

  cont.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="180" preserveAspectRatio="xMidYMid meet">${barras}</svg>`;
}

/**
 * Barra apilada horizontal (una sola barra dividida en tramos de color) —
 * muy fácil de leer para ver de un vistazo cómo se reparte un total entre
 * pocas categorías (ej. cuántas actas son semidirecta/indirecta/directa).
 * segmentos: [{ etiqueta, valor, color }]
 */
function renderBarraApilada(contenedorId, segmentos) {
  const cont = document.getElementById(contenedorId);
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  if (!total) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }

  const track = segmentos.filter(s => s.valor > 0).map(s => {
    const pct = (s.valor / total) * 100;
    return `<span class="apilada-segmento" style="width:${pct}%;background:${s.color}">${pct >= 8 ? pct.toFixed(0) + '%' : ''}</span>`;
  }).join('');

  const leyenda = segmentos.map(s => `
    <span class="chart-leyenda-item">
      <span class="chart-leyenda-dot" style="background:${s.color}"></span>
      ${escapeHtml(s.etiqueta)}: <b>${s.valor}</b>
    </span>`).join('');

  cont.innerHTML = `<div class="apilada-track">${track}</div><div class="chart-leyenda">${leyenda}</div>`;
}

// ============================================================================
// SELECTOR DE VISTA (Barras / Dona / Barra apilada) — recuerda la elección
// ============================================================================
const COLOR_MAP = {
  '': 'var(--purple-500)', accent: 'var(--orange-500)',
  success: 'var(--green-600)', danger: 'var(--red-600)'
};

function obtenerVistaGuardada(contenedorId, porDefecto) {
  return localStorage.getItem('cce_vista_' + contenedorId) || porDefecto;
}

/**
 * Dibuja "datos" (formato común [{etiqueta, valor, clase}]) como Barras, Dona
 * o Barra apilada, según lo que el usuario haya elegido para ese panel
 * (se recuerda en localStorage). Así una misma gráfica puede verse de la
 * forma que a cada persona le resulte más fácil de leer.
 */
function renderPanelFlexible(contenedorId, datos, porDefecto) {
  const tipo = obtenerVistaGuardada(contenedorId, porDefecto || 'barras');
  const selector = document.querySelector(`.selector-vista[data-target="${contenedorId}"]`);
  if (selector && selector.value !== tipo) selector.value = tipo;

  if (tipo === 'dona') {
    renderDona(contenedorId, datos.map(d => ({ etiqueta: d.etiqueta, valor: d.valor, color: COLOR_MAP[d.clase || ''] })));
  } else if (tipo === 'apilada') {
    renderBarraApilada(contenedorId, datos.map(d => ({ etiqueta: d.etiqueta, valor: d.valor, color: COLOR_MAP[d.clase || ''] })));
  } else {
    const max = Math.max(...datos.map(d => d.valor), 1);
    renderBarras(contenedorId, datos.map(d => ({ etiqueta: d.etiqueta, valor: d.valor, texto: String(d.valor), clase: d.clase })), max);
  }
}

function configurarSelectoresVista() {
  document.querySelectorAll('.selector-vista').forEach(sel => {
    const target = sel.dataset.target;
    sel.value = obtenerVistaGuardada(target, sel.value);
    sel.addEventListener('change', () => {
      localStorage.setItem('cce_vista_' + target, sel.value);
      renderDashboard();
    });
  });
}

// ============================================================================
// VISTAS GUARDADAS DEL DASHBOARD — qué paneles se ven + qué tipo de gráfica
// tiene cada uno, guardado en hasta 3 configuraciones distintas.
// ============================================================================
const TODOS_LOS_PANELES = [...document.querySelectorAll('#view-dashboard [data-panel-nombre]')]
  .map(el => el.dataset.panelNombre);

function obtenerPanelesVisibles() {
  try {
    const guardados = JSON.parse(localStorage.getItem('cce_paneles_visibles'));
    if (Array.isArray(guardados)) return guardados;
  } catch (e) { /* usa todos por defecto */ }
  return TODOS_LOS_PANELES.slice();
}

function guardarPanelesVisibles(nombres) {
  localStorage.setItem('cce_paneles_visibles', JSON.stringify(nombres));
}

function aplicarVisibilidadPaneles() {
  const visibles = obtenerPanelesVisibles();
  document.querySelectorAll('#view-dashboard [data-panel-nombre]').forEach(el => {
    // "Hallazgos" respeta además su propia regla (solo si hay pestaña Hallazgos) — no lo forzamos aquí.
    if (el.id === 'panelHallazgos') return;
    el.style.display = visibles.includes(el.dataset.panelNombre) ? '' : 'none';
  });
}

function configurarVistas() {
  document.getElementById('btnVistas').addEventListener('click', () => {
    pintarListaPaneles();
    pintarEstadoSlots();
    abrirModal('modalVistas');
  });
  document.getElementById('btnCerrarVistas').addEventListener('click', () => cerrarModal('modalVistas'));

  document.querySelectorAll('#modalVistas [data-accion]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.slot;
      if (btn.dataset.accion === 'guardar') guardarVista(slot);
      else cargarVista(slot);
    });
  });
}

function pintarListaPaneles() {
  const cont = document.getElementById('listaPanelesVista');
  const visibles = obtenerPanelesVisibles();
  cont.innerHTML = TODOS_LOS_PANELES.map(nombre => `
    <label><input type="checkbox" value="${escapeHtml(nombre)}" ${visibles.includes(nombre) ? 'checked' : ''}> ${escapeHtml(nombre)}</label>
  `).join('');
  cont.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const seleccionados = [...cont.querySelectorAll('input:checked')].map(c => c.value);
      guardarPanelesVisibles(seleccionados);
      aplicarVisibilidadPaneles();
    });
  });
}

function obtenerVistasGuardadas() {
  try { return JSON.parse(localStorage.getItem('cce_vistas_guardadas')) || {}; }
  catch (e) { return {}; }
}

function guardarVista(slot) {
  const vistas = obtenerVistasGuardadas();
  const tipos = {};
  document.querySelectorAll('.selector-vista').forEach(sel => { tipos[sel.dataset.target] = sel.value; });

  vistas[slot] = {
    paneles: obtenerPanelesVisibles(),
    tipos,
    columnas: obtenerColumnasVisibles(),
    guardadaEl: new Date().toLocaleString('es-CO')
  };
  localStorage.setItem('cce_vistas_guardadas', JSON.stringify(vistas));
  pintarEstadoSlots();
  mostrarToast(`Vista ${slot} guardada.`, 'success');
}

function cargarVista(slot) {
  const vistas = obtenerVistasGuardadas();
  const vista = vistas[slot];
  if (!vista) { mostrarToast(`La Vista ${slot} todavía está vacía.`, 'error'); return; }

  guardarPanelesVisibles(vista.paneles || TODOS_LOS_PANELES.slice());
  Object.keys(vista.tipos || {}).forEach(target => localStorage.setItem('cce_vista_' + target, vista.tipos[target]));
  if (vista.columnas) guardarColumnasVisibles(vista.columnas);

  aplicarVisibilidadPaneles();
  configurarSelectoresVista(); // refresca los <select> con los tipos guardados
  renderDashboard();
  renderTablaDatos();
  pintarListaPaneles();
  cerrarModal('modalVistas');
  mostrarToast(`Vista ${slot} cargada.`, 'success');
}

function pintarEstadoSlots() {
  const vistas = obtenerVistasGuardadas();
  [1, 2, 3].forEach(slot => {
    const span = document.querySelector(`.vista-slot-estado[data-estado="${slot}"]`);
    span.textContent = vistas[slot] ? `Guardada ${vistas[slot].guardadaEl}` : 'Vacía';
  });
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
  document.getElementById('filtroFechaDesde').addEventListener('change', e => {
    state.filtros.fechaDesde = e.target.value;
    renderTablaDatos();
  });
  document.getElementById('filtroFechaHasta').addEventListener('change', e => {
    state.filtros.fechaHasta = e.target.value;
    renderTablaDatos();
  });
  document.getElementById('btnLimpiarFechas').addEventListener('click', () => {
    state.filtros.fechaDesde = '';
    state.filtros.fechaHasta = '';
    document.getElementById('filtroFechaDesde').value = '';
    document.getElementById('filtroFechaHasta').value = '';
    renderTablaDatos();
  });
  document.getElementById('filtroHallazgosTipo').addEventListener('change', e => {
    state.filtroHallazgosTipo = e.target.value;
    renderDashboard();
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
      const analisis = await analizarExcel(file);

      if (!analisis.actas.length && !analisis.hojaHallazgos) {
        mostrarToast('No encontré actas (fila con "#") ni una hoja de hallazgos en este archivo.', 'error');
        return;
      }

      // Si el archivo trae solo actas (el caso más común), no interrumpimos con
      // preguntas — se sincroniza directo, como ya funcionaba.
      if (analisis.actas.length && !analisis.hojaHallazgos) {
        await confirmarYSincronizarActas(analisis.actas, btn);
        return;
      }

      // Si trae actas Y una hoja de hallazgos, dejamos que la persona elija
      // qué hacer con cada una, desde el panel del Asistente.
      preguntarQueHacerConExcel(analisis, btn);
    } catch (err) {
      mostrarToast('Error al leer el archivo: ' + err.message, 'error');
      console.error(err);
    }
  });
}

async function confirmarYSincronizarActas(actas, btn) {
  const confirmar = confirm(
    'Se encontraron ' + actas.length + ' actas en el archivo.\n' +
    'Se identifican por Fecha + Ciudad + Order ID: las que ya existan se ' +
    'actualizarán (sin duplicarse) y las nuevas se agregarán.\n\n' +
    '¿Continuar con la sincronización?'
  );
  if (!confirmar) return;

  btn.disabled = true;
  btn.textContent = 'Sincronizando…';
  try {
    const resp = await postAccion('bulkImport', { actas });
    await cargarDatos(false);
    mostrarToast((resp.mensaje || 'Importación completada.') + ' Gráficas actualizadas.', 'success');
  } catch (err) {
    mostrarToast('Error al importar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 Importar desde Excel';
  }
}

/**
 * Abre el panel del Asistente con una pregunta: qué hacer con cada tipo de
 * información detectada en el Excel (actas y/o una hoja de hallazgos).
 */
function preguntarQueHacerConExcel(analisis, btn) {
  const panel = document.getElementById('panelAsistente');
  const overlay = document.getElementById('asistenteOverlay');
  const cont = document.getElementById('asistenteContenido');

  let html = `<div class="asistente-resumen">
    <span class="emoji">🧐</span>
    <div><strong>Encontré varias cosas en tu archivo</strong>
    <span>Dime qué quieres hacer con cada una</span></div>
  </div>`;

  if (analisis.actas.length) {
    html += `<div class="hallazgo-grupo">
      <h4>📋 ${analisis.actas.length} actas encontradas</h4>
      <div class="hallazgo-item">
        <span class="hallazgo-detalle">Se pueden sincronizar con "Datos completos" (actualiza las que ya existan, agrega las nuevas).</span>
        <button type="button" class="btn btn-primary btn-block" id="btnExcelSincronizarActas" style="margin-top:8px;">Sincronizar estas actas</button>
      </div>
    </div>`;
  }

  if (analisis.hojaHallazgos) {
    html += `<div class="hallazgo-grupo">
      <h4>🔎 Hoja "${escapeHtml(analisis.hojaHallazgos)}" con hallazgos</h4>
      <div class="hallazgo-item">
        <span class="hallazgo-detalle">La app no escribe directo en la pestaña "Hallazgos" de tu Sheet — pero te preparo el CSV normalizado (Serie Medidor + Aliado) listo para importar ahí.</span>
        <button type="button" class="btn btn-primary btn-block" id="btnExcelDescargarHallazgos" style="margin-top:8px;">Descargar CSV de hallazgos</button>
      </div>
    </div>`;
  }

  html += `<button class="btn btn-ghost btn-block" id="btnCancelarPreguntaExcel" style="margin-top:10px;">Cancelar</button>`;
  cont.innerHTML = html;
  panel.classList.add('is-active');
  overlay.classList.add('is-active');

  const cerrarPanel = () => { panel.classList.remove('is-active'); overlay.classList.remove('is-active'); };

  const btnActas = document.getElementById('btnExcelSincronizarActas');
  if (btnActas) btnActas.addEventListener('click', async () => {
    cerrarPanel();
    await confirmarYSincronizarActas(analisis.actas, btn);
  });

  const btnHallazgos = document.getElementById('btnExcelDescargarHallazgos');
  if (btnHallazgos) btnHallazgos.addEventListener('click', () => {
    const csv = generarCsvHallazgos(analisis.workbook, analisis.hojaHallazgos);
    descargarCsv(csv, 'hallazgos_para_importar.csv');
    mostrarToast('CSV descargado — impórtalo en la pestaña "Hallazgos" de tu Sheet.', 'success');
  });

  document.getElementById('btnCancelarPreguntaExcel').addEventListener('click', cerrarPanel);
}

/** Lee el archivo completo y detecta tanto la hoja de actas como una posible hoja de hallazgos. */
function analizarExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });

        // Hoja de actas: la primera que tenga una fila cuya columna A sea "#"
        let idxEncabezado = -1, filas = null;
        for (const nombre of workbook.SheetNames) {
          const candidatas = XLSX.utils.sheet_to_json(workbook.Sheets[nombre], { header: 1, raw: true, defval: '' });
          const idx = candidatas.findIndex(f => String(f[0]).trim() === '#');
          if (idx !== -1) { idxEncabezado = idx; filas = candidatas; break; }
        }

        let actas = [];
        if (filas) {
          const encabezados = filas[idxEncabezado].map(h => String(h || '').trim());
          for (let i = idxEncabezado + 1; i < filas.length; i++) {
            const fila = filas[i];
            const id = fila[0];
            if (typeof id !== 'number' || id <= 0) continue;
            const obj = {};
            encabezados.forEach((h, col) => {
              if (!h) return;
              let valor = fila[col];
              if (valor instanceof Date) valor = valor.toISOString().slice(0, 10);
              obj[h] = valor === undefined ? '' : valor;
            });
            actas.push(obj);
          }
        }

        // Hoja de hallazgos: cualquier pestaña cuyo nombre contenga "hallazgo"
        const hojaHallazgos = workbook.SheetNames.find(n => n.toLowerCase().includes('hallazgo')) || null;

        resolve({ workbook, actas, hojaHallazgos });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/** Normaliza una hoja de hallazgos (formato Microsoft Forms) al CSV que espera la pestaña "Hallazgos". */
function generarCsvHallazgos(workbook, nombreHoja) {
  const MAPEO_ALIADO = {
    'MEHV': 'MHEV INGENIERIA SAS', 'C3': 'C3 PRONTO SERVICIOS SAS',
    'CIRELECTRICOS': 'Circuitos Eléctricos SAS', 'ENERBIT': 'ENERBIT SA ESP',
    'VALGARO': 'VALGARO SAS', 'CGM': 'CGM SUPPORT S.A.S',
    'SE&SE': 'S&SE', 'OCA': 'OCA GLOBAL COLOMBIA SAS'
  };

  const filas = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, raw: true, defval: '' });
  const encabezados = (filas[0] || []).map(h => String(h || '').trim().toLowerCase());
  const idx = (patron) => encabezados.findIndex(h => h.includes(patron));

  const iMedidor = idx('medidor');
  const iAliado = idx('aliado');
  const iAmpliacion = idx('ampliación') !== -1 ? idx('ampliación') : idx('ampliacion');
  const iObservacion = idx('observación general') !== -1 ? idx('observación general') : idx('observacion general');
  const iSoporte = idx('cargar archivo');

  const salida = [['Serie Medidor', 'Aliado', 'Ampliación del hallazgo', 'Observación general', 'Soporte']];
  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i];
    const aliadoRaw = String(fila[iAliado] || '').trim();
    if (!aliadoRaw) continue;
    const aliado = MAPEO_ALIADO[aliadoRaw.toUpperCase()] || aliadoRaw;
    salida.push([
      fila[iMedidor] || '', aliado,
      iAmpliacion !== -1 ? (fila[iAmpliacion] || '') : '',
      iObservacion !== -1 ? (fila[iObservacion] || '') : '',
      iSoporte !== -1 ? (fila[iSoporte] || '') : ''
    ]);
  }

  return salida.map(fila => fila.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
}

function descargarCsv(contenido, nombreArchivo) {
  const blob = new Blob(['\ufeff' + contenido], { type: 'text/csv;charset=utf-8;' }); // BOM para acentos en Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
    const fecha = normalizarFechaCliente(a['Fecha']);
    if (state.filtros.fechaDesde && fecha && fecha < state.filtros.fechaDesde) return false;
    if (state.filtros.fechaHasta && fecha && fecha > state.filtros.fechaHasta) return false;
    return true;
  });
}

/** Convierte "2026-07-01T00:00:00.000Z" o "2026-07-01" a "2026-07-01" para poder comparar con un <input type="date">. */
function normalizarFechaCliente(valor) {
  if (!valor) return '';
  return String(valor).slice(0, 10);
}

// --- Tabla: Datos completos --------------------------------------------------
// Todas las columnas disponibles para mostrar en la tabla (mismo orden que la hoja)
const TODAS_LAS_COLUMNAS = [
  '#', 'Fecha', 'Ciudad', 'Aliado', 'Técnico', 'Serie Medidor', 'Tipo Medida',
  'V. Servicio', 'V. Alta Trafo', 'V. Baja Trafo', 'Factor acta (K)', 'Factor real (L)',
  'R01 Tensión', 'R03 Formato', 'Score', 'Supervisión Manual (T)', 'Supervisión IA (U)',
  'Acuerdo T=U', 'revisado', 'Fallos Detectados', 'Tipo de acta', 'Order ID'
];

// Columnas visibles por defecto (el usuario puede cambiarlas con el botón "🗂 Columnas")
const COLUMNAS_POR_DEFECTO = [
  '#', 'Fecha', 'Ciudad', 'Aliado', 'Técnico', 'Serie Medidor', 'Tipo Medida',
  'Score', 'Supervisión Manual (T)', 'Supervisión IA (U)', 'Acuerdo T=U', 'revisado', 'Order ID'
];

function obtenerColumnasVisibles() {
  try {
    const guardadas = JSON.parse(localStorage.getItem('cce_columnas_tabla'));
    if (Array.isArray(guardadas) && guardadas.length) return guardadas;
  } catch (e) { /* usa el valor por defecto */ }
  return COLUMNAS_POR_DEFECTO;
}

function guardarColumnasVisibles(columnas) {
  localStorage.setItem('cce_columnas_tabla', JSON.stringify(columnas));
}

function configurarSelectorColumnas() {
  const btn = document.getElementById('btnColumnas');
  const panel = document.getElementById('panelColumnas');

  const pintarPanel = () => {
    const visibles = obtenerColumnasVisibles();
    panel.innerHTML = TODAS_LAS_COLUMNAS.map(c => `
      <label><input type="checkbox" value="${escapeHtml(c)}" ${visibles.includes(c) ? 'checked' : ''}> ${escapeHtml(c)}</label>
    `).join('');
    panel.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', () => {
        const seleccionadas = [...panel.querySelectorAll('input:checked')].map(c => c.value);
        guardarColumnasVisibles(seleccionadas.length ? seleccionadas : ['#']); // siempre al menos el #
        renderTablaDatos();
      });
    });
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pintarPanel();
    panel.classList.toggle('is-active');
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.remove('is-active');
  });
}

function renderTablaDatos() {
  const filtradas = actasFiltradas();
  const columnas = obtenerColumnasVisibles();
  document.getElementById('datosSubtitle').textContent =
    filtradas.length + ' de ' + state.actas.length + ' actas mostradas';

  const thead = document.querySelector('#tablaDatos thead');
  thead.innerHTML = '<tr>' + columnas.map(c => `<th>${c}</th>`).join('') + '<th>Acciones</th></tr>';

  const tbody = document.querySelector('#tablaDatos tbody');
  tbody.innerHTML = '';
  filtradas
    .slice()
    .sort((a, b) => (b['#'] || 0) - (a['#'] || 0))
    .forEach(acta => {
      const tr = document.createElement('tr');
      tr.dataset.filaId = acta['#'];
      tr.innerHTML = columnas.map(c => `<td>${celdaHtml(c, acta[c])}</td>`).join('') +
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
