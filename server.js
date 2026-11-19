const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Google Sheet ID en vivo
const SHEET_ID = '1lEY_Dltt9pCsTfbXLQcjLlzIS5vBWyU-TzdV4YuF-YY';

// GIDs de las pestañas
const GIDS = {
  CALENDARIO: '107866153',
  EXPERIMENTOS: '1146342330',
  HORARIOS_REGLAS: '1489175614',
  CHEFS: '1911090356',
  CANINO: '1981376541',
  TEMAS_CHEF: '2041696224',
  PLANTILLAS: '93174668',
  TEMPORADAS: '1174868251'
};

function fetchWithRedirect(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Demasiados redireccionamientos'));
    const client = url.startsWith('https:') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchWithRedirect(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      let chunks = '';
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => resolve(chunks));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentCell.trim());
      currentCell = '';
      if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
      currentRow = [];
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
  }

  return rows;
}

// Descarga en vivo de cualquier pestaña vía Google Visualization CSV export
async function fetchSheetData(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const rawCsv = await fetchWithRedirect(url);
  return parseCSV(rawCsv);
}

function parseDateToISO(dateStr, defaultHour = "08:30") {
  if (!dateStr) return new Date().toISOString().slice(0, 16);
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2].trim();
    return `${year}-${month}-${day}T${defaultHour}`;
  }
  return new Date().toISOString().slice(0, 16);
}

function slugify(name) {
  return (name || 'desconocido')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function mapRendimientoToStatus(rend) {
  const r = (rend || '').toLowerCase();
  if (r.includes('exploto') || r.includes('explotó')) return 'exploto';
  if (r.includes('muy bien') || r.includes('muybien')) return 'muybien';
  if (r.includes('decente') || r.includes('bien')) return 'bien';
  if (r.includes('regular')) return 'tibia';
  if (r.includes('muerta') || r.includes('desechado') || r.includes('fracaso')) return 'muerta';
  if (r.includes('programa')) return 'programada';
  return 'tibia';
}

// ══════════════ 1. PROCESAR EXPERIMENTOS EDITORIALES (COMPLETO) ══════════════
function processExperimentsSheet(rows) {
  const experiments = [];
  // Row 0 y 1 tienen KPIs, row 2 encabezados, row 3 en adelante las notas
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const fecha = (r[1] || '').trim();
    const entidad = (r[2] || '').trim();
    const titular = (r[3] || '').trim();
    const tipoExp = (r[4] || '').trim();
    const seccion = (r[5] || '').trim();
    const url = (r[6] || '').trim();
    const marfeel = (r[7] || '').trim();
    let rendimiento = (r[8] || '').trim();
    const hallazgos = (r[9] || '').trim();

    if (!titular && !entidad) continue;

    if (!rendimiento && (marfeel === 'PROGRAMADO' || hallazgos === 'PROGRAMADO')) {
      rendimiento = 'PROGRAMADO';
    }

    const estado = mapRendimientoToStatus(rendimiento);
    const isCanino = seccion.toLowerCase().includes('mascota') ||
                     seccion.toLowerCase().includes('canin') ||
                     seccion.toLowerCase().includes('felin') ||
                     titular.toLowerCase().includes('perro') ||
                     titular.toLowerCase().includes('gato') ||
                     entidad.toLowerCase().includes('millán') ||
                     entidad.toLowerCase().includes('capponi') ||
                     entidad.toLowerCase().includes('manzano') ||
                     entidad.toLowerCase().includes('puchol') ||
                     entidad.toLowerCase().includes('vidal') ||
                     entidad.toLowerCase().includes('corchado');

    // Estimaciones visuales para gráficos/tableros si no hay API de Marfeel conectada
    let impresiones = null;
    let clics = null;
    if (estado === 'exploto') { impresiones = 385000; clics = 34000; }
    else if (estado === 'muybien') { impresiones = 195000; clics = 16200; }
    else if (estado === 'bien') { impresiones = 88000; clics = 6500; }
    else if (estado === 'tibia') { impresiones = 38000; clics = 2400; }
    else if (estado === 'muerta') { impresiones = 4900; clics = 110; }
    else if (estado === 'programada') { impresiones = null; clics = null; }

    experiments.push({
      id: `EXP-${String(experiments.length + 1).padStart(3, '0')}`,
      fecha: parseDateToISO(fecha, "08:30"),
      fechaOriginal: fecha,
      experto: slugify(entidad),
      expertoNombre: entidad,
      vertical: isCanino ? 'canino' : 'cocina',
      estado: estado,
      rendimientoOriginal: rendimiento || (estado === 'programada' ? 'PROGRAMADO' : 'En evaluación'),
      titular: titular,
      tipoExperimento: tipoExp || (isCanino ? 'Mundo Canino' : 'Gastronomía'),
      fuente: tipoExp || (isCanino ? 'Mundo Canino' : 'Gastronomía'),
      seccion: seccion,
      url: url.startsWith('http') ? url : '',
      marfeel: marfeel.startsWith('http') ? marfeel : '',
      impresiones: impresiones,
      clics: clics,
      hipotesis: hallazgos || (estado === 'programada' ? 'Nota programada para publicación.' : 'En seguimiento de rendimiento en Discover.')
    });
  }

  return experiments;
}

