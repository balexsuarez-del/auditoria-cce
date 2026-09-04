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
  supervisionDetalle: [],
  usuario: localStorage.getItem('cce_usuario') || '',
  pin: localStorage.getItem('cce_pin') || '',
  filtros: { texto: '', aliado: '', supervision: '', fechaDesde: '', fechaHasta: '' },
  filtroHallazgosTipo: '',
  cargando: false,
  editandoId: null
};

// Campos que el usuario puede editar manualmente en el formulario de acta.
// (# se autogenera; Dif. Factor y Acuerdo T=U se calculan en el backend)
// Solo "Supervisión Manual (T)" es editable aquí — el resto son datos de
// referencia del acta (vienen de Snowflake/Estadium) o hallazgos automáticos
// (R01-R07, Score, Supervisión IA), y no deben modificarse a mano desde este
// formulario. Quedan visibles como contexto, pero deshabilitados.
const CAMPOS_FORM = [
  { campo: 'Fecha', tipo: 'text', placeholder: 'YYYY-MM-DD', soloLectura: true },
  { campo: 'Ciudad', tipo: 'text', soloLectura: true },
  { campo: 'Aliado', tipo: 'text', soloLectura: true },
  { campo: 'Técnico', tipo: 'text', soloLectura: true },
  { campo: 'Serie Medidor', tipo: 'text', soloLectura: true },
  { campo: 'Tipo Medida', tipo: 'select', opciones: ['directa', 'semidirecta', 'indirecta'], soloLectura: true },
  { campo: 'V. Servicio', tipo: 'number' },
  { campo: 'V. Alta Trafo', tipo: 'number', soloLectura: true },
  { campo: 'V. Baja Trafo', tipo: 'number', soloLectura: true },
  { campo: 'Factor acta (K)', tipo: 'number', soloLectura: true },
  { campo: 'Factor real (L)', tipo: 'text', placeholder: 'Número, o "OK" si coincide con Factor acta' },
  { campo: 'R01 Tensión', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'] },
  { campo: 'R03 Formato', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'], soloLectura: true },
  { campo: 'R04 Foto Serial', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'], soloLectura: true },
  { campo: 'R05 Foto Sistema', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'], soloLectura: true },
  { campo: 'R06 Sellos', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'], soloLectura: true },
  { campo: 'R07 Caja', tipo: 'select', opciones: ['OK', 'FALLA', 'PENDIENTE'], soloLectura: true },
  { campo: 'Score', tipo: 'number', soloAutomatico: true },
  { campo: 'Supervisión Manual (T)', tipo: 'select', opciones: ['PENDIENTE', 'CONFORME', 'NO CONFORMIDAD'] },
  { campo: 'Supervisión IA (U)', tipo: 'select', opciones: ['PENDIENTE', 'CONFORME', 'NO CONFORMIDAD'], soloLectura: true },
  { campo: 'Fallos Detectados', tipo: 'textarea', span2: true },
  { campo: 'Tipo de acta', tipo: 'text' },
  { campo: 'Order ID', tipo: 'text' }
];

// ============================================================================
// ARRANQUE
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Cada función de inicio se envuelve en su propio try/catch — así, si UNA
  // falla (por ejemplo porque index.html quedó desactualizado respecto a
  // app.js y le falta algún elemento), las demás igual se ejecutan. Antes,
  // un solo error aquí detenía TODO lo que viniera después en esta lista,
  // incluyendo el inicio de sesión y la carga de datos — dejando la página
  // atascada en "Conectando..." para siempre sin ningún aviso.
  const iniciar = (nombre, fn) => {
    try { fn(); } catch (e) { console.error('Fallo al iniciar "' + nombre + '":', e); }
  };

  iniciar('configurarNavegacion', configurarNavegacion);
  iniciar('configurarModalUsuario', configurarModalUsuario);
  iniciar('configurarModalActa', configurarModalActa);
  iniciar('configurarFiltros', configurarFiltros);
  iniciar('configurarAsistente', configurarAsistente);
  iniciar('configurarSelectoresVista', configurarSelectoresVista);
  iniciar('configurarSelectorColumnas', configurarSelectorColumnas);
  iniciar('configurarVistas', configurarVistas);
  iniciar('aplicarVisibilidadPaneles', aplicarVisibilidadPaneles);
  iniciar('aplicarOrdenPaneles', aplicarOrdenPaneles);
  iniciar('configurarVistaSupervision', configurarVistaSupervision);
  iniciar('configurarVistaProyectos', configurarVistaProyectos);

  const btnRefrescar = document.getElementById('btnRefrescar');
  if (btnRefrescar) btnRefrescar.addEventListener('click', () => cargarDatos(true));

  // Esto SIEMPRE debe ejecutarse, sin importar si algo de arriba falló —
  // es lo que realmente conecta con tus datos.
  if (state.usuario && state.pin) {
    const label = document.getElementById('usuarioActualLabel');
    if (label) label.textContent = '\ud83d\udc64 ' + state.usuario;
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
    state.supervisionDetalle = data.supervisionDetalle || [];
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

      // El asistente morado (CCE) y el naranja (Otros proyectos) nunca deben
      // verse los dos a la vez — al entrar a "Otros proyectos" se oculta el
      // morado (y se cierra su panel si estaba abierto); al salir de ahí hacia
      // cualquier otra vista de CCE, se restaura el morado y se oculta el
      // naranja (el naranja además solo aparece cuando hay un proyecto abierto,
      // eso ya lo controla abrirProyecto()/mostrarListaProyectos()).
      const btnCCE = document.getElementById('btnAsistente');
      if (btn.dataset.view === 'proyectos') {
        btnCCE.style.display = 'none';
        document.getElementById('panelAsistente').classList.remove('is-active');
        document.getElementById('asistenteOverlay').classList.remove('is-active');
      } else {
        btnCCE.style.display = '';
        document.getElementById('btnAsistenteProyectos').style.display = 'none';
        document.getElementById('panelAsistenteProyectos').classList.remove('is-active');
        document.getElementById('asistenteProyectosOverlay').classList.remove('is-active');
      }
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
  document.getElementById('btnAsistentePowerPoint').addEventListener('click', () => renderOpcionesPowerPoint());

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
  { target: 'chartHallazgos', nombre: 'Hallazgos por aliado', nombrePanel: 'Hallazgos por aliado', opciones: ['barras', 'dona'] },
  { target: 'chartLinea', nombre: 'Tendencia de actas por mes', nombrePanel: 'Tendencia de actas por mes', opciones: ['linea', 'barras', 'cascada'] },
  { target: 'chartArea', nombre: 'Score promedio por mes', nombrePanel: 'Score promedio por mes (área)', opciones: ['linea', 'barras', 'cascada'] },
  { target: 'chartHistograma', nombre: 'Distribución de Score', nombrePanel: 'Distribución de Score (histograma)', opciones: ['barras', 'dona', 'apilada'] },
  { target: 'chartAliados', nombre: 'Conformidad por aliado', nombrePanel: 'Conformidad por aliado', opciones: ['barras', 'dona', 'apilada'] },
  { target: 'chartTipoMedida', nombre: 'Score promedio por tipo de medida', nombrePanel: 'Score promedio por tipo de medida', opciones: ['barras', 'dona', 'apilada'] }
];
const NOMBRE_TIPO_GRAFICA = { barras: '📊 Barras', dona: '🍩 Dona', apilada: '▬ Apilada', linea: '📈 Línea', cascada: '🪜 Cascada' };

/** Cuántas categorías tiene ahora mismo cada gráfica (para poder recomendar el tipo). */
function calcularNumCategorias(target) {
  const k = state.kpis;
  switch (target) {
    case 'chartDona': return 3; // Conforme / No conforme / Pendiente
    case 'chartApilada': return (k && k.porTipoMedida) ? k.porTipoMedida.length : 2;
    case 'chartAcuerdo': return 2; // Conforme / Desacuerdo
    case 'chartFactor': return 2; // Concuerda / No concuerda
    case 'chartHallazgos': return hallazgosPorAliadoFiltrados().length || 1;
    case 'chartLinea': return calcularActasPorMes().length || 1;
    case 'chartArea': return calcularScorePromedioPorMes().length || 1;
    case 'chartHistograma': return 5; // 5 rangos de score fijos
    case 'chartAliados': return (k && k.porAliado) ? k.porAliado.length : 1;
    case 'chartTipoMedida': return (k && k.porTipoMedida) ? k.porTipoMedida.length : 1;
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
// Campos por los que se puede "agrupar" (para cruces tipo "no conformidad por aliado").
// El campo temporal (esTemporal) es especial: en vez de contar por valor exacto de
// fecha, agrupa por mes (YYYY-MM) para mostrar una tendencia en el tiempo.
const CAMPOS_AGRUPABLES = [
  { claves: ['aliado'], campo: 'Aliado' },
  { claves: ['ciudad'], campo: 'Ciudad' },
  { claves: ['tecnico', 'técnico'], campo: 'Técnico' },
  { claves: ['tipo medida', 'tipo de medida'], campo: 'Tipo Medida' },
  { claves: ['mes', 'mensual', 'fecha', 'tendencia', 'evolucion', 'evolución'], campo: 'Fecha', esTemporal: true }
];
// Estados/condiciones reconocidos para filtrar antes de agrupar
const ESTADOS_RECONOCIDOS = [
  { claves: ['no conformidad', 'no conforme'], campo: 'Supervisión Manual (T)', valor: 'NO CONFORMIDAD' },
  { claves: ['conforme'], campo: 'Supervisión Manual (T)', valor: 'CONFORME' },
  { claves: ['pendiente'], campo: 'Supervisión Manual (T)', valor: 'PENDIENTE' },
  { claves: ['desacuerdo'], campo: 'Acuerdo T=U', valor: 'DESACUERDO' }
];
const PALETA_MULTICOLOR = ['var(--purple-500)', 'var(--orange-500)', 'var(--green-600)', 'var(--blue-600)',
  'var(--red-600)', 'var(--amber-700)', '#0E9384' /* teal */, '#DD2590' /* rosa */,
  'var(--purple-900)', '#667085' /* gris */];

// Campos del formulario completo de "Supervision" (Microsoft Forms) — se
// activan con la palabra "formulario" para no confundirse con los campos
// homónimos de "Datos completos" (ambos tienen Aliado, Técnico, etc.).
const CAMPOS_SUPERVISION = [
  { claves: ['aliado'], campo: 'Aliado' },
  { claves: ['tecnico', 'técnico'], campo: 'Tecnico' },
  { claves: ['conforme'], campo: 'Conforme' },
  { claves: ['hallazgo 1'], campo: 'Tipo Hallazgo 1' },
  { claves: ['hallazgo 2'], campo: 'Tipo Hallazgo 2' },
  { claves: ['hallazgo 3'], campo: 'Tipo Hallazgo 3' },
  { claves: ['no conformidad'], campo: 'No Conformidad 1' },
  { claves: ['condicion tecnica', 'condición técnica', 'condicion técnica'], campo: 'Condicion Tecnica' },
  { claves: ['zona', 'departamento'], campo: 'Zona' },
  { claves: ['supervisor'], campo: 'Supervisor' },
  { claves: ['tipo inspeccion', 'tipo de inspección', 'inspeccion'], campo: 'Tipo Inspeccion' },
  { claves: ['tipo os', 'tipo de os'], campo: 'Tipo OS Programada' },
  { claves: ['medidor', 'serie'], campo: 'Serie Medidor' },
  { claves: ['acta', 'item', 'numero os', 'número os', 'orden de servicio', ' os '], campo: 'Numero OS' }
];

/** Filtra cualquier arreglo de registros por Tipo de Medida, cruzando por Serie Medidor contra las actas. */
function filtrarPorTipoMedidaCruzado(registros, campoSerieEnRegistro, tipoMedida) {
  const serieATipo = {};
  state.actas.forEach(a => {
    const serie = (a['Serie Medidor'] || '').toString().trim();
    if (serie) serieATipo[serie] = (a['Tipo Medida'] || '').toString().trim().toLowerCase();
  });
  return registros.filter(r => serieATipo[(r[campoSerieEnRegistro] || '').toString().trim()] === tipoMedida);
}

function buscarCampoGraficable(texto) {
  const q = texto.toLowerCase().trim();
  return CAMPOS_GRAFICABLES.find(c => c.claves.some(k => q.includes(k)));
}

/** Cuenta cuántas actas hay por cada valor distinto de un campo categórico. */
function agregarPorCategoria(campo, actas) {
  const conteo = {};
  (actas || state.actas).forEach(a => {
    const v = (a[campo] || '').toString().trim() || 'Sin dato';
    conteo[v] = (conteo[v] || 0) + 1;
  });
  return Object.keys(conteo).map(k => ({ etiqueta: k, valor: conteo[k] })).sort((a, b) => b.valor - a.valor);
}

const NOMBRES_MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Agrupa registros por mes (YYYY-MM) usando el campo de fecha indicado, para
 * consultas de tendencia/evolución ("actas por mes", "score por mes",
 * "no conformidad por mes"). A diferencia de agregarPorCategoria, el orden
 * queda CRONOLÓGICO (no por cantidad), porque en una tendencia el orden
 * en el tiempo es lo que importa. Si se pasa campoNumerico, en vez de
 * contar registros calcula el promedio de ese campo por mes.
 */
function agregarPorMes(actas, campoFecha, campoNumerico) {
  const grupos = {};
  (actas || []).forEach(a => {
    const f = (a[campoFecha] || '').toString().slice(0, 7); // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(f)) return;
    (grupos[f] = grupos[f] || []).push(a);
  });
  const claves = Object.keys(grupos).sort(); // orden cronológico ascendente
  return claves.map(clave => {
    const [anio, mes] = clave.split('-');
    const etiqueta = `${NOMBRES_MES_CORTO[parseInt(mes, 10) - 1]} ${anio}`;
    if (campoNumerico) {
      const valores = grupos[clave].map(a => parseFloat(a[campoNumerico])).filter(v => !isNaN(v));
      const valor = valores.length ? Math.round((valores.reduce((s, v) => s + v, 0) / valores.length) * 10) / 10 : 0;
      return { etiqueta, valor };
    }
    return { etiqueta, valor: grupos[clave].length };
  });
}

/**
 * Promedia un campo numérico (ej. Score) agrupando por un campo categórico
 * (ej. Aliado) — para consultas tipo "score promedio por aliado" o
 * "comparar score por técnico", que son distintas de solo contar cuántas
 * actas tiene cada uno.
 */
function promedioPorCategoria(campoCategoria, campoNumerico, actas) {
  const grupos = {};
  (actas || state.actas).forEach(a => {
    const cat = (a[campoCategoria] || '').toString().trim() || 'Sin dato';
    const v = parseFloat(a[campoNumerico]);
    if (isNaN(v)) return;
    (grupos[cat] = grupos[cat] || []).push(v);
  });
  return Object.keys(grupos)
    .map(cat => ({ etiqueta: cat, valor: Math.round((grupos[cat].reduce((s, v) => s + v, 0) / grupos[cat].length) * 10) / 10 }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Cuenta cuáles son las fallas/errores más comunes, mirando las columnas
 * de reglas (R01-R07) y buscando frases típicas dentro de "Fallos
 * Detectados" — para responder "top de fallas más comunes" sin necesitar
 * una columna única que ya traiga esa clasificación.
 */
function calcularTopFallas(limite, actasFuente) {
  const conteo = {};
  const sumar = (etiqueta) => { conteo[etiqueta] = (conteo[etiqueta] || 0) + 1; };

  const reglasSimples = [
    { campo: 'R01 Tensión', etiqueta: 'R01: Tensión inconsistente' },
    { campo: 'R03 Formato', etiqueta: 'R03: Formato de tensión incorrecto' },
    { campo: 'R04 Foto Serial', etiqueta: 'R04: Falta foto de serial' },
    { campo: 'R05 Foto Sistema', etiqueta: 'R05: Falta foto del sistema' },
    { campo: 'R06 Sellos', etiqueta: 'R06: Problema con sellos' },
    { campo: 'R07 Caja', etiqueta: 'R07: Problema con la caja' }
  ];
  const fragmentosTexto = [
    { buscar: 'firma cliente', etiqueta: 'Sin firma del cliente' },
    { buscar: 'firma frontier', etiqueta: 'Sin firma del frontier/instalador' },
    { buscar: 'factor', etiqueta: 'Factor acta/real no coincide' },
    { buscar: 'duplicad', etiqueta: 'Posible duplicado' }
  ];

  (actasFuente || state.actas).forEach(a => {
    reglasSimples.forEach(r => {
      const v = (a[r.campo] || '').toString().toUpperCase();
      if (v && v !== 'OK' && v !== 'PENDIENTE') sumar(r.etiqueta);
    });
    const textoFallos = (a['Fallos Detectados'] || '').toString().toLowerCase();
    fragmentosTexto.forEach(f => { if (textoFallos.includes(f.buscar)) sumar(f.etiqueta); });
  });

  return Object.keys(conteo)
    .map(etiqueta => ({ etiqueta, valor: conteo[etiqueta] }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limite || 10);
}

// ============================================================================
// PANELES PERSONALIZADOS — cualquier gráfica del buscador se puede "fijar"
// como panel permanente del Dashboard, y quitar cuando ya no se necesite.
// ============================================================================
function obtenerPanelesPersonalizados() {
  try { return JSON.parse(localStorage.getItem('cce_paneles_personalizados')) || []; }
  catch (e) { return []; }
}
function guardarPanelesPersonalizados(lista) {
  localStorage.setItem('cce_paneles_personalizados', JSON.stringify(lista));
}

/** Conecta el botón "📌 Fijar en el Dashboard" que aparece junto a un resultado del buscador. */
function conectarBotonFijarPanel(contenedor) {
  const btn = contenedor.querySelector('.btn-fijar-panel');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const config = JSON.parse(btn.dataset.config);
    // Antes esto se perdía: si la persona cambiaba el tipo de gráfica en el
    // selector (barras/dona/apilada/línea/cascada) antes de fijar, el panel
    // fijado igual se re-dibujaba con la recomendación automática, ignorando
    // lo que había elegido. Ahora se guarda el tipo activo en ese momento.
    const botonActivo = contenedor.querySelector('.btn-opcion-grafica[data-tipo-grafica].is-active');
    if (botonActivo) config.tipoGrafica = botonActivo.dataset.tipoGrafica;
    const lista = obtenerPanelesPersonalizados();
    lista.push({ id: 'custom_' + Date.now(), ...config });
    guardarPanelesPersonalizados(lista);
    renderPanelesPersonalizados();
    // Se acaba de pedir explícitamente este panel — se muestra ya mismo, sin
    // esperar a que además esté marcado en "Vistas" o en "Solo mis paneles".
    const visibles = obtenerPanelesVisibles();
    if (!visibles.includes(config.titulo)) {
      guardarPanelesVisibles(visibles.concat([config.titulo]));
      aplicarVisibilidadPaneles();
    }
    btn.textContent = '✅ Fijado en el Dashboard';
    btn.disabled = true;
    mostrarToast(`"${config.titulo}" se agregó al Dashboard.`, 'success');
  });
}

/** Recalcula los datos {etiqueta, valor} de un panel personalizado según su tipo guardado. */
function calcularDatosPanelPersonalizado(config) {
  if (config.tipo === 'topFallas') return calcularTopFallas(10);
  if (config.tipo === 'cruce') {
    const filtradas = state.actas.filter(a => (a[config.estadoCampo] || '').toString().toUpperCase() === config.estadoValor);
    if (config.esTemporal) return agregarPorMes(filtradas, config.agrupableCampo);
    return agregarPorCategoria(config.agrupableCampo, filtradas);
  }
  if (config.tipo === 'promedio') {
    if (config.esTemporal) return agregarPorMes(state.actas, config.agrupableCampo, config.campoNumerico);
    return promedioPorCategoria(config.agrupableCampo, config.campoNumerico, state.actas);
  }
  if (config.tipo === 'tendencia') return agregarPorMes(state.actas, config.agrupableCampo);
  if (config.tipo === 'formulario') {
    let fuente = state.supervisionDetalle || [];
    if (config.tipoMedida) fuente = filtrarPorTipoMedidaCruzado(fuente, 'Serie Medidor', config.tipoMedida);
    return agregarPorCategoria(config.campo, fuente);
  }
  return agregarPorCategoria(config.campo); // tipo === 'campo'
}


/** Reconstruye todos los paneles personalizados guardados dentro del Dashboard. */
function renderPanelesPersonalizados() {
  const grid = document.getElementById('panelGridDashboard');
  // Quita los paneles personalizados existentes antes de redibujarlos (evita duplicados)
  grid.querySelectorAll('.panel-personalizado').forEach(p => p.remove());

  obtenerPanelesPersonalizados().forEach(config => {
    const idContenedor = 'panelPersonalizado_' + config.id;
    const panel = document.createElement('div');
    panel.className = 'panel panel-personalizado';
    panel.dataset.panelNombre = config.titulo;
    panel.innerHTML = `
      <div class="panel-header-row">
        <h3>${escapeHtml(config.titulo)} <span class="badge-personalizado">fijado</span></h3>
        <button type="button" class="btn-quitar-panel" data-id="${config.id}" title="Quitar este panel">🗑</button>
      </div>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
    `;
    grid.appendChild(panel);

    const datos = calcularDatosPanelPersonalizado(config);
    if (!datos.length) { document.getElementById(idContenedor).innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }
    // "promedio" (ej. Score por aliado) no se puede sumar entre categorías —
    // se lo indicamos a dona/apilada para que no muestren un "total" sin sentido.
    const opcionesGrafica = config.tipo === 'promedio' ? { modo: 'promedio', etiquetaCentro: (config.campoNumerico || '').toLowerCase() } : undefined;
    if (config.pideTabla) {
      // Respeta que la persona haya pedido "tabla" antes de fijar el panel.
      renderizarComoTabla(idContenedor, datos, config.columnaTabla || config.titulo);
    } else if (config.tipoGrafica) {
      // Respeta el tipo de gráfica que la persona eligió antes de fijar el panel
      // (esto va ANTES del caso especial de 'topFallas' — antes ese caso especial
      // siempre ganaba y mostraba barras rojas fijas sin importar qué se hubiera elegido).
      dibujarTipoGrafica(idContenedor, datos, config.tipoGrafica, opcionesGrafica);
    } else if (config.tipo === 'topFallas') {
      const max = Math.max(...datos.map(d => d.valor), 1);
      renderBarras(idContenedor, datos.map(d => ({ etiqueta: d.etiqueta, valor: d.valor, texto: String(d.valor), clase: 'danger' })), max);
    } else {
      renderizarSegunRecomendacion(idContenedor, datos, opcionesGrafica);
    }
  });

  grid.querySelectorAll('.btn-quitar-panel').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Quitar este panel del Dashboard? Puedes volver a generarlo cuando quieras desde "Buscar y graficar".')) return;
      const lista = obtenerPanelesPersonalizados().filter(p => p.id !== btn.dataset.id);
      guardarPanelesPersonalizados(lista);
      renderPanelesPersonalizados();
      mostrarToast('Panel quitado.', 'success');
    });
  });
}

/** Sugerencias rápidas que se muestran como botones al abrir el buscador guiado.
 *  Cada una está probada para que dispare una rama específica y válida del motor. */
const SUGERENCIAS_GUIADAS = [
  'Supervisión Manual', 'No conformidad por aliado', 'Top de fallas más comunes',
  'Score por aliado', 'No conformidad por mes', 'Formulario conforme por aliado'
];

/** Nombres más amigables para mostrarle al usuario en el catálogo de ayuda
 *  (el campo real de la hoja puede ser más técnico, ej. "Acuerdo T=U"). */
const NOMBRE_AMIGABLE_CAMPO = {
  'Supervisión Manual (T)': 'Supervisión Manual',
  'Supervisión IA (U)': 'Supervisión IA',
  'Acuerdo T=U': 'Acuerdo IA vs Manual',
  'revisado': 'Revisado',
  'Fecha': 'Mes' // cuando "Fecha" aparece como campo agrupable, es la dimensión temporal (tendencia mensual)
};
const nombreAmigable = (campo) => NOMBRE_AMIGABLE_CAMPO[campo] || campo;

/**
 * Arma el HTML del catálogo de "¿qué puedo mostrarte?" leyendo directamente
 * de los mismos catálogos que usa el motor de búsqueda (CAMPOS_GRAFICABLES,
 * CAMPOS_AGRUPABLES, ESTADOS_RECONOCIDOS, CAMPOS_SUPERVISION), para que la
 * ayuda nunca quede desactualizada si esos catálogos cambian.
 * Cada opción es un chip clicable que llena el buscador y ejecuta la consulta.
 */
function generarPanelAyudaConsultas() {
  const chip = (texto) => `<button type="button" class="btn-opcion-grafica btn-sugerencia-guiada" data-consulta="${escapeHtml(texto)}">${escapeHtml(texto)}</button>`;

  const chipsCampos = CAMPOS_GRAFICABLES.map(c => chip(nombreAmigable(c.campo))).join('');

  // Campos "para agrupar" que no son la dimensión temporal (esos van en su propio bloque).
  const agrupablesCategoricos = CAMPOS_AGRUPABLES.filter(c => !c.esTemporal);

  // Cruces = un estado (no conformidad, conforme, pendiente, desacuerdo) "por" un campo agrupable.
  // Se genera solo un ejemplo representativo por estado para no saturar de chips;
  // el usuario puede combinar cualquier estado con cualquier campo agrupable escribiéndolo.
  const chipsCruces = ESTADOS_RECONOCIDOS.map(estado => {
    const campoEjemplo = agrupablesCategoricos[0];
    return chip(`${estado.claves[0]} por ${campoEjemplo.claves[0]}`);
  }).join('');
  const listaAgrupables = agrupablesCategoricos.map(c => nombreAmigable(c.campo)).join(', ');

  const chipsFormulario = CAMPOS_SUPERVISION.map(c => chip(`formulario ${c.claves[0]}`)).join('');

  // Promedio numérico (ej. Score) por cada campo agrupable categórico.
  const camposNumericos = CAMPOS_GRAFICABLES.filter(c => c.esNumerico);
  const chipsPromedio = camposNumericos.flatMap(num =>
    agrupablesCategoricos.map(agr => chip(`${num.claves[0]} por ${agr.claves[0]}`))
  ).join('');

  // Tendencia en el tiempo: conteo o promedio numérico agrupado por mes.
  const chipsTendencia = [
    chip('Actas por mes'),
    ...ESTADOS_RECONOCIDOS.map(e => chip(`${e.claves[0]} por mes`)),
    ...camposNumericos.map(n => chip(`${n.claves[0]} por mes`))
  ].join('');

  return `
    <div class="ayuda-consultas-panel">
      <div class="ayuda-consultas-bloque">
        <strong>📊 Campos de "Datos completos"</strong>
        <p>Cuenta cuántas actas hay por cada valor de este campo.</p>
        <div class="preferencia-opciones">${chipsCampos}</div>
      </div>
      <div class="ayuda-consultas-bloque">
        <strong>🔀 Comparaciones (cruces)</strong>
        <p>Formato: <em>&lt;estado&gt; por &lt;campo&gt;</em>. Estados disponibles:
        no conformidad, conforme, pendiente, desacuerdo. Campos para agrupar: ${escapeHtml(listaAgrupables)}.
        Ejemplos (toca uno o combínalos a tu gusto):</p>
        <div class="preferencia-opciones">${chipsCruces}</div>
      </div>
      <div class="ayuda-consultas-bloque">
        <strong>🧮 Promedios numéricos</strong>
        <p>Formato: <em>&lt;campo numérico&gt; por &lt;campo&gt;</em> — en vez de contar actas, promedia el valor
        (ej. el Score promedio de cada aliado, no cuántas actas tiene):</p>
        <div class="preferencia-opciones">${chipsPromedio}</div>
      </div>
      <div class="ayuda-consultas-bloque">
        <strong>📈 Tendencia en el tiempo</strong>
        <p>Agrega "por mes", "tendencia" o "evolución" a cualquier consulta para verla mes a mes en vez de por categoría:</p>
        <div class="preferencia-opciones">${chipsTendencia}</div>
      </div>
      <div class="ayuda-consultas-bloque">
        <strong>🏆 Ranking</strong>
        <p>Top de fallas más comunes en todas las actas cargadas.</p>
        <div class="preferencia-opciones">${chip('Top de fallas más comunes')}</div>
      </div>
      <div class="ayuda-consultas-bloque">
        <strong>📝 Formulario de Supervisión</strong>
        <p>Agrega la palabra "formulario" para consultar los 672 registros del formulario completo (distinto de "Datos completos"):</p>
        <div class="preferencia-opciones">${chipsFormulario}</div>
      </div>

    </div>
  `;
}

/** Conecta el clic de cualquier chip ".btn-sugerencia-guiada" dentro de un contenedor
 *  dado: llena el input del buscador con su consulta y la ejecuta de una vez.
 *  Se usa tanto para los chips iniciales como para los que aparecen luego dentro
 *  del panel de ayuda "¿Qué puedo mostrarte?" (que se inyecta en otro momento). */
function conectarChipsGuiados(contenedor) {
  contenedor.querySelectorAll('.btn-sugerencia-guiada').forEach(btn => {
    if (btn.dataset.conectado) return; // evita duplicar el listener si ya se conectó antes
    btn.dataset.conectado = '1';
    btn.addEventListener('click', () => {
      document.getElementById('inputBuscadorGraficas').value = btn.dataset.consulta;
      ejecutarBusquedaGrafica(btn.dataset.consulta);
    });
  });
}

/** El sub-panel donde escribes lo que quieres ver y el asistente lo busca y grafica/tabula solo. */
function renderBuscadorGraficas() {
  const cont = document.getElementById('asistenteContenido');
  cont.innerHTML = `
    <div class="asistente-resumen">
      <span class="emoji">📈</span>
      <div><strong>¿Qué quieres ver?</strong>
      <span>Elige una sugerencia, o escribe la tuya — puedes acotar por fecha abajo antes de pedirla</span></div>
    </div>
    <div class="preferencia-opciones" style="margin-bottom:12px;">
      ${SUGERENCIAS_GUIADAS.map(s => `<button type="button" class="btn-opcion-grafica btn-sugerencia-guiada" data-consulta="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
    </div>
    <button type="button" class="btn btn-ghost btn-icon" id="btnAyudaConsultas" style="margin-bottom:12px;">❓ ¿Qué puedo mostrarte o comparar?</button>
    <div id="ayudaConsultasPanel" style="display:none;"></div>
    <form id="formBuscadorGraficas" class="asistente-pregunta" style="padding:0 0 8px;">
      <input type="text" id="inputBuscadorGraficas" placeholder="O escribe la tuya: score por aliado, no conformidad por mes, formulario hallazgo 1…">
      <button type="submit" class="btn btn-primary btn-icon">Buscar</button>
    </form>
    <div class="asistente-pregunta" style="padding:0 0 14px;">
      <label class="toolbar-date-label" style="color:var(--ink-500);">Desde <input type="date" id="fechaGlobalDesde"></label>
      <label class="toolbar-date-label" style="color:var(--ink-500);">Hasta <input type="date" id="fechaGlobalHasta"></label>
      <button type="button" class="btn btn-ghost btn-icon" id="btnLimpiarFechaGlobal">✕ Quitar fechas</button>
    </div>
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

  document.getElementById('btnAyudaConsultas').addEventListener('click', () => {
    const panel = document.getElementById('ayudaConsultasPanel');
    const abrir = panel.style.display === 'none';
    if (abrir && !panel.innerHTML) panel.innerHTML = generarPanelAyudaConsultas();
    panel.style.display = abrir ? 'block' : 'none';
    document.getElementById('btnAyudaConsultas').textContent = abrir
      ? '❓ Ocultar opciones' : '❓ ¿Qué puedo mostrarte o comparar?';
    if (abrir) conectarChipsGuiados(panel);
  });

  conectarChipsGuiados(cont);

  document.getElementById('btnLimpiarFechaGlobal').addEventListener('click', () => {
    document.getElementById('fechaGlobalDesde').value = '';
    document.getElementById('fechaGlobalHasta').value = '';
    const texto = document.getElementById('inputBuscadorGraficas').value.trim();
    if (texto) ejecutarBusquedaGrafica(texto);
  });
  ['fechaGlobalDesde', 'fechaGlobalHasta'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const texto = document.getElementById('inputBuscadorGraficas').value.trim();
      if (texto) ejecutarBusquedaGrafica(texto); // si ya había una consulta, se re-ejecuta con el nuevo rango
    });
  });
}

/**
 * Recorta cualquier lista de registros al rango Desde/Hasta elegido en el
 * buscador guiado (si hay alguno puesto), usando el campo de fecha que
 * corresponda a esa fuente de datos.
 */
function aplicarRangoFechaGlobal(registros, campoFecha) {
  const desde = document.getElementById('fechaGlobalDesde') ? document.getElementById('fechaGlobalDesde').value : '';
  const hasta = document.getElementById('fechaGlobalHasta') ? document.getElementById('fechaGlobalHasta').value : '';
  if (!desde && !hasta) return registros;
  return registros.filter(r => {
    const f = (r[campoFecha] || '').toString().slice(0, 10);
    if (!f) return false;
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    return true;
  });
}

/** Dibuja "datos" como dona/apilada/barras (recomendado) dentro de un contenedor del sub-panel. */
/** Dibuja "datos" en el contenedor con el tipo de gráfica indicado (barras/dona/apilada).
 *  opciones.modo: 'suma' (default, ej. conteo de actas) | 'promedio' (ej. Score
 *  promedio) — en modo 'promedio' los valores NO se deben sumar entre sí para
 *  mostrar un total, porque sumar dos promedios no significa nada. */
function dibujarTipoGrafica(idContenedor, datos, tipo, opciones) {
  const coloreados = datos.map((d, i) => ({ ...d, color: PALETA_MULTICOLOR[i % PALETA_MULTICOLOR.length] }));
  if (tipo === 'dona') renderDona(idContenedor, coloreados, opciones);
  else if (tipo === 'apilada') renderBarraApilada(idContenedor, coloreados, opciones);
  else if (tipo === 'linea') renderLineaGenerica(idContenedor, datos);
  else if (tipo === 'cascada') renderCascada(idContenedor, datos);
  else {
    const max = Math.max(...datos.map(d => d.valor), 1);
    renderBarras(idContenedor, datos.map(d => ({ etiqueta: d.etiqueta, valor: d.valor, texto: String(d.valor) })), max);
  }
}

/** Línea genérica para cualquier arreglo {etiqueta, valor} (no requiere formato de fecha). */
function renderLineaGenerica(contenedorId, datos) {
  const cont = document.getElementById(contenedorId);
  if (!datos.length) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }
  const w = 340, h = 180, padding = 34;
  const max = Math.max(...datos.map(d => d.valor), 1);
  const paso = datos.length > 1 ? (w - padding * 2) / (datos.length - 1) : 0;
  const coords = datos.map((d, i) => ({
    x: padding + i * paso,
    y: h - padding - (d.valor / max) * (h - padding * 2),
    d
  }));
  const linea = coords.map(c => `${c.x},${c.y}`).join(' ');
  const area = `${padding},${h - padding} ${linea} ${coords[coords.length - 1].x},${h - padding}`;
  const puntos = coords.map(c => `
    <circle cx="${c.x}" cy="${c.y}" r="4" fill="var(--purple-500)"><title>${escapeHtml(String(c.d.etiqueta))}: ${c.d.valor}</title></circle>
    <text x="${c.x}" y="${c.y - 10}" text-anchor="middle" font-size="9.5" font-family="var(--font-mono)" fill="var(--ink-700)">${c.d.valor}</text>
    <text x="${c.x}" y="${h - 10}" text-anchor="middle" font-size="8.5" fill="var(--ink-500)">${escapeHtml(String(c.d.etiqueta)).slice(0, 8)}</text>
  `).join('');
  cont.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="180" preserveAspectRatio="xMidYMid meet">
    <polygon points="${area}" fill="var(--purple-100)"></polygon>
    <polyline points="${linea}" fill="none" stroke="var(--purple-500)" stroke-width="2.5"></polyline>
    ${puntos}
  </svg>`;
}

/** Cascada (waterfall): muestra cómo cada categoría suma hasta el total acumulado. */
function renderCascada(contenedorId, datos) {
  const cont = document.getElementById(contenedorId);
  if (!datos.length) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }
  const w = 340, h = 180, padding = 30;
  const total = datos.reduce((s, d) => s + d.valor, 0) || 1;
  const anchoBarra = (w - padding * 2) / datos.length;
  let acumulado = 0, svg = '';
  datos.forEach((d, i) => {
    const yInicio = h - padding - (acumulado / total) * (h - padding * 2);
    acumulado += d.valor;
    const yFin = h - padding - (acumulado / total) * (h - padding * 2);
    const x = padding + i * anchoBarra;
    const alto = Math.max(yInicio - yFin, 1);
    const color = PALETA_MULTICOLOR[i % PALETA_MULTICOLOR.length];
    svg += `<rect x="${x + 3}" y="${yFin}" width="${anchoBarra - 6}" height="${alto}" fill="${color}" rx="2"><title>${escapeHtml(String(d.etiqueta))}: ${d.valor}</title></rect>
      <text x="${x + anchoBarra / 2}" y="${yFin - 6}" text-anchor="middle" font-size="9.5" font-family="var(--font-mono)" fill="var(--ink-700)">${d.valor}</text>
      <text x="${x + anchoBarra / 2}" y="${h - 8}" text-anchor="middle" font-size="8" fill="var(--ink-500)">${escapeHtml(String(d.etiqueta)).slice(0, 8)}</text>`;
  });
  cont.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="180" preserveAspectRatio="xMidYMid meet">${svg}</svg>
    <p style="font-size:10px;color:var(--ink-500);text-align:center;margin:4px 0 0;">Total acumulado: ${total}</p>`;
}

function renderizarSegunRecomendacion(idContenedor, datos, opcionesGrafica) {
  const rec = recomendarTipoGrafica(datos.length, ['dona', 'apilada', 'barras']);
  dibujarTipoGrafica(idContenedor, datos, rec.tipo, opcionesGrafica);
  return rec;
}

/**
 * Igual que renderizarSegunRecomendacion, pero además dibuja un selector de
 * tipo de gráfica (Barras / Dona / Apilada / Línea / Cascada) para que la
 * persona elija con cuál quiere ver justo ese resultado, en vez de aceptar
 * solo lo recomendado. opcionesGrafica: { modo: 'suma' | 'promedio' } — se
 * reenvía a dibujarTipoGrafica para que dona/apilada sepan si los valores se
 * pueden sumar (conteos) o no (promedios).
 */
function renderizarConSelectorTipo(idPicker, idContenedor, datos, opcionesGrafica) {
  const rec = recomendarTipoGrafica(datos.length, ['dona', 'apilada', 'barras']);
  const tiposDisponibles = ['barras', 'dona', 'apilada', 'linea', 'cascada'];

  document.getElementById(idPicker).innerHTML = tiposDisponibles.map(op => `
    <button type="button" class="btn-opcion-grafica ${op === rec.tipo ? 'is-active' : ''}"
      data-tipo-grafica="${op}" data-contenedor="${idContenedor}">${NOMBRE_TIPO_GRAFICA[op]}</button>
  `).join('');

  dibujarTipoGrafica(idContenedor, datos, rec.tipo, opcionesGrafica);

  document.querySelectorAll(`#${idPicker} .btn-opcion-grafica`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${idPicker} .btn-opcion-grafica`).forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      dibujarTipoGrafica(btn.dataset.contenedor, datos, btn.dataset.tipoGrafica, opcionesGrafica);
    });
  });

  return rec;
}

/**
 * Hace que CUALQUIER tabla .data-table se pueda ordenar por columna con un
 * clic en su encabezado — detecta automáticamente si la columna es numérica
 * (incluyendo "12.3%") o de texto, y alterna ascendente/descendente. Se llama
 * una vez después de generar el HTML de la tabla.
 */
function hacerTablaOrdenable(idContenedor) {
  const tabla = document.querySelector(`#${idContenedor} table.data-table`);
  if (!tabla) return;
  const encabezados = tabla.querySelectorAll('thead th');
  encabezados.forEach((th, colIdx) => {
    th.style.cursor = 'pointer';
    th.dataset.dirOrden = '';
    th.addEventListener('click', () => {
      const tbody = tabla.querySelector('tbody');
      const filas = Array.from(tbody.querySelectorAll('tr'));
      const asc = th.dataset.dirOrden !== 'asc';

      const valorCelda = (fila) => (fila.children[colIdx] || {}).textContent || '';
      const esNumerico = filas.every(f => {
        const t = valorCelda(f).replace('%', '').replace(/,/g, '').trim();
        return t === '' || !isNaN(parseFloat(t));
      });

      filas.sort((a, b) => {
        let va = valorCelda(a).trim(), vb = valorCelda(b).trim();
        if (esNumerico) { va = parseFloat(va.replace('%', '')) || 0; vb = parseFloat(vb.replace('%', '')) || 0; }
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
      });

      filas.forEach(f => tbody.appendChild(f));
      encabezados.forEach(h => { h.dataset.dirOrden = ''; h.classList.remove('th-asc', 'th-desc'); });
      th.dataset.dirOrden = asc ? 'asc' : 'desc';
      th.classList.add(asc ? 'th-asc' : 'th-desc');
    });
  });
}

/** Dibuja "datos" como una tabla simple de 2 columnas (Etiqueta / Cantidad). */
function renderizarComoTabla(idContenedor, datos, nombreColumna) {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  const filas = datos.map(d => `
    <tr><td>${escapeHtml(d.etiqueta)}</td><td style="text-align:right;font-family:var(--font-mono);">${d.valor}</td>
    <td style="text-align:right;color:var(--ink-500);font-size:11px;">${total ? ((d.valor / total) * 100).toFixed(1) : 0}%</td></tr>`).join('');
  document.getElementById(idContenedor).innerHTML = `
    <table class="data-table" style="width:100%;">
      <thead><tr><th>${escapeHtml(nombreColumna)}</th><th style="text-align:right;">Cantidad</th><th style="text-align:right;">%</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
  hacerTablaOrdenable(idContenedor);
}

/** Interpreta el pedido (top de fallas / cruce por categoría / campo simple) y lo muestra como gráfica o tabla. */
function ejecutarBusquedaGrafica(texto) {
  const resultadoCont = document.getElementById('resultadoBuscadorGraficas');
  const q = texto.toLowerCase().trim();
  const idContenedor = 'graficaBusquedaResultado';
  const pideTabla = /\btabla\b/.test(q);

  // 1) Formulario de Supervisión completo — se activa con la palabra "formulario"
  // (va primero para que no lo intercepte la regla de "cruce" cuando la
  // consulta también menciona un estado + "por" + un campo agrupable)
  // para no confundirlo con los campos de "Datos completos" (ambos tienen
  // "Aliado", "Técnico", etc.). Ej: "formulario conforme por aliado",
  // "formulario zona", "formulario hallazgo 1 semidirecta".
  if (q.includes('formulario')) {
    if (!state.supervisionDetalle || !state.supervisionDetalle.length) {
      resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">📭</span>
        Todavía no hay datos en la pestaña "Supervision" de tu Google Sheet.</div>`;
      return;
    }

    let fuente = state.supervisionDetalle;
    fuente = aplicarRangoFechaGlobal(fuente, 'Fecha Ejecucion OS');
    const tipoMedidaMatch = ['semidirecta', 'indirecta', 'directa'].find(t => q.includes(t));
    if (tipoMedidaMatch) fuente = filtrarPorTipoMedidaCruzado(fuente, 'Serie Medidor', tipoMedidaMatch);

    // Filtro de fecha (mes/año), igual que ya funciona para las actas
    const MESES_ES = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
      julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };
    const mesFormulario = Object.keys(MESES_ES).find(m => q.includes(m));
    if (mesFormulario) {
      const mm = MESES_ES[mesFormulario];
      fuente = fuente.filter(s => (s['Fecha Ejecucion OS'] || '').toString().slice(5, 7) === mm);
    }
    const anioFormularioMatch = q.match(/20\d{2}/);
    if (anioFormularioMatch) {
      fuente = fuente.filter(s => (s['Fecha Ejecucion OS'] || '').toString().startsWith(anioFormularioMatch[0]));
    }

    // Consulta directa por número de medidor o de OS/acta (ej. "formulario medidor 2222149035")
    const numeroMatch = q.match(/\b\d{5,}\b/);
    if (numeroMatch) {
      fuente = fuente.filter(s =>
        (s['Serie Medidor'] || '').toString().includes(numeroMatch[0]) ||
        (s['Numero OS'] || '').toString().includes(numeroMatch[0]) ||
        (s['ID'] || '').toString() === numeroMatch[0]
      );
    }

    const campoInfoSup = CAMPOS_SUPERVISION.find(c => c.claves.some(k => q.includes(k)));
    if (!campoInfoSup && !numeroMatch) {
      resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">🤔</span>
        Del formulario reconozco: aliado, técnico, conforme, hallazgo 1/2/3, no conformidad,
        condición técnica, zona/departamento, supervisor, tipo de inspección, tipo de OS,
        medidor/serie, acta/item/OS. Puedes agregar semidirecta/indirecta, un mes o un año
        para filtrar. Ej: "formulario medidor 2222149035", "formulario zona julio".</div>`;
      return;
    }

    // Si escribió un número (medidor/OS) sin pedir agrupar por un campo, se muestran esas
    // respuestas como tabla directamente (no tiene sentido "graficar" un solo registro).
    if (numeroMatch && !campoInfoSup) {
      if (!fuente.length) {
        resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">🔍</span>No encontré respuestas del formulario con "${numeroMatch[0]}".</div>`;
        return;
      }
      const columnas = ['ID', 'Fecha Ejecucion OS', 'Aliado', 'Tecnico', 'Serie Medidor', 'Numero OS', 'Conforme', 'Tipo Hallazgo 1', 'Observacion General'];
      const filasHtml = fuente.slice(0, 30).map(s => `<tr>${columnas.map(c => `<td>${escapeHtml(s[c])}</td>`).join('')}</tr>`).join('');
      resultadoCont.innerHTML = `<div class="hallazgo-grupo">
        <h4>Resultados para "${escapeHtml(numeroMatch[0])}" <span class="severidad-pill sev-baja">${fuente.length}</span></h4>
        <div class="table-wrap" style="max-height:320px;">
          <table class="data-table" style="width:100%;">
            <thead><tr>${columnas.map(c => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody>${filasHtml}</tbody>
          </table>
        </div>
        ${fuente.length > 30 ? `<p class="panel-note">…y ${fuente.length - 30} más.</p>` : ''}
      </div>`;
      hacerTablaOrdenable('resultadoBuscadorGraficas');
      return;
    }

    const datos = agregarPorCategoria(campoInfoSup.campo, fuente);
    if (!datos.length) {
      resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">📭</span>
        No hay datos en "${escapeHtml(campoInfoSup.campo)}" ${tipoMedidaMatch ? 'para ' + tipoMedidaMatch : ''}.</div>`;
      return;
    }
    const tituloConFiltro = campoInfoSup.campo + (tipoMedidaMatch ? ` (${tipoMedidaMatch})` : '') + ' — formulario';
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>${escapeHtml(tituloConFiltro)} <span class="severidad-pill sev-baja">${fuente.length} respuesta(s)</span></h4>
      <div id="picker_${idContenedor}" class="preferencia-opciones" style="margin-bottom:8px;"></div>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
      <button type="button" class="btn-fijar-panel" data-config='${JSON.stringify({ tipo: 'formulario', campo: campoInfoSup.campo, tipoMedida: tipoMedidaMatch || '', titulo: tituloConFiltro, pideTabla, columnaTabla: campoInfoSup.campo })}'>📌 Fijar en el Dashboard</button>
    </div>`;
    if (pideTabla) renderizarComoTabla(idContenedor, datos, campoInfoSup.campo);
    else renderizarConSelectorTipo(`picker_${idContenedor}`, idContenedor, datos);
    conectarBotonFijarPanel(resultadoCont);
    return;
  }
  // 2) "Top de fallas/errores más comunes"
  if (/top|m[aá]s comunes?|ranking|frecuente/.test(q) && /falla|error/.test(q)) {
    const actasEnRango = aplicarRangoFechaGlobal(state.actas, 'Fecha');
    const datos = calcularTopFallas(10, actasEnRango);
    if (!datos.length) {
      resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">🎉</span>No encontré fallas registradas ${document.getElementById('fechaGlobalDesde').value || document.getElementById('fechaGlobalHasta').value ? 'en ese rango de fechas' : 'todavía'}.</div>`;
      return;
    }
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>Top de fallas más comunes <span class="severidad-pill sev-alta">${datos.length}</span></h4>
      <div id="picker_${idContenedor}" class="preferencia-opciones" style="margin-bottom:8px;"></div>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
      <button type="button" class="btn-fijar-panel" data-config='${JSON.stringify({ tipo: 'topFallas', titulo: 'Top de fallas más comunes', pideTabla, columnaTabla: 'Tipo de falla' })}'>📌 Fijar en el Dashboard</button>
    </div>`;
    if (pideTabla) renderizarComoTabla(idContenedor, datos, 'Tipo de falla');
    else renderizarConSelectorTipo(`picker_${idContenedor}`, idContenedor, datos);
    conectarBotonFijarPanel(resultadoCont);
    return;
  }

  // 3) Cruce "<estado> por <campo>" — ej. "no conformidad por aliado", "desacuerdos por técnico".
  // Si el campo para agrupar es temporal (mes/fecha/tendencia/evolución), en vez de contar por
  // categoría se agrupa cronológicamente por mes — para pedidos como "no conformidad por mes".
  const estadoInfo = ESTADOS_RECONOCIDOS.find(e => e.claves.some(k => q.includes(k)));
  const agrupableInfo = CAMPOS_AGRUPABLES.find(c => c.claves.some(k => q.includes(k)));
  if (estadoInfo && agrupableInfo && q.includes('por')) {
    const actasEnRango = aplicarRangoFechaGlobal(state.actas, 'Fecha');
    const filtradas = actasEnRango.filter(a => (a[estadoInfo.campo] || '').toString().toUpperCase() === estadoInfo.valor);
    const nombreEje = agrupableInfo.esTemporal ? 'mes' : agrupableInfo.campo;
    const datos = agrupableInfo.esTemporal ? agregarPorMes(filtradas, agrupableInfo.campo) : agregarPorCategoria(agrupableInfo.campo, filtradas);
    if (!datos.length) {
      resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">🎉</span>No hay actas en "${estadoInfo.valor}" para agrupar por ${escapeHtml(nombreEje)}.</div>`;
      return;
    }
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>${escapeHtml(estadoInfo.valor)} por ${escapeHtml(nombreEje)} <span class="severidad-pill sev-media">${filtradas.length}</span></h4>
      <div id="picker_${idContenedor}" class="preferencia-opciones" style="margin-bottom:8px;"></div>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
      <button type="button" class="btn-fijar-panel" data-config='${JSON.stringify({ tipo: 'cruce', estadoCampo: estadoInfo.campo, estadoValor: estadoInfo.valor, agrupableCampo: agrupableInfo.campo, esTemporal: !!agrupableInfo.esTemporal, titulo: `${estadoInfo.valor} por ${nombreEje}`, pideTabla, columnaTabla: nombreEje })}'>📌 Fijar en el Dashboard</button>
    </div>`;
    if (pideTabla) renderizarComoTabla(idContenedor, datos, nombreEje);
    else renderizarConSelectorTipo(`picker_${idContenedor}`, idContenedor, datos);
    conectarBotonFijarPanel(resultadoCont);
    return;
  }

  // 3.5) Comparar un CAMPO NUMÉRICO (ej. Score) promediado por categoría o por mes —
  // ej. "score por aliado", "score promedio por técnico", "comparar score por mes".
  // Es distinto del cruce anterior: en vez de contar cuántas actas hay, promedia el valor.
  const campoNumericoInfo = CAMPOS_GRAFICABLES.find(c => c.esNumerico && c.claves.some(k => q.includes(k)));
  if (campoNumericoInfo && agrupableInfo && q.includes('por')) {
    const actasEnRango = aplicarRangoFechaGlobal(state.actas, 'Fecha');
    const nombreEje = agrupableInfo.esTemporal ? 'mes' : agrupableInfo.campo;
    const datos = agrupableInfo.esTemporal
      ? agregarPorMes(actasEnRango, agrupableInfo.campo, campoNumericoInfo.campo)
      : promedioPorCategoria(agrupableInfo.campo, campoNumericoInfo.campo, actasEnRango);
    if (!datos.length) {
      resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">📭</span>No hay datos de "${escapeHtml(campoNumericoInfo.campo)}" para promediar por ${escapeHtml(nombreEje)}.</div>`;
      return;
    }
    const titulo = `${campoNumericoInfo.campo} promedio por ${nombreEje}`;
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>${escapeHtml(titulo)}</h4>
      <div id="picker_${idContenedor}" class="preferencia-opciones" style="margin-bottom:8px;"></div>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
      <button type="button" class="btn-fijar-panel" data-config='${JSON.stringify({ tipo: 'promedio', campoNumerico: campoNumericoInfo.campo, agrupableCampo: agrupableInfo.campo, esTemporal: !!agrupableInfo.esTemporal, titulo, pideTabla, columnaTabla: nombreEje })}'>📌 Fijar en el Dashboard</button>
    </div>`;
    if (pideTabla) renderizarComoTabla(idContenedor, datos, nombreEje);
    else renderizarConSelectorTipo(`picker_${idContenedor}`, idContenedor, datos, { modo: 'promedio', etiquetaCentro: campoNumericoInfo.campo.toLowerCase() });
    conectarBotonFijarPanel(resultadoCont);
    return;
  }

  // 3.6) Tendencia general en el tiempo sin campo numérico ni estado — ej. "actas por mes",
  // "tendencia mensual", "evolución de actas" — cuenta actas por mes.
  if (agrupableInfo && agrupableInfo.esTemporal && !estadoInfo && !campoNumericoInfo) {
    const actasEnRango = aplicarRangoFechaGlobal(state.actas, 'Fecha');
    const datos = agregarPorMes(actasEnRango, agrupableInfo.campo);
    if (!datos.length) {
      resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">📭</span>No hay fechas válidas para armar la tendencia.</div>`;
      return;
    }
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>Actas por mes <span class="severidad-pill sev-baja">${actasEnRango.length}</span></h4>
      <div id="picker_${idContenedor}" class="preferencia-opciones" style="margin-bottom:8px;"></div>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
      <button type="button" class="btn-fijar-panel" data-config='${JSON.stringify({ tipo: 'tendencia', agrupableCampo: agrupableInfo.campo, titulo: 'Actas por mes', pideTabla, columnaTabla: 'Mes' })}'>📌 Fijar en el Dashboard</button>
    </div>`;
    if (pideTabla) renderizarComoTabla(idContenedor, datos, 'Mes');
    else renderizarConSelectorTipo(`picker_${idContenedor}`, idContenedor, datos);
    conectarBotonFijarPanel(resultadoCont);
    return;
  }

  // 4) Campo simple (comportamiento original: aliado, ciudad, score, etc.)
  const campoInfo = buscarCampoGraficable(texto);
  if (!campoInfo) {
    resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">🤔</span>
      No reconozco "${escapeHtml(texto)}". Prueba con: aliado, ciudad, tipo medida, técnico,
      supervisión manual, supervisión IA, acuerdo, tipo de acta, revisado, score, "top de fallas",
      cruces como "no conformidad por aliado", promedios como "score por aliado", o tendencias
      como "no conformidad por mes" / "actas por mes". Toca "❓ ¿Qué puedo mostrarte?" para ver todas las opciones.</div>`;
    return;
  }

  if (campoInfo.esNumerico) {
    const actasEnRango = aplicarRangoFechaGlobal(state.actas, 'Fecha');
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>${escapeHtml(campoInfo.campo)} <span class="severidad-pill sev-baja">histograma</span></h4>
      <p class="panel-note" style="margin:0 0 10px;">💡 Es un valor numérico — un histograma muestra mejor cómo se distribuye.</p>
      <div id="${idContenedor}" class="chart-svg-wrap"></div>
    </div>`;
    renderHistograma(idContenedor, actasEnRango);
    return;
  }

  const actasEnRango = aplicarRangoFechaGlobal(state.actas, 'Fecha');
  const datos = agregarPorCategoria(campoInfo.campo, actasEnRango);
  if (!datos.length) {
    resultadoCont.innerHTML = `<div class="asistente-vacio"><span class="emoji">📭</span>No hay datos cargados en "${escapeHtml(campoInfo.campo)}" todavía.</div>`;
    return;
  }

  if (pideTabla) {
    resultadoCont.innerHTML = `<div class="hallazgo-grupo">
      <h4>${escapeHtml(campoInfo.campo)} <span class="severidad-pill sev-baja">${datos.length} valores</span></h4>
      <div id="${idContenedor}"></div>
    </div>`;
    renderizarComoTabla(idContenedor, datos, campoInfo.campo);
    return;
  }

  resultadoCont.innerHTML = `<div class="hallazgo-grupo">
    <h4>${escapeHtml(campoInfo.campo)} <span class="severidad-pill sev-baja">${datos.length} valores</span></h4>
    <div id="picker_${idContenedor}" class="preferencia-opciones" style="margin-bottom:8px;"></div>
    <div id="${idContenedor}" class="chart-svg-wrap"></div>
    <button type="button" class="btn-fijar-panel" data-config='${JSON.stringify({ tipo: 'campo', campo: campoInfo.campo, titulo: campoInfo.campo, pideTabla, columnaTabla: campoInfo.campo })}'>📌 Fijar en el Dashboard</button>
  </div>`;
  const rec = renderizarConSelectorTipo(`picker_${idContenedor}`, idContenedor, datos);
  document.querySelector(`#${idContenedor}`).insertAdjacentHTML('beforebegin',
    `<p class="panel-note" style="margin:0 0 10px;">💡 ${escapeHtml(rec.motivo)} — mostrando como ${NOMBRE_TIPO_GRAFICA[rec.tipo]}. Escribe "tabla de ${campoInfo.campo.toLowerCase()}" si prefieres verlo en tabla.</p>`);
  conectarBotonFijarPanel(resultadoCont);
}

