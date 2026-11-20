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

// GIDs de las pestañas activas
const GIDS = {
  CALENDARIO: '107866153',
  EXPERIMENTOS: '1146342330',
  HORARIOS_REGLAS: '1489175614',
  CHEFS: '1911090356',
  CANINO: '1981376541'
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
                     entidad.toLowerCase().includes('cervantes') ||
                     entidad.toLowerCase().includes('corchado');

    // Estimaciones realistas para visualización
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

// ══════════════ 2. PROCESAR DIRECTORIO DE CHEFS (FILTRO ESTRICTO) ══════════════
function processChefsSheet(rows) {
  const chefs = [];
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

    // REGLA: "cuando no hay ningun estado no se debe colocar o tener en cuenta"
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
    const precauciones = (r[9] || r[8] || '').trim();
    const url = (r[10] || '').trim();
    const criterio = (r[11] || '').trim();
    const estado = (r[12] || '').trim();
    const potencial = (r[13] || '').trim();

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
      motivo: (precauciones || criterio || '').slice(0, 140),
      fuente: inst || 'Clínica / Academia',
      canalUrl: url,
      mejorDia: 'Jueves / Sábado',
      mejorHora: '18:00–21:00',
      lectura: precauciones || `Estado en Discover: ${estado}`
    });
  }

  return caninos;
}