// ══════════════ 2. PROCESAR DIRECTORIO DE CHEFS (CON FILTRO ESTRICTO) ══════════════
function processChefsSheet(rows) {
  const chefs = [];
  // Row 3: encabezados. Row 4 en adelante: datos
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[1] || '').trim();
    if (!name) continue;

    const canal = (r[2] || '').trim();
    const url = (r[3] || '').trim();
    const audiencia = (r[4] || '').trim();
    const ganchos = (r[5] || '').trim();
    const estado = (r[6] || '').trim();
    const potencial = (r[7] || '').trim();
    const notasPub = (r[8] || '').trim();
    const dias = (r[9] || '').trim();

    // REGLA DEL USUARIO: "cuando no hay ningun estado no se debe colocar o tener en cuenta"
    if (!estado || estado === '' || estado === '—' || estado === '-') {
      continue;
    }

    let veredicto = 'observacion';
    const estU = estado.toUpperCase();
    if (estU.includes('TOP') || estU.includes('ACTIVO') || estU.includes('PROBADO')) {
      veredicto = 'aprobado';
    } else if (estU.includes('DESECH') || estU.includes('NO DESPEG') || estU.includes('DESCART')) {
      veredicto = 'descartado';
    } else {
      veredicto = 'observacion';
    }

    chefs.push({
      id: slugify(name),
      nombre: name,
      rol: canal || 'Chef / Creador Gastronómico',
      vertical: 'cocina',
      veredicto: veredicto,
      estadoDiscover: estado,
      potencialDiscover: potencial || 'Medio',
      audiencia: audiencia,
      notasPublicadas: notasPub ? parseInt(notasPub, 10) : 0,
      motivo: ganchos ? ganchos.slice(0, 140) : `Potencial Discover: ${potencial}`,
      fuente: canal || 'YouTube / Instagram',
      canalUrl: url,
      mejorDia: dias || 'Sábado',
      mejorHora: '07:30–09:30',
      lectura: ganchos || `Estado en Discover: ${estado}`
    });
  }

  return chefs;
}

// ══════════════ 3. PROCESAR DIRECTORIO CANINO ══════════════
function processCaninoSheet(rows) {
  const caninos = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[1] || '').trim();
    if (!name) continue;

    const rol = (r[2] || '').trim();
    const pais = (r[3] || '').trim();
    const inst = (r[4] || '').trim();
    const acreditaciones = (r[5] || '').trim();
    const obra = (r[6] || '').trim();
    const impacto = (r[7] || '').trim();
    const autoridad = (r[8] || '').trim();
    const precauciones = (r[9] || '').trim();
    const url = (r[10] || '').trim();
    const criterio = (r[11] || '').trim();
    const estado = (r[12] || '').trim();
    const potencial = (r[13] || '').trim();

    // Filtro estricto: solo si tiene estado en Discover
    if (!estado || estado === '' || estado === '—' || estado === '-') {
      continue;
    }

    let veredicto = 'observacion';
    const estU = estado.toUpperCase();
    if (estU.includes('TOP') || estU.includes('ACTIVO') || estU.includes('PROBADO')) {
      veredicto = 'aprobado';
    } else if (estU.includes('DESECH') || estU.includes('NO DESPEG') || estU.includes('DESCART')) {
      veredicto = 'descartado';
    } else {
      veredicto = 'observacion';
    }

    caninos.push({
      id: slugify(name),
      nombre: name,
      rol: rol || 'Especialista Canino / Veterinario',
      vertical: 'canino',
      pais: pais,
      veredicto: veredicto,
      estadoDiscover: estado,
      potencialDiscover: potencial || 'Alto',
      motivo: (autoridad || precauciones || criterio || '').slice(0, 140),
      fuente: inst || 'Clínica / Academia',
      canalUrl: url,
      mejorDia: 'Jueves / Sábado',
      mejorHora: '18:00–21:00',
      lectura: precauciones || autoridad || `Estado en Discover: ${estado}`
    });
  }

  return caninos;
}