/**
 * Deja arrastrar el botón flotante del asistente a cualquier parte de la
 * pantalla (mouse y touch), recordando la última posición elegida.
 */
function configurarArrastreBoton(btn) {
  const posGuardada = JSON.parse(localStorage.getItem('cce_asistente_pos') || 'null');
  if (posGuardada) {
    // Bug corregido: antes se aplicaba la posición guardada tal cual, sin
    // verificar que siga cabiendo en la pantalla ACTUAL. Si se arrastró el
    // botón en una pantalla ancha (ej. computador) y luego se abre la app en
    // una más angosta (ej. celular, o una ventana más chica), el botón
    // quedaba posicionado fuera del área visible — invisible, sin forma de
    // recuperarlo salvo borrando localStorage. Ahora se recorta (clamp) igual
    // que durante el arrastre, para que siempre quede dentro de la pantalla.
    const left = Math.max(4, Math.min(window.innerWidth - 58 - 4, posGuardada.left));
    const top = Math.max(4, Math.min(window.innerHeight - 58 - 4, posGuardada.top));
    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
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

  // Patrón conocido "V. Servicio con el valor equivocado" — esto NO se
  // corrige solo (el valor real hay que confirmarlo con la foto/PDF), pero sí
  // se le puede generar al aliado una nota lista para copiar y enviarle, para
  // que no repita el mismo error de digitación en futuras actas.
  // - En INDIRECTA: V. Servicio debe llevar la tensión por ALTA — si aparece
  //   un valor bajo (<100), probablemente digitaron la de BAJA por error.
  // - En SEMIDIRECTA: V. Servicio debe ser ≈ V. Baja Trafo/1000 (en kV) — si
  //   en vez de eso quedó igual a V. Alta Trafo, probablemente se pisó con
  //   ese valor durante la sincronización/digitación (mismo síntoma, causa
  //   inversa). Confirmado en campo con el acta #109 (Cartagena, C3 Pronto).
  const patronVServicioBaja = state.actas.filter(a => {
    if ((a['R01 Tensión'] || '').toString().toUpperCase() !== 'FALLA') return false;
    const tipo = (a['Tipo Medida'] || '').toLowerCase();
    const vServ = parseFloat(a['V. Servicio']), vAlta = parseFloat(a['V. Alta Trafo']);
    if (tipo === 'indirecta') return !isNaN(vServ) && !isNaN(vAlta) && vServ < 100 && vAlta >= 1;
    if (tipo === 'semidirecta') return !isNaN(vServ) && !isNaN(vAlta) && Math.abs(vServ - vAlta) < 0.05;
    return false;
  });
  if (patronVServicioBaja.length) grupos.push({
    titulo: 'Patrón de digitación — avisar al aliado (no se corrige solo)', icono: '📣', severidad: 'alta',
    items: patronVServicioBaja.map(a => {
      const tipo = (a['Tipo Medida'] || '').toLowerCase();
      const explicacion = tipo === 'indirecta'
        ? `V. Servicio quedó en ${a['V. Servicio']} (parece ser la tensión de BAJA). En indirecta debe ir la tensión por ALTA (${a['V. Alta Trafo']}).`
        : `V. Servicio quedó igual a V. Alta Trafo (${a['V. Servicio']}). En semidirecta debe ir la tensión por BAJA convertida a kV (≈ ${(parseFloat(a['V. Baja Trafo']) / 1000).toFixed(3)}).`;
      return {
        id: a['#'], texto: `Acta #${a['#']} — ${a['Aliado']} (Técnico: ${a['Técnico'] || 'sin dato'})`,
        detalle: explicacion,
        notaAliado: `Estimado equipo de ${a['Aliado']}: en el acta #${a['#']} (Serie ${a['Serie Medidor'] || 'N/D'}, técnico ${a['Técnico'] || 'N/D'}), la "Tensión del Servicio" quedó mal registrada. ${explicacion} Por favor verificar en campo y tenerlo en cuenta en las próximas instalaciones para evitar que se repita. Gracias.`
      };
    })
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

  // Patrón repetido por TÉCNICO individual: mismo técnico con el mismo tipo de
  // falla 3+ veces, sin importar el aliado. Esto complementa el patrón por
  // aliado — un técnico puede repetir un error aunque su aliado en general
  // esté bien, o puede repartirse entre varios aliados si es subcontratado.
  const patronesPorTecnico = {};
  state.actas.forEach(a => {
    const tecnico = (a['Técnico'] || '').toString().trim();
    if (!tecnico) return;
    ['R01 Tensión', 'R03 Formato'].forEach(campo => {
      const v = (a[campo] || '').toString().toUpperCase();
      if (v && v !== 'OK' && v !== 'PENDIENTE') {
        const clave = tecnico + '|' + campo;
        (patronesPorTecnico[clave] = patronesPorTecnico[clave] || []).push(a);
      }
    });
  });
  const patronesFrecuentesTecnico = Object.entries(patronesPorTecnico).filter(([, arr]) => arr.length >= 3);
  if (patronesFrecuentesTecnico.length) grupos.push({
    titulo: 'Fallas repetidas por técnico — candidato a capacitación individual', icono: '👷', severidad: 'media',
    items: patronesFrecuentesTecnico.map(([clave, arr]) => {
      const [tecnico, campo] = clave.split('|');
      const aliadosInvolucrados = [...new Set(arr.map(a => a['Aliado']).filter(Boolean))];
      return {
        id: arr[0]['#'],
        texto: `${tecnico} — ${campo} fallando ${arr.length} veces`,
        detalle: `Actas # ${arr.map(a => a['#']).join(', ')} · Aliado(s): ${aliadosInvolucrados.join(', ') || 'sin dato'}`,
        notaAliado: `Se detectó que el técnico ${tecnico}${aliadosInvolucrados.length ? ' (' + aliadosInvolucrados.join(', ') + ')' : ''} repitió la falla "${campo}" en ${arr.length} actas (# ${arr.map(a => a['#']).join(', ')}). Se recomienda reforzar capacitación puntual con este técnico en este criterio antes de la próxima ronda de instalaciones.`
      };
    })
  });

  return grupos;
}

/** Categorías OODA que la persona ya abrió/revisó en esta sesión (para el contador de progreso). */
const categoriasOodaRevisadas = new Set();

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

  // Ordenar por severidad (alta primero) y tamaño, para que "Orientar/Decidir" señalen lo correcto
  const gruposOrdenados = grupos.slice().sort((a, b) => {
    const peso = { alta: 3, media: 2, baja: 1 };
    return (peso[b.severidad] - peso[a.severidad]) || (b.items.length - a.items.length);
  });
  const prioridad = gruposOrdenados[0];

  // --- Resumen ejecutivo de una frase — para no tener que armarlo mentalmente
  // leyendo las 4 tarjetas OODA de abajo.
  let html = `<p class="asistente-resumen-frase">
    Encontré <b>${totalItems} hallazgo(s)</b> en <b>${grupos.length} categoría(s)</b> —
    ${criticos ? `<b>${criticos} crítico(s)</b>, ` : ''}lo más urgente es
    <b>"${escapeHtml(prioridad.titulo)}"</b> (${prioridad.items.length} caso(s)).
  </p>`;

  // --- Franja OODA: Observar / Orientar / Decidir / Actuar --------------------
  html += `<div class="franja-ooda">
    <div class="ooda-paso">
      <span class="ooda-etiqueta">👁 Observar</span>
      <span class="ooda-valor">${totalItems} hallazgo(s)</span>
      <span class="ooda-detalle">en ${grupos.length} categoría(s)</span>
    </div>
    <div class="ooda-paso">
      <span class="ooda-etiqueta">🧭 Orientar</span>
      <span class="ooda-valor">${criticos} crítico(s)</span>
      <span class="ooda-detalle">${criticos ? 'requieren atención pronto' : 'nada urgente'}</span>
    </div>
    <div class="ooda-paso ooda-decidir">
      <span class="ooda-etiqueta">🎯 Decidir</span>
      <span class="ooda-valor">${escapeHtml(prioridad.titulo)}</span>
      <span class="ooda-detalle">${prioridad.items.length} caso(s) — empieza por aquí</span>
    </div>
    <div class="ooda-paso ooda-paso-actuar">
      <span class="ooda-etiqueta">⚡ Actuar</span>
      <button type="button" class="ooda-actuar-btn" id="btnOodaActuar">Ir a "${escapeHtml(prioridad.titulo)}"</button>
      <span class="ooda-detalle" id="oodaProgreso">${categoriasOodaRevisadas.size} de ${grupos.length} categoría(s) revisada(s)</span>
    </div>
  </div>`;

  gruposOrdenados.forEach((g, iGrupo) => {
    const abierta = iGrupo === 0; // solo la categoría prioritaria empieza expandida
    if (abierta) categoriasOodaRevisadas.add(g.titulo); // la prioritaria cuenta como revisada al abrir el asistente
    html += `<div class="hallazgo-grupo" id="grupo-ooda-${iGrupo}">
      <h4 class="hallazgo-grupo-toggle" data-toggle-grupo="${iGrupo}" data-titulo-grupo="${escapeHtml(g.titulo)}">
        <span>${g.icono} ${escapeHtml(g.titulo)} <span class="severidad-pill sev-${g.severidad}">${g.items.length}</span></span>
        <span class="chevron-grupo">${abierta ? '▾' : '▸'}</span>
      </h4>
      <div class="hallazgo-items-lista" data-lista-grupo="${iGrupo}" style="${abierta ? '' : 'display:none;'}">`;
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
    html += `</div></div>`;
  });

  cont.innerHTML = html;

  cont.querySelectorAll('.hallazgo-grupo-toggle').forEach(h4 => {
    h4.addEventListener('click', () => {
      const idx = h4.dataset.toggleGrupo;
      const lista = cont.querySelector(`[data-lista-grupo="${idx}"]`);
      const chevron = h4.querySelector('.chevron-grupo');
      const abrir = lista.style.display === 'none';
      lista.style.display = abrir ? '' : 'none';
      chevron.textContent = abrir ? '▾' : '▸';
      if (abrir) {
        categoriasOodaRevisadas.add(h4.dataset.tituloGrupo);
        const progreso = document.getElementById('oodaProgreso');
        if (progreso) progreso.textContent = `${categoriasOodaRevisadas.size} de ${grupos.length} categoría(s) revisada(s)`;
      }
    });
  });

  // "⚡ Actuar" salta directo a la categoría prioritaria (ya viene abierta) y
  // la resalta un momento, para que "actuar" sea un solo clic, no "adivina cuál
  // categoría abrir".
  const btnActuar = document.getElementById('btnOodaActuar');
  if (btnActuar) {
    btnActuar.addEventListener('click', () => {
      const destino = document.getElementById('grupo-ooda-0');
      if (!destino) return;
      destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
      destino.classList.add('grupo-resaltado');
      setTimeout(() => destino.classList.remove('grupo-resaltado'), 1600);
    });
  }

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
  const q = pregunta.toLowerCase();

  // Si claramente es un pedido de ranking/cruce/gráfica ("top de fallas",
  // "no conformidad por aliado", "gráfica de ciudad"...), se resuelve con el
  // mismo motor de "Buscar y graficar" en vez de tratarlo como búsqueda de
  // actas puntuales — así no importa en cuál caja del asistente lo escribas.
  const esRankingDeFallas = /top|m[aá]s comunes?|ranking|frecuente/.test(q) && /falla|error/.test(q);
  const esCruce = ESTADOS_RECONOCIDOS.some(e => e.claves.some(k => q.includes(k))) &&
                  CAMPOS_AGRUPABLES.some(c => c.claves.some(k => q.includes(k))) && q.includes('por');
  const esPedidoDeGrafica = /gr[aá]fica|graficar|tabla de/.test(q);

  if (esRankingDeFallas || esCruce || esPedidoDeGrafica) {
    renderBuscadorGraficas();
    document.getElementById('inputBuscadorGraficas').value = pregunta;
    ejecutarBusquedaGrafica(pregunta);
    return;
  }

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
    state.supervisionDetalle = data.supervisionDetalle || [];

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
  renderTablaSupervisionView();
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

  renderPanelFlexible('chartLinea', calcularActasPorMes().map(p => ({ etiqueta: p.mes.slice(2).replace('-', '/'), valor: p.cantidad })), 'linea');
  renderPanelFlexible('chartArea', calcularScorePromedioPorMes().map(p => ({ etiqueta: p.mes.slice(2).replace('-', '/'), valor: +p.valor.toFixed(1) })), 'linea', 'promedio');
  renderPanelFlexible('chartHistograma', calcularDistribucionScore(), 'barras');

  renderPanelFlexible('chartApilada', k.porTipoMedida.map((t, i) => ({
    etiqueta: t.tipo, valor: t.actas, clase: ['', 'accent', 'success'][i % 3]
  })), 'apilada');

  // Conformidad por aliado — % de no conformidad (no es un conteo: sumar los
  // % de varios aliados no da un "total" con sentido, por eso modo 'promedio').
  renderPanelFlexible('chartAliados', k.porAliado.map(a => ({
    etiqueta: a.aliado, valor: +(a.pctNC * 100).toFixed(1), sufijo: '%',
    clase: a.pctNC > 0.2 ? 'danger' : 'accent'
  })), 'barras', 'promedio');

  // Score por tipo de medida — también es un promedio, mismo criterio.
  renderPanelFlexible('chartTipoMedida', k.porTipoMedida.map(t => ({
    etiqueta: t.tipo, valor: +t.scoreProm.toFixed(1),
    clase: t.scoreProm < 70 ? 'danger' : ''
  })), 'barras', 'promedio');

  // --- Datos por aliado CON Score, calculados aquí mismo del lado del
  // navegador (k.porAliado viene del backend y no trae Score por aliado, así
  // que no se puede reutilizar tal cual para los 3 paneles nuevos de abajo).
  const scoresPorAliado = {};
  state.actas.forEach(a => {
    const al = a['Aliado'] || 'Sin aliado';
    const s = parseFloat(a['Score']);
    if (!scoresPorAliado[al]) scoresPorAliado[al] = { suma: 0, n: 0 };
    if (!isNaN(s)) { scoresPorAliado[al].suma += s; scoresPorAliado[al].n++; }
  });
  const porAliadoConScore = (k.porAliado || []).map(a => ({
    ...a,
    scoreProm: scoresPorAliado[a.aliado] && scoresPorAliado[a.aliado].n
      ? scoresPorAliado[a.aliado].suma / scoresPorAliado[a.aliado].n : 0
  }));

  // --- Panel combinado: %NC (barras) + Score promedio (línea), por aliado ---
  // Junta en un solo panel lo que antes había que comparar mentalmente entre
  // dos tarjetas separadas — si sube la barra (más no conformidad), ¿también
  // baja la línea (peor Score) en ese mismo aliado?
  const topAliadosComb = porAliadoConScore.slice(0, 8);
  if (document.getElementById('chartCombinadoAliado')) {
    renderBarrasConLinea(
      'chartCombinadoAliado',
      topAliadosComb.map(a => a.aliado),
      topAliadosComb.map(a => +(a.pctNC * 100).toFixed(1)),
      topAliadosComb.map(a => +a.scoreProm.toFixed(1)),
      { colorBarra: 'var(--red-600)', colorLinea: 'var(--purple-500)', nombreBarra: '% No conformidad', nombreLinea: 'Score promedio' }
    );
  }

  // --- Gauge: Score general vs meta (85 por defecto) ---
  if (document.getElementById('chartGaugeScore')) {
    const todosLosScores = state.actas.map(a => parseFloat(a['Score'])).filter(v => !isNaN(v));
    const scoreGeneral = todosLosScores.length ? todosLosScores.reduce((s, v) => s + v, 0) / todosLosScores.length : 0;
    renderGauge('chartGaugeScore', scoreGeneral, { max: 100, meta: 85 });
  }

  // --- Radar: hasta 4 aliados con más actas, comparando 3 dimensiones normalizadas ---
  if (document.getElementById('chartRadarAliados')) {
    const coloresRadar = ['var(--purple-500)', 'var(--orange-500)', 'var(--green-600)', 'var(--blue-600)'];
    const topPorVolumen = porAliadoConScore.slice().sort((a, b) => b.actas - a.actas).slice(0, 4);
    const maxActas = Math.max(...porAliadoConScore.map(a => a.actas), 1);
    const seriesRadar = topPorVolumen.map((a, i) => ({
      nombre: a.aliado,
      valores: [a.scoreProm / 100, 1 - a.pctNC, a.actas / maxActas],
      color: coloresRadar[i % coloresRadar.length]
    }));
    renderRadar('chartRadarAliados', ['Score', '% Conforme', 'Volumen de actas'], seriesRadar);
  }

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

  // Hallazgos por aliado (solo si la pestaña "Hallazgos" existe en la fuente Y
  // además el usuario no lo ocultó con "✕"/"Limpiar" — antes esto se mostraba
  // siempre que hubiera datos, sin importar la preferencia del usuario).
  const panelHallazgos = document.getElementById('panelHallazgos');
  const hayDatosHallazgos = state.hallazgosPorAliado && state.hallazgosPorAliado.length;
  if (hayDatosHallazgos && obtenerPanelesVisibles().includes('Hallazgos por aliado')) {
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

  // Supervisión Manual completa (opcional — solo si la pestaña "Supervision" existe)
  const panelSupervision = document.getElementById('panelSupervision');
  if (state.supervisionDetalle && state.supervisionDetalle.length) {
    panelSupervision.style.display = '';
    const filtradas = supervisionFiltrada();
    const conteo = { Conforme: 0, 'No conforme': 0 };
    filtradas.forEach(s => {
      const v = (s['Conforme'] || '').toString().trim();
      if (v === 'Conforme' || v === 'No conforme') conteo[v]++;
    });
    renderPanelFlexible('chartSupervision', [
      { etiqueta: 'Conforme', valor: conteo['Conforme'], clase: 'success' },
      { etiqueta: 'No conforme', valor: conteo['No conforme'], clase: 'danger' }
    ], 'dona');
  } else {
    panelSupervision.style.display = 'none';
  }

  renderPanelesPersonalizados();
  aplicarVisibilidadPaneles(); // los paneles recién reconstruidos deben respetar el estado oculto/visible actual
}

/**
 * Filtra el detalle de "Supervision" (formulario manual completo) según el
 * selector de Tipo de Medida, cruzando por Serie Medidor con las actas de
 * "Datos completos" — igual que ya se hace con el panel de Hallazgos.
 */
function supervisionFiltrada() {
  const tipoElegido = document.getElementById('filtroSupervisionTipo').value;
  let datos = state.supervisionDetalle;

  if (tipoElegido === 'semi_indirecta') {
    const serieATipo = {};
    state.actas.forEach(a => {
      const serie = (a['Serie Medidor'] || '').toString().trim();
      if (serie) serieATipo[serie] = (a['Tipo Medida'] || '').toString().trim().toLowerCase();
    });
    datos = datos.filter(s => {
      const tipo = serieATipo[(s['Serie Medidor'] || '').toString().trim()];
      return tipo === 'semidirecta' || tipo === 'indirecta';
    });
  } else if (tipoElegido) {
    datos = filtrarPorTipoMedidaCruzado(datos, 'Serie Medidor', tipoElegido);
  }

  const desde = document.getElementById('filtroSupervisionFechaDesde').value;
  const hasta = document.getElementById('filtroSupervisionFechaHasta').value;
  if (desde) datos = datos.filter(s => (s['Fecha Ejecucion OS'] || '').toString().slice(0, 10) >= desde);
  if (hasta) datos = datos.filter(s => (s['Fecha Ejecucion OS'] || '').toString().slice(0, 10) <= hasta);

  return datos;
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
 * segmentos: [{ etiqueta, valor, color }].
 * opciones.modo: 'suma' (default) | 'promedio' — en 'promedio' los valores
 * son promedios de distintas categorías (ej. Score por aliado) y NO se deben
 * sumar entre sí ni mostrarse como "% del total", porque no son partes de un
 * mismo todo. En ese modo el centro muestra el promedio general en vez de la
 * suma, y la leyenda no muestra porcentaje.
 */
/**
 * Medidor tipo velocímetro (gauge) — para mostrar UN valor contra una meta,
 * con zonas de color (rojo/ámbar/verde) igual que recomiendan las guías de
 * dashboards profesionales para "progreso hacia una meta". Los valores de
 * "zonas" son proporciones de 0 a 1 sobre el máximo.
 */
function renderGauge(contenedorId, valor, opciones) {
  opciones = opciones || {};
  const max = opciones.max || 100;
  const meta = opciones.meta;
  const w = 240, h = 150, cx = w / 2, cy = h - 14, r = 92;
  const pct = Math.max(0, Math.min(1, valor / max));
  const zonas = opciones.zonas || [
    { desde: 0, hasta: 0.5, color: 'var(--red-600)' },
    { desde: 0.5, hasta: 0.8, color: 'var(--amber-700)' },
    { desde: 0.8, hasta: 1, color: 'var(--green-600)' }
  ];
  const punto = (p, radio) => {
    const a = Math.PI - p * Math.PI;
    return { x: cx + Math.cos(a) * radio, y: cy - Math.sin(a) * radio };
  };

  const arcos = zonas.map(z => {
    const p0 = punto(z.desde, r), p1 = punto(z.hasta, r);
    const largeArc = (z.hasta - z.desde) > 0.5 ? 1 : 0;
    return `<path d="M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} 1 ${p1.x} ${p1.y}" fill="none" stroke="${z.color}" stroke-width="16" opacity="0.3"/>`;
  }).join('');

  const puntaAguja = punto(pct, r - 12);
  const colorValor = pct >= 0.8 ? 'var(--green-600)' : pct >= 0.5 ? 'var(--amber-700)' : 'var(--red-600)';
  let marcaMeta = '';
  if (meta != null) {
    const pMeta = punto(meta / max, r);
    const pMeta2 = punto(meta / max, r - 20);
    marcaMeta = `<line x1="${pMeta.x}" y1="${pMeta.y}" x2="${pMeta2.x}" y2="${pMeta2.y}" stroke="var(--ink-900)" stroke-width="2" stroke-dasharray="2,2"/>`;
  }

  const svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="150">
    ${arcos}${marcaMeta}
    <line x1="${cx}" y1="${cy}" x2="${puntaAguja.x}" y2="${puntaAguja.y}" stroke="var(--ink-900)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="var(--ink-900)"/>
    <text x="${cx}" y="${cy - 32}" text-anchor="middle" font-size="26" font-weight="800" fill="${colorValor}" font-family="var(--font-mono)">${(Math.round(valor * 10) / 10)}</text>
    ${meta != null ? `<text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="10" fill="var(--ink-500)">Meta: ${meta}</text>` : ''}
  </svg>`;
  document.getElementById(contenedorId).innerHTML = svg;
}

/**
 * Radar/araña — para comparar varias métricas de una misma categoría a la
 * vez (ej. un aliado en Score, %Conforme, Sellos OK...) en una sola forma.
 * "series": [{ nombre, valores (0 a 1, ya normalizados), color }].
 */
function renderRadar(contenedorId, ejes, series) {
  const w = 280, h = 280, cx = w / 2, cy = h / 2, r = 95;
  const n = ejes.length;
  const anguloPor = (2 * Math.PI) / n;
  const punto = (i, p) => {
    const a = -Math.PI / 2 + i * anguloPor;
    return { x: cx + Math.cos(a) * r * p, y: cy + Math.sin(a) * r * p };
  };

  const rejilla = [0.25, 0.5, 0.75, 1].map(p =>
    `<polygon points="${ejes.map((_, i) => { const pt = punto(i, p); return pt.x + ',' + pt.y; }).join(' ')}" fill="none" stroke="var(--ink-100)" stroke-width="1"/>`
  ).join('');
  const ejesLineas = ejes.map((_, i) => { const p = punto(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="var(--ink-100)" stroke-width="1"/>`; }).join('');
  const etiquetas = ejes.map((e, i) => { const p = punto(i, 1.2); return `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="9" fill="var(--ink-700)">${escapeHtml(e)}</text>`; }).join('');
  const poligonos = series.map(s => {
    const pts = s.valores.map((v, i) => punto(i, Math.max(0, Math.min(1, v))));
    return `<polygon points="${pts.map(p => p.x + ',' + p.y).join(' ')}" fill="${s.color}" fill-opacity="0.22" stroke="${s.color}" stroke-width="2"/>` +
      pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${s.color}"/>`).join('');
  }).join('');

  const leyenda = series.map(s => `<span class="chart-leyenda-item"><span class="chart-leyenda-dot" style="background:${s.color}"></span>${escapeHtml(s.nombre)}</span>`).join('');
  document.getElementById(contenedorId).innerHTML =
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="260">${rejilla}${ejesLineas}${poligonos}${etiquetas}</svg><div class="chart-leyenda">${leyenda}</div>`;
}

/**
 * Barras + línea combinadas en un solo panel (2 escalas independientes) —
 * para ver de un vistazo si dos métricas relacionadas se mueven juntas (ej.
 * % de no conformidad vs Score, por aliado), sin tener que comparar 2
 * tarjetas separadas mentalmente.
 */
function renderBarrasConLinea(contenedorId, categorias, valoresBarra, valoresLinea, opciones) {
  opciones = opciones || {};
  const w = 520, h = 220, pad = { top: 24, right: 16, bottom: 34, left: 16 };
  const innerW = w - pad.left - pad.right, innerH = h - pad.top - pad.bottom;
  const n = categorias.length, gap = innerW / n, anchoBarra = gap * 0.5;
  const maxBarra = Math.max(...valoresBarra, 1);
  const maxLinea = Math.max(...valoresLinea, 1), minLinea = Math.min(...valoresLinea, 0);
  const colorBarra = opciones.colorBarra || 'var(--purple-500)';
  const colorLinea = opciones.colorLinea || 'var(--orange-500)';

  const barras = valoresBarra.map((v, i) => {
    const x = pad.left + i * gap + (gap - anchoBarra) / 2;
    const altura = (v / maxBarra) * innerH;
    const y = pad.top + innerH - altura;
    return `<rect x="${x}" y="${y}" width="${anchoBarra}" height="${altura}" fill="${colorBarra}" rx="3"><title>${escapeHtml(String(categorias[i]))}: ${v}</title></rect>
      <text x="${x + anchoBarra / 2}" y="${y - 4}" text-anchor="middle" font-size="8.5" fill="var(--ink-700)">${v}</text>`;
  }).join('');

  const rango = (maxLinea - minLinea) || 1;
  const puntosLinea = valoresLinea.map((v, i) => ({
    x: pad.left + i * gap + gap / 2,
    y: pad.top + innerH - ((v - minLinea) / rango) * innerH, v
  }));
  const pathLinea = puntosLinea.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');
  const circulos = puntosLinea.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${colorLinea}"><title>${opciones.nombreLinea || 'valor'}: ${p.v}</title></circle>
    <text x="${p.x}" y="${p.y - 7}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${colorLinea}">${p.v}</text>`).join('');
  const etiquetas = categorias.map((c, i) => `<text x="${pad.left + i * gap + gap / 2}" y="${h - 10}" text-anchor="middle" font-size="8" fill="var(--ink-500)">${escapeHtml(String(c).slice(0, 10))}</text>`).join('');

  const leyenda = `<span class="chart-leyenda-item"><span class="chart-leyenda-dot" style="background:${colorBarra}"></span>${escapeHtml(opciones.nombreBarra || 'Barras')}</span>
    <span class="chart-leyenda-item"><span class="chart-leyenda-dot" style="background:${colorLinea}"></span>${escapeHtml(opciones.nombreLinea || 'Línea')}</span>`;

  document.getElementById(contenedorId).innerHTML =
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="220">${barras}<path d="${pathLinea}" fill="none" stroke="${colorLinea}" stroke-width="2.5"/>${circulos}${etiquetas}</svg>
     <div class="chart-leyenda">${leyenda}</div>`;
}

function renderDona(contenedorId, segmentos, opciones) {
  opciones = opciones || {};
  const modoPromedio = opciones.modo === 'promedio';
  const cont = document.getElementById(contenedorId);
  const suma = segmentos.reduce((s, x) => s + x.valor, 0);
  if (!suma && !segmentos.length) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }

  const r = 60, cx = 80, cy = 80, grosor = 22;
  const circunferencia = 2 * Math.PI * r;
  let acumulado = 0;
  // En modo promedio, el ancho de cada arco no puede representar "% del total"
  // (no existe tal total) — se reparte en partes iguales, la longitud del arco
  // ya no es informativa por sí sola, así que el valor real va en el tooltip
  // y la leyenda, no en el tamaño del arco.
  const pesoIgual = 1 / (segmentos.filter(s => s.valor > 0).length || 1);

  const arcos = segmentos.filter(s => s.valor > 0).map(s => {
    const pct = modoPromedio ? pesoIgual : (s.valor / suma);
    const largo = pct * circunferencia;
    const offset = -acumulado * circunferencia;
    acumulado += pct;
    const tituloPct = modoPromedio ? '' : ` (${(pct * 100).toFixed(0)}%)`;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:${s.color}"
      stroke-width="${grosor}" stroke-dasharray="${largo} ${circunferencia - largo}"
      stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"><title>${escapeHtml(String(s.etiqueta))}: ${s.valor}${tituloPct}</title></circle>`;
  }).join('');

  const valorCentro = modoPromedio ? (suma / (segmentos.length || 1)) : suma;
  const etiquetaCentro = opciones.etiquetaCentro || (modoPromedio ? 'promedio' : 'actas');
  const svg = `<svg viewBox="0 0 160 160" width="180" height="180">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--ink-100)" stroke-width="${grosor}"></circle>
    ${arcos}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="dona-centro-valor">${modoPromedio ? valorCentro.toFixed(1) : valorCentro}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="dona-centro-label">${escapeHtml(etiquetaCentro)}</text>
  </svg>`;

  const leyenda = segmentos.map(s => `
    <span class="chart-leyenda-item">
      <span class="chart-leyenda-dot" style="background:${s.color}"></span>
      ${escapeHtml(s.etiqueta)}: <b>${s.valor}</b>${modoPromedio ? '' : ` (${suma ? ((s.valor / suma) * 100).toFixed(0) : 0}%)`}
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
 * Histograma — agrupa el Score de todas las actas en rangos (0-59, 60-69...
 * 90-100) y muestra cuántas actas caen en cada rango. Es la forma más clara
 * de ver si tus actas se concentran en scores altos o bajos.
 */
/** Igual que renderHistograma pero devuelve los datos en formato genérico {etiqueta,valor,clase}
 *  para poder alimentar cualquier tipo de gráfica (no solo el histograma de barras fijo). */
function calcularDistribucionScore(actasFuente) {
  const cortes = [
    { desde: 0, hasta: 59, etiqueta: '0-59', clase: 'danger' },
    { desde: 60, hasta: 69, etiqueta: '60-69', clase: 'warning' },
    { desde: 70, hasta: 79, etiqueta: '70-79', clase: 'warning' },
    { desde: 80, hasta: 89, etiqueta: '80-89', clase: 'success' },
    { desde: 90, hasta: 100, etiqueta: '90-100', clase: 'success' }
  ];
  const conteo = cortes.map(c => ({ etiqueta: c.etiqueta, valor: 0, clase: c.clase, desde: c.desde, hasta: c.hasta }));
  (actasFuente || state.actas).forEach(a => {
    const score = parseFloat(a['Score']);
    if (isNaN(score)) return;
    const bucket = conteo.find(c => score >= c.desde && score <= c.hasta);
    if (bucket) bucket.valor++;
  });
  return conteo;
}

function renderHistograma(contenedorId, actasFuente) {
  const cont = document.getElementById(contenedorId);
  const cortes = [
    { desde: 0, hasta: 59, etiqueta: '0-59' },
    { desde: 60, hasta: 69, etiqueta: '60-69' },
    { desde: 70, hasta: 79, etiqueta: '70-79' },
    { desde: 80, hasta: 89, etiqueta: '80-89' },
    { desde: 90, hasta: 100, etiqueta: '90-100' }
  ];
  const conteo = cortes.map(c => ({ ...c, cantidad: 0 }));

  (actasFuente || state.actas).forEach(a => {
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
/**
 * Barra apilada — para conteos (partes de un total) por default. Si
 * opciones.modo === 'promedio', los valores no son partes de un todo (ej.
 * Score promedio por aliado) y el ancho de cada segmento se reparte en partes
 * iguales en vez de "% del total" — el valor real va en el texto/tooltip.
 */
function renderBarraApilada(contenedorId, segmentos, opciones) {
  opciones = opciones || {};
  const modoPromedio = opciones.modo === 'promedio';
  const cont = document.getElementById(contenedorId);
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  if (!total && !segmentos.length) { cont.innerHTML = '<p style="color:var(--ink-500);font-size:13px;">Sin datos aún.</p>'; return; }
  const visibles = segmentos.filter(s => s.valor > 0);
  const pesoIgual = 100 / (visibles.length || 1);

  const track = visibles.map(s => {
    const pct = modoPromedio ? pesoIgual : (s.valor / total) * 100;
    const etiquetaSegmento = modoPromedio ? String(s.valor) : pct.toFixed(0) + '%';
    const tituloPct = modoPromedio ? '' : ` (${pct.toFixed(0)}%)`;
    return `<span class="apilada-segmento" style="width:${pct}%;background:${s.color}" title="${escapeHtml(String(s.etiqueta))}: ${s.valor}${tituloPct}">${pct >= 8 ? etiquetaSegmento : ''}</span>`;
  }).join('');

  const leyenda = segmentos.map(s => `
    <span class="chart-leyenda-item">
      <span class="chart-leyenda-dot" style="background:${s.color}"></span>
      ${escapeHtml(s.etiqueta)}: <b>${s.valor}</b>
    </span>`).join('');

  cont.innerHTML = `<div class="apilada-track">${track}</div><div class="chart-leyenda">${leyenda}</div>`;
}

// ============================================================================
// OPCIONES DEL POWERPOINT — antes de generar, se pregunta qué incluir
// (en vez de armar siempre las mismas 8 diapositivas con todo).
// ============================================================================
const SECCIONES_PPT = [
  { id: 'hallazgosClave', nombre: '📌 Hallazgos clave (texto)' },
  { id: 'resumen', nombre: 'Resumen ejecutivo (tarjetas KPI)' },
  { id: 'conformidadGeneral', nombre: 'Conformidad general' },
  { id: 'porAliado', nombre: 'Conformidad por aliado' },
  { id: 'topFallas', nombre: 'Top de fallas más comunes' },
  { id: 'scorePorTipo', nombre: 'Score por tipo de medida' },
  { id: 'desacuerdos', nombre: 'Desacuerdos T≠U' },
  { id: 'conclusiones', nombre: '🧩 Conclusiones y recomendaciones' }
];

function renderOpcionesPowerPoint() {
  const cont = document.getElementById('asistenteContenido');
  cont.innerHTML = `
    <div class="asistente-resumen">
      <span class="emoji">📽️</span>
      <div><strong>¿Qué tipo de presentación quieres?</strong>
      <span>Completa (10 diapositivas) o reducida (1-2 tarjetas ejecutivas)</span></div>
    </div>
    <div class="preferencia-opciones" style="margin-bottom:14px;">
      <button type="button" class="btn-opcion-grafica is-active" data-modo-ppt="completa">📽️ Completa</button>
      <button type="button" class="btn-opcion-grafica" data-modo-ppt="reducida">📇 Reducida (tarjetas)</button>
      <button type="button" class="btn-opcion-grafica" data-modo-ppt="interactiva">🖥️ Interactiva (HTML editable)</button>
    </div>
    <div class="asistente-pregunta" style="padding:0 0 6px; flex-direction:column; align-items:stretch;">
      <label style="font-size:12px; font-weight:600; color:var(--ink-500); margin-bottom:4px;">➕ ¿Alguna gráfica o dato específico que quieras incluir? (opcional)</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="pptConsultaLibre" placeholder="Ej: score por aliado, no conformidad por mes…" style="flex:1;">
        <button type="button" class="btn btn-ghost btn-icon" id="btnPptSugerir">🤖 Sugerir</button>
      </div>
      <p class="panel-note" id="pptNotaSugerencia" style="margin:6px 0 0;"></p>
    </div>
    <div id="opcionesPptInteractiva" style="display:none;">
      <p class="panel-note" style="margin:0 0 12px;">Abre una presentación en pantalla que puedes editar (títulos, notas, tipo de gráfica) antes de descargarla — en HTML o en PowerPoint, con el mismo contenido que hayas dejado. Si escribiste algo arriba, se agrega como una diapositiva extra.</p>
    </div>
    <div id="opcionesPptCompleta">
      <div class="preferencia-opciones" style="flex-direction:column; align-items:stretch; margin-bottom:12px;">
        ${SECCIONES_PPT.map(s => `
          <label style="display:flex; align-items:center; gap:8px; padding:6px 2px; font-size:12.5px; color:var(--ink-700);">
            <input type="checkbox" class="chk-seccion-ppt" value="${s.id}" checked> ${escapeHtml(s.nombre)}
          </label>`).join('')}
      </div>
    </div>
    <div id="opcionesPptReducida" style="display:none;">
      <div class="preferencia-opciones" style="flex-direction:column; align-items:stretch; margin-bottom:12px;">
        <label style="display:flex; align-items:center; gap:8px; padding:6px 2px; font-size:12.5px; color:var(--ink-700);">
          <input type="checkbox" class="chk-tarjeta-ppt" value="noConformidad" checked> Tarjeta 1: Tasa de No Conformidad
        </label>
        <label style="display:flex; align-items:center; gap:8px; padding:6px 2px; font-size:12.5px; color:var(--ink-700);">
          <input type="checkbox" class="chk-tarjeta-ppt" value="porAliado" checked> Tarjeta 2: Riesgo por aliado
        </label>
      </div>
      <p class="panel-note" style="margin:0 0 12px;">Formato "tarjeta ejecutiva": número, título, gráfica + tabla, mini-indicadores de estado y nota — igual al ejemplo que compartiste.</p>
    </div>
    <div class="asistente-pregunta" style="padding:0 0 14px;">
      <label class="toolbar-date-label">Desde <input type="date" id="pptFechaDesde"></label>
      <label class="toolbar-date-label">Hasta <input type="date" id="pptFechaHasta"></label>
    </div>
    <button type="button" class="btn btn-primary btn-block" id="btnGenerarPptConOpciones">📽️ Generar PowerPoint</button>
    <button class="btn btn-ghost btn-block" id="btnVolverDesdePpt" style="margin-top:10px;">← Volver al diagnóstico</button>
  `;

  let modoActual = 'completa';
  cont.querySelectorAll('[data-modo-ppt]').forEach(btn => {
    btn.addEventListener('click', () => {
      modoActual = btn.dataset.modoPpt;
      cont.querySelectorAll('[data-modo-ppt]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.getElementById('opcionesPptCompleta').style.display = modoActual === 'completa' ? '' : 'none';
      document.getElementById('opcionesPptReducida').style.display = modoActual === 'reducida' ? '' : 'none';
      document.getElementById('opcionesPptInteractiva').style.display = modoActual === 'interactiva' ? '' : 'none';
      document.getElementById('btnGenerarPptConOpciones').textContent = modoActual === 'interactiva' ? '🖥️ Abrir presentación interactiva' : '📽️ Generar PowerPoint';
    });
  });

  document.getElementById('btnVolverDesdePpt').addEventListener('click', renderAsistente);

  document.getElementById('btnPptSugerir').addEventListener('click', () => {
    const gruposOODA = ejecutarDiagnostico();
    const nota = document.getElementById('pptNotaSugerencia');
    if (!gruposOODA.length) { nota.textContent = 'No hay hallazgos suficientes ahora mismo para sugerir algo — no cambié nada.'; return; }
    const prioridad = gruposOODA.slice().sort((a, b) => b.items.length - a.items.length)[0];

    if (modoActual === 'completa') {
      // Marca solo las secciones que aportan algo real ahora mismo, según los
      // datos actuales — no una lista fija de checkboxes.
      const relevantes = new Set(['resumen', 'conformidad']);
      if (state.hallazgosPorAliado && state.hallazgosPorAliado.length) relevantes.add('aliados');
      if (calcularTopFallas(1, state.actas).length) relevantes.add('topFallas');
      relevantes.add('conclusiones');
      cont.querySelectorAll('.chk-seccion-ppt').forEach(chk => { chk.checked = relevantes.has(chk.value); });
      nota.textContent = `Marqué las secciones con datos relevantes ahora mismo (destaca: "${prioridad.titulo}"). Para incluir Desacuerdos Manual≠IA o el formulario de Supervisión como gráfica aparte, usa "Interactiva".`;
    } else if (modoActual === 'reducida') {
      const hayAliadosRiesgo = state.hallazgosPorAliado && state.hallazgosPorAliado.length;
      cont.querySelectorAll('.chk-tarjeta-ppt').forEach(chk => {
        if (chk.value === 'noConformidad') chk.checked = true;
        if (chk.value === 'porAliado') chk.checked = !!hayAliadosRiesgo;
      });
      nota.textContent = `Sugerido según tus datos actuales — lo más urgente es "${prioridad.titulo}" (${prioridad.items.length} caso(s)). Para Desacuerdos Manual≠IA o el formulario de Supervisión, usa "Interactiva".`;
    } else {
      // Para la interactiva: sugerencias CONCRETAS ya verificadas con datos reales,
      // una de cada fuente pedida (Datos completos, Desacuerdos Manual≠IA, Formulario).
      const sugerencias = generarSugerenciasPresentacion();
      if (!sugerencias.length) {
        nota.textContent = 'No encontré datos suficientes en Datos completos, Desacuerdos ni en el formulario de Supervisión para sugerir algo ahora mismo.';
      } else {
        nota.innerHTML = 'Elige una (ya verificada con datos reales):<br>' + sugerencias.map(s =>
          `<button type="button" class="btn-opcion-grafica btn-sugerencia-guiada" data-consulta="${escapeHtml(s.texto)}" style="margin:4px 4px 0 0;">${escapeHtml(s.resultado.titulo)}</button>`
        ).join('');
        nota.querySelectorAll('.btn-sugerencia-guiada').forEach(btn => {
          btn.addEventListener('click', () => { document.getElementById('pptConsultaLibre').value = btn.dataset.consulta; });
        });
      }
    }
  });

  document.getElementById('btnGenerarPptConOpciones').addEventListener('click', (e) => {
    const desde = document.getElementById('pptFechaDesde').value;
    const hasta = document.getElementById('pptFechaHasta').value;
    const consultaLibre = document.getElementById('pptConsultaLibre').value.trim();
    if (modoActual === 'interactiva') {
      abrirPresentacionInteractiva(desde, hasta, consultaLibre);
    } else if (modoActual === 'reducida') {
      const tarjetas = {};
      cont.querySelectorAll('.chk-tarjeta-ppt').forEach(chk => { tarjetas[chk.value] = chk.checked; });
      generarPowerPointReducido(tarjetas, desde, hasta, e.target);
    } else {
      const secciones = {};
      cont.querySelectorAll('.chk-seccion-ppt').forEach(chk => { secciones[chk.value] = chk.checked; });
      generarPowerPoint(secciones, desde, hasta, e.target);
    }
  });
}

/**
 * Presentación interactiva en pantalla, editable ANTES de descargar — títulos
 * y notas son contenteditable, cada gráfica tiene su propio selector de tipo
 * (reutiliza dibujarTipoGrafica, con tooltips nativos al pasar el mouse).
 * Desde aquí se puede descargar como HTML autónomo o como PowerPoint, con el
 * contenido exactamente como haya quedado editado en pantalla.
 */
/** CSS autosuficiente para el archivo HTML exportado — no depende de style.css
 *  (que no viaja con el archivo), así que se ve igual al abrirlo en cualquier
 *  computador, sin conexión a tu sitio. */
const CSS_PRESENTACION_EXPORTABLE = `
  :root { --purple-900:#3A1259; --purple-700:#5B1E8C; --purple-500:#7028AE; --purple-100:#F3E8FF;
    --orange-500:#FF7900; --orange-100:#FFF1E0; --ink-900:#1A1F2B; --ink-700:#344055; --ink-500:#667085;
    --ink-100:#F2F4F7; --canvas:#F3F2F1; --radius:12px;
    --shadow-lg:0 16px 40px rgba(58,18,89,0.16),0 2px 6px rgba(58,18,89,0.06); --font-mono:'JetBrains Mono',monospace; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Inter, -apple-system, sans-serif;
    background: linear-gradient(165deg, var(--purple-900), var(--purple-700) 55%, var(--purple-500)); }
  .presentacion-viewport { display:flex; align-items:center; justify-content:center; position:relative; padding:20px 70px; }
  .presentacion-nav { position:absolute; top:50%; transform:translateY(-50%); width:44px; height:44px; border-radius:50%;
    border:none; background:rgba(255,255,255,0.15); color:white; font-size:22px; cursor:pointer; }
  .presentacion-nav:hover { background:rgba(255,255,255,0.3); }
  .presentacion-nav-prev { left:16px; } .presentacion-nav-next { right:16px; }
  .presentacion-slides { position:relative; width:100%; max-width:1000px; height:100%; }
  .slide-presentacion { position:absolute; inset:0; display:none; flex-direction:column; background:white;
    border-radius:var(--radius); padding:40px 48px; box-shadow:var(--shadow-lg); overflow-y:auto; }
  .slide-presentacion.is-active { display:flex; }
  .slide-portada { align-items:flex-start; justify-content:center;
    background:linear-gradient(135deg, var(--purple-900), var(--purple-500) 70%, var(--orange-500)); color:white; }
  .slide-portada-marca { font-size:22px; font-weight:800; margin-bottom:40px; }
  .slide-portada-marca span { color:var(--orange-100); }
  .slide-logo { position:absolute; top:24px; right:28px; width:130px; height:auto; }
  .slide-logo-oscuro { background:white; border-radius:8px; padding:6px 10px; }
  .slide-iconos-redes { position:absolute; bottom:20px; left:28px; height:18px; }
  .slide-portada h1 { font-size:46px; font-weight:800; margin:0 0 14px; }
  .slide-subtitulo { font-size:18px; margin:0 0 8px; opacity:0.92; }
  .slide-rango { font-size:12.5px; opacity:0.75; margin:0; }
  .slide-cabecera { display:flex; align-items:center; gap:12px; margin-bottom:20px; }
  .slide-icono { width:44px; height:44px; border-radius:12px; background:linear-gradient(135deg, var(--purple-500), var(--purple-700));
    color:white; font-size:20px; display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow-lg); }
  .slide-presentacion h2 { font-size:22px; font-weight:800; color:var(--ink-900); margin:0; flex:1; }
  .slide-cuerpo { display:grid; grid-template-columns:1.3fr 1fr; gap:22px; flex:1; min-height:0; }
  .slide-grafica-wrap, .slide-tabla-wrap { background:var(--canvas); border-radius:12px; padding:16px; box-shadow:inset 0 0 0 1px var(--ink-100); }
  .slide-nota { margin:18px 0 0; padding:12px 16px; font-size:13px; color:var(--ink-700); background:var(--orange-100); border-radius:10px; }
  .presentacion-puntos { display:flex; justify-content:center; gap:8px; padding:14px; }
  .punto-presentacion { width:9px; height:9px; border-radius:50%; border:none; background:rgba(255,255,255,0.35); cursor:pointer; padding:0; }
  .punto-presentacion.is-active { background:white; transform:scale(1.3); }
  .data-table { border-collapse:collapse; width:100%; font-size:12.5px; }
  .data-table thead th { background:linear-gradient(135deg, var(--purple-700), var(--purple-500)); color:white; text-align:left; padding:9px 12px; }
  .data-table tbody td { padding:8px 12px; border-bottom:1px solid var(--ink-100); color:var(--ink-700); }
  .data-table tbody tr:nth-child(even) { background:var(--ink-100); }
  .chart-svg-wrap { display:flex; flex-direction:column; align-items:center; gap:10px; }
  .chart-svg-wrap svg { max-width:100%; }
  .preferencia-opciones { display:none; } /* el selector de tipo no aplica en el archivo ya exportado */
  @media (max-width:900px){ .slide-cuerpo{grid-template-columns:1fr;} .presentacion-viewport{padding:16px 50px;} .slide-presentacion{padding:26px 22px;} }