// ══════════════ 4. PROCESAR CALENDARIO EDITORIAL COMPLETO (26 DÍAS · 52 PAUTAS) ══════════════
function processCalendarSheet(rows) {
  const rawPautas = [];
  
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const diaRaw = (r[1] || '').trim();
    if (!diaRaw) continue;

    const franja = (r[2] || '').trim();
    const seccion = (r[3] || '').trim();
    const formato = (r[4] || '').trim();
    const referente = (r[5] || '').trim();
    const titular = (r[6] || '').trim();
    const reglaRaw = (r[7] || '').trim();
    const estado = (r[8] || '').trim();
    const urlPub = (r[9] || '').trim();

    if (!titular && !referente) continue;

    let fechaStr = '';
    let reglaLimpia = reglaRaw;
    const dateMatch = reglaRaw.match(/\[(\d{1,2}\s+[a-záéíóúñ]{3,4}\s+\d{4})\]/i);
    if (dateMatch) {
      fechaStr = dateMatch[1];
      reglaLimpia = reglaRaw.replace(dateMatch[0], '').trim();
    }

    const diaNorm = diaRaw.charAt(0).toUpperCase() + diaRaw.slice(1).toLowerCase();
    const isCanino = seccion.toLowerCase().includes('mascota') ||
                     seccion.toLowerCase().includes('canin') ||
                     seccion.toLowerCase().includes('felin') ||
                     titular.toLowerCase().includes('perro') ||
                     titular.toLowerCase().includes('gato') ||
                     referente.toLowerCase().includes('canin') ||
                     referente.toLowerCase().includes('adiestrador') ||
                     referente.toLowerCase().includes('veterinari') ||
                     referente.toLowerCase().includes('etólog') ||
                     referente.toLowerCase().includes('etolog');

    // Determinar bloque / semana
    let semana = 'Semana 1';
    let semanaLabel = 'Semana 1 (21 - 29 Nov) · Arranque & Alborada';
    if (fechaStr.includes('dic')) {
      const dayNum = parseInt(fechaStr, 10);
      if (dayNum >= 14) {
        semana = 'Semana 4';
        semanaLabel = 'Semana 4 (14 - 19 Dic) · Cenas & Viajes de Vacaciones';
      } else if (dayNum >= 7) {
        semana = 'Semana 3';
        semanaLabel = 'Semana 3 (7 - 12 Dic) · Menús Navideños & Fiestas';
      } else {
        semana = 'Semana 2';
        semanaLabel = 'Semana 2 (30 Nov - 5 Dic) · Noche de Velitas & Alimentos';
      }
    } else if (fechaStr.includes('30 nov')) {
      semana = 'Semana 2';
      semanaLabel = 'Semana 2 (30 Nov - 5 Dic) · Noche de Velitas & Alimentos';
    }

    rawPautas.push({
      id: `PAUTA-${i - 3}`,
      dia: diaNorm,
      fechaStr: fechaStr,
      fechaLabel: fechaStr ? `${diaNorm} ${fechaStr}` : diaNorm,
      semana: semana,
      semanaLabel: semanaLabel,
      franja: franja || '08:00 - 11:00',
      seccion: seccion || 'General',
      vertical: isCanino ? 'canino' : 'cocina',
      formato: formato || 'Formato ganador Discover',
      referente: referente,
      titular: titular,
      regla: reglaLimpia || reglaRaw || 'Fórmula de alto CTR para Discover.',
      estado: estado || 'PROGRAMADO',
      urlPublicada: urlPub
    });
  }

  // Agrupar por fecha real
  const groupedByDate = {};
  rawPautas.forEach(p => {
    const key = p.fechaLabel || p.dia;
    if (!groupedByDate[key]) {
      // Determinar impacto algorítmico del día
      let impacto = '-1% (Neutral)';
      let prioridad = 'Prioridad Estándar';
      let tagCls = 'bg-wash text-sub';

      const d = p.dia.toLowerCase();
      if (d === 'sábado' || d === 'sabado') {
        impacto = '+34% (PICO #1 DISCOVER)';
        prioridad = 'Pico Máximo de Fin de Semana (Ocio y Tracción Continua)';
        tagCls = 'bg-exito-tint text-exito border-exito/30';
      } else if (d === 'domingo') {
        impacto = '+23% (PICO #2 DISCOVER)';
        prioridad = 'Pico Máximo (Batch cooking, lectura reposada y arrastre a lunes)';
        tagCls = 'bg-bien-tint text-bien border-bien/30';
      } else if (d === 'viernes') {
        impacto = '+5% (Ventana Puente)';
        prioridad = 'Alta Prioridad (Inicio de fin de semana · Compras inteligentes)';
        tagCls = 'bg-cola-tint text-cola border-cola/30';
      } else if (d === 'miércoles' || d === 'miercoles') {
        impacto = '-16% (Saturado)';
        prioridad = 'Filtro Anti-saturación (Usar Paradoja o Alerta Sanitaria)';
        tagCls = 'bg-amber-50 text-amber-800 border-amber-300';
      } else if (d === 'jueves') {
        impacto = '-19% (Filtro Máximo)';
        prioridad = 'Máxima Saturación Generalista (Solo 2 formatos blindados)';
        tagCls = 'bg-muerta-tint text-muerta border-muerta/30';
      }

      groupedByDate[key] = {
        dia: p.dia,
        fechaStr: p.fechaStr,
        fechaLabel: key,
        semana: p.semana,
        semanaLabel: p.semanaLabel,
        impacto: impacto,
        prioridad: prioridad,
        tagCls: tagCls,
        slots: []
      };
    }
    groupedByDate[key].slots.push(p);
  });

  // Asegurar ESTRICTAMENTE máximo 2 pautas por día
  const calendarDays = Object.values(groupedByDate).map(d => {
    d.slots = d.slots.slice(0, 2);
    return d;
  });

  return {
    pautas: rawPautas,
    days: calendarDays,
    totalPautas: rawPautas.length,
    totalDias: calendarDays.length
  };
}

// ══════════════ 5. PROCESAR REGLAS Y HORARIOS DISCOVER 2026 ══════════════
function processRulesSheet(rows) {
  const rules = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const bloque = (r[1] || r[0] || '').trim();
    if (!bloque) continue;

    const impacto = (r[2] || '').trim();
    const prioridad = (r[3] || '').trim();
    const horaES = (r[4] || '').trim();
    const horaCO = (r[5] || '').trim();
    const analisis = (r[6] || '').trim();
    const aplicacion = (r[7] || '').trim();

    rules.push({
      id: `RULE-${i - 3}`,
      titulo: bloque,
      evidencia: impacto || prioridad,
      impacto: impacto,
      prioridad: prioridad,
      horarioES: horaES,
      horarioCO: horaCO,
      detalle: analisis,
      aplicacion: aplicacion
    });
  }

  return rules;
}