// ══════════════ 4. PROCESAR CALENDARIO (ESTRICTAMENTE MÁXIMO 2 PAUTAS POR DÍA) ══════════════
function processCalendarSheet(rows) {
  const rawPautas = [];
  // Row 3: encabezados. Row 4 en adelante: pautas
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const diaRaw = (r[1] || '').trim();
    if (!diaRaw) continue;

    const franja = (r[2] || '').trim();
    const seccion = (r[3] || '').trim();
    const formato = (r[4] || '').trim();
    const referente = (r[5] || '').trim();
    const titular = (r[6] || '').trim();
    const regla = (r[7] || '').trim();
    const estado = (r[8] || '').trim();
    const urlPub = (r[9] || '').trim();

    if (!titular && !referente) continue;

    const diaNorm = diaRaw.charAt(0).toUpperCase() + diaRaw.slice(1).toLowerCase();
    const isCanino = seccion.toLowerCase().includes('mascota') ||
                     seccion.toLowerCase().includes('canin') ||
                     seccion.toLowerCase().includes('felin') ||
                     titular.toLowerCase().includes('perro') ||
                     titular.toLowerCase().includes('gato') ||
                     referente.toLowerCase().includes('canin') ||
                     referente.toLowerCase().includes('vet');

    rawPautas.push({
      id: `CAL-${i}`,
      dia: diaNorm,
      franja: franja || '08:00 - 11:00',
      seccion: seccion || 'General',
      vertical: isCanino ? 'canino' : 'cocina',
      formato: formato || 'Formato ganador',
      referente: referente,
      titular: titular,
      regla: regla || 'Fórmula de alto CTR para Discover.',
      estado: estado || 'SUGERIDO',
      urlPublicada: urlPub
    });
  }

  // Meta de los días de la semana con insights de tráfico Discover
  const daysOrder = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const dayMeta = {
    'Lunes': { impacto: '-1% (Neutral)', prioridad: 'Prioridad Estándar', estrategia: 'Reactivación de actualidad y cenas rápidas de 10 min.', horarioRecomendado: '06:00 - 10:00 CO · 18:00 - 21:00 CO' },
    'Martes': { impacto: '-4% (Bajo)', prioridad: 'Prioridad Media', estrategia: 'Declaraciones virales de chefs o consejos veterinarios rápidos.', horarioRecomendado: '07:30 - 09:30 CO · 18:00 - 20:30 CO' },
    'Miércoles': { impacto: '-16% (Saturado)', prioridad: 'Solo Formatos Ganadores', estrategia: 'Evitar recetas genéricas; publicar alertas sanitarias o seguridad alimentaria.', horarioRecomendado: '06:00 - 09:30 CO · 11:00 - 14:00 CO' },
    'Jueves': { impacto: '-19% (Filtro Máximo)', prioridad: 'Máxima Prioridad Discover', estrategia: 'Día con mayor saturación en Discover; blindar con los mejores referentes.', horarioRecomendado: '06:00 - 10:00 CO · 16:00 - 19:00 CO' },
    'Viernes': { impacto: '+5% (Ventana Puente)', prioridad: 'Alta Prioridad', estrategia: 'Inicio de ventana fin de semana; compras inteligentes y alertas preventivas.', horarioRecomendado: '06:00 - 10:00 CO · 16:00 - 20:00 CO' },
    'Sábado': { impacto: '+34% (PICO #1 SEMANAL)', prioridad: '1 · PICO MÁXIMO FIN DE SEMANA', estrategia: 'Día de oro Discover: el feed tiene mayor concurrencia y vida útil de 48h a 72h.', horarioRecomendado: '06:00 - 12:00 CO · 18:00 - 22:00 CO' },
    'Domingo': { impacto: '+23% (PICO #2 SEMANAL)', prioridad: '1 · PICO MÁXIMO FIN DE SEMANA', estrategia: 'Batch cooking, organización semanal y lecturas reposadas con arrastre a lunes.', horarioRecomendado: '08:00 - 14:00 CO · 16:00 - 21:00 CO' }
  };

  // Construir parrilla asegurando ESTRICTAMENTE MÁXIMO 2 PAUTAS POR DÍA
  const weekly = daysOrder.map(dayName => {
    const matching = rawPautas.filter(p => p.dia.toLowerCase() === dayName.toLowerCase());

    // Ordenar priorizando las que están en redacción o programadas
    matching.sort((a, b) => {
      const aPrior = (a.estado.includes('REDAC') || a.estado.includes('PROG')) ? 2 : 1;
      const bPrior = (b.estado.includes('REDAC') || b.estado.includes('PROG')) ? 2 : 1;
      if (aPrior !== bPrior) return bPrior - aPrior;
      return 0;
    });

    // Seleccionar máximo 2 pautas por día buscando diversidad (1 canino + 1 cocina, o mañana + tarde)
    let selectedSlots = [];
    if (matching.length > 0) {
      selectedSlots.push(matching[0]);
      if (matching.length > 1) {
        // Buscar una segunda pauta con vertical o franja distinta
        const second = matching.slice(1).find(p => p.vertical !== matching[0].vertical) || matching[1];
        selectedSlots.push(second);
      }
    }

    // Si algún día solo tenía 1 pauta en el sheet, dejamos esa o una complementaria
    selectedSlots = selectedSlots.slice(0, 2);

    return {
      dia: dayName,
      ...dayMeta[dayName],
      slots: selectedSlots
    };
  });

  return weekly;
}