`;

/**
 * Versión simplificada del motor de "Buscar y graficar", pensada para
 * agregar UNA diapositiva extra a la presentación interactiva a partir de
 * texto libre (ej. "score por aliado", "no conformidad por mes"). Reutiliza
 * los mismos catálogos (CAMPOS_GRAFICABLES, ESTADOS_RECONOCIDOS,
 * CAMPOS_AGRUPABLES) para que reconozca las mismas frases. Devuelve
 * { titulo, datos, esPromedio } o null si no reconoce nada.
 */
function interpretarConsultaLibre(texto) {
  if (!texto) return null;
  const q = texto.toLowerCase().trim();
  const actasEnRango = state.actas;

  // "formulario X [por Y]" — datos del formulario de Supervisión Manual (Microsoft Forms),
  // distintos de "Datos completos". Se activa solo si la palabra "formulario" aparece.
  if (q.includes('formulario')) {
    const fuente = state.supervisionDetalle || [];
    const sinFormulario = q.replace('formulario', '').trim();
    const partes = sinFormulario.split(' por ');
    const buscarEn = (texto) => CAMPOS_SUPERVISION.find(c => c.claves.some(k => texto.includes(k)));

    if (partes.length === 2) {
      // "formulario <medida> por <agrupador>" — ej. "formulario no conformidad por aliado"
      const campoInfoSup = buscarEn(partes[0]);
      const agrupableSup = buscarEn(partes[1]);
      if (campoInfoSup && agrupableSup) {
        // Solo cuenta los registros donde ese campo SÍ tiene algo registrado
        // (no vacío / "No" / "N/A") — así "no conformidad por aliado" cuenta
        // hallazgos reales, no todos los registros sin distinción.
        const filtradas = fuente.filter(r => {
          const v = (r[campoInfoSup.campo] || '').toString().trim().toLowerCase();
          return v && v !== 'no' && v !== 'n/a' && v !== 'ninguno';
        });
        return { titulo: `Formulario: ${campoInfoSup.campo} por ${agrupableSup.campo}`, datos: agregarPorCategoria(agrupableSup.campo, filtradas), esPromedio: false };
      }
    }
    const campoInfoSup = buscarEn(sinFormulario);
    if (campoInfoSup) {
      return { titulo: `Formulario: ${campoInfoSup.campo}`, datos: agregarPorCategoria(campoInfoSup.campo, fuente), esPromedio: false };
    }
    return null;
  }

  const estadoInfo = ESTADOS_RECONOCIDOS.find(e => e.claves.some(k => q.includes(k)));
  const agrupableInfo = CAMPOS_AGRUPABLES.find(c => c.claves.some(k => q.includes(k)));
  const campoNumericoInfo = CAMPOS_GRAFICABLES.find(c => c.esNumerico && c.claves.some(k => q.includes(k)));
  const campoInfo = CAMPOS_GRAFICABLES.find(c => c.claves.some(k => q.includes(k)));

  if (campoNumericoInfo && agrupableInfo) {
    const nombreEje = agrupableInfo.esTemporal ? 'mes' : agrupableInfo.campo;
    const datos = agrupableInfo.esTemporal
      ? agregarPorMes(actasEnRango, agrupableInfo.campo, campoNumericoInfo.campo)
      : promedioPorCategoria(agrupableInfo.campo, campoNumericoInfo.campo, actasEnRango);
    return { titulo: `${campoNumericoInfo.campo} promedio por ${nombreEje}`, datos, esPromedio: true };
  }
  if (estadoInfo && agrupableInfo) {
    const filtradas = actasEnRango.filter(a => (a[estadoInfo.campo] || '').toString().toUpperCase() === estadoInfo.valor);
    const nombreEje = agrupableInfo.esTemporal ? 'mes' : agrupableInfo.campo;
    const datos = agrupableInfo.esTemporal ? agregarPorMes(filtradas, agrupableInfo.campo) : agregarPorCategoria(agrupableInfo.campo, filtradas);
    return { titulo: `${estadoInfo.valor} por ${nombreEje}`, datos, esPromedio: false };
  }
  if (campoInfo) {
    return { titulo: campoInfo.campo, datos: agregarPorCategoria(campoInfo.campo, actasEnRango), esPromedio: !!campoInfo.esNumerico };
  }
  return null;
}

/**
 * Genera hasta 3 sugerencias CONCRETAS y garantizadas (ya verificadas con
 * datos reales, no un título narrativo del diagnóstico) — una de cada fuente
 * que se pidió: Datos completos, Desacuerdos Manual≠IA, y el formulario de
 * Supervisión Manual. Cada una ya se probó con interpretarConsultaLibre, así
 * que si se muestra es porque SÍ va a producir una gráfica con datos.
 */
function generarSugerenciasPresentacion() {
  const candidatas = [
    'no conformidad por aliado',      // Datos completos
    'score por aliado',               // Datos completos (promedio)
    'desacuerdo por aliado',          // Desacuerdos Manual ≠ IA
    'desacuerdo por mes',             // Desacuerdos Manual ≠ IA, tendencia
    'formulario no conformidad por aliado', // Supervisión Manual (formulario)
    'formulario conforme por aliado'        // Supervisión Manual (formulario)
  ];
  return candidatas
    .map(texto => ({ texto, resultado: interpretarConsultaLibre(texto) }))
    .filter(c => c.resultado && c.resultado.datos && c.resultado.datos.length)
    .slice(0, 3);
}

function abrirPresentacionInteractiva(fechaDesde, fechaHasta, consultaLibre) {
  tituloBasePresentacion = 'Auditoria_CCE';
  let actas = state.actas;
  if (fechaDesde || fechaHasta) {
    actas = actas.filter(a => {
      const f = normalizarFechaCliente(a['Fecha']);
      if (!f) return false;
      if (fechaDesde && f < fechaDesde) return false;
      if (fechaHasta && f > fechaHasta) return false;
      return true;
    });
  }
  const k = calcularKpisLocal(actas);
  const porMes = calcularTasaNCPorMes(actas);
  const topAliados = (k.porAliado || []).slice(0, 6);
  const rangoTexto = (fechaDesde || fechaHasta) ? `${fechaDesde || '…'} a ${fechaHasta || '…'}` : 'Todo el período disponible';
  const extra = interpretarConsultaLibre(consultaLibre);

  let overlay = document.getElementById('overlayPresentacionInteractiva');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlayPresentacionInteractiva';
    overlay.className = 'overlay-presentacion';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="presentacion-barra">
      <span class="presentacion-barra-titulo">🖥️ Presentación interactiva — haz clic en cualquier texto para editarlo</span>
      <div class="presentacion-barra-botones">
        <button type="button" class="btn btn-ghost btn-icon" id="btnPresDescargarHtml">⬇️ Descargar HTML</button>
        <button type="button" class="btn btn-primary btn-icon" id="btnPresDescargarPptx">⬇️ Descargar PowerPoint</button>
        <button type="button" class="btn btn-ghost btn-icon" id="btnPresCerrar">✕ Cerrar</button>
      </div>
    </div>
    <div class="presentacion-viewport">
      <button type="button" class="presentacion-nav presentacion-nav-prev" id="btnPresPrev">‹</button>
      <div class="presentacion-slides" id="presentacionSlides">

        <section class="slide-presentacion slide-portada" data-slide="0">
          <img class="slide-logo slide-logo-oscuro" src="data:image/png;base64,${LOGO_ENERBIT_B64}" alt="enerBit">
          <h1 contenteditable="true">Auditoría CCE</h1>
          <p class="slide-subtitulo" contenteditable="true">Resumen ejecutivo de calidad — Programa CCE</p>
          <p class="slide-rango">${escapeHtml(rangoTexto)} · ${k.total} actas</p>
        </section>

        <section class="slide-presentacion" data-slide="1">
          <img class="slide-logo" src="data:image/png;base64,${LOGO_ENERBIT_B64}" alt="enerBit">
          <div class="slide-cabecera">
            <span class="slide-icono">📈</span>
            <h2 contenteditable="true">Tasa de No Conformidad Manual, por mes</h2>
          </div>
          <div class="slide-cuerpo">
            <div class="slide-grafica-wrap">
              <div class="preferencia-opciones" id="picker_presNC" style="margin-bottom:10px;"></div>
              <div id="chart_presNC" class="chart-svg-wrap"></div>
            </div>
            <div class="slide-tabla-wrap">${tablaHtmlSimple(porMes.map(m => ({ etiqueta: m.mes, valor: m.tasa.toFixed(1) + '%' })), 'Mes', 'Tasa NC')}</div>
          </div>
          <p class="slide-nota" contenteditable="true">${porMes.length ? `El promedio del período es ${(porMes.reduce((s, m) => s + m.tasa, 0) / porMes.length).toFixed(1)}%. Haz clic aquí para escribir tu propia conclusión.` : 'Sin datos suficientes en este rango — haz clic para escribir una nota.'}</p>
          <img class="slide-iconos-redes" src="data:image/png;base64,${ICONOS_REDES_B64}" alt="">
        </section>

        <section class="slide-presentacion" data-slide="2">
          <img class="slide-logo" src="data:image/png;base64,${LOGO_ENERBIT_B64}" alt="enerBit">
          <div class="slide-cabecera">
            <span class="slide-icono">⚠️</span>
            <h2 contenteditable="true">Aliados con mayor riesgo</h2>
          </div>
          <div class="slide-cuerpo">
            <div class="slide-grafica-wrap">
              <div class="preferencia-opciones" id="picker_presAliados" style="margin-bottom:10px;"></div>
              <div id="chart_presAliados" class="chart-svg-wrap"></div>
            </div>
            <div class="slide-tabla-wrap">${tablaHtmlSimple(topAliados.map(a => ({ etiqueta: a.aliado, valor: (a.pctNC * 100).toFixed(1) + '%' })), 'Aliado', '% NC')}</div>
          </div>
          <p class="slide-nota" contenteditable="true">${topAliados.length ? `"${topAliados[topAliados.length - 1].aliado}" concentra el mayor riesgo. Haz clic aquí para escribir tu propia conclusión.` : 'Sin datos de aliados en este rango — haz clic para escribir una nota.'}</p>
          <img class="slide-iconos-redes" src="data:image/png;base64,${ICONOS_REDES_B64}" alt="">
        </section>

        ${extra ? `
        <section class="slide-presentacion" data-slide="3">
          <img class="slide-logo" src="data:image/png;base64,${LOGO_ENERBIT_B64}" alt="enerBit">
          <div class="slide-cabecera">
            <span class="slide-icono">✨</span>
            <h2 contenteditable="true">${escapeHtml(extra.titulo)}</h2>
          </div>
          <div class="slide-cuerpo">
            <div class="slide-grafica-wrap">
              <div class="preferencia-opciones" id="picker_presExtra" style="margin-bottom:10px;"></div>
              <div id="chart_presExtra" class="chart-svg-wrap"></div>
            </div>
            <div class="slide-tabla-wrap">${tablaHtmlSimple(extra.datos, 'Etiqueta', 'Valor')}</div>
          </div>
          <p class="slide-nota" contenteditable="true">Diapositiva agregada a partir de tu pedido: "${escapeHtml(consultaLibre)}". Haz clic aquí para escribir tu propia conclusión.</p>
          <img class="slide-iconos-redes" src="data:image/png;base64,${ICONOS_REDES_B64}" alt="">
        </section>` : ''}

      </div>
      <button type="button" class="presentacion-nav presentacion-nav-next" id="btnPresNext">›</button>
    </div>
    <div class="presentacion-puntos" id="presentacionPuntos"></div>
  `;

  renderizarConSelectorTipo('picker_presNC', 'chart_presNC', porMes.map(m => ({ etiqueta: m.mes, valor: +m.tasa.toFixed(1) })), { modo: 'promedio', etiquetaCentro: '% nc' });
  renderizarConSelectorTipo('picker_presAliados', 'chart_presAliados', topAliados.map(a => ({ etiqueta: a.aliado, valor: +(a.pctNC * 100).toFixed(1) })), { modo: 'promedio', etiquetaCentro: '% nc' });
  if (extra) {
    renderizarConSelectorTipo('picker_presExtra', 'chart_presExtra', extra.datos, extra.esPromedio ? { modo: 'promedio' } : undefined);
  }

  configurarNavegacionPresentacion(overlay);
  document.getElementById('btnPresCerrar').addEventListener('click', () => overlay.remove());
  document.getElementById('btnPresDescargarHtml').addEventListener('click', () => descargarPresentacionComoHTML(overlay));
  document.getElementById('btnPresDescargarPptx').addEventListener('click', (e) => descargarPresentacionComoPPTX(overlay, e.target));
}