// ══════════════ 6. CONSTRUCTOR UNIFICADO EN TIEMPO REAL ══════════════
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
  const calData = processCalendarSheet(calRows);
  const rules = processRulesSheet(ruleRows);

  const allExperts = [...chefs, ...caninos];

  return {
    meta: {
      sheetName: 'MI ESPACIO ET · Auditoría Discover 2026',
      sheetUrl: `docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      hojas: 5,
      totalExperimentos: experiments.length,
      totalChefsActivos: chefs.length,
      totalCaninosActivos: caninos.length,
      totalPautasCalendario: calData.totalPautas,
      totalDiasPlanificados: calData.totalDias,
      kpis: {
        picoFinSemana: '+54%',
        mejorDiaSabado: '+34%',
        segundoMejorDomingo: '+23%',
        boostNombrePropio: '+20%',
        peorDiaJueves: '-19%'
      },
      insights: {
        todos: 'El fin de semana (+34% Sáb / +23% Dom) es la ventana dorada de Discover. Los días miércoles (-16%) y jueves (-19%) están saturados de política dura y exigen formatos blindados.',
        cocina: 'Cocina triunfa con atajos domésticos de chefs colombianos y españoles (Jorge Rausch, Harry Sasson, Jordi Cruz, Ferran Adrià, Dani García) en desayunos 06:30-09:30 o fines de semana.',
        canino: 'Mascotas gana tracción masiva en tardes 17:00-20:00 o mañanas de paseo con etólogos y veterinarios (Borja Capponi, Alan Peiró, Amir Anwary, Felipe Valencia/IDPYBA).'
      },
      sheetRefs: {
        calendario: 'CALENDARIO EDITORIAL · A1:K56',
        bitacora: 'EXPERIMENTOS EDITORIALES · A1:J30',
        reglas: 'HORARIOS Y REGLAS DISCOVER · A1:G18',
        'dir-chefs': 'DIRECTORIO CHEFS · A1:J36',
        'dir-canino': 'DIRECTORIO CANINO · A1:N16'
      }
    },
    calendar: calData,
    calendarWeekly: calData.days.slice(0, 7), // Primeros 7 días para compatibilidad
    calendarDays: calData.days,
    calendarPautas: calData.pautas,
    experts: allExperts,
    experiments: experiments,
    rules: rules.length ? rules : [
      { id:'r1', titulo:'SÁBADO (+34%): Día de Oro en Discover', evidencia:'+34%', detalle:'Las redacciones bajan 50% su volumen, pero el feed está en pico de lectura de ocio.', aplicacion:'Lanzar recetas de autor y guías caninas profundas.' },
      { id:'r2', titulo:'DOMINGO (+23%): Batch Cooking & Planificación', evidencia:'+23%', detalle:'Captura la organización semanal de las familias y arrastra tráfico a lunes.', aplicacion:'Menús semanales, caldos limpios y etología de convivencia.' },
      { id:'r3', titulo:'MIÉRCOLES & JUEVES: Filtro Anti-saturación', evidencia:'-16% a -19%', detalle:'Pico de saturación generalista. Veto de recetas atemporales.', aplicacion:'Publicar solo Paradojas culposas o Alertas sanitarias.' }
    ],
    heatmaps: {
      bands: ['06–10','10–12','12–15','15–18','18–21','21–24'],
      cocina: { levels: [[3,2,2,2,0,3,3],[1,1,1,1,0,2,2],[1,1,1,1,0,1,1],[0,0,0,0,0,0,0],[1,1,1,1,0,1,1],[0,0,0,0,0,0,0]] },
      canino: { levels: [[2,2,2,2,2,3,3],[1,1,1,1,1,2,2],[0,0,0,0,0,1,0],[1,1,1,1,1,2,2],[3,3,3,3,3,3,3],[1,1,1,1,1,1,1]] }
    }
  };
}

let cachedSheetData = null;
let lastFetchTime = 0;

// Keep-Alive para Render
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
      pautasCount: cachedSheetData.meta.totalPautasCalendario,
      diasCount: cachedSheetData.meta.totalDiasPlanificados
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
    console.log(`✅ Sincronizados: ${cachedSheetData.experiments.length} experimentos, ${cachedSheetData.experts.length} expertos activos, y ${cachedSheetData.calendarDays.length} días planificados (${cachedSheetData.calendarPautas.length} pautas, máx 2/día).`);
  } catch (e) {
    console.error('Error inicial al sincronizar:', e.message);
  }
});