// ══════════════ 5. CONSTRUCTOR UNIFICADO DE DATOS EN TIEMPO REAL ══════════════
async function buildUnifiedSheetData() {
  const [calRows, expRows, chefRows, caninoRows, ruleRows] = await Promise.all([
    fetchSheetData(GIDS.CALENDARIO).catch(() => []),
    fetchSheetData(GIDS.EXPERIMENTOS).catch(() => []),
    fetchSheetData(GIDS.CHEFS).catch(() => []),
    fetchSheetData(GIDS.CANINO).catch(() => []),
    fetchSheetData(GIDS.HORARIOS_REGLAS).catch(() => [])
  ]);

  const experiments = processExperimentsSheet(expRows);
  const chefs = processChefsSheet(chefRows);
  const caninos = processCaninoSheet(caninoRows);
  const calendarWeekly = processCalendarSheet(calRows);

  // Unificar expertos (Chefs con estado + Caninos con estado)
  const allExperts = [...chefs, ...caninos];

  return {
    meta: {
      sheetName: 'MI ESPACIO ET · Auditoría Discover',
      sheetUrl: `docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      hojas: 8,
      objetivo: 35,
      totalExperimentos: experiments.length,
      totalChefsActivos: chefs.length,
      totalCaninosActivos: caninos.length,
      insights: {
        todos: 'El vertical canino supera a cocina en tasa de éxito (+50% vs 16.7%). El fin de semana (+34% Sáb / +23% Dom) es la ventana dorada donde no hay saturación.',
        cocina: 'Cocina requiere cita textual + atajo doméstico de supermercado en mar-jue 07:30-09:00 o sábado mañana con Ferran Adrià / Joan Roca.',
        canino: 'Mascotas triunfa en ventana 18:00-21:00 con reencuadres contraintuitivos (César Millán, Borja Capponi, Santi Vidal).'
      },
      sheetRefs: {
        bitacora: 'EXPERIMENTOS EDITORIALES · A1:J27',
        calendario: 'CALENDARIO EDITORIAL · A1:K36',
        'dir-chefs': 'DIRECTORIO CHEFS · A1:J36',
        'dir-canino': 'DIRECTORIO CANINO · A1:N16',
        reglas: 'HORARIOS Y REGLAS DISCOVER · A1:G15',
        temporada: 'CHEFS POR TEMPORADA · A1:E10',
        plantillas: 'Plantillas de Titulares · A1:D11'
      }
    },
    calendarWeekly: calendarWeekly,
    experts: allExperts,
    experiments: experiments,
    rules: [
      { id:'r1', tipo:'hacer', titulo:'SÁBADO (+34%) y DOMINGO (+23%): Volcar las mejores recetas y etología', evidencia:'Pico #1 y #2 semanal', detalle:'Las redacciones reducen 50% el volumen publicado, pero el feed de Discover tiene su mayor concurrencia. Una nota lanzada el sábado vive de 48 a 72 horas.' },
      { id:'r2', tipo:'hacer', titulo:'En MIÉRCOLES (-16%) y JUEVES (-19%): Solo 4 Formatos Ganadores Blindados', evidencia:'Vencen la saturación', detalle:'En los dos peores días de la semana, NO publicar recetas planas. Usar: A) Paradoja culposa, B) Desmentido diario + credencial, C) Seguridad alimentaria / Marcas, D) Servicio hogar / Temporada urgente.' },
      { id:'r3', tipo:'hacer', titulo:'Fórmula E-E-A-T Obligatoria en Titulares', evidencia:'+20% entidad / +5% cita', detalle:'[Nombre Propio] + [Credencial: veterinario / chef / nutricionista] + [Cita textual entrecomillada o dato exacto sin ocultar el truco]. Elimina el clickbait penalizado por Google.' },
      { id:'r4', tipo:'hacer', titulo:'Publica Mascotas de 18:00 a 21:00 (Hora Colombia)', evidencia:'4/4 éxitos demostrados', detalle:'El lector está en casa junto a su perro o gato en el sofá. El contenido emocional y de salud preventiva alcanza su mayor CTR nocturno.' },
      { id:'r5', tipo:'hacer', titulo:'Gastronomía matutina: de 06:00 a 09:30 (Hora Colombia)', evidencia:'Momento café y planning', detalle:'El usuario planifica mentalmente qué cocinar o comprar antes de iniciar la jornada.' },
      { id:'r6', tipo:'evitar', titulo:'VETO TOTAL: Cocina tradicional en viernes', evidencia:'0/3 histórico', detalle:'El viernes la actualidad deportiva y planes de ocio copan el feed. Solo se permite compras inteligentes de pescadería con José María Sánchez.' },
      { id:'r7', tipo:'evitar', titulo:'Alta cocina sin traducción doméstica de supermercado', evidencia:'CTR 2.2% Dani García', detalle:'Platos Michelin sin ingredientes accesibles nacen muertos en Discover. Traducir siempre a atajos de cocina diaria.' },
      { id:'r8', tipo:'evitar', titulo:'Titulares clínicos o académicos sin beneficio emocional', evidencia:'CTR < 2%', detalle:'Términos como "displasia" o "IGP nivel 1" no conectan. Reencuadrar en "el gesto al pasear que le daña la columna".' }
    ],
    heatmaps: {
      bands: ['06–10','10–12','12–15','15–18','18–21','21–24'],
      cocina: { levels: [[3,2,2,2,0,3,3],[1,1,1,1,0,2,2],[1,1,1,1,0,1,1],[0,0,0,0,0,0,0],[1,1,1,1,0,1,1],[0,0,0,0,0,0,0]] },
      canino: { levels: [[2,2,2,2,2,3,3],[1,1,1,1,1,2,2],[0,0,0,0,0,1,0],[1,1,1,1,1,2,2],[3,3,3,3,3,3,3],[1,1,1,1,1,1,1]] }
    },
    seasons: [
      { id:'otono', nombre:'Otoño / Fin de Año', meses:'Nov – Dic', icon:'leaf', actual:true, temas:['Pólvora y alborada en mascotas','Guisos de cuchara y setas','Batch cooking de vuelta a la rutina','Caldos limpios de pollo'], chefs:['ferran','roca','carlosgut','peiro'], evidencia:'Pólvora canina del 30 de nov y caldos de Ferran Adrià marcan picos masivos.', evitar:'Recetas veraniegas o torrijas fuera de Cuaresma.' }
    ],
    templates: [
      { id:'t1', cat:'Desmentido + Credencial', exp:'Carlos Gutiérrez', patron:'[Veterinario / Educador], [credencial]: «Por qué solo el [X %] de los [perros/gatos] sufre [problema] y el error que estás cometiendo»' },
      { id:'t2', cat:'Paradoja Culposa', exp:'Pablo Ojeda', patron:'[Nutricionista / Chef], [credencial]: «Si llegas a las [hora nocturna] y te comerías la nevera, el fallo empieza en [hábito diurno]»' },
      { id:'t3', cat:'Seguridad Alimentaria', exp:'Jordi Cruz', patron:'[Chef / Experto], [credencial]: el peligro real de dejar el [alimento cotidiano] enfriando a temperatura ambiente' },
      { id:'t4', cat:'Compra Inteligente', exp:'José María Sánchez', patron:'[Producto] en bandeja de supermercado vs. mostrador de [tienda]: cómo el [truco de venta] te hace pagar el doble' }
    ]
  };
}

let cachedSheetData = null;
let lastFetchTime = 0;

// Sistema Keep-Alive para Render (Anti-inactividad 24/7)
const keepAliveState = {
  enabled: true,
  intervalMinutes: 10,
  targetUrl: process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '',
  lastPingTime: null,
  lastPingStatus: null,
  totalPings: 0
};

function performSelfPing() {
  const urlToPing = keepAliveState.targetUrl || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/api/health` : '');
  if (!urlToPing) return;

  const cleanUrl = urlToPing.endsWith('/api/health') ? urlToPing : `${urlToPing.replace(/\/$/, '')}/api/health`;
  const startTime = Date.now();
  const client = cleanUrl.startsWith('https:') ? https : http;

  client.get(cleanUrl, (res) => {
    const duration = Date.now() - startTime;
    keepAliveState.totalPings++;
    keepAliveState.lastPingTime = new Date();
    keepAliveState.lastPingStatus = `HTTP ${res.statusCode} (${duration}ms)`;
  }).on('error', () => {});
}

setInterval(() => {
  if (keepAliveState.enabled) performSelfPing();
}, 10 * 60 * 1000);

app.get(['/api/health', '/health', '/ping'], (req, res) => {
  res.json({
    status: 'ok',
    message: 'Discover Pulse Monitor activo 24/7 en Render',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    keepAliveActive: true
  });
});

app.get('/api/data', async (req, res) => {
  const now = Date.now();
  if (!cachedSheetData || (now - lastFetchTime) > 30000) {
    try {
      cachedSheetData = await buildUnifiedSheetData();
      lastFetchTime = now;
    } catch (e) {
      console.error('Error al actualizar datos en vivo:', e.message);
    }
  }
  res.json(cachedSheetData);
});

app.post('/api/sync', async (req, res) => {
  try {
    cachedSheetData = await buildUnifiedSheetData();
    lastFetchTime = Date.now();
    res.json({
      success: true,
      experimentsCount: cachedSheetData.experiments.length,
      chefsCount: cachedSheetData.meta.totalChefsActivos,
      caninosCount: cachedSheetData.meta.totalCaninosActivos,
      calendarDays: cachedSheetData.calendarWeekly.length
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`🚀 Discover Pulse corriendo en puerto ${PORT}`);
  console.log(`📊 Conectado a Google Sheet en vivo: ${SHEET_ID}`);
  try {
    cachedSheetData = await buildUnifiedSheetData();
    lastFetchTime = Date.now();
    console.log(`✅ Sincronizados: ${cachedSheetData.experiments.length} experimentos, ${cachedSheetData.experts.length} expertos activos, y calendario con máx 2 pautas/día.`);
  } catch (e) {
    console.error('Error inicial al sincronizar:', e.message);
  }
});