/**
 * Igual que abrirPresentacionInteractiva, pero para un proyecto genérico de
 * "Otros proyectos" — reutiliza exactamente la misma estructura de
 * diapositivas, navegación, y descarga en HTML/PowerPoint. La portada usa el
 * nombre del proyecto, y hay una diapositiva por cada columna categórica que
 * ya se esté graficando en el Dashboard de ese proyecto.
 */
function abrirPresentacionProyecto() {
  const proyecto = obtenerProyectos().find(p => p.id === proyectoActualId);
  if (!proyecto) { mostrarToast('Abre un proyecto primero.', 'error'); return; }
  tituloBasePresentacion = proyecto.nombre.replace(/[^a-zA-Z0-9_ -]/g, '').trim().replace(/\s+/g, '_') || 'Proyecto';

  const categoricas = proyecto.headers.filter(h => proyecto.tipos[h] === 'categorica').slice(0, 4);
  const numericas = proyecto.headers.filter(h => proyecto.tipos[h] === 'numerica');
  const resumenNumerico = numericas.slice(0, 2).map(h => {
    const valores = proyecto.filas.map(f => parseFloat(f[h])).filter(v => !isNaN(v));
    const suma = valores.reduce((s, v) => s + v, 0);
    return `${h}: suma ${formatearNumeroProyecto(suma)}, promedio ${formatearNumeroProyecto(suma / (valores.length || 1))}`;
  }).join(' · ');

  let overlay = document.getElementById('overlayPresentacionInteractiva');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlayPresentacionInteractiva';
    overlay.className = 'overlay-presentacion';
    document.body.appendChild(overlay);
  }

  const slidesCategoricas = categoricas.map((h, i) => {
    const conteo = {};
    proyecto.filas.forEach(f => { const v = String(f[h] === '' || f[h] == null ? '(vacío)' : f[h]).trim() || '(vacío)'; conteo[v] = (conteo[v] || 0) + 1; });
    const datos = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([etiqueta, valor]) => ({ etiqueta, valor }));
    return { h, i: i + 1, datos };
  });

  overlay.innerHTML = `
    <div class="presentacion-barra">
      <span class="presentacion-barra-titulo">🖥️ Presentación interactiva — haz clic en cualquier texto para editarlo</span>
      <div class="presentacion-barra-botones">
        <button type="button" class="btn btn-ghost btn-icon" id="btnPresDescargarHtml">⬇️ Descargar HTML</button>
        <button type="button" class="btn btn-primary btn-icon" id="btnPresDescargarPptx">⬇️ Descargar PowerPoint</button>
        <button type="button" class="btn btn-ghost btn-icon" id="btnPresCerrar">✕ Cerrar</button>
      </div>
    </div>
    <div class="presentacion-viewport">
      <button type="button" class="presentacion-nav presentacion-nav-prev" id="btnPresPrev">‹</button>
      <div class="presentacion-slides" id="presentacionSlides">

        <section class="slide-presentacion slide-portada" data-slide="0">
          <img class="slide-logo slide-logo-oscuro" src="data:image/png;base64,${LOGO_ENERBIT_B64}" alt="enerBit">
          <h1 contenteditable="true">${escapeHtml(proyecto.nombre)}</h1>
          <p class="slide-subtitulo" contenteditable="true">${resumenNumerico ? escapeHtml(resumenNumerico) : 'Resumen del proyecto'}</p>
          <p class="slide-rango">${proyecto.filas.length} filas · ${proyecto.headers.length} columnas · generado el ${new Date().toLocaleDateString('es-CO')}</p>
        </section>

        ${slidesCategoricas.map(s => `
        <section class="slide-presentacion" data-slide="${s.i}">
          <img class="slide-logo" src="data:image/png;base64,${LOGO_ENERBIT_B64}" alt="enerBit">
          <div class="slide-cabecera">
            <span class="slide-icono">📊</span>
            <h2 contenteditable="true">${escapeHtml(s.h)}</h2>
          </div>
          <div class="slide-cuerpo">
            <div class="slide-grafica-wrap">
              <div class="preferencia-opciones" id="picker_pres${s.i}" style="margin-bottom:10px;"></div>
              <div id="chart_pres${s.i}" class="chart-svg-wrap"></div>
            </div>
            <div class="slide-tabla-wrap">${tablaHtmlSimple(s.datos, s.h, 'Cantidad')}</div>
          </div>
          <p class="slide-nota" contenteditable="true">${s.datos.length ? `"${s.datos[0].etiqueta}" es el valor más frecuente (${s.datos[0].valor} de ${proyecto.filas.length}). Haz clic aquí para escribir tu propia conclusión.` : 'Sin datos suficientes — haz clic para escribir una nota.'}</p>
          <img class="slide-iconos-redes" src="data:image/png;base64,${ICONOS_REDES_B64}" alt="">
        </section>`).join('')}

      </div>
      <button type="button" class="presentacion-nav presentacion-nav-next" id="btnPresNext">›</button>
    </div>
    <div class="presentacion-puntos" id="presentacionPuntos"></div>
  `;

  slidesCategoricas.forEach(s => {
    renderizarConSelectorTipo(`picker_pres${s.i}`, `chart_pres${s.i}`, s.datos, undefined);
  });

  configurarNavegacionPresentacion(overlay);
  document.getElementById('btnPresCerrar').addEventListener('click', () => overlay.remove());
  document.getElementById('btnPresDescargarHtml').addEventListener('click', () => descargarPresentacionComoHTML(overlay));
  document.getElementById('btnPresDescargarPptx').addEventListener('click', (e) => descargarPresentacionComoPPTX(overlay, e.target));
}

/** Tabla simple de 2 columnas para acompañar cada gráfica de la presentación. */
function tablaHtmlSimple(filas, colA, colB) {
  if (!filas.length) return '<p class="panel-note">Sin datos.</p>';
  return `<table class="data-table" style="width:100%;">
    <thead><tr><th>${escapeHtml(colA)}</th><th style="text-align:right;">${escapeHtml(colB)}</th></tr></thead>
    <tbody>${filas.map(f => `<tr><td>${escapeHtml(String(f.etiqueta))}</td><td style="text-align:right;font-family:var(--font-mono);">${escapeHtml(String(f.valor))}</td></tr>`).join('')}</tbody>
  </table>`;
}

/** Navegación entre diapositivas: flechas, puntos, y teclado (← →). */
function configurarNavegacionPresentacion(overlay) {
  const slides = overlay.querySelectorAll('.slide-presentacion');
  const puntos = overlay.querySelector('#presentacionPuntos');
  let actual = 0;

  puntos.innerHTML = Array.from(slides).map((_, i) => `<button type="button" class="punto-presentacion" data-ir="${i}"></button>`).join('');

  const mostrar = (i) => {
    actual = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, idx) => s.classList.toggle('is-active', idx === actual));
    puntos.querySelectorAll('.punto-presentacion').forEach((p, idx) => p.classList.toggle('is-active', idx === actual));
  };

  overlay.querySelector('#btnPresPrev').addEventListener('click', () => mostrar(actual - 1));
  overlay.querySelector('#btnPresNext').addEventListener('click', () => mostrar(actual + 1));
  puntos.querySelectorAll('.punto-presentacion').forEach(p => p.addEventListener('click', () => mostrar(+p.dataset.ir)));

  const onKey = (e) => {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', onKey); return; }
    if (document.activeElement && document.activeElement.isContentEditable) return; // no interferir mientras se escribe
    if (e.key === 'ArrowRight') mostrar(actual + 1);
    if (e.key === 'ArrowLeft') mostrar(actual - 1);
  };
  document.addEventListener('keydown', onKey);

  mostrar(0);
}

/**
 * Descarga la presentación como un archivo HTML autónomo — incluye el CSS
 * necesario embebido (no depende de style.css externo) y conserva
 * exactamente el texto que se haya editado en pantalla, incluyendo el tipo
 * de gráfica que se haya elegido en cada selector.
 */
/** Nombre base para los archivos descargados de la presentación interactiva —
 *  "Auditoria_CCE" por defecto, pero se cambia al nombre del proyecto cuando
 *  la presentación se abre desde "Otros proyectos". */
let tituloBasePresentacion = 'Auditoria_CCE';

function descargarPresentacionComoHTML(overlay) {
  const slidesHtml = overlay.querySelector('#presentacionSlides').outerHTML
    .replace(/contenteditable="true"/g, ''); // ya no debe ser editable al abrir el archivo exportado

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>${escapeHtml(tituloBasePresentacion.replace(/_/g, ' '))} — Presentación</title>
<style>${CSS_PRESENTACION_EXPORTABLE}</style>
</head><body>
<div class="presentacion-viewport" style="height:100vh;">
  <button type="button" class="presentacion-nav presentacion-nav-prev" onclick="irSlide(-1)">‹</button>
  ${slidesHtml}
  <button type="button" class="presentacion-nav presentacion-nav-next" onclick="irSlide(1)">›</button>
</div>
<div class="presentacion-puntos" id="presentacionPuntos"></div>
<script>
  const slides = document.querySelectorAll('.slide-presentacion');
  const puntosCont = document.getElementById('presentacionPuntos');
  puntosCont.innerHTML = Array.from(slides).map((_, i) => '<button onclick="irSlideDirecto(' + i + ')" class="punto-presentacion"></button>').join('');
  let actual = 0;
  function render() {
    slides.forEach((s, i) => s.classList.toggle('is-active', i === actual));
    puntosCont.querySelectorAll('.punto-presentacion').forEach((p, i) => p.classList.toggle('is-active', i === actual));
  }
  function irSlide(delta) { actual = Math.max(0, Math.min(slides.length - 1, actual + delta)); render(); }
  function irSlideDirecto(i) { actual = i; render(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') irSlide(1); if (e.key === 'ArrowLeft') irSlide(-1); });
  render();
</script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${tituloBasePresentacion}_presentacion_${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarToast('Presentación HTML descargada.', 'success');
}

/**
 * Descarga la misma presentación como PowerPoint, tomando el texto EDITADO en
 * pantalla (títulos y notas) — reutiliza el mismo diseño de tarjeta real
 * (logo, caja con borde naranja) que "Generar PowerPoint reducido".
 */
async function descargarPresentacionComoPPTX(overlay, btnUsado) {
  if (typeof PptxGenJS === 'undefined') {
    mostrarToast('No se pudo cargar la librería de PowerPoint. Revisa tu conexión e intenta de nuevo.', 'error');
    return;
  }
  if (btnUsado) { btnUsado.disabled = true; btnUsado.textContent = 'Generando…'; }

  const PURPLE = '501C7C', ORANGE = 'FF7900', GRIS_TEXTO = '667085', GRIS_BORDE = 'E4E7EC', TINTA = '1D2939';
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CCE', width: 13.33, height: 7.5 });
  pptx.layout = 'CCE';
  pptx.title = tituloBasePresentacion.replace(/_/g, ' ') + ' — Presentación';

  const slides = overlay.querySelectorAll('.slide-presentacion');

  // --- Portada ---
  const portada = slides[0];
  let slide = pptx.addSlide();
  slide.background = { color: PURPLE };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 6.9, w: 13.33, h: 0.6, fill: { color: ORANGE }, line: { type: 'none' } });
  slide.addImage({ data: 'image/png;base64,' + LOGO_ENERBIT_B64, x: 0.6, y: 0.55, w: 2.0, h: 0.75 });
  slide.addText(portada.querySelector('h1').textContent, { x: 0.6, y: 2.8, w: 12.1, h: 1, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
  slide.addText(portada.querySelector('.slide-subtitulo').textContent, { x: 0.6, y: 3.7, w: 12.1, h: 0.5, fontSize: 16, color: 'E4D4F2', fontFace: 'Arial' });
  slide.addText(portada.querySelector('.slide-rango').textContent, { x: 0.6, y: 4.2, w: 12.1, h: 0.4, fontSize: 11, color: 'C9AEDD', fontFace: 'Arial' });

  // --- Diapositivas de contenido (1, 2, y la extra si existe) -------------------
  for (let i = 1; i < slides.length; i++) {
    const s = slides[i];
    const titulo = s.querySelector('h2').textContent;
    const nota = s.querySelector('.slide-nota').textContent;
    const filas = Array.from(s.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent));
    const encabezados = Array.from(s.querySelectorAll('thead th')).map(th => th.textContent);
    // Qué tipo de gráfica se ve en pantalla para esta diapositiva (Barras/Dona/
    // Apilada/Línea/Cascada) — antes esto se ignoraba por completo al exportar
    // a PowerPoint y solo se copiaba la tabla; ahora si se respeta.
    const botonActivo = s.querySelector('.btn-opcion-grafica[data-tipo-grafica].is-active');
    const tipoGrafica = botonActivo ? botonActivo.dataset.tipoGrafica : null;
    const datos = filas.map(fila => ({ etiqueta: fila[0], valor: parseFloat((fila[1] || '0').replace('%', '')) || 0 }));

    slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.5, y: 0.4, w: 0.4, h: 0.4, fill: { color: PURPLE }, line: { type: 'none' } });
    slide.addText(String(i), { x: 0.5, y: 0.4, w: 0.4, h: 0.4, fontSize: 15, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center', valign: 'middle' });
    slide.addText(titulo, { x: 1.3, y: 0.28, w: 9.0, h: 0.5, fontSize: 22, bold: true, color: PURPLE, fontFace: 'Arial' });
    slide.addShape(pptx.ShapeType.roundRect, { x: 1.3, y: 0.85, w: 1.5, h: 0.05, rectRadius: 0.03, fill: { color: ORANGE }, line: { type: 'none' } });

    if (encabezados.length && datos.length) {
      if (tipoGrafica === 'dona') {
        // Dona 3D dibujada a mano (ver generarImagenDona3D) — a la izquierda, tabla completa a la derecha.
        const colores = ['501C7C', 'FF7900', '12B76A', '2E90FA', 'D92D20', 'F79009'];
        const img = generarImagenDona3D(datos, datos.map((_, idx) => colores[idx % colores.length]));
        slide.addImage({ data: 'image/png;base64,' + img, x: 0.5, y: 1.2, w: 5.2, h: 4.2 });
        datos.forEach((d, idx) => {
          const y = 5.6 + idx * 0.28;
          if (y > 6.4) return; // no desbordar hacia el pie
          slide.addShape(pptx.ShapeType.rect, { x: 0.5, y, w: 0.16, h: 0.16, fill: { color: colores[idx % colores.length] }, line: { type: 'none' } });
          slide.addText(`${d.etiqueta}: ${d.valor}`, { x: 0.75, y: y - 0.03, w: 4.9, h: 0.22, fontSize: 9, fontFace: 'Arial', color: GRIS_TEXTO });
        });
        const filasTabla = [encabezados.map(h => ({ text: h, options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 11 } }))]
          .concat(filas.map(fila => fila.map(v => ({ text: v, options: { fontSize: 11 } }))));
        slide.addTable(filasTabla, { x: 6.0, y: 1.2, w: 6.9, h: 5.2, fontFace: 'Arial', border: { type: 'solid', color: GRIS_BORDE, pt: 1 } });
      } else {
        // Barras (3D), Apilada, o Línea nativas de pptxgenjs + tabla al lado — igual
        // que ya se ve en pantalla. "Cascada" no tiene equivalente nativo en la
        // librería, así que cae a barras 3D (el más parecido disponible).
        const chartW = 5.2, chartX = 0.5, tableX = 6.0, tableW = 6.9;
        const nombreSerie = titulo.slice(0, 30);
        if (tipoGrafica === 'apilada') {
          slide.addChart(pptx.ChartType.bar3d, [{ name: nombreSerie, labels: datos.map(d => d.etiqueta), values: datos.map(d => d.valor) }],
            { x: chartX, y: 1.2, w: chartW, h: 5.2, barDir: 'col', barGrouping: 'stacked', bar3DShape: 'box', chartColors: ['501C7C', 'FF7900', '12B76A', '2E90FA', 'D92D20'], showValue: true, dataLabelFontSize: 9 });
        } else if (tipoGrafica === 'linea') {
          slide.addChart(pptx.ChartType.line, [{ name: nombreSerie, labels: datos.map(d => d.etiqueta), values: datos.map(d => d.valor) }],
            { x: chartX, y: 1.2, w: chartW, h: 5.2, chartColors: [ORANGE], showValue: true, dataLabelFontSize: 9, lineSize: 2.5, lineSmooth: false });
        } else {
          // barras (default) y cascada (sin equivalente nativo, cae aquí)
          slide.addChart(pptx.ChartType.bar3d, [{ name: nombreSerie, labels: datos.map(d => d.etiqueta), values: datos.map(d => d.valor) }],
            { x: chartX, y: 1.2, w: chartW, h: 5.2, barDir: 'bar', bar3DShape: 'box', chartColors: [PURPLE], showValue: true, dataLabelFontSize: 9 });
        }
        const filasTabla = [encabezados.map(h => ({ text: h, options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 11 } }))]
          .concat(filas.map(fila => fila.map(v => ({ text: v, options: { fontSize: 11 } }))));
        slide.addTable(filasTabla, { x: tableX, y: 1.2, w: tableW, h: 5.2, fontFace: 'Arial', border: { type: 'solid', color: GRIS_BORDE, pt: 1 } });
      }
    }
    slide.addText(nota, { x: 0.5, y: 6.5, w: 12.3, h: 0.6, fontSize: 11, italic: true, color: GRIS_TEXTO, fontFace: 'Arial' });
    slide.addImage({ data: 'image/png;base64,' + ICONOS_REDES_B64, x: 0.4, y: 7.1, w: 1.5, h: 0.21 });
    slide.addImage({ data: 'image/png;base64,' + LOGO_ENERBIT_B64, x: 11.1, y: 6.95, w: 1.4, h: 0.5 });
  }

  await pptx.writeFile({ fileName: `${tituloBasePresentacion}_presentacion_${new Date().toISOString().slice(0, 10)}.pptx` });
  if (btnUsado) { btnUsado.disabled = false; btnUsado.textContent = '⬇️ Descargar PowerPoint'; }
  mostrarToast('PowerPoint descargado.', 'success');
}

/**
 * Resume en 3-5 frases los hallazgos más críticos (reutiliza el mismo
 * diagnóstico del asistente), para la diapositiva de texto — así el
 * PowerPoint no depende solo de gráficas para transmitir lo importante.
 */
function calcularHallazgosClave(actasFuente) {
  const actas = actasFuente || state.actas;
  const frases = [];

  const criticos = actas.filter(a => (a['R01 Tensión'] || '').toString().toUpperCase() === 'FALLA').length;
  if (criticos) frases.push(`${criticos} acta(s) con tensión inconsistente (R01) — el patrón más frecuente es digitar la tensión por baja en vez de por alta en medida indirecta.`);

  const conteoAliado = {};
  actas.forEach(a => {
    if ((a['Supervisión Manual (T)'] || '') === 'NO CONFORMIDAD') {
      conteoAliado[a['Aliado']] = (conteoAliado[a['Aliado']] || 0) + 1;
    }
  });
  const peorAliado = Object.entries(conteoAliado).sort((a, b) => b[1] - a[1])[0];
  if (peorAliado) frases.push(`${peorAliado[0]} concentra la mayor cantidad de no conformidades manuales (${peorAliado[1]} actas).`);

  const desacuerdos = actas.filter(a => (a['Acuerdo T=U'] || '') === 'DESACUERDO').length;
  if (desacuerdos) frases.push(`${desacuerdos} acta(s) con desacuerdo entre Supervisión Manual e IA, pendientes de resolver.`);

  const topFallas = calcularTopFallas(1, actas);
  if (topFallas.length) frases.push(`La falla más común es "${topFallas[0].etiqueta}", con ${topFallas[0].valor} ocurrencia(s).`);

  const HOY = new Date();
  const pendientesAntiguos = actas.filter(a => {
    if ((a['Supervisión Manual (T)'] || '') !== 'PENDIENTE') return false;
    const f = normalizarFechaCliente(a['Fecha']);
    if (!f) return false;
    return Math.floor((HOY - new Date(f)) / 86400000) > 15;
  }).length;
  if (pendientesAntiguos) frases.push(`${pendientesAntiguos} acta(s) llevan más de 15 días pendientes de supervisión manual.`);

  return frases.slice(0, 5);
}

/**
 * Genera automáticamente (basado en reglas, no en IA generativa) el
 * contenido de la diapositiva de Conclusiones: riesgos identificados,
 * oportunidades de mejora, y recomendaciones concretas — a partir del
 * mismo diagnóstico que ya usa el asistente.
 */
function calcularConclusiones(actas, k, topFallas) {
  const riesgos = [], oportunidades = [], recomendaciones = [];

  const pctNCGeneral = k.total ? (k.noConformesManual / k.total) : 0;
  if (pctNCGeneral > 0) {
    riesgos.push(`${(pctNCGeneral * 100).toFixed(0)}% de las actas del período están en No Conformidad manual.`);
  }
  const peorAliado = k.porAliado && k.porAliado[0];
  if (peorAliado && peorAliado.pctNC > 0) {
    riesgos.push(`${peorAliado.aliado} concentra el mayor porcentaje de no conformidad (${(peorAliado.pctNC * 100).toFixed(0)}%).`);
  }
  if (k.desacuerdos > 0) {
    riesgos.push(`${k.desacuerdos} acta(s) con desacuerdo entre supervisión Manual e IA, sin resolver.`);
  }
  if (!riesgos.length) riesgos.push('No se identificaron riesgos mayores en el período analizado.');

  if (topFallas && topFallas.length) {
    oportunidades.push(`Corregir "${topFallas[0].etiqueta}" resolvería el hallazgo más repetido (${topFallas[0].valor} caso(s)).`);
  }
  const tipoMasBajo = k.porTipoMedida && k.porTipoMedida.slice().sort((a, b) => a.scoreProm - b.scoreProm)[0];
  const tipoMasAlto = k.porTipoMedida && k.porTipoMedida.slice().sort((a, b) => b.scoreProm - a.scoreProm)[0];
  if (tipoMasBajo && tipoMasAlto && tipoMasBajo.tipo !== tipoMasAlto.tipo) {
    oportunidades.push(`Estandarizar el proceso de "${tipoMasBajo.tipo}" al nivel de "${tipoMasAlto.tipo}" (${tipoMasBajo.scoreProm.toFixed(0)} vs ${tipoMasAlto.scoreProm.toFixed(0)} de score promedio).`);
  }
  if (!oportunidades.length) oportunidades.push('El proceso se mantiene estable — mantener el estándar actual.');

  if (peorAliado) recomendaciones.push(`Reforzar la capacitación de ${peorAliado.aliado} en los criterios de la reglas CCE con más fallas.`);
  if (topFallas && topFallas.length) recomendaciones.push(`Incluir "${topFallas[0].etiqueta}" en el checklist de autorevisión antes de radicar el acta.`);
  if (k.desacuerdos > 0) recomendaciones.push('Priorizar la resolución de los desacuerdos Manual vs IA pendientes esta semana.');
  if (!recomendaciones.length) recomendaciones.push('Continuar el monitoreo periódico — no se requieren acciones correctivas urgentes.');

  return { riesgos: riesgos.slice(0, 3), oportunidades: oportunidades.slice(0, 3), recomendaciones: recomendaciones.slice(0, 3) };
}

// ============================================================================
// GENERAR POWERPOINT — arma un .pptx en el navegador con PptxGenJS (gratis,
// sin servidor), con los KPIs y gráficas actuales convertidos en gráficas
// NATIVAS de PowerPoint (editables ahí mismo, no imágenes pegadas).
// ============================================================================
/**
 * pptxgenjs (la librería de PowerPoint) NO tiene dona 3D — solo implementó 3D
 * para barras y burbujas. Este es el rodeo real: en vez de pedirle a la
 * librería una gráfica nativa, se dibuja la dona a mano en un <canvas> con
 * una "pared" sombreada debajo de cada porción para simular la extrusión 3D,
 * y esa imagen ya renderizada se pega en la diapositiva — así sí queda con
 * volumen real, aunque la librería no lo soporte como tipo de gráfica nativo.
 * Es una función global (no vive dentro de una sola presentación) para que
 * tanto la completa como la interactiva puedan usarla cuando el usuario
 * elija "Dona" como tipo de gráfica.
 */
/**
 * Textura de puntos de la marca enerBit — el patrón que se repite de fondo en
 * las 3 plantillas oficiales (portada morada, divisor naranja, contenido
 * blanco). Se dibuja una sola vez por color de fondo y se pega como imagen
 * de fondo completa — pptxgenjs no soporta patrones de relleno nativos.
 */
function generarTexturaPuntos(colorPunto) {
  const W = 1333, H = 750, paso = 42;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colorPunto;
  for (let x = paso; x < W; x += paso) {
    for (let y = paso; y < H; y += paso) {
      ctx.beginPath();
      ctx.arc(x, y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
// Antes esto se calculaba SIEMPRE al cargar la página (2 imágenes de 1333x750
// con ~500 puntos dibujados a mano cada una), aunque el 99% de las veces
// nadie iba a generar un PowerPoint en esa visita. Ahora solo se calcula la
// primera vez que de verdad se usa (dentro de dibujarPortadaMorada/
// dibujarDivisorNaranja), y se guarda en caché para no repetirlo dos veces.
let _texturaPuntosClarosCache = null;
function obtenerTexturaPuntosClaros() {
  if (!_texturaPuntosClarosCache) _texturaPuntosClarosCache = generarTexturaPuntos('rgba(255,255,255,0.16)');
  return _texturaPuntosClarosCache;
}

/**
 * PLANTILLA MAESTRA 1 — Portada morada. Para la carátula de la presentación
 * (una por presentación).
 */
function dibujarPortadaMorada(pptx, titulo, subtitulo1, subtitulo2) {
  const slide = pptx.addSlide();
  slide.background = { color: '501C7C' };
  slide.addImage({ data: 'image/png;base64,' + obtenerTexturaPuntosClaros(), x: 0, y: 0, w: 13.33, h: 7.5 });
  slide.addText([
    { text: 'LO IMPOSIBLE\n', options: { strike: false } },
    { text: 'LO VOLVEMOS POSIBLE', options: { bold: true } }
  ], { x: 0.6, y: 0.4, w: 5, h: 0.6, fontSize: 13, color: 'FFFFFF', fontFace: 'Arial' });
  slide.addText('enerBit', { x: 10.3, y: 0.4, w: 2.4, h: 0.5, fontSize: 26, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'right' });
  slide.addText('Con el respaldo de Celsia', { x: 10.3, y: 0.82, w: 2.4, h: 0.25, fontSize: 8, color: 'D9C7EC', fontFace: 'Arial', align: 'right' });
  slide.addText(titulo, { x: 0.6, y: 3.0, w: 10, h: 1.0, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
  if (subtitulo1) slide.addText(`${subtitulo1}${subtitulo2 ? '\n' + subtitulo2 : ''}`, { x: 0.6, y: 3.95, w: 10, h: 0.7, fontSize: 14, color: 'E4D4F2', fontFace: 'Arial', lineSpacing: 20 });
  dibujarPieMarca(slide, 'oscuro');
  return slide;
}

/**
 * PLANTILLA MAESTRA 2 — Divisor naranja. Para separar cada sección/tema
 * grande de la presentación (una por cada tema de la agenda).
 */
function dibujarDivisorNaranja(pptx, tituloSeccion) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FF7900' };
  slide.addImage({ data: 'image/png;base64,' + obtenerTexturaPuntosClaros(), x: 0, y: 0, w: 13.33, h: 7.5 });
  slide.addText('enerBit', { x: 10.3, y: 0.4, w: 2.4, h: 0.5, fontSize: 26, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'right' });
  slide.addText('Con el respaldo de Celsia', { x: 10.3, y: 0.82, w: 2.4, h: 0.25, fontSize: 8, color: 'FFE0B8', fontFace: 'Arial', align: 'right' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 9.6, y: 1.3, w: 3.1, h: 0.85, rectRadius: 0.15, fill: { color: '501C7C' }, line: { type: 'none' } });
  slide.addText([
    { text: 'Somos una empresa de ', options: { fontSize: 11, color: 'FFFFFF' } },
    { text: '100%', options: { fontSize: 15, bold: true, color: 'FF7900' } },
    { text: ' energía digital', options: { fontSize: 11, color: 'FFFFFF' } }
  ], { x: 9.75, y: 1.4, w: 2.8, h: 0.65, fontFace: 'Arial', valign: 'middle' });
  slide.addText(tituloSeccion, { x: 0.6, y: 5.3, w: 11.5, h: 1.1, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
  dibujarPieMarca(slide, 'oscuro');
  return slide;
}

/**
 * Fila de íconos de redes + sitio web, en la variante clara (para fondos
 * morado/naranja, íconos y texto en blanco) u oscura (para fondo blanco,
 * íconos y texto en morado) — reutilizada por las 3 plantillas maestras.
 */
function dibujarPieMarca(slide, variante) {
  const colorTexto = variante === 'oscuro' ? 'FFFFFF' : '501C7C';
  const iconos = ['📷', '👍', '▶', '💼', '♪'];
  let x = 0.55;
  iconos.forEach(ic => {
    slide.addShape('ellipse', { x, y: 6.98, w: 0.28, h: 0.28, fill: { color: variante === 'oscuro' ? '6B3FA0' : 'F3E8FF' }, line: { type: 'none' } });
    slide.addText(ic, { x, y: 6.98, w: 0.28, h: 0.28, fontSize: 9, color: colorTexto, align: 'center', valign: 'middle' });
    x += 0.36;
  });
  slide.addText('www.enerbit.co', { x: 9.8, y: 6.98, w: 2.9, h: 0.3, fontSize: 11, bold: true, color: colorTexto, fontFace: 'Arial', align: 'right', valign: 'middle' });
}

function generarImagenDona3D(segmentos, colores) {
  const W = 640, H = 520, cx = W / 2, cy = 210;
  const rx = 220, ry = 130, grosor = 85, profundidad = 42;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const oscurecer = (hex, pct) => {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((n >> 16) & 255) * (1 - pct));
    const g = Math.max(0, ((n >> 8) & 255) * (1 - pct));
    const b = Math.max(0, (n & 255) * (1 - pct));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  };

  const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1;
  const paso = 0.015;

  let acumulado = -Math.PI / 2;
  segmentos.forEach((s, i) => {
    const a0 = acumulado, a1 = acumulado + (s.valor / total) * Math.PI * 2;
    ctx.fillStyle = oscurecer(colores[i], 0.35);
    ctx.beginPath();
    for (let a = a0; a <= a1; a += paso) {
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry + profundidad;
      a === a0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry);
    for (let a = a1; a >= a0; a -= paso) ctx.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
    ctx.closePath(); ctx.fill();
    acumulado = a1;
  });

  acumulado = -Math.PI / 2;
  segmentos.forEach((s, i) => {
    const a0 = acumulado, a1 = acumulado + (s.valor / total) * Math.PI * 2;
    ctx.fillStyle = colores[i];
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry);
    for (let a = a0; a <= a1; a += paso) ctx.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
    for (let a = a1; a >= a0; a -= paso) ctx.lineTo(cx + Math.cos(a) * (rx - grosor), cy + Math.sin(a) * (ry - grosor));
    ctx.closePath(); ctx.fill();
    acumulado = a1;
  });

  return canvas.toDataURL('image/png').split(',')[1];
}

async function generarPowerPoint(secciones, fechaDesde, fechaHasta, btnUsado) {
  if (typeof PptxGenJS === 'undefined') {
    mostrarToast('No se pudo cargar la librería de PowerPoint. Revisa tu conexión e intenta de nuevo.', 'error');
    return;
  }
  if (!state.kpis) { mostrarToast('Espera a que carguen los datos antes de generar el PowerPoint.', 'error'); return; }

  secciones = secciones || Object.fromEntries(SECCIONES_PPT.map(s => [s.id, true]));
  if (btnUsado) { btnUsado.disabled = true; btnUsado.textContent = 'Generando…'; }
  mostrarToast('Generando PowerPoint…', 'success');

  // Si se puso un rango de fechas, se recalculan los KPIs solo con esas actas
  // (en vez de usar siempre el total general) — así el PPT refleja justo el
  // período que se pidió.
  let actas = state.actas;
  if (fechaDesde || fechaHasta) {
    actas = actas.filter(a => {
      const f = normalizarFechaCliente(a['Fecha']);
      if (!f) return false;
      if (fechaDesde && f < fechaDesde) return false;
      if (fechaHasta && f > fechaHasta) return false;
      return true;
    });
  }
  const k = calcularKpisLocal(actas);

  // --- Paleta: fondo claro + acentos azul/verde (estilo BI ejecutivo), marca
  // (morado/naranja de enerBit) reservada para logo, encabezados y detalles.
  const PURPLE = '501C7C', PURPLE2 = '7028AE', ORANGE = 'FF7900',
    BLUE = '2E90FA', GREEN = '12B76A', RED = 'D92D20', AMBER = 'F79009',
    GRIS_TEXTO = '667085', GRIS_CLARO = 'F8F9FC', GRIS_BORDE = 'E4E7EC', TINTA = '1D2939';

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CCE', width: 13.33, height: 7.5 });
  pptx.layout = 'CCE';
  pptx.author = 'Asistente CCE';
  pptx.title = 'Auditoría CCE — enerBit';

  const dibujarLogoEnerbit = (slide, x, y, w, h, sobreFondoOscuro) => {
    if (sobreFondoOscuro) {
      // La plantilla real pone un rectángulo blanco detrás del logo cuando el
      // fondo es oscuro (el logo no se lee bien directamente sobre morado).
      slide.addShape(pptx.ShapeType.rect, { x: x - 0.1, y: y - 0.08, w: w + 0.2, h: h + 0.16, fill: { color: 'FFFFFF' }, line: { type: 'none' } });
    }
    slide.addImage({ data: 'image/png;base64,' + LOGO_ENERBIT_B64, x, y, w, h });
  };

  // Fondo claro estándar + pie de página minimalista (logo chico + número).
  let numeroSlide = 0;
  const nuevaSlideClara = () => {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    return s;
  };
  const pieDePagina = (slide) => {
    numeroSlide++;
    slide.addText('LO IMPOSIBLE LO VOLVEMOS POSIBLE', { x: 0.4, y: 7.05, w: 3.5, h: 0.25, fontSize: 8, bold: true, color: PURPLE, fontFace: 'Arial' });
    slide.addImage({ data: 'image/png;base64,' + ICONOS_REDES_B64, x: 0.4, y: 7.28, w: 1.5, h: 0.18 });
    dibujarLogoEnerbit(slide, 11.6, 7.02, 1.05, 0.4, false);
    slide.addText(String(numeroSlide), { x: 12.9, y: 7.05, w: 0.4, h: 0.25, fontSize: 9, color: GRIS_TEXTO, fontFace: 'Arial', align: 'right' });
  };

  /** Encabezado de diapositiva con el mismo estilo de la tarjeta real: insignia
   *  numerada + categoría + título + subrayado naranja (en vez de la barra
   *  lateral de acento genérica que se usaba antes). */
  const tituloSlide = (slide, numero, texto) => {
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.5, y: 0.35, w: 0.4, h: 0.4, fill: { color: PURPLE }, line: { type: 'none' } });
    slide.addText(String(numero), { x: 0.5, y: 0.35, w: 0.4, h: 0.4, fontSize: 15, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center', valign: 'middle' });
    slide.addText('AUDITORÍA CCE', { x: 1.05, y: 0.24, w: 11.0, h: 0.24, fontSize: 11, bold: true, color: ORANGE, fontFace: 'Arial', charSpacing: 1 });
    slide.addText(texto, { x: 1.05, y: 0.46, w: 11.0, h: 0.42, fontSize: 22, bold: true, color: TINTA, fontFace: 'Arial' });
    slide.addShape(pptx.ShapeType.roundRect, { x: 1.05, y: 0.92, w: 1.5, h: 0.05, rectRadius: 0.03, fill: { color: ORANGE }, line: { type: 'none' } });
  };

  /** Tarjeta KPI: ícono + número grande + etiqueta, con sombra suave y borde de color según estado. */
  const dibujarTarjetaKPI = (slide, x, y, w, h, opts) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w, h, rectRadius: 0.1, fill: { color: 'FFFFFF' }, line: { color: GRIS_BORDE, width: 1 },
      shadow: { type: 'outer', color: '344055', opacity: 0.18, blur: 7, offset: 2, angle: 90 }
    });
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 0.07, h, rectRadius: 0.035, fill: { color: opts.color }, line: { type: 'none' } });
    slide.addText(opts.icono, { x: x + 0.18, y: y + 0.14, w: 0.6, h: 0.4, fontSize: 17, fontFace: 'Arial' });
    slide.addText(String(opts.valor), { x: x + 0.15, y: y + 0.5, w: w - 0.3, h: h - 0.85, fontSize: 30, bold: true, color: opts.color, fontFace: 'Arial', valign: 'middle' });
    slide.addText(opts.etiqueta, { x: x + 0.15, y: y + h - 0.38, w: w - 0.3, h: 0.32, fontSize: 10, color: GRIS_TEXTO, fontFace: 'Arial' });
  };

  const rangoTexto = (fechaDesde || fechaHasta)
    ? `Período: ${fechaDesde || '…'} a ${fechaHasta || '…'}` : 'Todo el período disponible';

  // --- 1) Portada (siempre) — plantilla morada real de la marca ------------------
  dibujarPortadaMorada(pptx, 'Auditoría CCE', 'Auditoría de calidad — Programa CCE · enerBit S.A. ESP', rangoTexto + '  ·  Generado el ' + new Date().toLocaleDateString('es-CO'));
  let slide;

  // --- Divisor de sección (plantilla naranja real de la marca) -------------------
  dibujarDivisorNaranja(pptx, 'Diagnóstico y hallazgos');

  // --- 2) Hallazgos clave (texto) -------------------------------------------------
  if (secciones.hallazgosClave) {
    const frases = calcularHallazgosClave(actas);
    slide = nuevaSlideClara();
    tituloSlide(slide, 1, '📌 Hallazgos clave');
    if (frases.length) {
      slide.addText(frases.map(f => ({ text: f, options: { bullet: { code: '25B8', color: BLUE }, breakLine: true, paraSpaceAfter: 16 } })), {
        x: 0.7, y: 1.25, w: 11.9, h: 5.2, fontSize: 16, color: TINTA, fontFace: 'Arial', valign: 'top'
      });
    } else {
      slide.addText('Sin hallazgos críticos que destacar en este período. 🎉', { x: 0.7, y: 3, w: 11.9, h: 1, fontSize: 16, color: TINTA, fontFace: 'Arial' });
    }
    pieDePagina(slide);
  }

  // --- 3) Resumen ejecutivo — tarjetas KPI con ícono y color por estado -----------
  if (secciones.resumen) {
    slide = nuevaSlideClara();
    tituloSlide(slide, 2, '📋 Resumen ejecutivo');
    const cardW = 2.226, cardH = 1.9, gap = 0.25, x0 = 0.6, y0 = 1.6;
    const tarjetas = [
      { icono: '📊', valor: k.total, etiqueta: 'Total actas', color: PURPLE2 },
      { icono: '✅', valor: k.conformesManual, etiqueta: 'Conformes (Manual)', color: GREEN },
      { icono: '⚠️', valor: k.noConformesManual, etiqueta: 'No conformes (Manual)', color: RED },
      { icono: '🤖', valor: k.conformesIA, etiqueta: 'Conformes (IA)', color: BLUE },
      { icono: '⚖️', valor: k.desacuerdos, etiqueta: 'Desacuerdos Manual≠IA', color: AMBER }
    ];
    tarjetas.forEach((t, i) => dibujarTarjetaKPI(slide, x0 + i * (cardW + gap), y0, cardW, cardH, t));
    slide.addText('Los indicadores reflejan el período seleccionado en esta presentación.', { x: 0.6, y: y0 + cardH + 0.35, w: 12.1, h: 0.4, fontSize: 11, italic: true, color: GRIS_TEXTO, fontFace: 'Arial' });
    pieDePagina(slide);
  }

  // --- 4) Conformidad general (dona 3D dibujada a mano — ver nota arriba) --------
  if (secciones.conformidadGeneral) {
    slide = nuevaSlideClara();
    tituloSlide(slide, 3, '🟢 Conformidad general');
    const segsConf = [
      { etiqueta: 'Conforme', valor: k.conformesManual, color: GREEN },
      { etiqueta: 'No conforme', valor: k.noConformesManual, color: RED },
      { etiqueta: 'Pendiente', valor: k.pendientesManual, color: AMBER }
    ].filter(s => s.valor > 0);
    const imgDona = generarImagenDona3D(segsConf, segsConf.map(s => s.color));
    slide.addImage({ data: 'image/png;base64,' + imgDona, x: 3.6, y: 1.1, w: 6.1, h: 4.95 });
    const totalConf = segsConf.reduce((s, x) => s + x.valor, 0) || 1;
    segsConf.forEach((s, i) => {
      const y = 2.3 + i * 0.6;
      slide.addShape(pptx.ShapeType.rect, { x: 10.1, y: y + 0.05, w: 0.22, h: 0.22, fill: { color: s.color }, line: { type: 'none' } });
      slide.addText(`${s.etiqueta}: ${s.valor} (${((s.valor / totalConf) * 100).toFixed(0)}%)`, { x: 10.45, y, w: 2.3, h: 0.32, fontSize: 12, fontFace: 'Arial', color: TINTA });
    });
    pieDePagina(slide);
  }

  // --- 5) Conformidad por aliado (ranking horizontal + mejor/peor) ---------------
  if (secciones.porAliado && k.porAliado && k.porAliado.length) {
    slide = nuevaSlideClara();
    tituloSlide(slide, 4, '🏗️ Conformidad por aliado (% no conformidad)');
    const ordenAsc = k.porAliado.slice().sort((a, b) => a.pctNC - b.pctNC); // mejor primero para el chart de abajo a arriba
    slide.addChart(pptx.ChartType.bar3d, [{
      name: '% NC',
      labels: ordenAsc.map(a => a.aliado),
      values: ordenAsc.map(a => +(a.pctNC * 100).toFixed(1))
    }], { x: 0.7, y: 1.55, w: 11.9, h: 5.0, barDir: 'bar', bar3DShape: 'box', chartColors: [BLUE], showValue: true, dataLabelFontSize: 10 });
    const mejor = ordenAsc[0], peor = ordenAsc[ordenAsc.length - 1];
    slide.addText([
      { text: `🏆 Mejor: ${mejor.aliado} (${(mejor.pctNC * 100).toFixed(0)}% NC)`, options: { color: GREEN, bold: true } },
      { text: '     ', options: {} },
      { text: `⚠️ Atención: ${peor.aliado} (${(peor.pctNC * 100).toFixed(0)}% NC)`, options: { color: RED, bold: true } }
    ], { x: 0.7, y: 1.1, w: 11.9, h: 0.35, fontSize: 12, fontFace: 'Arial' });
    pieDePagina(slide);
  }

  // --- 6) Top de fallas más comunes ------------------------------------------------
  const topFallas = calcularTopFallas(8, actas);
  if (secciones.topFallas && topFallas.length) {
    slide = nuevaSlideClara();
    tituloSlide(slide, 5, '🔎 Top de fallas más comunes');
    slide.addChart(pptx.ChartType.bar3d, [{
      name: 'Fallas',
      labels: topFallas.map(f => f.etiqueta),
      values: topFallas.map(f => f.valor)
    }], { x: 0.7, y: 1.25, w: 11.9, h: 5.3, barDir: 'bar', bar3DShape: 'box', chartColors: [ORANGE], showValue: true, dataLabelFontSize: 10 });
    pieDePagina(slide);
  }

  // --- 7) Score por tipo de medida — medidores circulares tipo "gauge" -----------
  if (secciones.scorePorTipo && k.porTipoMedida && k.porTipoMedida.length) {
    slide = nuevaSlideClara();
    tituloSlide(slide, 6, '🎯 Score por tipo de medida');
    const tipos = k.porTipoMedida.slice(0, 4);
    const anchoGauge = 2.6, gap = 0.4;
    const totalAncho = tipos.length * anchoGauge + (tipos.length - 1) * gap;
    const xInicio = (13.33 - totalAncho) / 2;
    tipos.forEach((t, i) => {
      const x = xInicio + i * (anchoGauge + gap);
      const score = Math.round(t.scoreProm);
      const color = score >= 90 ? GREEN : score >= 70 ? AMBER : RED;
      slide.addChart(pptx.ChartType.doughnut, [{
        name: t.tipo, labels: ['Score', ''], values: [score, 100 - score]
      }], { x, y: 1.5, w: anchoGauge, h: anchoGauge, chartColors: [color, 'F2F4F7'], showLegend: false, showValue: false, holeSize: 72 });
      slide.addText(String(score), { x, y: 1.5 + anchoGauge / 2 - 0.4, w: anchoGauge, h: 0.8, fontSize: 30, bold: true, color, fontFace: 'Arial', align: 'center', valign: 'middle' });
      slide.addText(t.tipo, { x, y: 1.5 + anchoGauge + 0.15, w: anchoGauge, h: 0.4, fontSize: 14, bold: true, color: TINTA, fontFace: 'Arial', align: 'center' });
    });
    pieDePagina(slide);
  }

  // --- 8) Desacuerdos T≠U (tabla resumida) ---------------------------------------
  const desacuerdos = actas.filter(a => (a['Acuerdo T=U'] || '') === 'DESACUERDO');
  if (secciones.desacuerdos && desacuerdos.length) {
    slide = nuevaSlideClara();
    tituloSlide(slide, 7, `🧾 Desacuerdos Manual vs IA (${desacuerdos.length})`);
    const filasTabla = [
      [{ text: '#', options: { bold: true, fill: { color: PURPLE2 }, color: 'FFFFFF' } },
       { text: 'Aliado', options: { bold: true, fill: { color: PURPLE2 }, color: 'FFFFFF' } },
       { text: 'Manual', options: { bold: true, fill: { color: PURPLE2 }, color: 'FFFFFF' } },
       { text: 'IA', options: { bold: true, fill: { color: PURPLE2 }, color: 'FFFFFF' } }]
    ];
    desacuerdos.slice(0, 12).forEach(a => {
      filasTabla.push([
        { text: String(a['#']), options: { fontSize: 10.5 } },
        { text: a['Aliado'] || '', options: { fontSize: 10.5 } },
        { text: a['Supervisión Manual (T)'] || '', options: { fontSize: 10.5, color: RED } },
        { text: a['Supervisión IA (U)'] || '', options: { fontSize: 10.5, color: BLUE } }
      ]);
    });
    slide.addTable(filasTabla, { x: 0.7, y: 1.25, w: 11.9, h: 5.0, fontFace: 'Arial', border: { type: 'solid', color: GRIS_BORDE, pt: 1 } });
    if (desacuerdos.length > 12) {
      slide.addText(`…y ${desacuerdos.length - 12} más — ver el detalle completo en la app.`, { x: 0.7, y: 6.5, w: 11.9, h: 0.35, fontSize: 10, italic: true, color: GRIS_TEXTO, fontFace: 'Arial' });
    }
    pieDePagina(slide);
  }

  // --- 9) Conclusiones y recomendaciones -----------------------------------------
  if (secciones.conclusiones) {
    const { riesgos, oportunidades, recomendaciones } = calcularConclusiones(actas, k, topFallas);
    slide = nuevaSlideClara();
    tituloSlide(slide, 8, '🧩 Conclusiones y recomendaciones');
    const columnas = [
      { titulo: '⚠️ Riesgos', color: RED, items: riesgos, x: 0.6 },
      { titulo: '💡 Oportunidades', color: AMBER, items: oportunidades, x: 4.7 },
      { titulo: '✅ Recomendaciones', color: GREEN, items: recomendaciones, x: 8.8 }
    ];
    columnas.forEach(col => {
      slide.addShape(pptx.ShapeType.roundRect, { x: col.x, y: 1.2, w: 3.75, h: 5.3, rectRadius: 0.08, fill: { color: GRIS_CLARO }, line: { color: GRIS_BORDE, width: 1 } });
      slide.addShape(pptx.ShapeType.roundRect, { x: col.x, y: 1.2, w: 3.75, h: 0.08, rectRadius: 0, fill: { color: col.color }, line: { type: 'none' } });
      slide.addText(col.titulo, { x: col.x + 0.2, y: 1.35, w: 3.35, h: 0.4, fontSize: 14, bold: true, color: TINTA, fontFace: 'Arial' });
      slide.addText(col.items.map(i => ({ text: i, options: { bullet: { code: '25CF', color: col.color }, breakLine: true, paraSpaceAfter: 12 } })), {
        x: col.x + 0.2, y: 1.85, w: 3.35, h: 4.5, fontSize: 11.5, color: TINTA, fontFace: 'Arial', valign: 'top'
      });
    });
    pieDePagina(slide);
  }

  // --- 10) Cierre (siempre) — fondo claro con banda de acento ---------------------
  slide = nuevaSlideClara();
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: PURPLE }, line: { type: 'none' } });
  dibujarLogoEnerbit(slide, 5.5, 2.4, 2.3, 0.86, true);
  slide.addText('Gracias', { x: 0.6, y: 4.1, w: 12.13, h: 0.8, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center' });
  slide.addText('Auditoría CCE · enerBit S.A. ESP', { x: 0.6, y: 4.85, w: 12.13, h: 0.4, fontSize: 13, color: 'E9D5FF', fontFace: 'Arial', align: 'center' });

  await pptx.writeFile({ fileName: `Auditoria_CCE_${new Date().toISOString().slice(0, 10)}.pptx` });
  mostrarToast('PowerPoint descargado.', 'success');
  if (btnUsado) { btnUsado.disabled = false; btnUsado.textContent = '📽️ Generar PowerPoint'; }
}

/** Recalcula los mismos KPIs que buildKPIs() del backend, pero en el navegador sobre un subconjunto de actas (ej. filtrado por fecha). */
/** Agrupa las actas por mes y calcula, para cada uno, actas totales / no conformes / tasa. */
function calcularTasaNCPorMes(actas) {
  const grupos = {};
  actas.forEach(a => {
    const mes = normalizarFechaCliente(a['Fecha']).slice(0, 7);
    if (!mes) return;
    if (!grupos[mes]) grupos[mes] = { total: 0, noConf: 0 };
    grupos[mes].total++;
    if ((a['Supervisión Manual (T)'] || '') === 'NO CONFORMIDAD') grupos[mes].noConf++;
  });
  const NOMBRES_MES = { '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun',
    '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic' };
  return Object.keys(grupos).sort().map(mes => ({
    mes: NOMBRES_MES[mes.slice(5, 7)] || mes,
    total: grupos[mes].total,
    noConf: grupos[mes].noConf,
    tasa: grupos[mes].total ? (grupos[mes].noConf / grupos[mes].total) * 100 : 0
  }));
}

// Logo real (enerBit + Con el respaldo de Celsia) extraído de la plantilla oficial enerBit.
const LOGO_ENERBIT_B64 = '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';
// Fila de íconos de redes sociales extraída de la plantilla oficial enerBit.
const ICONOS_REDES_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAOYAAAAgCAYAAAAG2wQSAAAl5klEQVR4nO292Z9dx3Xf+11Vtfc+5/SIoTGxARCcSXGUOIoUKVqUYsuObcmxMviTTz7JvS+5Ny/5G/Jyn28e8skcKx/HcmzLmmxRsSgOEikO4AQSBEBiIGZ0o+fTZ9hD1cpD7dMD0CBBG7LkyAufZp/ep86paa1avzXUolRVpfw1SfXyrxCRlecictWfuxq60vdd+r0f307qdgEYjEXo93OcTRBxhCD0uyUfvn+Ww+8c5cjhY8xMz9HvFTibkKSW7bu2cvtdN3Hn3bcwef02xAVsIqgGRARjzEeOXVXR4CkLjzUJRhzdtufQux/w3oH3OfrBcRZmFygrT5alNBqWm27dxw037+Gu+25j68QmgihqPMbE/kQEQUCFEEBlMM8A9XyDD5Slx7kGqKBqOHdmhkNvHOXwwWOcPz9Ft92jqgJpmjEy2mTPvh3cee8d3HrnjYxtamJcIGjsdzC3j1r3sirxvsK5DF8EnE1wYpif63DowFHefuMgp0+cZWG+TVDFJJbh0SF2XTfBPfd+itvvvJGxLSO4xJJkghihqnxcR7Qex0du+5qFFwRQETT+We9HQILHhBITPEIArcAGNHQhVBAC+XKXd197m7/8ix9z7OhF+vkQeTlKFUbADGFMQLRCNaysi4iga9ntCiQ/L8H8qwrlR9Ggn08mmHGVBk1DgLIIOJfgKyHvF/yvp5/nh9/7CRdOzlN2lSRp4WxGVSmIxySBYPvsvn4Lv/mVv8fDj97N0HgDT4GIYK39mJEH8jwncSlVbjh7cpbv/NkPOfDGIeYutrE4nE3wZUnQgHPC4vI8Wyc2ccMtu/mn//x3mdy3E5uCcQFjDcaEwVcTVFAUCIgZcIWQ90uybIi8rxiF/fuP8OffeYb3D5xES0eVKwRLI22h6hGrqM0ZHrd87gsP8fkvPMz2XZuwqSdJLcYYVPXKBzEKRinKEvWAdzhjOfTOCb7/nWc5+NZRlhdyGm6Y4A3BC2oUrwXGBZrDhts/tY+vfu3XuOm26zBOUAGTgPcV1tlBR1dFooohoAJeDEEMChgBEyq06GGqHONzyJfR3hyds0dYuPAhvfYMoSpYbuc0hnZy+Fib/QfmODPVhHQvuR9CtUTwKAHRWiYEpP63qgq47PXPRTB/FkK5tp9PJpiRYaNwCiKGMgcNwskPz/L13/8j3nnrEPSaJGEMqw2CN2iwCIY0c/SqNhUdbFowvrnJb/+Dp3jy7z1MNuQQA9YZ4pKDiGF1G6KAoAHVQKgMR947wR/+/nc5evgc3WVIaGLFob7C+3JFIxojFL5HSZ/t123mn/yz3+H+Rz5FayTBWEVMIGhFCB7UrPZn6rUBCI7gLWXf8Mxf7udb3/w+M9NtbNnEeIfBYTQlBAdA0IKKDsF2SJoVn7rnJr7yu09x0227GRpp4Jwh1NqBlV5W2U5RvJYEA8Y7QmF4/ZWDfOtPnubDI+cp+xbjG1gaiE8JXrCJo9IcJCeYHpLkTF6/la9+7de4/5HbyVoJNhUqX8YDidW1/lh+UY/BowJBHF4MSjysjZZY38XkbcqFiyyfPsbCW8+RzBzFVAuE0AZKbJKyXCRkm25nsdrL/kOe149ULJbjBEkIUSLjHmh9OKlCEFTqsSpEyQ2giiC4y5l7Y6EZwL7Ln1+pvX5km7VC80kE9eOEbW2bwfcOTvJL+1vXrSioR3Bo6Zi50OHb33ieY2+fR3oJVEKlFWJKKg24xOJDSR6ilnLB4wtYnq34468/QzMd5sHHb2dkU4YRT+UDIhkhSA25PNbU66qCkDB9foH/+u+/w5njsxTdlFQzLI6y6pKkBZN7N7N9+w5EEubm25w7e57FtmdptuDPv/kMm8eHuPn2fbRGE/Kyj3MGwRLwCAawKFGbGgUjCb6AH3zvJb7/3R8zf34JR4ZWAuQEFjGmgZUWVWFwTrDGIWaEslNw4sAFvi/P8zv/+EvcdPtuxIIRJQSPSOxLMbVuCAiKtY6q8JhgeO+ND/nWHzzD6eOzJAwTQoE1QihyLAYjKaEAYxJMApWvIMDpD2b47p88y9BQgzvu2UdqDFgofSAxho3wyRXYFxAUA2pxwaASKI0nmBwbFmDxGLP7X6B78iA6c5zEdElchOS26NEslxgLhnK+JLMXeerWW2i5lOcPzzDXywgmw9gWiqUsC5ypCFrQyIbwpRCCIwBiPcZE2KvBXC6YVxaSqwXuP3u60hg/qS0rQjzJBJDIOARQD2/v/4CThy/SmfNkaYPNE1u5697PsHXrBEliUPWgJa1WxsLiPIcPvc/5M7MszHUpusIf/vfvMDyScu+DN2Izj80ygoZaQGqbRhUJSvCG7nKP//IfvsHU6SV8P8F4iXDPBBqpcv3NO/hH//Q3ue3uGwhdxztvn+A//6c/XIHbRw+f5k+/8QP+5b/+hzRHtpC6FEzAhwhtBYOSgBhEAqIBQTj+wWl+8sNXWZ7pkajDh4I0sfjQQ0wHMRX95T6NdBTwBJ9DMCTqqDrK0YNneeeND7huzzZckiGuIiIQgYGIRAMXRAleyVzKueNtnv72TzhzdBbfc1RUJIklz5dpZkNo1SdUHq8Zmcvo9To0WhmqCaW3nD0xw0vPv8meG7czMTqGCrjEIEGvGsoONHogarOI/hXIUdOmXDpD9+hr9E68RrM7jW10IVWyTVvotQuKRUvL52Ra4VgklD0qv8xtu+/ldK9Bfjon9ym9osSr4jJBKcks9LtthCGMsyCWUnMIPQyGxDQuF8xPQtcKkq6FvdeCLtWOl0Lb2B+sQC0VIELM4GFhvs1LL77M1NRFsqzF9okxHnzkAVSE+fkLNBqWygfA0+5AVZU88OB9zO1r88LzrzA3t8hyO3DgwBFuuG2SbZOjBALWGlQlohJVNAQECxj2v/I2F07N0l7s47QRHSTGgg1gPbfdcQO79k6wON/m8LvHOHTgNMvtDnm/IqjgbMbBd97nzVeO8PjIZxje3CQExRiDNXF+ASFQO4AQep2Kt14/wsXpJfr9HGMV60ruuu82tu8YpzVsKXuKk2GKosAmQl50Ofb+Mc6dmaUsLO12jxeef5n7Hr6DoeGd0fFkazRyKfpSgyDkvcCR945w9vRZyqLCiKOqKq7bu4N9N05y5MgxZqYWItQ0CaXmmEQIqqiCkJD3e7z+6ls88OgdDI/eQmM4I/iARTY+oDd8VEPJ2vkTasTvVDGhYOn8Cc4ffgvXWWDrnuvwrqC7PE87adJOUsYmtyEhZ3HqDGXeBRfQsMRItsjte8c5d3GJqfkS8Q1squTFEi6JGpFUCL5L0EAIFnEBFCrvMTZ8Eo35s7ELB3QtHEQhrNo3G3124JiI76244NZb3xheeuk1Tp+6QPBCkVdMbN3B4sIS7x56l4sz05RVzsS2zYSqYPfunTz00AO8+cZ+PvforzDyZpNur09elLx/6DQLcx227RrHJjW0U41wj2hvGrX0uyWnjk2xvFiSmhY2WCpfgIWi6tNsBLZNbsJmwksvvsb3vvkMs+eWSWSE4MG5Bj5UOCM89+xP+dS9N9Eaa4ADI4KoQaWepPgIl3AsLfQ5fuwcy+0KazO2bmvx1a99icm926hCTntpicQ20cpSVZ7R0SFsEnjiyU/zg6d/xE9/8h6ZbXDu7Axv7f+AHbu2MpI6RCR6iXWgOQd2nyAYep0+hw4eY2Z6niwdIlRK2mqxZ99OfuMrXyB8t2B+aZqiW+AkpSgCWWopywojKeAIoWR6aoofPv0sk3sm2NXcSQge4+zVe2UREBNtO9EawQhWA7o8R/fEQVqdi2RJYP7iNFtuuI5mv0+vV+Eko9kYIZ9ewFQVLSmhXCJhme7SIe7ZPMHZnQ16vZT5ZUelPdJmxfjEGI10iDSx9JZ7tJcK5mYX2LV9G1kzo9/PGR0e30gwYSMhvPrJ/uzpaiDrWjvzY+1SpZ6goSyVd985RL9XEkICQRBJKcuKxaU5xsaHeeSzT7F7che9bpuy7GKssLi4QJqmZGlKnucgTS5OtZmeXmJ3dzvNkYSi6mNtsgJjESEodLsV50/PUnaVUICzgrWQJDAyNEw27HGZxVPhpSJtJKRJSt4paDXGqCqDsQ4NMH1hjvnZJSav34ZLLCFUhMFa1OESkbg+x46e5tzZeXxlCCiTk7sYGxviv/233+f4iZOURcHQUJN+r8AXFmMykgS+9KtPsGXrNlpDp5m6sIjNEl7+6es8+NhtDI9tR7WKTqa1h6NGIdBKaM91mJ2aB2/I+wWKoqHk9LkzvPjqq5yZOkFz3CJJhdGSkXSYssiplgp8CUYaJDbDpqMcOXSUpaVlJhFcmtabebVu2TV+DgJaA37Uw9I8Mn2adGkKyQxkm5g7O03R61EYR9dbxC+T9UoSH2hQ0UpKXL+HkylMfopROwG5MtLaRj/pc/dn7+LLv/3rbNk8RuqEi1NzfOtPf8Bbb7zL//Uvv8rOyW0szC2xZfPo1UPZj3Pg/E3SlfpdG5a4kpCuvg+rXsP4WhDaS8ssL3fJ+yXOtHCNjOANWZaRZim33nory8sd/vIvf0jilCee+BzvHDjAxZlZ+v0+QUGw+GBot/sszHUYwCWXJKgKIfgY+8MRSqXXKel3A1VuMSRoiKNyzvArX3iCTz9yM3tu2UJjLOWJLzzOPXfcz6vPHOTp777A0pJHvcVlCWXZA3WcvzDFreUekmZWxzI1OpmMIiY6gkSg1y/o9yusaaGhT7OVcejwYaYv5PSWhzC2wT/5vX/MzPQ8L/34ANMX+vRL5eypkt2TY2ho0mgYKs1pL+X0lgPqhYAHoxgLtSuyXvRoXc/PztNZ6iBBcNbhNSDWMzTSYNfkVg4ftfzqZ59kfHwrDddk89gmpi/M871v/ZCzpxYp8wqjkLgGGjxzF5couhXZUFp7nS/h1UFM91K20XgwKoEgUTBRsFVFOXUWtzRDk5x0bCudLVtZ7nsqk7PlhlvYu20f3Zk5yvPH6V3M6HbO0vc540mJhh5FOcf2ievZPDrEiekFJu/ezJe+/BgmLfj6//gGiSv5+7/+RR578l5OnfmAtFUxsXOIQ++/y/d/8O7VC6Yxa5n4b4auVWLCRu1jINpQlUoIMTYoGPr9Pv1+H8XEwLpLV9qVhWfnjl0cPHiQ48c+BC3ZvHkLxiSkaQvnmliTkqZNijKh9AUiluCj2IMHZCXgjCpBlV63R5lXJDahKAyVFoiBNHUMD7eYnJxgZDiDBJqNFnbLEEVZ4pKMxFYY16Tb76FW6PdyirwgVAGCYp0lBBOFE40OKFUI0RETvOJ9IE0T0jRjbHwcEY1OoIbl+ht28PjnH+S+T3+Gf/f//0/On7/I/OIcEztGMCkUVYGKUuQVy+2cKkDlC5LMrbHlV/dTgFB6qtKjCuqjKSHWMDo+wi233sDx03u45zN3sndyL52lJcTATbfuZGb6Ak/PvcJSETDGUOQFzlYszC3iqwrRlLVWyhoGIKw9IOJoYrM6thiINr8JQL9HvrwIZR/jC9rnzzLfKUm3TJIOb6Zym3Dbb2frjROEokNYOk/nxOt0jr1MZ+YDbB+KoAyPDZG1LI2m4eZbrmdi2zgvvv4KJ04doSwWufe+fWzfuoct24ZJm4bpi/M899zLHDl0bKNwCRvM7ErP/vZSjSSJ8csYfkchSRKssdE2E6Esi1rjKCPDo7TbHRqNFqOjoyTOsHtyLydPnqTMK/J+ha8UX2p0wlsl+AoEfPDR1GJw4MTT2RhDkqbYxNIvcqxpIGqwaYNOp8tPXnyR01NHeOJL93PbPTfz9tuHeP3Fw7z78jGW233y3JA1GrjUYrOMdm8u9mEEjOC9H0RQWW/vKUErxChJIqh6QlC63S5ilSQBH0oW5/scXDzOX3zvOWbnpxGTMzbWREQp+iXGWIwzOGdoDaUI0GgOEbRcFcp6nam1lnMGa+uYZ1DECd4HsjQhSQxVUaA+MDV1gf/8H/892ya28rV/8Ls0mg7nwNp4yCRJgnUFzVYT1KxBQYP+PpIDVmMoUrv+NAZ4cBbbaFDZhDxEM3Tr6DDD40OcOT9POTuLmiE024kkghvdx+j4bvol9JaWSHtLWNsg75d4FYIxjI6NkKQpTzz+BPd/+mHKok1qlYW5Hs45qsLQaXv6XQ8h2Ugw/88SwCtT1JQipra5oldseHiIRjONf0tkVpHoUc3zgg8+OMrDDz/E3ffcibOwuDDHqVOn6Pf7pGmGcyk+BFRKms2U5lCGdYMAianN2dV0OWsjQ7uGIWkK/eWCRpJQln3ECqdOnmdq5gy33bmXm269gQ+PnuL1V99g4UKOhBYubRFdSZ5er83k3h1MbNuKS12MnZq674GHVAdwX0gSQPqoCfiypNvtMTayK4qwQFUq3/6zZ5idmWf24gKIkJdtRkcbWLUk0gK/hNqSRqtF1jBYC977mIWj0eM8sPuUgKqhMdwkayUYA2rqAwpBq+gY84UnsULRzSn6StH35P2AcynGGlRKgg8YKoyFiYnNNIZSjCUG9K/aUVnHudf9N4CzZFu2UQ1vorfQomUqpLNEtTTDSK9grtOjuvg50qG9qB0DLEW5QLtokTBGRiCxLc6enWGhM0qpI1ycWWB2dpkPT5/g2R+9QHd5jn1799BIRzlz6gLq45wFCF6vXjB/Rsk6P1dSBWOITgmN6WpDwwm33X4zxw/NkxcVQ0PDGCd0um1ElDNnTvMHf3CUoBXOKI1GgrUW61KSxNDtLhNChSSGHTu3sGfvVtLEgmjUXsYhMkh4UMQqzSHH0GiCawihW+ExFGVFw6WUeYkPOWUvIBVIKfgCwMbc2VTwWqKmpNl05MUyE9s2YZ3DGEHx0es4iCuqMMiV3XfDJBPbxpi/cJZeL+fi9By33vJ5fu/3vsbLr7xCklhOnjxHI3Psum4bkHPLLXfy5JOf5c3Xj5A1DVkTct/l7rsfYHx8GGMNvX5OJhnGrmrn+ONRq0xs38zmiU24xgzexxCKigNvEA9aCr4naDBU/YR+J8EklrJUUtci73dIUkNedJncsZWxLS2sE4qqxLorhEs25oCYB4sgAazW4pmmyOYJ/KYd5FMfkpVLhOkLZG6ZllXmlnvoxXdg+yQyCmpbJOMtRvfsZenCVmY7JY3WVopsjE5QelXBmbNzVH3DA/fez/zUIksLi3zxyc8zPd3m0LvnMGqwCBaHL6u/nQkG147CimdO1a/w0MMPP8RbP/2QE+1plIK5uWnuuOsmdhfXMTc3h3MOaw2+6pHnEYrcdNNtnD1zFu9j3mjh++y8bitj40MELTBqMSaphTKsG0WjlXHL7Tfw9psnSBqWMvdkjRiHTFyL1lCDzLYwKiSmgVaCiMMlGaWvABBbkVcdHnvwIbZOjOKswatHjERv7Mq21sKpgYnt4+zZO8Hpo+dxdogzp8/xB1//X9x6xx185tOPYF3BE48/jtGMojCEULCwMMPrrx3ipZ+8ycXpJVQKRjal3P/gnYyOD6Na0Wq1qEIg1DBwQErUiK2RlOv37ebg6ydYbleIOlQDywsFRw5MszxX8sG7p7EmJV92LBvDOy9Pce7DNt3lEmcTgla0hps88uiDbNo0ipoCa2VgOV4lrWJtowap90VDwIyMM7znFpYufEg53WU8ddgiEKgYyQLn3t/PdZt3k/R7aDZGMpSx7YabyZY+w+niCDPdzRw+16bnowPxvYPH+eb/fI4v/eojPPbwoxhRps+1eeFHb9Je8Jw+2aXRDIQqw8kn8Mr+n0YirGgtVSWoxxK1yZ4927n7vtuZvbjM3MUFzEzJ0OmMHbt2sWvHZPTcWUFDEZ0pIgQVfvrKy0xNX8AHZfO2Ye646wZGxlq41BI0YOrAu9bQDWrLyxju/vSdPPfsGywtTKFiMDbDl4GqUsocfCGEQjAhIbEZaBEdWCZ6Fb3kbN2xiS/+2qOMbR5DRdekYa5JpJBVu6o1lHLnPbdw+MBxTp+aw+fCG2+8x1tvHSdtBKzr0syaqG+gmuJ9SVWVlIUHtWiAdMjwyGP3sXvvBC6JHlmDYEw8AAa2vGqMFWJArHD7nTfx6gsH6C/PUfYr0iTlyOGjnD59in6/w4nD5wnBsNT2zDcCf3TqLxBVlpY6uMTVSRc38pmH7qY10sBrFc2SdZ72j2OCeFiIxpRyGWh2m4AMMzZ5C1w4TXd+hn6nQ6agAawvsfPnaL/zY5ar/TC2k+vuvA81lsVOk17jZl59Z5oLi5a8DkVZ02L/y+9y5sOTjI5k4KHXVebm2+Rlybe/+RwaAsvtHia0NhJMc/mjvyZ90lDLpe1/Fnavagy+x/xYj7NxU3yoaIxaHnnyHo4cO0q37NDOS15/632St08w1Bwm7+SIxkSFoizIGgm46MQoRTCNwL47tnLXQ/uwTYNXcC6lKEqsdRiByKFEwbaWHTs38//8q3/B//dv/i1TZ+YpK0iSJsbERPilxcDibKC9VOILg+9BmkElPcgCxvX58ld+ky27tqPO1Bk+MbeFkES3j9ThxejpoF/2eOCxe3jjjXeYmptneSngTEZiIeQVVddQ4kmM1oeQpwolLhH6vk02nDBx3Qj3ffZ2RrYP4U28lVP5auXAqC9W1cn7gi/juG66bQ9P/cYj/Nf/8A3yfkHRdTjToOpbVIfpVQZfCUnWoOwGqryiXy7THLKYrI9NSx75/L1MbN9K0sgofB8rUiehXx2F2hEWNWW81hVttoyqGMZuuo1NtysLFztMn3+XCVKkfxZXLrM5nKE6PsNIMoSf38Ls/PtUrX1cXBrj5NQQH5xy5MUQeEOSNBCx9MuS+ekeC9Pd2E19YBpxLFxcXBmXFbk2t0s+jn4RBTNuCLW95UF8/dyS96DfF9549TB/9Iff5cL5RWyVUi57LA6LIzVZHZ5UCt+nkpxKcpqjKbd86nr+7//3q1y3e9PKbRDv/bp7metHYghBKbrw42f3871vPsO5U/No4QjeYCTm5gatSFIhcxmhH5MNNKmQtOKxpx7gy7/1RXbumSBrGGIiQQwRiMZc2ag0Y5KB4tEQKHqBsuv4+n/5U1776UFmpzukOBwOUYvRJGYOqWKcQW1FGToUdNkxuZXf+tqXePRX7mFkvIVqwFpLVVXr7qGuXhrQeq5C2a/AG77/nWd45i9+zOxUG58nEDJMyFASjEliipoDNTlqepTaZnjc8NSvPc6Xfv0Jtu/ajJiAcVBVFcY4jFydctHBNS+tMFRrEhYNYLC+j/RnKM6/z9Sbz1KdepVG/xw29AhlL4aDbJPCbKIjk7TNDVzMr+OHL5/hwqIh0MLXwje4i1nDh9j/yv7XmnstT/zyCqZZ4y4fCGdMMq8qEHH0O4EPj0/zJ3/8bd578xjaT6kKTyg1JomrYp1QaZ9CezRHHQ8++hl+66tfYPP2EYaGUqyrmfoKQgmgeIIvSJKMueku+196lz/7o6eZmergS4dogmoUXjEQqj7DLUNRLbN15xYeffIhHnvqYbZftxmXgNgolPFSbqgTCgbe2HhRWtVTFAUEizMZ89M9fvj0T3n+mVe5eK5NKAWthNRlaBXjhkpFMAVJS9hz406+/Jtf5K77bmZok2CS1TkOhHKtQA5+RKAsSxKbESpYnFnm1Rff4uk//xHnT82i3mFNM175MkkM+WhFGfoYV7Jt5yi/8dtf5JHH72XT1hEwilLGlESX1LnHV8cvKhHeCxWGEqnv4ZRqwCSIL0iKNsYvUc2fpTp1iOL8Ufrtafq9WVQ9WbaJdqfFhbkWR07CwRM5M90GJUNIkkRfhPcxAmDMStroRjz9d4IJrBNMqMMJMV2t2+3hbIIxjna7g3rlJ88e4I+//l067R5Z2qAqS/J+h2argbjAvpt285Wv/QZ3f/pWXMMiFqqqIE0TIObxXlFApaLwHTrtZYabm5CqwakTM7z+yrs8/6OXmLnYoSpAiOl8zabidZ777r+T3/na32fTts00Rxu4FIIEDAFrJCaFaB2jlUEME6LGDJRljpWEKlcy16DfDZx4/wLf+/YLvHfgA4IX+p0uWgWS1OIyoTnk+PxTn+VzX3iYbbvGSRoQ8NHuQ1eQwaWZVwN7vqxyEMWIwwaHFQeVcOrEFM/96EV+8vzLzE4vEGoUoSKIUTZtGeX+B+7mV774Ofbs20VjyGFTpddbxiW2TqQIGEnWHEIfTSpCvEZQYjRqzAqhkhRP/D4XSjLNMVUPgkK/S9W5iA1dlhYXeO7Zl9n/ygnOnPWU1QTqdpD7FoEEqh7iy9p0YbWCwZqLFVeivxPMdR1pfdF3wGBC4iy9fh/KFOst7x85yZv732a5u4Qzls2bx7nv/nu4bu8OTGJQU0XGq0/HtWmCV7pFo8SYaVXGmxbWJDE8gqHfqXjt1QN8eOwUIFSlMrlnGw88eBebJ0bASQ0xAz7ECgdGBGfi/IwMUuSIQfg6rqg1aPNVzDgq+x5nU4w6ylyYOjvHK6++xtzsPE6i1/SOO2/lrntvZngkI9jooTRJfeczRGZzLrotvPcrc17dP0UlIhMNGiF2MAQPJjhCgPnZJQ6/9z7Hj56gn+cElBtuvpG777mD8fERkoZFpa7EICGGhOqLCN6HeF/0KgUziCEIWPUYLTEEKqDEEUwS3UHekxJI8GhVoaIYQ7xg7QOdxR4v/OgVXnzhAGdOLTM3pxgzjgZHJooJFXUuIhrWpIR+TKz1l1gwiZ7L+i7eamaM1ilpHhFPVRU467Amg8oiGqiqeFFafbxtHqQO5DuhCrGcSPSwSDzFay050CSXr0e8DhZUsWY16K1Bo70UhOAVDcTYoCgqgYBHTUy7K31Va33BisWKJfgazlKueH3ihaKYFuhDgZEYyzNiEDUYLEGBING2DeDLgHUGMUqgwNhYX0hNRQgGo42VxIUBVFtbZmStYIrRWqsbijwnsSn4gTMuRvIGkU/vQ8xgsvGJEQi1fRzNyGizlmWFtRZj7CeKtwcxeBGMKlZLRHz00IujwMTrdCJEX6/HSYwpKxYhifZy6cErs9PzHHrnOG+9foTOIvQ7xNTIUBKCYm2sw+QH68OlNibrLjpJWZbXTDA3Shz/qDYbtb2WQviRcEECKhXxKIvG/spvtLY7Q+0UCjDIMa3T2syg8oAIoXY2rORqCxBk3XzWwpjLBxqZIDaMYxONDimpIaAZxD4wBBnUi1FUlCDU8dE4JqPxqteqW6GqY5mWUNtgKoqRgEj0SsvK4RQT3anDCLEkhtQZSzEVTqW2U4mOKwkZbFg3YAMaCKaa1euagzWp72uKSgTbsjrHQYWONQHZ1dTGdT/rY8Tr264nj1AJsfaP+trOjG6YIBat1zD+C6j2EalAHKoJGoSgsTCXAYw3aGGo+hbvLb2iTxXKGKUaTFHqka7NCNRBJEtWXv+NxzF/cVL+fP0DURijJoE1WnTwJxJT9Ey1wsCDTdO6ZEeMTNabqYNMl7gbG91uWUcruzQolLV6IKgJNaMOWAQis1K/GjCzqeOVcXzUmxxfm1pzmpVCHzKwOXVNut6qrlrTx2AhBDGxztFaQBbDPld5CA/CRHqJIA04V+JFaJVAqGOM8UH9kZWqhoM9GNjNa9IKZGXTPpJWZjzYT0zUhBpiCqYODmSp3xdEUyCNaymGYAVRS6WeoGCtwTSEJBMShabLwKSXrcHGSRC6TttfU8H8WAb8OdFGFQxWkrkHm7tyeg8+NdA4huixjdq1/qYVZl4VhTVMomYlLHGVI8SYakVLr5q+QszUGWjyWquvKbdpBkKxUnCLVaGs3xrcDFIZFISK01YGwj5IdzBr5hJqRlntOwRhzeAGXdVrcbXmSrzVs7o0g4vNcd460MqD1rryKdalEa3s3dWVq9wYqbFyUMW9daiU9UGnNVqpG6pd0ZLRpvAM8p+FJH5ewaOIqWKVwhpuXzaWDcY7AGODt/7agrmRMP7iaMVVuqzmqRjQZPAuK0tSe2fXk0XIQKPnMdLAIFgj5Gt0GrLmOz+WYtGP9Q4BuVwgV3qJmk5WtOL6OTIY1ko2S6ih7RootW6utXAO2gw0EwOUGYVg3RWuWhbjEC8XzI/iATOAdYMDE1ll1to+13rs0e4cvGlWmoTBANf+ZmXAV0WisTxZvUL17yQWYamrGqzsr0ToLXgIJWiJEiF5Kk1EXFwPrUCKOEZJ0RUkxiUobPXPlSnI6u9rpjGvpm7PtS78fLU0sO/W/ujKNaFBI1ivNmX9m+pYWa661OBqUFjW2QcrbbjaWkaRGUVlDWS7VLAHp3dt2a21yxlUKR3YxnX7lQSD+N7qDZfYTmT1AFrVTNTSNniwqsWjApA17aXWvBvPcePaO6uhk0F/IuvFeqX7tdpy5cBbsx4r2voSbt+ALnMoAkL0G2gNTWOVWVg1TQaGbQ1l6+wwrd+PgjiQJr+y3gO4CzUyWHm+MpiNVmvtsX7toewvGoyFVcEcvIY1uu0y3tFVIdVVhgir2G/1+Ursc62QrM/huLo1qSEra/pYOx6oN3cgYAPbdq2OHgheLSgDqD1gipWDx9dsfAkqkNUmq8kpq8Ie0eaamkoCRmuGlYFm/3gaTE1hHVSUNQ4to7VDa2CP1geWrFsbXbVBWXsIXB1KGfQ16NXoAN7Xh80avLkK/UNdyyiaF2JWSrghEmPDoS6FaRCsKkY8qzy1OvLLRyoRJtdXAq9puOQXHc6upwFDDWiN9thg7Cu5jXJ5+43or3ZAbQR/1/ezTitf+mlZy/aX9r+RBl7bZhWO67oa/hvbj4Nv1A3HfOl41j+7mrUZCKKqrnotP2LuH9UnXGk/asHUgcYcHN6sCOxAW8bWtd9gxXwZUFiFHDXsjwfcxyOJK5ZW/eUVzJ/tGH8eyOFazeevMvZLme1qxnI17T7pWK6FufRX/Y5r6fz8pb32dSX6pMWk/45YZyZ8EqEc/P7bvraXORZrulLq3dXM95daMD/JyfaLaDtfSr9IY/x5re21+K6f9TpeDbL8pRbMv6NrQx/3/6n5qM/9bdeWcPmc16KBj2r/UXP/30DsqF5xuPhjAAAAAElFTkSuQmCC';

/**
 * Genera la presentación "reducida": 1-2 diapositivas en formato de tarjeta
 * ejecutiva (número, categoría, título, gráfica + tabla, mini-indicadores
 * de estado, nota) — replicando el estilo del ejemplo real de enerBit que
 * se compartió (círculo numerado, subrayado naranja, tarjetas de estado con
 * fondo tintado, logo con el respaldo de Celsia).
 */
async function generarPowerPointReducido(tarjetas, fechaDesde, fechaHasta, btnUsado) {
  if (typeof PptxGenJS === 'undefined') {
    mostrarToast('No se pudo cargar la librería de PowerPoint. Revisa tu conexión e intenta de nuevo.', 'error');
    return;
  }
  if (!state.kpis) { mostrarToast('Espera a que carguen los datos antes de generar el PowerPoint.', 'error'); return; }

  if (btnUsado) { btnUsado.disabled = true; btnUsado.textContent = 'Generando…'; }
  mostrarToast('Generando presentación reducida…', 'success');

  let actas = state.actas;
  if (fechaDesde || fechaHasta) {
    actas = actas.filter(a => {
      const f = normalizarFechaCliente(a['Fecha']);
      if (!f) return false;
      if (fechaDesde && f < fechaDesde) return false;
      if (fechaHasta && f > fechaHasta) return false;
      return true;
    });
  }
  const k = calcularKpisLocal(actas);

  const PURPLE = '501C7C', ORANGE = 'FF7900', GREEN = '12B76A', RED = 'D92D20',
    AMBER_TXT = 'B54708', AMBER_BG = 'FFF4E5', GREEN_BG = 'E7F9F0', RED_BG = 'FCE9E9',
    PURPLE_BG = 'F3E8FF', GRIS_TEXTO = '667085', GRIS_BORDE = 'E4E7EC', TINTA = '1D2939';

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CCE', width: 13.33, height: 7.5 });
  pptx.layout = 'CCE';
  pptx.author = 'Asistente CCE';
  pptx.title = 'Auditoría CCE — enerBit (resumen)';

  // Franja inferior reservada SIEMPRE para la fila de íconos de redes sociales
  // (posición real de la plantilla: x=0.4", y=6.85", 1.9"x0.27"). El contenido
  // de la tarjeta nunca se dibuja debajo de FOOTER_Y, así que jamás la tapa.
  const FOOTER_Y = 6.72;
  // Ancho seguro para el título: la plantilla pone el logo en x=10.7", así que
  // el título nunca debe extenderse más allá de LOGO_X - un margen de 0.3".
  const LOGO_X = 10.7;

  /** Logo real (imagen exacta de la plantilla), siempre arriba a la derecha. */
  const dibujarLogo = (slide) => {
    slide.addImage({ data: 'image/png;base64,' + LOGO_ENERBIT_B64, x: LOGO_X, y: 0.32, w: 2.0, h: 0.75 });
  };

  /** Fila de íconos de redes sociales (imagen exacta de la plantilla), siempre abajo a la izquierda. */
  const dibujarRedesSociales = (slide) => {
    slide.addImage({ data: 'image/png;base64,' + ICONOS_REDES_B64, x: 0.4, y: FOOTER_Y + 0.14, w: 1.9, h: 0.27 });
  };

  const footer = (slide) => {
    dibujarRedesSociales(slide);
    dibujarLogo(slide);
  };

  /**
   * Caja de contenido con fondo blanco, sin borde — más limpia que el naranja
   * de la plantilla original. Todo el contenido de la tarjeta (gráfica, tabla,
   * tarjetas de estado, nota) se dibuja DENTRO de esta caja, nunca fuera.
   */
  const dibujarCajaContenido = (slide, x, y, w, h) => {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: 'FFFFFF' }, line: { type: 'none' } });
  };

  /** Mini-tarjeta de estado con fondo tintado, como en el ejemplo (Promedio / Meta / etc.). */
  const dibujarStatCard = (slide, x, y, w, h, opts) => {
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: opts.fondo }, line: { type: 'none' } });
    slide.addText(opts.etiqueta, { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.28, fontSize: 10.5, color: GRIS_TEXTO, fontFace: 'Arial' });
    // Los valores numéricos cortos ("9.8%", "99") se ven bien grandes (22pt),
    // pero un nombre de aliado largo a ese tamaño se desborda de la tarjeta y
    // se monta sobre lo que esté debajo. Se reduce el tamaño según el largo
    // del texto para que SIEMPRE quepa en una sola línea dentro de la tarjeta.
    const texto = `${opts.valor} ${opts.icono || ''}`.trim();
    const fontSize = texto.length > 18 ? 13 : texto.length > 12 ? 16 : 22;
    slide.addText(texto, { x: x + 0.15, y: y + 0.36, w: w - 0.3, h: h - 0.42, fontSize, bold: true, color: opts.color, fontFace: 'Arial', valign: 'top', wrap: false });
  };

  /**
   * Encabezado de tarjeta — círculo numerado + categoría + título de 1 o 2
   * líneas + subrayado naranja, igual a la plantilla real (slide2.xml). El
   * título nunca pasa de LOGO_X - 0.3" de ancho, así que no puede taparlo aunque
   * el texto sea largo. Devuelve el "y" donde debe empezar la caja de contenido.
   */
  const encabezadoTarjeta = (slide, numero, categoria, titulo, tituloLinea2, descripcion) => {
    slide.background = { color: 'FFFFFF' };
    const anchoTitulo = LOGO_X - 0.3 - 1.3; // deja siempre 0.3" libres antes del logo
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.5, y: 0.68, w: 0.4, h: 0.4, fill: { color: PURPLE }, line: { type: 'none' } });
    slide.addText(String(numero), { x: 0.5, y: 0.68, w: 0.4, h: 0.4, fontSize: 15, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center', valign: 'middle' });
    slide.addText(categoria.toUpperCase(), { x: 1.3, y: 0.32, w: anchoTitulo, h: 0.28, fontSize: 12, bold: true, color: ORANGE, fontFace: 'Arial', charSpacing: 1 });
    slide.addText(titulo, { x: 1.3, y: 0.56, w: anchoTitulo, h: 0.45, fontSize: 22, bold: true, color: PURPLE, fontFace: 'Arial' });
    let yUnderline = 1.2;
    if (tituloLinea2) {
      slide.addText(tituloLinea2, { x: 1.3, y: 0.98, w: anchoTitulo, h: 0.35, fontSize: 15, bold: true, color: PURPLE, fontFace: 'Arial' });
      yUnderline = 1.42;
    }
    slide.addShape(pptx.ShapeType.roundRect, { x: 1.3, y: yUnderline, w: 1.7, h: 0.05, rectRadius: 0.03, fill: { color: ORANGE }, line: { type: 'none' } });
    const yDescripcion = yUnderline + 0.13;
    slide.addText(descripcion, { x: 0.4, y: yDescripcion, w: 12.5, h: 0.28, fontSize: 10.5, color: GRIS_TEXTO, fontFace: 'Arial' });
    return yDescripcion + 0.4; // donde debe empezar la caja de contenido
  };


  // --- Tarjeta 1: Tasa de No Conformidad Manual, por mes -------------------------
  if (tarjetas.noConformidad) {
    const porMes = calcularTasaNCPorMes(actas);
    const slide = pptx.addSlide();
    const yContenido = encabezadoTarjeta(slide, 1, 'Auditoría · CCE', 'Tasa de No Conformidad Manual', null,
      'Tasa = Actas No Conformes / Total de actas revisadas  |  Supervisión manual, por mes');

    // Caja de contenido (fondo blanco + borde naranja, igual a la plantilla real).
    // Todo lo de abajo (chart, tabla, tarjetas de estado, nota) se dibuja DENTRO
    // de ella con un padding fijo — nunca se sale de la caja ni pisa el pie.
    const PAD = 0.2;
    const cajaX = 0.4, cajaW = 12.53;
    const cajaY = yContenido - PAD;
    const cajaAlto = FOOTER_Y - 0.18 - cajaY;
    dibujarCajaContenido(slide, cajaX, cajaY, cajaW, cajaAlto);

    const innerX = cajaX + PAD, innerW = cajaW - PAD * 2;
    const statH = 0.7, notaY = cajaY + cajaAlto - PAD - 0.24;
    const statY = notaY - 0.06 - statH;
    const contenidoH = statY - 0.15 - yContenido;

    if (porMes.length) {
      const chartW = innerW * 0.53, tableX = innerX + chartW + 0.3, tableW = innerW - chartW - 0.3;
      slide.addChart(pptx.ChartType.bar3d, [{
        name: 'Tasa NC %', labels: porMes.map(m => m.mes), values: porMes.map(m => +m.tasa.toFixed(1))
      }], { x: innerX, y: yContenido, w: chartW, h: contenidoH, bar3DShape: 'box', chartColors: [ORANGE], showValue: true, valAxisTitle: '% no conformidad', catAxisTitle: 'Mes' });

      const filasTabla = [[
        { text: 'Mes', options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 10.5 } },
        { text: 'Actas', options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 10.5 } },
        { text: 'No Conf.', options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 10.5 } },
        { text: 'Tasa', options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 10.5 } }
      ]];
      porMes.forEach(m => {
        const critico = m.tasa >= 10;
        filasTabla.push([
          { text: m.mes, options: { fontSize: 10.5, bold: true } },
          { text: String(m.total), options: { fontSize: 10.5 } },
          { text: String(m.noConf), options: { fontSize: 10.5 } },
          { text: m.tasa.toFixed(2) + '%', options: { fontSize: 10.5, bold: critico, color: critico ? RED : TINTA } }
        ]);
      });
      slide.addTable(filasTabla, { x: tableX, y: yContenido, w: tableW, h: contenidoH, fontFace: 'Arial', border: { type: 'solid', color: GRIS_BORDE, pt: 1 } });

      const promedio = porMes.reduce((s, m) => s + m.tasa, 0) / porMes.length;
      const ultimo = porMes[porMes.length - 1];
      const anterior = porMes[porMes.length - 2];
      const gap = 0.15, cardW = (innerW - gap * 3) / 4;
      const cx = i => innerX + i * (cardW + gap);
      dibujarStatCard(slide, cx(0), statY, cardW, statH, { etiqueta: 'Promedio período', valor: promedio.toFixed(1) + '%', icono: promedio < 5 ? '✅' : '⚠️', color: promedio < 5 ? GREEN : AMBER_TXT, fondo: promedio < 5 ? GREEN_BG : AMBER_BG });
      dibujarStatCard(slide, cx(1), statY, cardW, statH, { etiqueta: `Último mes (${ultimo.mes})`, valor: ultimo.tasa.toFixed(1) + '%', icono: ultimo.tasa >= 10 ? '⚠️' : '✅', color: ultimo.tasa >= 10 ? RED : GREEN, fondo: ultimo.tasa >= 10 ? RED_BG : GREEN_BG });
      dibujarStatCard(slide, cx(2), statY, cardW, statH, { etiqueta: 'Meta de referencia', valor: '< 5%', icono: '', color: PURPLE, fondo: PURPLE_BG });
      dibujarStatCard(slide, cx(3), statY, cardW, statH, { etiqueta: 'Total actas', valor: String(k.total), icono: '', color: TINTA, fondo: 'F2F4F7' });

      if (anterior && ultimo.tasa > anterior.tasa) {
        slide.addText(`⚠️ ${ultimo.mes} ya superó a ${anterior.mes} (${ultimo.tasa.toFixed(1)}% vs ${anterior.tasa.toFixed(1)}%).`, { x: innerX, y: notaY, w: innerW, h: 0.22, fontSize: 10, italic: true, color: RED, fontFace: 'Arial' });
      }
    } else {
      slide.addText('No hay suficientes actas con fecha para calcular la tendencia mensual.', { x: innerX, y: yContenido + 0.3, w: innerW, h: 0.5, fontSize: 13, color: GRIS_TEXTO, fontFace: 'Arial' });
    }
    footer(slide);
  }

  // --- Tarjeta 2: Riesgo por aliado -----------------------------------------------
  if (tarjetas.porAliado && k.porAliado && k.porAliado.length) {
    const slide = pptx.addSlide();
    const yContenido = encabezadoTarjeta(slide, tarjetas.noConformidad ? 2 : 1, 'Auditoría · Aliados', 'Aliados con mayor no conformidad', null,
      '% No conformidad manual sobre el total de actas de cada aliado');

    const PAD = 0.2;
    const cajaX = 0.4, cajaW = 12.53;
    const cajaY = yContenido - PAD;
    const cajaAlto = FOOTER_Y - 0.18 - cajaY;
    dibujarCajaContenido(slide, cajaX, cajaY, cajaW, cajaAlto);

    const innerX = cajaX + PAD, innerW = cajaW - PAD * 2;
    const statH = 0.7, notaY = cajaY + cajaAlto - PAD - 0.24;
    const statY = notaY - 0.06 - statH;
    const contenidoH = statY - 0.15 - yContenido;
    const chartW = innerW * 0.53, tableX = innerX + chartW + 0.3, tableW = innerW - chartW - 0.3;

    const top5 = k.porAliado.slice(0, 5);
    slide.addChart(pptx.ChartType.bar3d, [{
      name: '% NC', labels: top5.map(a => a.aliado), values: top5.map(a => +(a.pctNC * 100).toFixed(1))
    }], { x: innerX, y: yContenido, w: chartW, h: contenidoH, barDir: 'bar', bar3DShape: 'box', chartColors: [RED], showValue: true, valAxisTitle: '% no conformidad' });

    const filasTabla = [[
      { text: 'Aliado', options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 10.5 } },
      { text: 'Actas', options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 10.5 } },
      { text: '% NC', options: { bold: true, fill: { color: PURPLE }, color: 'FFFFFF', fontSize: 10.5 } }
    ]];
    top5.forEach(a => {
      filasTabla.push([
        { text: a.aliado, options: { fontSize: 10 } },
        { text: String(a.actas), options: { fontSize: 10.5 } },
        { text: (a.pctNC * 100).toFixed(1) + '%', options: { fontSize: 10.5, bold: true, color: a.pctNC >= 0.5 ? RED : TINTA } }
      ]);
    });
    slide.addTable(filasTabla, { x: tableX, y: yContenido, w: tableW, h: contenidoH, fontFace: 'Arial', border: { type: 'solid', color: GRIS_BORDE, pt: 1 } });

    const ordenAsc = k.porAliado.slice().sort((a, b) => a.pctNC - b.pctNC);
    const mejor = ordenAsc[0], peor = ordenAsc[ordenAsc.length - 1];
    const promedioGeneral = k.porAliado.reduce((s, a) => s + a.pctNC, 0) / k.porAliado.length;
    const gap = 0.15, cardW = (innerW - gap * 3) / 4;
    const cx = i => innerX + i * (cardW + gap);
    dibujarStatCard(slide, cx(0), statY, cardW, statH, { etiqueta: '🏆 Mejor aliado', valor: mejor.aliado.length > 16 ? mejor.aliado.slice(0, 16) + '…' : mejor.aliado, icono: '', color: GREEN, fondo: GREEN_BG });
    dibujarStatCard(slide, cx(1), statY, cardW, statH, { etiqueta: '⚠️ Mayor riesgo', valor: peor.aliado.length > 16 ? peor.aliado.slice(0, 16) + '…' : peor.aliado, icono: '', color: RED, fondo: RED_BG });
    dibujarStatCard(slide, cx(2), statY, cardW, statH, { etiqueta: 'Promedio general', valor: (promedioGeneral * 100).toFixed(1) + '%', icono: '', color: PURPLE, fondo: PURPLE_BG });
    dibujarStatCard(slide, cx(3), statY, cardW, statH, { etiqueta: 'Aliados evaluados', valor: String(k.porAliado.length), icono: '', color: TINTA, fondo: 'F2F4F7' });

    slide.addText(`⚠️ ${peor.aliado} concentra el mayor riesgo — priorizar seguimiento y capacitación.`, { x: innerX, y: notaY, w: innerW, h: 0.22, fontSize: 10, italic: true, color: RED, fontFace: 'Arial' });
    footer(slide);
  }

  await pptx.writeFile({ fileName: `Auditoria_CCE_resumen_${new Date().toISOString().slice(0, 10)}.pptx` });
  mostrarToast('Presentación reducida descargada.', 'success');
  if (btnUsado) { btnUsado.disabled = false; btnUsado.textContent = '📽️ Generar PowerPoint'; }
}

function calcularKpisLocal(actas) {
  const total = actas.length;
  const contar = (campo, valor) => actas.filter(a => (a[campo] || '').toString().trim() === valor).length;
  const conformesManual = contar('Supervisión Manual (T)', 'CONFORME');
  const noConformesManual = contar('Supervisión Manual (T)', 'NO CONFORMIDAD');
  const pendientesManual = contar('Supervisión Manual (T)', 'PENDIENTE');
  const conformesIA = contar('Supervisión IA (U)', 'CONFORME');
  const noConformesIA = contar('Supervisión IA (U)', 'NO CONFORMIDAD');
  const desacuerdos = contar('Acuerdo T=U', 'DESACUERDO');

  const aliados = {};
  actas.forEach(a => {
    const al = a['Aliado'] || 'Sin aliado';
    if (!aliados[al]) aliados[al] = { actas: 0, ncManual: 0, scoreSuma: 0, scoreN: 0 };
    aliados[al].actas++;
    if ((a['Supervisión Manual (T)'] || '') === 'NO CONFORMIDAD') aliados[al].ncManual++;
    const s = parseFloat(a['Score']);
    if (!isNaN(s)) { aliados[al].scoreSuma += s; aliados[al].scoreN++; }
  });
  const porAliado = Object.keys(aliados).map(nombre => ({
    aliado: nombre, actas: aliados[nombre].actas,
    pctNC: aliados[nombre].actas ? aliados[nombre].ncManual / aliados[nombre].actas : 0,
    scoreProm: aliados[nombre].scoreN ? aliados[nombre].scoreSuma / aliados[nombre].scoreN : 0
  })).sort((a, b) => b.pctNC - a.pctNC);

  const tipos = {};
  actas.forEach(a => {
    const t = a['Tipo Medida'] || 'Sin tipo';
    if (!tipos[t]) tipos[t] = { suma: 0, n: 0 };
    const s = parseFloat(a['Score']);
    if (!isNaN(s)) { tipos[t].suma += s; tipos[t].n++; }
  });
  const porTipoMedida = Object.keys(tipos).map(t => ({ tipo: t, scoreProm: tipos[t].n ? tipos[t].suma / tipos[t].n : 0 }));

  return { total, conformesManual, noConformesManual, pendientesManual, conformesIA, noConformesIA, desacuerdos, porAliado, porTipoMedida };
}
// ============================================================================
// SELECTOR DE VISTA (Barras / Dona / Barra apilada) — recuerda la elección
// ============================================================================
const COLOR_MAP = {
  '': 'var(--purple-500)', accent: 'var(--orange-500)',
  success: 'var(--green-600)', danger: 'var(--red-600)', warning: 'var(--amber-700)'
};

function obtenerVistaGuardada(contenedorId, porDefecto) {
  return localStorage.getItem('cce_vista_' + contenedorId) || porDefecto;
}

/**
 * Dibuja "datos" (formato común [{etiqueta, valor, clase}]) como Barras, Dona,
 * Barra apilada, Línea o Cascada, según lo que el usuario haya elegido para
 * ese panel (se recuerda en localStorage). Así una misma gráfica puede verse
 * de la forma que a cada persona le resulte más fácil de leer — funciona
 * igual para CUALQUIER panel del Dashboard, no solo los 4 originales.
 */
function renderPanelFlexible(contenedorId, datos, porDefecto, modo) {
  const tipo = obtenerVistaGuardada(contenedorId, porDefecto || 'barras');
  const selector = document.querySelector(`.selector-vista[data-target="${contenedorId}"]`);
  if (selector && selector.value !== tipo) selector.value = tipo;

  const coloreados = datos.map((d, i) => ({
    ...d, color: (d.clase !== undefined && COLOR_MAP[d.clase]) ? COLOR_MAP[d.clase] : PALETA_MULTICOLOR[i % PALETA_MULTICOLOR.length]
  }));
  const opcionesGrafica = modo ? { modo } : undefined;

  if (tipo === 'dona') {
    renderDona(contenedorId, coloreados, opcionesGrafica);
  } else if (tipo === 'apilada') {
    renderBarraApilada(contenedorId, coloreados, opcionesGrafica);
  } else if (tipo === 'linea') {
    renderLineaGenerica(contenedorId, datos);
  } else if (tipo === 'cascada') {
    renderCascada(contenedorId, datos);
  } else {
    const max = Math.max(...datos.map(d => d.valor), 1);
    renderBarras(contenedorId, datos.map(d => ({ etiqueta: d.etiqueta, valor: d.valor, texto: String(d.valor) + (d.sufijo || ''), clase: d.clase })), max);
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
  } catch (e) { /* usa el default de abajo */ }
  // Antes esto devolvía TODOS_LOS_PANELES (todo visible de entrada). Ahora los
  // paneles originales del Dashboard arrancan OCULTOS por defecto — la persona
  // los revela explícitamente marcándolos en "👁 Vistas", o pidiéndolos al
  // asistente (que los fija como panel personalizado, siempre visible aparte).
  return [];
}

function guardarPanelesVisibles(nombres) {
  localStorage.setItem('cce_paneles_visibles', JSON.stringify(nombres));
}

/**
 * Agrega un pequeño botón "✕" al encabezado de cada panel ORIGINAL (no a los
 * personalizados, que ya tienen su propio "🗑 Quitar") para poder ocultar
 * ese panel puntual sin tener que usar "🧹 Limpiar" (que oculta todos) ni
 * entrar al modal de "👁 Vistas". Es idempotente: si el botón ya existe no
 * lo vuelve a insertar.
 */
function agregarBotonesCerrarPanel() {
  document.querySelectorAll('#view-dashboard .panel[data-panel-nombre]').forEach(panel => {
    if (panel.classList.contains('panel-personalizado')) return; // ya tienen su propio 🗑 Quitar
    const h3 = panel.querySelector('h3');
    if (!h3 || h3.querySelector('.btn-cerrar-panel-individual')) return;
    const nombre = panel.dataset.panelNombre;
    h3.insertAdjacentHTML('beforeend', `<button type="button" class="btn-cerrar-panel-individual" title="Ocultar este panel" data-cerrar-panel="${escapeHtml(nombre)}">✕</button>`);
  });

  // Un solo listener por delegación — funciona incluso para paneles que se
  // vuelvan a crear después (no hace falta re-conectar cada vez).
  if (!document.body.dataset.cerrarPanelConectado) {
    document.body.dataset.cerrarPanelConectado = '1';
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-cerrar-panel-individual');
      if (!btn) return;
      const nombre = btn.dataset.cerrarPanel;
      guardarPanelesVisibles(obtenerPanelesVisibles().filter(n => n !== nombre));
      aplicarVisibilidadPaneles();
    });
  }
}

function aplicarVisibilidadPaneles() {
  const visibles = obtenerPanelesVisibles();
  document.querySelectorAll('#view-dashboard [data-panel-nombre]').forEach(el => {
    if (el.id === 'panelHallazgos') {
      // Además de la preferencia del usuario, "Hallazgos" solo puede mostrarse
      // si realmente hay datos de esa pestaña — mostrar un panel vacío sería peor.
      const hayDatos = state.hallazgosPorAliado && state.hallazgosPorAliado.length;
      el.style.display = (hayDatos && visibles.includes(el.dataset.panelNombre)) ? '' : 'none';
      return;
    }
    // Antes los paneles personalizados (fijados desde "Buscar y graficar") quedaban
    // SIEMPRE visibles, exentos de esta lista. Ahora se rigen por la misma regla que
    // los originales: también arrancan ocultos por defecto, y solo se muestran si su
    // nombre está en la lista de visibles (ver conectarBotonFijarPanel y
    // configurarSoloMisPaneles para cómo entran a esa lista).
    el.style.display = visibles.includes(el.dataset.panelNombre) ? '' : 'none';
  });
  agregarBotonesCerrarPanel();
}

function configurarVistas() {
  document.getElementById('btnVistas').addEventListener('click', () => {
    pintarListaPaneles();
    pintarEstadoSlots();
    abrirModal('modalVistas');
  });
  document.getElementById('btnCerrarVistas').addEventListener('click', () => cerrarModal('modalVistas'));
  document.getElementById('btnRestablecerOrden').addEventListener('click', () => {
    guardarOrdenPaneles(TODOS_LOS_PANELES.slice());
    aplicarOrdenPaneles();
    pintarListaPaneles();
    mostrarToast('Orden restablecido.', 'success');
  });

  document.querySelectorAll('#modalVistas [data-accion]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.slot;
      if (btn.dataset.accion === 'guardar') guardarVista(slot);
      else cargarVista(slot);
    });
  });

  configurarSoloMisPaneles();
  configurarLimpiarDashboard();
  configurarMostrarOcultarGraficas();
}

/**
 * Los paneles ORIGINALES del Dashboard arrancan ocultos por defecto (ver
 * obtenerPanelesVisibles) — este botón simplemente abre el asistente para
 * que la persona pida justo lo que quiere ver. Ya no existe un botón
 * "Mostrar todas" para revelarlos de golpe; la única vía es pedirlo.
 */
function configurarMostrarOcultarGraficas() {
  const btn = document.getElementById('btnMostrarOcultarGraficas');
  btn.addEventListener('click', () => {
    document.getElementById('btnAsistente').click(); // abre el panel del asistente
    renderBuscadorGraficas();
  });
}

/**
 * Botón toggle: oculta de un clic los 10 paneles originales del Dashboard
 * (los personalizados que fijaste no se tocan), para dejar el Dashboard
 * mostrando solo lo que tú elegiste. Recuerda antes cuáles estaban visibles,
 * para poder devolverlos igual al desactivar el modo.
 */
/**
 * Botón "🧹 Limpiar": oculta TODOS los paneles de una vez (originales y
 * fijados), sin excepción — la forma más directa de dejar el Dashboard en
 * blanco para empezar de cero y pedir solo lo que se quiera ver. También
 * resetea "Solo mis paneles" para que no quede en un estado inconsistente.
 */
function configurarLimpiarDashboard() {
  const btn = document.getElementById('btnLimpiarDashboard');
  btn.addEventListener('click', () => {
    guardarPanelesVisibles([]);
    localStorage.removeItem('cce_solo_mis_paneles');
    localStorage.removeItem('cce_paneles_visibles_antes_de_solo_mios');
    aplicarVisibilidadPaneles();
    const btnSolo = document.getElementById('btnSoloMisPaneles');
    if (btnSolo) btnSolo.textContent = '🎯 Solo mis paneles';
    mostrarToast('Dashboard limpio. Pide lo que quieras ver desde "¿Qué quieres ver?".', 'success');
  });
}

function configurarSoloMisPaneles() {
  const btn = document.getElementById('btnSoloMisPaneles');

  const enModoSoloMios = () => localStorage.getItem('cce_solo_mis_paneles') === '1';
  const actualizarTextoBoton = () => {
    btn.textContent = enModoSoloMios() ? '👁 Mostrar todos los paneles' : '🎯 Solo mis paneles';
  };

  btn.addEventListener('click', () => {
    if (enModoSoloMios()) {
      // Restaurar: vuelve a mostrar los paneles que estaban visibles antes de activar el modo
      const anteriores = JSON.parse(localStorage.getItem('cce_paneles_visibles_antes_de_solo_mios') || 'null');
      guardarPanelesVisibles(Array.isArray(anteriores) ? anteriores : []);
      localStorage.removeItem('cce_solo_mis_paneles');
    } else {
      // Activar: guarda qué estaba visible, y muestra SOLO los paneles fijados
      // (los personalizados) — ocultando los originales. Fijarlos ya es "pedirlos"
      // explícitamente, así que "Solo mis paneles" es la forma de revelarlos.
      localStorage.setItem('cce_paneles_visibles_antes_de_solo_mios', JSON.stringify(obtenerPanelesVisibles()));
      guardarPanelesVisibles(obtenerPanelesPersonalizados().map(p => p.titulo));
      localStorage.setItem('cce_solo_mis_paneles', '1');

      if (!obtenerPanelesPersonalizados().length) {
        mostrarToast('Aún no tienes paneles fijados — ve a "Buscar y graficar" para agregar alguno.', 'error');
      }
    }
    aplicarVisibilidadPaneles();
    actualizarTextoBoton();
  });

  actualizarTextoBoton(); // deja el texto correcto si ya estaba activado desde antes
}

/** Nombres de los paneles que el usuario ha fijado desde el asistente ("📌 Fijar en el Dashboard"). */
function obtenerNombresPanelesPersonalizados() {
  return obtenerPanelesPersonalizados().map(p => p.titulo);
}

/** Todo lo que se puede elegir mostrar/ocultar: los paneles originales + los que el usuario fijó. */
function obtenerUniversoPaneles() {
  return TODOS_LOS_PANELES.concat(obtenerNombresPanelesPersonalizados());
}

function obtenerOrdenPaneles() {
  const universo = obtenerUniversoPaneles();
  try {
    const guardado = JSON.parse(localStorage.getItem('cce_orden_paneles'));
    if (Array.isArray(guardado) && guardado.length) {
      // Si se agregó un panel nuevo (original o fijado) después de guardar el orden, se añade al final
      const faltantes = universo.filter(n => !guardado.includes(n));
      return [...guardado.filter(n => universo.includes(n)), ...faltantes];
    }
  } catch (e) { /* usa el orden por defecto */ }
  return universo.slice();
}
function guardarOrdenPaneles(orden) {
  localStorage.setItem('cce_orden_paneles', JSON.stringify(orden));
}

/** Reordena los paneles fijos dentro del grid del Dashboard según el orden guardado. */
function aplicarOrdenPaneles() {
  const grid = document.getElementById('panelGridDashboard');
  obtenerOrdenPaneles().forEach(nombre => {
    const el = grid.querySelector(`[data-panel-nombre="${CSS.escape(nombre)}"]`);
    if (el) grid.appendChild(el); // mover al final en el orden correcto va reordenando todo
  });
}

function moverPanelEnOrden(nombre, direccion) {
  const orden = obtenerOrdenPaneles();
  const idx = orden.indexOf(nombre);
  const nuevoIdx = idx + direccion;
  if (nuevoIdx < 0 || nuevoIdx >= orden.length) return;
  [orden[idx], orden[nuevoIdx]] = [orden[nuevoIdx], orden[idx]];
  guardarOrdenPaneles(orden);
  aplicarOrdenPaneles();
  pintarListaPaneles();
}

function pintarListaPaneles() {
  const cont = document.getElementById('listaPanelesVista');
  const visibles = obtenerPanelesVisibles();
  const orden = obtenerOrdenPaneles();
  const nombresFijados = new Set(obtenerNombresPanelesPersonalizados());
  cont.innerHTML = orden.map((nombre, i) => `
    <div class="fila-panel-vista">
      <label><input type="checkbox" value="${escapeHtml(nombre)}" ${visibles.includes(nombre) ? 'checked' : ''}> ${escapeHtml(nombre)}${nombresFijados.has(nombre) ? ' <span class="badge-personalizado">fijado</span>' : ''}</label>
      <div class="botones-orden">
        <button type="button" class="btn-orden" data-mover="${escapeHtml(nombre)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
        <button type="button" class="btn-orden" data-mover="${escapeHtml(nombre)}" data-dir="1" ${i === orden.length - 1 ? 'disabled' : ''} title="Bajar">▼</button>
      </div>
    </div>
  `).join('');

  cont.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const seleccionados = [...cont.querySelectorAll('input:checked')].map(c => c.value);
      guardarPanelesVisibles(seleccionados);
      aplicarVisibilidadPaneles();
    });
  });
  cont.querySelectorAll('.btn-orden').forEach(btn => {
    btn.addEventListener('click', () => moverPanelEnOrden(btn.dataset.mover, Number(btn.dataset.dir)));
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
    orden: obtenerOrdenPaneles(),
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

  guardarPanelesVisibles(vista.paneles || []);
  if (vista.orden) guardarOrdenPaneles(vista.orden);
  Object.keys(vista.tipos || {}).forEach(target => localStorage.setItem('cce_vista_' + target, vista.tipos[target]));
  if (vista.columnas) guardarColumnasVisibles(vista.columnas);

  aplicarVisibilidadPaneles();
  aplicarOrdenPaneles();
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
  document.getElementById('btnVerPendientes').addEventListener('click', () => {
    // Reutiliza el mismo filtro que ya existe (Manual: PENDIENTE) — este botón
    // es solo un atajo más visible, con contador, para llegar directo a la
    // "bandeja de pendientes" sin tener que abrir el desplegable.
    document.getElementById('filtroSupervision').value = 'PENDIENTE';
    state.filtros.supervision = 'PENDIENTE';
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
  document.getElementById('filtroSupervisionTipo').addEventListener('change', () => {
    renderDashboard();
  });
  document.getElementById('filtroSupervisionFechaDesde').addEventListener('change', () => renderDashboard());
  document.getElementById('filtroSupervisionFechaHasta').addEventListener('change', () => renderDashboard());
  document.getElementById('btnNuevaActa').addEventListener('click', () => abrirModalActa(null));
  configurarImportacionExcel();
}

/**
 * Descarga TODAS las actas cargadas ahora mismo (state.actas, con las mismas
 * columnas que ves en pantalla) como un archivo Excel — un respaldo local en
 * tu computador, independiente de Google Sheets. No sube ni cambia nada, solo
 * descarga una copia de lo que ya está en pantalla en este momento.
 */
function exportarDatosCompletosComoRespaldo() {
  if (!state.actas || !state.actas.length) { mostrarToast('No hay datos cargados todavía para respaldar.', 'error'); return; }
  const columnas = state.headers && state.headers.length ? state.headers : Object.keys(state.actas[0]);
  const hoja = XLSX.utils.json_to_sheet(state.actas, { header: columnas });
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Datos completos');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(libro, `Respaldo_Datos_completos_CCE_${fecha}.xlsx`);
  mostrarToast('Respaldo descargado — guárdalo en tu computador.', 'success');
}

// ============================================================================
// IMPORTAR DESDE EXCEL (.xlsx) — lee el archivo en el navegador con SheetJS,
// hace match con la hoja "Datos Completos" y sincroniza (upsert) por "#".
// ============================================================================
function configurarImportacionExcel() {
  const btn = document.getElementById('btnImportarExcel');
  const input = document.getElementById('inputExcel');
  const btnExportar = document.getElementById('btnExportarDatosCompletos');
  if (btnExportar) btnExportar.addEventListener('click', exportarDatosCompletosComoRespaldo);

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    input.value = ''; // permite volver a elegir el mismo archivo más tarde
    if (!file) return;

    try {
      const analisis = await analizarExcel(file);

      if (!analisis.actas.length && !analisis.hojaHallazgos && !analisis.hojasExtra.length) {
        mostrarToast('No encontré actas (fila con "#"), hoja de hallazgos, ni ninguna otra hoja con datos en este archivo.', 'error');
        return;
      }

      // Si el archivo trae SOLO actas (el caso más común, sin nada más que
      // preguntar), no interrumpimos con preguntas — se sincroniza directo.
      if (analisis.actas.length && !analisis.hojaHallazgos && !analisis.hojasExtra.length) {
        await confirmarYSincronizarActas(analisis.actas, btn);
        return;
      }

      // Si trae actas, hallazgos, y/o cualquier otra hoja con datos, dejamos
      // que la persona elija qué hacer con cada una, desde el Asistente.
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

  if (analisis.hojasExtra && analisis.hojasExtra.length) {
    html += `<div class="hallazgo-grupo">
      <h4>📚 Otras ${analisis.hojasExtra.length} hoja(s) encontradas en el libro</h4>
      ${analisis.hojasExtra.map((h, i) => `
        <div class="hallazgo-item">
          <b>${escapeHtml(h.nombre)}</b>
          <span class="hallazgo-detalle">${h.filas} fila(s) con datos. No tiene un formato reconocido (ni actas ni hallazgos), pero te la puedo entregar tal cual en CSV.</span>
          <button type="button" class="btn-descargar-hoja-extra" data-hoja="${escapeHtml(h.nombre)}" style="margin-top:8px;">📥 Descargar "${escapeHtml(h.nombre)}" en CSV</button>
        </div>`).join('')}
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

  cont.querySelectorAll('.btn-descargar-hoja-extra').forEach(b => {
    b.addEventListener('click', () => {
      const nombreHoja = b.dataset.hoja;
      const csv = XLSX.utils.sheet_to_csv(analisis.workbook.Sheets[nombreHoja]);
      const nombreArchivo = nombreHoja.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.csv';
      descargarCsv(csv, nombreArchivo);
      mostrarToast(`CSV de "${nombreHoja}" descargado.`, 'success');
    });
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
        let nombreHojaActas = null, idxEncabezado = -1, filas = null;
        for (const nombre of workbook.SheetNames) {
          const candidatas = XLSX.utils.sheet_to_json(workbook.Sheets[nombre], { header: 1, raw: true, defval: '' });
          const idx = candidatas.findIndex(f => String(f[0]).trim() === '#');
          if (idx !== -1) { nombreHojaActas = nombre; idxEncabezado = idx; filas = candidatas; break; }
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

        // Cualquier otra hoja del libro que no sea ni la de actas ni la de
        // hallazgos — para no dejar información del Excel sin recoger
        // (ej. "Datos_Graficos", "Resumen Ejecutivo", "formulas", etc.).
        const hojasExtra = workbook.SheetNames
          .filter(n => n !== nombreHojaActas && n !== hojaHallazgos)
          .map(n => {
            const filasHoja = XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1, raw: true, defval: '' });
            const filasConDatos = filasHoja.filter(f => f.some(celda => celda !== '' && celda !== null && celda !== undefined));
            return { nombre: n, filas: filasConDatos.length };
          })
          .filter(h => h.filas > 0); // ignora hojas totalmente vacías

        resolve({ workbook, actas, hojaHallazgos, hojasExtra, nombreHojaActas });
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

  // Contador en vivo de "🔔 Pendientes": se recalcula cada vez que se renderiza
  // la tabla (al cargar, al filtrar, y después de guardar una acta editada) —
  // así el número va bajando solo a medida que se completa la Supervisión
  // Manual de cada una, sin tener que refrescar nada a mano.
  const totalPendientes = state.actas.filter(a => (a['Supervisión Manual (T)'] || 'PENDIENTE') === 'PENDIENTE').length;
  const btnPend = document.getElementById('btnVerPendientes');
  const badgePend = document.getElementById('badgePendientes');
  if (badgePend) badgePend.textContent = totalPendientes;
  if (btnPend) btnPend.classList.toggle('sin-pendientes', totalPendientes === 0);

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
// VISTA: SUPERVISIÓN (formulario completo) — tabla dedicada con filtros
// ============================================================================
function configurarVistaSupervision() {
  ['filtroSupervisionViewTexto', 'filtroSupervisionViewAliado', 'filtroSupervisionViewConforme',
    'filtroSupervisionViewTipoMedida', 'filtroSupervisionViewDesde', 'filtroSupervisionViewHasta'
  ].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', () => renderTablaSupervisionView());
  });

  document.getElementById('btnActualizarSupervisionExcel').addEventListener('click', () => {
    document.getElementById('inputSupervisionExcel').click();
  });
  document.getElementById('inputSupervisionExcel').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) actualizarSupervisionDesdeExcel(file);
  });
}

function supervisionFiltradaCompleta() {
  const texto = document.getElementById('filtroSupervisionViewTexto').value.trim().toLowerCase();
  const aliado = document.getElementById('filtroSupervisionViewAliado').value;
  const conforme = document.getElementById('filtroSupervisionViewConforme').value;
  const tipoMedida = document.getElementById('filtroSupervisionViewTipoMedida').value;
  const desde = document.getElementById('filtroSupervisionViewDesde').value;
  const hasta = document.getElementById('filtroSupervisionViewHasta').value;

  const serieATipo = {};
  state.actas.forEach(a => {
    const serie = (a['Serie Medidor'] || '').toString().trim();
    if (serie) serieATipo[serie] = (a['Tipo Medida'] || '').toString().trim().toLowerCase();
  });

  return (state.supervisionDetalle || []).filter(s => {
    if (aliado && s['Aliado'] !== aliado) return false;
    if (conforme && (s['Conforme'] || '') !== conforme) return false;

    const tipo = serieATipo[(s['Serie Medidor'] || '').toString().trim()];
    if (tipoMedida === 'semi_indirecta' && tipo !== 'semidirecta' && tipo !== 'indirecta') return false;
    if (tipoMedida && tipoMedida !== 'semi_indirecta' && tipo !== tipoMedida) return false;

    const fecha = (s['Fecha Ejecucion OS'] || '').toString().slice(0, 10);
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;

    if (texto) {
      const haystack = [s['Aliado'], s['Tecnico'], s['Serie Medidor'], s['Zona'], s['Supervisor'], s['Numero OS']]
        .join(' ').toLowerCase();
      if (!haystack.includes(texto)) return false;
    }
    return true;
  }).map(s => ({ ...s, _tipoMedida: serieATipo[(s['Serie Medidor'] || '').toString().trim()] || '' }));
}

function renderTablaSupervisionView() {
  // Refresca el desplegable de aliados con los valores reales presentes
  const selectAliado = document.getElementById('filtroSupervisionViewAliado');
  if (selectAliado.options.length <= 1) {
    const aliados = [...new Set((state.supervisionDetalle || []).map(s => s['Aliado']).filter(Boolean))].sort();
    const actual = selectAliado.value;
    selectAliado.innerHTML = '<option value="">Todos los aliados</option>' +
      aliados.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    selectAliado.value = actual;
  }

  const filtradas = supervisionFiltradaCompleta();
  document.getElementById('supervisionViewSubtitle').textContent =
    filtradas.length + ' de ' + (state.supervisionDetalle || []).length + ' respuestas mostradas';

  const tbody = document.querySelector('#tablaSupervisionView tbody');
  tbody.innerHTML = '';
  filtradas.slice(0, 500).forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s['ID'])}</td>
      <td>${escapeHtml((s['Fecha Ejecucion OS'] || '').toString().slice(0, 10))}</td>
      <td>${escapeHtml(s['Aliado'])}</td>
      <td>${escapeHtml(s['Tecnico'])}</td>
      <td>${escapeHtml(s['_tipoMedida'])}</td>
      <td>${escapeHtml(s['Serie Medidor'])}</td>
      <td>${escapeHtml(s['Numero OS'])}</td>
      <td>${celdaHtml('Conforme', s['Conforme'] === 'Conforme' ? 'CONFORME' : (s['Conforme'] === 'No conforme' ? 'NO CONFORMIDAD' : s['Conforme']))}</td>
      <td>${escapeHtml(s['Tipo Hallazgo 1'])}</td>
      <td>${escapeHtml(s['Zona'])}</td>
      <td>${escapeHtml(s['Supervisor'])}</td>
      <td>${escapeHtml(s['Observacion General'])}</td>`;
    tbody.appendChild(tr);
  });
  if (!filtradas.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--ink-500);padding:20px;">Sin resultados con estos filtros.</td></tr>';
  } else if (filtradas.length > 500) {
    tbody.insertAdjacentHTML('beforeend', `<tr><td colspan="12" style="text-align:center;color:var(--ink-500);padding:10px;">…y ${filtradas.length - 500} más — afina los filtros para acotar.</td></tr>`);
  }
}

/** Lee un Excel del formulario de Supervisión y lo envía al backend para actualizar (upsert por ID). */
async function actualizarSupervisionDesdeExcel(file) {
  const btn = document.getElementById('btnActualizarSupervisionExcel');
  btn.disabled = true;
  btn.textContent = 'Leyendo archivo…';
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const nombreHoja = workbook.SheetNames.find(n => {
      const filas = XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1, raw: true, defval: '' });
      const encabezados = (filas[0] || []).map(h => (h || '').toString().toLowerCase());
      return encabezados.some(h => h.includes('conforme')) && encabezados.some(h => h.includes('medidor'));
    }) || workbook.SheetNames[0];

    const filas = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, raw: true, defval: '' });
    const encabezadosOriginales = (filas[0] || []).map(h => (h || '').toString().trim());
    // Quita tildes antes de comparar, para que patrones sin acento (ej. "numero de os")
    // sí encuentren encabezados con acento (ej. "Número de OS") — antes esto fallaba
    // silenciosamente y la búsqueda caía a un patrón de respaldo demasiado genérico.
    const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const encabezadosNormalizados = encabezadosOriginales.map(h => sinTildes(h.toLowerCase()));
    const idx = (patron) => encabezadosNormalizados.findIndex(h => h.includes(sinTildes(patron)));

    const mapaColumnas = {
      'ID': idx('id'), 'Fecha Supervision': idx('fecha de supervis') !== -1 ? idx('fecha de supervis') : idx('fecha supervision'),
      'Fecha Ejecucion OS': idx('fecha de ejecuci') !== -1 ? idx('fecha de ejecuci') : idx('fecha ejecucion'),
      'Supervisor': idx('supervisor') !== -1 ? idx('supervisor') : idx('realizada por'), 'Zona': idx('zona'),
      'Serie Medidor': idx('medidor'), 'Tipo Inspeccion': idx('inspecci'),
      'Numero OS': idx('numero de os'),
      'Aliado': idx('aliado'), 'Tecnico': idx('cnico'),
      'Conforme': idx('conforme'), 'Tipo Hallazgo 1': idx('tipo de hallazgo'),
      'Condicion Tecnica': idx('condici'), 'Observacion General': idx('observaci')
    };

    const registros = [];
    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const id = mapaColumnas['ID'] !== -1 ? fila[mapaColumnas['ID']] : null;
      if (id === null || id === undefined || id === '') continue;
      const obj = {};
      Object.keys(mapaColumnas).forEach(campo => {
        const col = mapaColumnas[campo];
        if (col === -1) return;
        let valor = fila[col];
        if (valor instanceof Date) valor = valor.toISOString().slice(0, 10);
        obj[campo] = valor === undefined ? '' : valor;
      });
      registros.push(obj);
    }

    if (!registros.length) {
      mostrarToast('No encontré filas con ID en ese archivo — revisa que sea el formulario de Supervisión.', 'error');
      return;
    }

    btn.textContent = 'Actualizando…';
    const resp = await postAccion('bulkImportSupervision', { registros });
    await cargarDatos(false);
    renderTablaSupervisionView();
    mostrarToast(resp.mensaje || `${registros.length} registros de Supervisión actualizados.`, 'success');
  } catch (err) {
    mostrarToast('Error al actualizar Supervisión: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 Actualizar desde Excel';
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
  // La restricción de "solo Supervisión Manual editable" aplica al EDITAR una
  // acta ya existente (donde los demás datos ya vienen de Estadium/Snowflake).
  // Al crear una acta nueva no hay datos previos que proteger, así que ahí sí
  // se pueden diligenciar todos los campos.
  const esEdicion = !!id;
  form.innerHTML = CAMPOS_FORM.map(f => campoHtml(f, acta ? acta[f.campo] : '', esEdicion)).join('');

  conectarRetroalimentacionFactor(form);
  conectarAdvertenciaScore(form);
  conectarRecalculoR01(form);
  abrirModal('modalActa');
}

/**
 * Sugiere automáticamente el valor de "R01 Tensión" en cuanto se corrige
 * "V. Servicio" (el campo que se ha visto llegar con el valor equivocado por
 * un problema de sincronización — ver acta #109). No bloquea el campo: la
 * persona puede seguir cambiándolo a mano si no está de acuerdo, esto solo
 * evita que quede mostrando "FALLA" después de arreglar el número.
 */
function conectarRecalculoR01(form) {
  const campoVServicio = form.querySelector('[name="V. Servicio"]');
  const campoVAlta = form.querySelector('[name="V. Alta Trafo"]');
  const campoVBaja = form.querySelector('[name="V. Baja Trafo"]');
  const campoTipoMedida = form.querySelector('[name="Tipo Medida"]');
  const campoR01 = form.querySelector('[name="R01 Tensión"]');
  if (!campoVServicio || !campoR01) return;

  campoVServicio.addEventListener('input', () => {
    const tipo = (campoTipoMedida ? campoTipoMedida.value : '').toLowerCase();
    const vServ = parseFloat(campoVServicio.value);
    const vAlta = parseFloat(campoVAlta ? campoVAlta.value : '');
    const vBaja = parseFloat(campoVBaja ? campoVBaja.value : '');
    if (isNaN(vServ) || !tipo) return;

    let nuevoValor = null;
    if (tipo === 'indirecta' && !isNaN(vAlta)) {
      nuevoValor = (vServ === vAlta) ? 'OK' : 'FALLA';
    } else if ((tipo === 'directa' || tipo === 'semidirecta') && !isNaN(vBaja)) {
      nuevoValor = (vServ < 100 && Math.abs(vServ - vBaja / 1000) <= 0.05) ? 'OK' : 'FALLA';
    }
    if (nuevoValor) campoR01.value = nuevoValor;
  });
}

/**
 * Mientras se escribe en "Factor real (L)", muestra de inmediato si concuerda
 * con "Factor acta (K)" — usa exactamente la misma regla que ya aplica el
 * Dashboard y el backend (calcularConcordanciaFactor / applyFormulas):
 * escribir la palabra "OK" cuenta como que el auditor confirmó que coincide,
 * sin necesidad de guardar primero para saberlo.
 */
function conectarRetroalimentacionFactor(form) {
  const campoReal = form.querySelector('[name="Factor real (L)"]');
  const campoActa = form.querySelector('[name="Factor acta (K)"]');
  if (!campoReal) return;

  let feedback = form.querySelector('#factorFeedback');
  if (!feedback) {
    feedback = document.createElement('span');
    feedback.id = 'factorFeedback';
    feedback.className = 'factor-feedback';
    campoReal.closest('.form-field').appendChild(feedback);
  }

  const actualizar = () => {
    const realTexto = campoReal.value.trim().toLowerCase();
    const actaNum = parseFloat(campoActa ? campoActa.value : '');
    if (!realTexto) { feedback.textContent = ''; return; }
    if (realTexto === 'ok') {
      feedback.textContent = '✅ Confirmado manualmente como concordante';
      feedback.className = 'factor-feedback factor-ok';
      return;
    }
    const realNum = parseFloat(realTexto);
    if (isNaN(realNum) || isNaN(actaNum)) { feedback.textContent = ''; return; }
    if (realNum === actaNum) {
      feedback.textContent = '✅ Concuerda con Factor acta (K)';
      feedback.className = 'factor-feedback factor-ok';
    } else {
      feedback.textContent = `⚠️ No concuerda (diferencia de ${Math.abs(realNum - actaNum)})`;
      feedback.className = 'factor-feedback factor-mal';
    }
  };

  campoReal.addEventListener('input', actualizar);
  actualizar();
}

/**
 * Ajusta el Score AUTOMÁTICAMENTE (sin pedir confirmación) cuando:
 *  - Supervisión Manual y Supervisión IA no coinciden → -15 puntos
 *  - Factor real (L) no concuerda con Factor acta (K) → -15 puntos
 * Parte siempre del Score que ya traía el acta al abrir el modal (scoreBase),
 * y se recalcula en vivo cada vez que cambia Supervisión Manual o Factor real
 * — el campo Score queda "readonly" (no se edita a mano) precisamente porque
 * lo controla esta función, pero SÍ viaja al guardar.
 */
function conectarAdvertenciaScore(form) {
  const campoManual = form.querySelector('[name="Supervisión Manual (T)"]');
  const campoIA = form.querySelector('[name="Supervisión IA (U)"]');
  const campoFactorReal = form.querySelector('[name="Factor real (L)"]');
  const campoFactorActa = form.querySelector('[name="Factor acta (K)"]');
  const campoScore = form.querySelector('[name="Score"]');
  if (!campoScore || !campoManual) return;

  const scoreBase = parseFloat(campoScore.value);
  if (isNaN(scoreBase)) return; // sin score de referencia, no hay nada que ajustar

  const PENALIZACION_DESACUERDO = 15;
  const PENALIZACION_FACTOR = 15;

  let nota = campoScore.closest('.form-field').querySelector('.score-nota');
  if (!nota) {
    nota = document.createElement('span');
    nota.className = 'score-nota';
    campoScore.closest('.form-field').appendChild(nota);
  }

  const recalcular = () => {
    const manual = (campoManual.value || '').trim().toUpperCase();
    const ia = (campoIA ? campoIA.value : '').trim().toUpperCase();
    const hayDesacuerdo = manual && ia && manual !== 'PENDIENTE' && ia !== 'PENDIENTE' && manual !== ia;

    const realTexto = (campoFactorReal ? campoFactorReal.value : '').trim().toLowerCase();
    const actaNum = parseFloat(campoFactorActa ? campoFactorActa.value : '');
    let factorNoConcuerda = false;
    if (realTexto && realTexto !== 'ok') {
      const realNum = parseFloat(realTexto);
      if (!isNaN(realNum) && !isNaN(actaNum) && realNum !== actaNum) factorNoConcuerda = true;
    }

    let nuevoScore = scoreBase;
    const motivos = [];
    if (hayDesacuerdo) { nuevoScore -= PENALIZACION_DESACUERDO; motivos.push(`-${PENALIZACION_DESACUERDO} desacuerdo Manual/IA`); }
    if (factorNoConcuerda) { nuevoScore -= PENALIZACION_FACTOR; motivos.push(`-${PENALIZACION_FACTOR} Factor real≠acta`); }
    nuevoScore = Math.max(0, nuevoScore);

    campoScore.value = nuevoScore;
    nota.textContent = motivos.length ? `⚠️ Ajustado: ${motivos.join(', ')} (base ${scoreBase})` : `Score original: ${scoreBase}`;
    nota.className = 'score-nota' + (motivos.length ? ' score-penalizado' : '');
  };

  campoManual.addEventListener('change', recalcular);
  if (campoFactorReal) campoFactorReal.addEventListener('input', recalcular);
  recalcular();
}

function campoHtml(f, valor, esEdicion) {
  valor = valor === undefined || valor === null ? '' : valor;
  const spanClass = f.span2 ? ' span-2' : '';
  const esSoloLectura = f.soloLectura && esEdicion;
  // "soloAutomatico" es distinto de "soloLectura": usa readonly (no disabled),
  // así que SÍ viaja en el FormData al guardar — porque el valor lo pone el
  // propio sistema (ver conectarAdvertenciaScore), no queda vacío como pasaría
  // con un campo disabled.
  const esAutomatico = !!f.soloAutomatico;
  const soloLecturaAttr = esSoloLectura ? 'disabled' : (esAutomatico ? 'readonly' : '');
  const soloLecturaClass = (esSoloLectura || esAutomatico) ? ' campo-solo-lectura' : '';
  let control;
  if (f.tipo === 'select') {
    control = `<select name="${f.campo}" ${esSoloLectura ? 'disabled' : ''}>` +
      f.opciones.map(op => `<option value="${op}" ${op === valor ? 'selected' : ''}>${op}</option>`).join('') +
      `</select>`;
  } else if (f.tipo === 'textarea') {
    control = `<textarea name="${f.campo}" rows="3" ${soloLecturaAttr}>${escapeHtml(valor)}</textarea>`;
  } else {
    control = `<input type="${f.tipo}" name="${f.campo}" value="${escapeHtml(valor)}" ${f.placeholder ? `placeholder="${f.placeholder}"` : ''} ${soloLecturaAttr}>`;
  }
  const etiqueta = esSoloLectura ? `${f.campo} <span class="etiqueta-solo-lectura">🔒 solo lectura</span>`
    : esAutomatico ? `${f.campo} <span class="etiqueta-solo-lectura">🔄 se ajusta solo</span>`
    : f.campo;
  return `<div class="form-field${spanClass}${soloLecturaClass}"><label>${etiqueta}</label>${control}</div>`;
}

async function onGuardarActa(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  // Los campos "solo lectura" están deshabilitados, y un <input disabled> NO
  // se incluye en FormData — sin este resguardo, guardar el formulario
  // borraría esos campos en vez de dejarlos como estaban.
  const actaOriginal = (state.editandoId && state.actas.find(a => a['#'] === state.editandoId)) || {};
  const cambios = {};
  CAMPOS_FORM.forEach(f => {
    cambios[f.campo] = formData.has(f.campo) ? (formData.get(f.campo) || '') : (actaOriginal[f.campo] || '');
  });

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

// ============================================================================
// OTROS PROYECTOS — hasta 5 proyectos libres, cada uno con su propio Excel.
// Se guardan en localStorage (NO en Google Sheets, para no arriesgar los
// datos de CCE) y vencen solos a los días que el usuario les ponga (máx. 20).
// El Dashboard de cada proyecto se arma solo, según las columnas que traiga
// su Excel — no depende de ninguna estructura fija como sí la tiene CCE.
// ============================================================================
const MAX_PROYECTOS = 5;
const MAX_DIAS_VENCIMIENTO_PROYECTO = 20;
let proyectoActualId = null;

function obtenerProyectos() {
  let lista;
  try { lista = JSON.parse(localStorage.getItem('cce_otros_proyectos') || '[]'); }
  catch (e) { lista = []; }
  const hoy = new Date().toISOString().slice(0, 10);
  const vigentes = lista.filter(p => p.vencimiento >= hoy);
  if (vigentes.length !== lista.length) guardarProyectos(vigentes); // purga silenciosa de los vencidos
  return vigentes;
}
function guardarProyectos(lista) {
  localStorage.setItem('cce_otros_proyectos', JSON.stringify(lista));
}

function configurarVistaProyectos() {
  // Cada elemento se busca por separado y solo se conecta si existe — así, si
  // index.html llegó a quedar desactualizado y le falta alguno de estos (ya
  // ha pasado con subidas anteriores), esta función no truena por completo:
  // simplemente esa parte puntual de "Otros proyectos" no queda conectada,
  // pero el resto de la app (login, carga de datos) sigue funcionando normal.
  const on = (id, evento, handler) => { const el = document.getElementById(id); if (el) el.addEventListener(evento, handler); };
  on('btnNuevoProyecto', 'click', abrirModalNuevoProyecto);
  on('btnCancelarNuevoProyecto', 'click', () => cerrarModal('modalNuevoProyecto'));
  on('formNuevoProyecto', 'submit', onCrearProyecto);
  on('btnVolverProyectos', 'click', mostrarListaProyectos);
  on('btnEliminarProyecto', 'click', onEliminarProyectoActual);
  on('btnPresentarProyecto', 'click', abrirPresentacionProyecto);
  on('btnExportarProyecto', 'click', exportarProyectoActual);
  on('btnLimpiarProyecto', 'click', onLimpiarProyectoActual);
  on('inputReemplazarExcel', 'change', onReemplazarExcelProyecto);
  const navProyectos = document.querySelector('[data-view="proyectos"]');
  if (navProyectos) navProyectos.addEventListener('click', mostrarListaProyectos);
  configurarAsistenteProyectos();
}

function mostrarListaProyectos() {
  proyectoActualId = null;
  document.getElementById('proyectosListaWrap').style.display = '';
  document.getElementById('proyectoDetalleWrap').style.display = 'none';
  document.getElementById('btnAsistenteProyectos').style.display = 'none';
  document.getElementById('panelAsistenteProyectos').classList.remove('is-active');
  document.getElementById('asistenteProyectosOverlay').classList.remove('is-active');
  renderListaProyectos();
}

function renderListaProyectos() {
  const lista = obtenerProyectos();
  const grid = document.getElementById('proyectosGrid');
  document.getElementById('btnNuevoProyecto').disabled = lista.length >= MAX_PROYECTOS;
  document.getElementById('proyectosSubtitle').textContent =
    `${lista.length} de ${MAX_PROYECTOS} proyectos — cada uno con su propio Excel y Dashboard. Se guardan solo en este navegador y vencen solos.`;

  if (!lista.length) {
    grid.innerHTML = '<p class="panel-note">Todavía no hay proyectos. Crea el primero con "+ Nuevo proyecto".</p>';
    return;
  }

  grid.innerHTML = lista.map(p => {
    const diasRestantes = Math.max(0, Math.ceil((new Date(p.vencimiento) - new Date()) / 86400000));
    return `<div class="proyecto-card">
      <h4>${escapeHtml(p.nombre)}</h4>
      <p class="panel-note" style="margin:0;">${p.filas.length} filas · ${p.headers.length} columnas</p>
      <p class="proyecto-vencimiento ${diasRestantes <= 3 ? 'proyecto-vencimiento-urgente' : ''}">⏳ vence en ${diasRestantes} día(s) (${p.vencimiento})</p>
      <button type="button" class="btn btn-primary btn-icon" data-abrir="${p.id}">Abrir</button>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-abrir]').forEach(btn => {
    btn.addEventListener('click', () => abrirProyecto(btn.dataset.abrir));
  });
}

function abrirModalNuevoProyecto() {
  if (obtenerProyectos().length >= MAX_PROYECTOS) {
    mostrarToast('Ya tienes 5 proyectos — elimina uno para crear otro.', 'error');
    return;
  }
  document.getElementById('formNuevoProyecto').reset();
  const hoy = new Date();
  const max = new Date(hoy.getTime() + MAX_DIAS_VENCIMIENTO_PROYECTO * 86400000);
  const inputFecha = document.getElementById('nuevoProyectoVencimiento');
  inputFecha.min = hoy.toISOString().slice(0, 10);
  inputFecha.max = max.toISOString().slice(0, 10);
  inputFecha.value = max.toISOString().slice(0, 10);
  abrirModal('modalNuevoProyecto');
}

async function onCrearProyecto(e) {
  e.preventDefault();
  const nombre = document.getElementById('nuevoProyectoNombre').value.trim();
  const vencimiento = document.getElementById('nuevoProyectoVencimiento').value;
  const archivo = document.getElementById('nuevoProyectoExcel').files[0];
  if (!nombre || !vencimiento || !archivo) return;

  const hoy = new Date().toISOString().slice(0, 10);
  const max = new Date(); max.setDate(max.getDate() + MAX_DIAS_VENCIMIENTO_PROYECTO);
  if (vencimiento > max.toISOString().slice(0, 10)) {
    mostrarToast(`La fecha máxima es ${max.toISOString().slice(0, 10)} (20 días).`, 'error'); return;
  }
  if (vencimiento < hoy) { mostrarToast('La fecha de vencimiento no puede ser en el pasado.', 'error'); return; }

  try {
    const data = await archivo.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const nombreHoja = workbook.SheetNames[0];
    const filasCrudas = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, raw: true, defval: '' });
    if (!filasCrudas.length) { mostrarToast('El Excel está vacío.', 'error'); return; }

    const headers = filasCrudas[0].map(h => String(h || '').trim()).filter(h => h);
    const filas = filasCrudas.slice(1)
      .filter(fila => fila.some(v => v !== '' && v !== null && v !== undefined))
      .map(fila => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = fila[i] !== undefined ? fila[i] : ''; });
        return obj;
      });
    if (!filas.length) { mostrarToast('El Excel no tiene filas de datos (solo encabezados).', 'error'); return; }

    const tipos = detectarTiposColumnas(headers, filas);
    const lista = obtenerProyectos();
    const nuevo = { id: 'proy_' + Date.now(), nombre, vencimiento, creado: hoy, headers, filas, tipos };
    lista.push(nuevo);
    guardarProyectos(lista);

    cerrarModal('modalNuevoProyecto');
    mostrarToast(`Proyecto "${nombre}" creado — ${filas.length} filas.`, 'success');
    abrirProyecto(nuevo.id);
  } catch (err) {
    mostrarToast('No se pudo leer el Excel: ' + err.message, 'error');
  }
}

/**
 * Para cada columna decide si es "numerica" (sirve para sumar/promediar),
 * "categorica" (pocos valores distintos — se puede graficar por conteo), o
 * "texto" (muchos valores distintos — solo se muestra en la tabla).
 */
function detectarTiposColumnas(headers, filas) {
  const tipos = {};
  headers.forEach(h => {
    const valores = filas.map(f => f[h]).filter(v => v !== '' && v !== null && v !== undefined);
    const numericos = valores.filter(v => typeof v === 'number' || (v !== '' && !isNaN(parseFloat(v)) && isFinite(v)));
    const distintos = new Set(valores.map(v => String(v))).size;
    if (valores.length && numericos.length / valores.length > 0.8) tipos[h] = 'numerica';
    else if (distintos > 0 && distintos <= 20 && distintos < valores.length * 0.7) tipos[h] = 'categorica';
    else tipos[h] = 'texto';
  });
  return tipos;
}

function onEliminarProyectoActual() {
  if (!proyectoActualId) return;
  if (!confirm('¿Eliminar este proyecto? No se puede deshacer.')) return;
  guardarProyectos(obtenerProyectos().filter(p => p.id !== proyectoActualId));
  mostrarToast('Proyecto eliminado.', 'success');
  mostrarListaProyectos();
}

/** Descarga los datos actuales del proyecto como un archivo Excel (.xlsx). */
function exportarProyectoActual() {
  const proyecto = obtenerProyectos().find(p => p.id === proyectoActualId);
  if (!proyecto || !proyecto.filas.length) { mostrarToast('Este proyecto no tiene datos para exportar.', 'error'); return; }
  const hoja = XLSX.utils.json_to_sheet(proyecto.filas, { header: proyecto.headers });
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, proyecto.nombre.slice(0, 31) || 'Datos');
  const nombreArchivo = proyecto.nombre.replace(/[^a-zA-Z0-9_ -]/g, '').trim().replace(/\s+/g, '_') || 'proyecto';
  XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
  mostrarToast('Excel descargado.', 'success');
}

/**
 * "🧹 Limpiar proyecto" — NO borra el proyecto (para eso está "🗑 Eliminar"),
 * solo vacía sus datos y muestra el selector de archivo para subir un Excel
 * nuevo al mismo proyecto (mismo nombre, misma fecha de vencimiento).
 */
function onLimpiarProyectoActual() {
  if (!proyectoActualId) return;
  if (!confirm('¿Vaciar los datos de este proyecto? El proyecto se conserva (nombre y vencimiento), pero tendrás que subir un Excel nuevo.')) return;
  const lista = obtenerProyectos();
  const proyecto = lista.find(p => p.id === proyectoActualId);
  if (!proyecto) return;
  proyecto.headers = []; proyecto.filas = []; proyecto.tipos = {};
  guardarProyectos(lista);
  mostrarToast('Datos vaciados — sube el Excel nuevo abajo.', 'success');
  document.getElementById('proyectoKpis').innerHTML = '';
  document.getElementById('proyectoGraficas').innerHTML = '<p class="panel-note">Sin datos todavía — sube un Excel nuevo abajo.</p>';
  document.querySelector('#tablaProyecto thead').innerHTML = '';
  document.querySelector('#tablaProyecto tbody').innerHTML = '';
  document.getElementById('proyectoTablaTitulo').textContent = 'Datos';
  document.getElementById('proyectoReemplazarWrap').style.display = '';
}

/** Sube un Excel nuevo DENTRO del proyecto ya existente (sin crear otro). */
async function onReemplazarExcelProyecto(e) {
  const archivo = e.target.files[0];
  if (!archivo || !proyectoActualId) return;
  try {
    const data = await archivo.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const nombreHoja = workbook.SheetNames[0];
    const filasCrudas = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, raw: true, defval: '' });
    if (!filasCrudas.length) { mostrarToast('El Excel está vacío.', 'error'); return; }

    const headers = filasCrudas[0].map(h => String(h || '').trim()).filter(h => h);
    const filas = filasCrudas.slice(1)
      .filter(fila => fila.some(v => v !== '' && v !== null && v !== undefined))
      .map(fila => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = fila[i] !== undefined ? fila[i] : ''; });
        return obj;
      });
    if (!filas.length) { mostrarToast('El Excel no tiene filas de datos (solo encabezados).', 'error'); return; }

    const lista = obtenerProyectos();
    const proyecto = lista.find(p => p.id === proyectoActualId);
    if (!proyecto) return;
    proyecto.headers = headers;
    proyecto.filas = filas;
    proyecto.tipos = detectarTiposColumnas(headers, filas);
    guardarProyectos(lista);

    document.getElementById('proyectoReemplazarWrap').style.display = 'none';
    e.target.value = '';
    mostrarToast(`Datos actualizados — ${filas.length} filas.`, 'success');
    abrirProyecto(proyectoActualId);
  } catch (err) {
    mostrarToast('No se pudo leer el Excel: ' + err.message, 'error');
  }
}

function abrirProyecto(id) {
  const proyecto = obtenerProyectos().find(p => p.id === id);
  if (!proyecto) {
    mostrarToast('Ese proyecto ya no existe (puede que haya vencido).', 'error');
    mostrarListaProyectos();
    return;
  }
  proyectoActualId = id;
  document.getElementById('proyectosListaWrap').style.display = 'none';
  document.getElementById('proyectoDetalleWrap').style.display = '';
  document.getElementById('btnAsistenteProyectos').style.display = '';
  document.getElementById('proyectoDetalleTitulo').textContent = proyecto.nombre;
  document.getElementById('proyectoReemplazarWrap').style.display = proyecto.filas.length ? 'none' : '';
  const diasRestantes = Math.max(0, Math.ceil((new Date(proyecto.vencimiento) - new Date()) / 86400000));
  document.getElementById('proyectoDetalleSubtitle').textContent =
    `${proyecto.filas.length} filas · ${proyecto.headers.length} columnas · vence en ${diasRestantes} día(s) (${proyecto.vencimiento})`;
  renderDashboardGenerico(proyecto);
}

function renderDashboardGenerico(proyecto) {
  const { headers, filas, tipos } = proyecto;

  // --- KPIs: total de filas + hasta 3 columnas numéricas (suma y promedio) ---
  const numericas = headers.filter(h => tipos[h] === 'numerica').slice(0, 3);
  const kpis = [{ etiqueta: 'Total de filas', valor: String(filas.length), icono: '📊' }];
  numericas.forEach(h => {
    const valores = filas.map(f => parseFloat(f[h])).filter(v => !isNaN(v));
    const suma = valores.reduce((s, v) => s + v, 0);
    kpis.push({ etiqueta: `Suma de ${h}`, valor: formatearNumeroProyecto(suma), icono: '➕' });
    kpis.push({ etiqueta: `Promedio de ${h}`, valor: formatearNumeroProyecto(suma / (valores.length || 1)), icono: '📈' });
  });
  document.getElementById('proyectoKpis').innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-icon">${k.icono}</div>
      <div class="kpi-texto"><span class="kpi-label">${escapeHtml(k.etiqueta)}</span><span class="kpi-value">${escapeHtml(k.valor)}</span></div>
    </div>`).join('');

  // --- Gráficas: una por cada columna categórica encontrada (hasta 4) ---
  const categoricas = headers.filter(h => tipos[h] === 'categorica').slice(0, 4);
  const graficasWrap = document.getElementById('proyectoGraficas');
  if (!categoricas.length) {
    graficasWrap.innerHTML = '<p class="panel-note">No encontré columnas con pocas categorías distintas para graficar automáticamente — revisa la tabla completa abajo.</p>';
  } else {
    graficasWrap.innerHTML = categoricas.map((h, i) => `
      <div class="panel">
        <div class="panel-header-row">
          <h3>${escapeHtml(h)}</h3>
          <select class="select-compact selector-vista-proyecto" data-target="proyChart${i}" data-idx="${i}">
            <option value="barras">Barras</option>
            <option value="dona">Dona</option>
            <option value="apilada">Barra apilada</option>
          </select>
        </div>
        <div id="proyChart${i}" class="chart-svg-wrap"></div>
      </div>`).join('');

    categoricas.forEach((h, i) => {
      const conteo = {};
      filas.forEach(f => { const v = String(f[h] === '' || f[h] == null ? '(vacío)' : f[h]).trim() || '(vacío)'; conteo[v] = (conteo[v] || 0) + 1; });
      const datos = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([etiqueta, valor]) => ({ etiqueta, valor }));
      const targetId = `proyChart${i}`;
      renderPanelFlexible(targetId, datos, 'barras');
      // Los selectores de estas gráficas se crean después de cargar la página
      // (dinámicos), así que se conectan aquí mismo — configurarSelectoresVista()
      // solo alcanza a los que ya existían al iniciar la app.
      const sel = document.querySelector(`.selector-vista-proyecto[data-target="${targetId}"]`);
      if (sel) {
        sel.value = obtenerVistaGuardada(targetId, 'barras');
        sel.addEventListener('change', () => {
          localStorage.setItem('cce_vista_' + targetId, sel.value);
          renderPanelFlexible(targetId, datos, 'barras');
        });
      }
    });
  }

  // --- Tabla completa (hasta 300 filas, ordenable por columna) ---
  document.getElementById('proyectoTablaTitulo').textContent = `Datos (${filas.length} filas)`;
  const thead = document.querySelector('#tablaProyecto thead');
  const tbody = document.querySelector('#tablaProyecto tbody');
  thead.innerHTML = '<tr>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr>';
  tbody.innerHTML = filas.slice(0, 300).map(f => '<tr>' + headers.map(h => `<td>${escapeHtml(String(f[h] ?? ''))}</td>`).join('') + '</tr>').join('');
  hacerTablaOrdenable('tablaProyectoWrap');
}

function formatearNumeroProyecto(n) {
  if (!isFinite(n)) return '0';
  return Number(n.toFixed(2)).toLocaleString('es-CO');
}

// --- Asistente naranja: ayuda a navegar el proyecto abierto -------------------
function configurarAsistenteProyectos() {
  const btn = document.getElementById('btnAsistenteProyectos');
  const panel = document.getElementById('panelAsistenteProyectos');
  const overlay = document.getElementById('asistenteProyectosOverlay');
  if (!btn || !panel || !overlay) return; // index.html desactualizado — no truena, solo no queda disponible
  btn.addEventListener('click', () => {
    panel.classList.add('is-active'); overlay.classList.add('is-active');
    renderAsistenteProyectosInicio();
  });
  const cerrar = () => { panel.classList.remove('is-active'); overlay.classList.remove('is-active'); };
  const btnCerrar = document.getElementById('btnCerrarAsistenteProyectos');
  if (btnCerrar) btnCerrar.addEventListener('click', cerrar);
  overlay.addEventListener('click', cerrar);
  const form = document.getElementById('formPreguntaAsistenteProyectos');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('inputPreguntaAsistenteProyectos');
    const texto = input.value.trim();
    if (texto) { responderPreguntaProyecto(texto); input.value = ''; }
  });
}

function renderAsistenteProyectosInicio() {
  const proyecto = obtenerProyectos().find(p => p.id === proyectoActualId);
  const cont = document.getElementById('asistenteProyectosContenido');
  if (!proyecto) { cont.innerHTML = '<p class="panel-note">Abre un proyecto primero.</p>'; return; }
  const numericas = proyecto.headers.filter(h => proyecto.tipos[h] === 'numerica');
  const chipsCategoricas = proyecto.headers.filter(h => proyecto.tipos[h] === 'categorica').slice(0, 3)
    .map(h => `<button type="button" class="btn-opcion-grafica btn-sugerencia-guiada-proy" data-consulta="top de ${escapeHtml(h)}">Top de ${escapeHtml(h)}</button>`).join('');
  const chipsNumericas = numericas.slice(0, 2)
    .map(h => `<button type="button" class="btn-opcion-grafica btn-sugerencia-guiada-proy" data-consulta="promedio de ${escapeHtml(h)}">Promedio de ${escapeHtml(h)}</button>`).join('');

  // Sugerencias de fórmulas/cálculos — solo si hay columnas numéricas con qué
  // armarlas. Con 2 o más, se pueden combinar entre sí (diferencia, suma,
  // porcentaje); con 1 sola, se sugiere algo simple como aplicarle un IVA.
  let chipsFormulas = '';
  if (numericas.length >= 2) {
    const [a, b] = numericas;
    chipsFormulas = `
      <p class="panel-note" style="margin-top:10px;">➕ También puedo calcular columnas nuevas, por ejemplo:</p>
      <div class="preferencia-opciones">
        <button type="button" class="btn-opcion-grafica btn-sugerencia-guiada-proy" data-consulta="Diferencia = ${a} - ${b}">Diferencia = ${escapeHtml(a)} − ${escapeHtml(b)}</button>
        <button type="button" class="btn-opcion-grafica btn-sugerencia-guiada-proy" data-consulta="Total = ${a} + ${b}">Total = ${escapeHtml(a)} + ${escapeHtml(b)}</button>
        <button type="button" class="btn-opcion-grafica btn-sugerencia-guiada-proy" data-consulta="Porcentaje = (${a} / ${b}) * 100">% de ${escapeHtml(a)} sobre ${escapeHtml(b)}</button>
      </div>`;
  } else if (numericas.length === 1) {
    chipsFormulas = `
      <p class="panel-note" style="margin-top:10px;">➕ También puedo calcular, por ejemplo:</p>
      <div class="preferencia-opciones">
        <button type="button" class="btn-opcion-grafica btn-sugerencia-guiada-proy" data-consulta="${numericas[0]} con IVA = ${numericas[0]} * 1.19">${escapeHtml(numericas[0])} con IVA (+19%)</button>
      </div>`;
  }

  cont.innerHTML = `
    <p class="asistente-resumen-frase">Este proyecto tiene <b>${proyecto.filas.length} filas</b> y <b>${proyecto.headers.length} columnas</b>: ${proyecto.headers.map(h => escapeHtml(h)).join(', ')}.</p>
    <p class="panel-note">Prueba con alguna de estas, o escribe tu propia pregunta o fórmula abajo (ej. "Ganancia = Monto - Costo"):</p>
    <div class="preferencia-opciones">${chipsCategoricas}${chipsNumericas}</div>
    ${chipsFormulas}
    <div id="respuestaAsistenteProyectos"></div>
  `;
  cont.querySelectorAll('.btn-sugerencia-guiada-proy').forEach(b => {
    b.addEventListener('click', () => responderPreguntaProyecto(b.dataset.consulta));
  });
}

/**
 * Evalúa una fórmula aritmética simple para UNA fila — solo permite números,
 * + - * / ( ) y nombres de columna (que se reemplazan por su valor numérico
 * antes de evaluar). Si después de sustituir las columnas queda cualquier
 * otra cosa (letras, punto y coma, etc.), se rechaza — así nunca se ejecuta
 * nada que no sea una cuenta aritmética.
 */
function evaluarFormulaFila(expresionOriginal, headers, fila) {
  let expr = expresionOriginal;
  const headersOrdenados = [...headers].sort((a, b) => b.length - a.length); // los más largos primero
  headersOrdenados.forEach(h => {
    if (expr.includes(h)) {
      const valor = parseFloat(fila[h]);
      expr = expr.split(h).join(isNaN(valor) ? '0' : String(valor));
    }
  });
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;
  try {
    const resultado = Function('"use strict"; return (' + expr + ');')();
    return isFinite(resultado) ? resultado : null;
  } catch (e) {
    return null;
  }
}

/**
 * Detecta el patrón "NombreNuevo = expresión" (ej. "Ganancia = Monto - Costo")
 * y, si de verdad menciona alguna columna existente, agrega esa columna
 * calculada a TODAS las filas del proyecto y la guarda — queda disponible en
 * la tabla, en los KPIs y en las gráficas, igual que si hubiera venido en el
 * Excel original.
 */
function intentarCrearColumnaCalculada(proyecto, texto) {
  const match = texto.match(/^([^=]{1,40})=(.+)$/);
  if (!match) return null;
  const nombreNueva = match[1].trim();
  const expresion = match[2].trim();
  if (!nombreNueva || !expresion) return null;
  const mencionaColumna = proyecto.headers.some(h => expresion.includes(h));
  if (!mencionaColumna) return null; // seguramente el "=" era parte de otra pregunta, no una fórmula

  let exitos = 0;
  proyecto.filas.forEach(f => {
    const r = evaluarFormulaFila(expresion, proyecto.headers, f);
    f[nombreNueva] = r === null ? '' : Math.round(r * 100) / 100;
    if (r !== null) exitos++;
  });
  if (exitos === 0) return { error: true };

  if (!proyecto.headers.includes(nombreNueva)) proyecto.headers.push(nombreNueva);
  proyecto.tipos[nombreNueva] = 'numerica';
  const lista = obtenerProyectos();
  const idx = lista.findIndex(p => p.id === proyecto.id);
  lista[idx] = proyecto;
  guardarProyectos(lista);
  return { nombreNueva, expresion, exitos };
}

function mostrarRespuestaAsistenteProyectos(html) {
  let destino = document.getElementById('respuestaAsistenteProyectos');
  if (!destino) {
    destino = document.createElement('div');
    destino.id = 'respuestaAsistenteProyectos';
    document.getElementById('asistenteProyectosContenido').appendChild(destino);
  }
  destino.innerHTML = html;
}

function responderPreguntaProyecto(texto) {
  const proyecto = obtenerProyectos().find(p => p.id === proyectoActualId);
  if (!proyecto) return;

  // ¿Es una fórmula para crear una columna nueva? Se revisa antes que
  // cualquier otra cosa porque el "=" es una señal bastante inequívoca.
  if (texto.includes('=')) {
    const resultado = intentarCrearColumnaCalculada(proyecto, texto);
    if (resultado && resultado.error) {
      mostrarRespuestaAsistenteProyectos('<p class="panel-note">Entendí que querías crear una fórmula, pero no pude calcularla en ninguna fila — revisa que el nombre de columna esté escrito exactamente igual que en la tabla.</p>');
      return;
    }
    if (resultado) {
      mostrarToast(`Columna "${resultado.nombreNueva}" agregada.`, 'success');
      abrirProyecto(proyecto.id); // re-renderiza Dashboard/tabla con la columna nueva
      renderAsistenteProyectosInicio();
      mostrarRespuestaAsistenteProyectos(`<p class="asistente-resumen-frase">✅ Agregué la columna calculada "<b>${escapeHtml(resultado.nombreNueva)}</b>" = ${escapeHtml(resultado.expresion)} (calculada en ${resultado.exitos} de ${proyecto.filas.length} filas). Ya la puedes ver en la tabla, los KPIs y las gráficas.</p>`);
      return;
    }
    // si no calzó como fórmula válida, sigue de largo por si el "=" era parte de otra pregunta
  }

  const q = texto.toLowerCase();
  const headers = proyecto.headers;
  const columna = headers.find(h => q.includes(h.toLowerCase()));

  let html;
  if (q.includes('cuánt') || q.includes('cuant') || (q.includes('total') && !columna)) {
    html = `<p class="asistente-resumen-frase">Este proyecto tiene <b>${proyecto.filas.length}</b> filas en total.</p>`;
  } else if (columna && (q.includes('top') || q.includes('mas comun') || q.includes('más común') || q.includes('distribucion') || q.includes('distribución'))) {
    const conteo = {};
    proyecto.filas.forEach(f => { const v = String(f[columna] === '' || f[columna] == null ? '(vacío)' : f[columna]).trim() || '(vacío)'; conteo[v] = (conteo[v] || 0) + 1; });
    const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 5);
    html = `<p class="asistente-resumen-frase">Top de "<b>${escapeHtml(columna)}</b>":</p><ul>` + top.map(([k, v]) => `<li>${escapeHtml(k)}: <b>${v}</b></li>`).join('') + '</ul>';
  } else if (columna && (q.includes('promedio') || q.includes('media'))) {
    const valores = proyecto.filas.map(f => parseFloat(f[columna])).filter(v => !isNaN(v));
    const prom = valores.reduce((s, v) => s + v, 0) / (valores.length || 1);
    html = `<p class="asistente-resumen-frase">El promedio de "<b>${escapeHtml(columna)}</b>" es <b>${formatearNumeroProyecto(prom)}</b> (sobre ${valores.length} valores numéricos).</p>`;
  } else if (columna && (q.includes('suma') || q.includes('total de'))) {
    const valores = proyecto.filas.map(f => parseFloat(f[columna])).filter(v => !isNaN(v));
    const suma = valores.reduce((s, v) => s + v, 0);
    html = `<p class="asistente-resumen-frase">La suma de "<b>${escapeHtml(columna)}</b>" es <b>${formatearNumeroProyecto(suma)}</b>.</p>`;
  } else if (columna && (q.includes('max') || q.includes('máx'))) {
    const valores = proyecto.filas.map(f => parseFloat(f[columna])).filter(v => !isNaN(v));
    html = `<p class="asistente-resumen-frase">El máximo de "<b>${escapeHtml(columna)}</b>" es <b>${formatearNumeroProyecto(Math.max(...valores))}</b>.</p>`;
  } else if (columna && (q.includes('min') || q.includes('mín'))) {
    const valores = proyecto.filas.map(f => parseFloat(f[columna])).filter(v => !isNaN(v));
    html = `<p class="asistente-resumen-frase">El mínimo de "<b>${escapeHtml(columna)}</b>" es <b>${formatearNumeroProyecto(Math.min(...valores))}</b>.</p>`;
  } else {
    html = `<p class="panel-note">Todavía no entiendo esa pregunta específica — puedo ayudarte con "top de [columna]", "promedio/suma/máximo/mínimo de [columna]", "cuántas filas hay", o crear una columna calculada escribiendo algo como "Ganancia = Monto - Costo". Las columnas disponibles son: ${headers.map(h => escapeHtml(h)).join(', ')}.</p>`;
  }
  mostrarRespuestaAsistenteProyectos(html);
}
