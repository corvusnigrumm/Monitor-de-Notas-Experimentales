/**
 * Discover Pulse · Servidor Web Editorial & Monitor Discover España 2026-2027
 * Sincronizado en tiempo real con Google Sheets
 * ID: 1lEY_Dltt9pCsTfbXLQcjLlzIS5vBWyU-TzdV4YuF-YY
 * Published Base: 2PACX-1vT1aBH7iMlllmZk28CNmqa-iLut7lHkfQH1GFXFIpjW6AJkYLwD9PpwSH7SDRVN5JeE3a7hjuT_HkrO
 * Incluye Keep-Alive automático 24/7 para evitar suspensión por inactividad en Render
 */

const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Google Sheet URLs Oficiales
const SHEET_ID = '1lEY_Dltt9pCsTfbXLQcjLlzIS5vBWyU-TzdV4YuF-YY';
const PUB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT1aBH7iMlllmZk28CNmqa-iLut7lHkfQH1GFXFIpjW6AJkYLwD9PpwSH7SDRVN5JeE3a7hjuT_HkrO/pub?output=csv&gid=';

// GIDs de las pestañas en vivo
const GIDS = {
  CALENDARIO: '107866153',
  EXPERIMENTOS: '1146342330',
  HORARIOS_REGLAS: '1489175614',
  CHEFS: '1911090356',
  CANINO: '1981376541',
  TRUCOS: '2041696224'
};

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/* ═══════════════════════════════════════════════════════════════════
   1. CONECTOR HTTP CON SOPORTE DE REDIRECCIONAMIENTOS
   ═══════════════════════════════════════════════════════════════════ */
function fetchWithRedirect(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Demasiados redireccionamientos'));
    const client = url.startsWith('https:') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) loc = 'https://docs.google.com' + loc;
        return resolve(fetchWithRedirect(loc, maxRedirects - 1));
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
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') { currentCell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
  }
  return rows;
}

async function fetchSheetData(gid) {
  // 1. Intento primario: Publicación oficial web (2PACX) sin restricciones
  const primaryUrl = `${PUB_BASE}${gid}`;
  try {
    const csvText = await fetchWithRedirect(primaryUrl);
    if (csvText && csvText.length > 50) {
      return parseCSV(csvText);
    }
  } catch (err) {
    console.warn(`Aviso: Error en enlace publicado para GID ${gid} (${err.message}). Intentando fallback...`);
  }

  // 2. Fallback: Google Visualisation API (gviz)
  const fallbackUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  try {
    const csvText = await fetchWithRedirect(fallbackUrl);
    return parseCSV(csvText);
  } catch (err) {
    console.error(`Error al descargar GID ${gid} en fallback:`, err.message);
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════
   2. PARSERS ESPECIALIZADOS PARA GOOGLE SHEETS
   ═══════════════════════════════════════════════════════════════════ */
const MONTH_MAP = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12'
};

function parseDateFromRule(ruleStr) {
  const m = (ruleStr || '').match(/\[(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})\]/i);
  if (m) {
    const day = m[1].padStart(2, '0');
    const mon = MONTH_MAP[m[2].toLowerCase().slice(0, 3)] || '11';
    const yr = m[3];
    return `${yr}-${mon}-${day}`;
  }
  return null;
}

const SF_MAP = {
  R: "Receta paso a paso",
  T: "Truco 1 ingrediente",
  P: "Paradoja culinaria",
  A: "Alerta nevera · sanitaria",
  M: "Menú festivo",
  B: "Batch cooking",
  C: "Técnica y ciencia",
  G: "Guía canina extensa",
  X: "Adiestramiento express",
  E: "Consulta etológica",
  V: "Salud veterinaria"
};

function mapSubformat(formatoRaw, vertical, titular) {
  const f = (formatoRaw || '').toUpperCase();
  const t = (titular || '').toLowerCase();
  
  if (vertical === 'cocina') {
    if (f.startsWith('A') || t.includes('paradoja') || t.includes('mentira') || t.includes('engañ')) return SF_MAP.P;
    if (f.startsWith('C') || t.includes('nevera') || t.includes('alerta') || t.includes('peligro') || t.includes('bacteri')) return SF_MAP.A;
    if (t.includes('menú') || t.includes('navidad') || t.includes('nochevieja') || t.includes('reyes') || t.includes('roscón')) return SF_MAP.M;
    if (f.startsWith('B') || t.includes('truco') || t.includes('ingrediente') || t.includes('cucharad')) return SF_MAP.T;
    if (t.includes('batch') || t.includes('semanal') || t.includes('domingo')) return SF_MAP.B;
    if (t.includes('ciencia') || t.includes('técnica') || t.includes('grados') || t.includes('temperatura')) return SF_MAP.C;
    return SF_MAP.R;
  } else {
    if (f.startsWith('F') || t.includes('guía') || t.includes('profunda') || t.includes('silencioso')) return SF_MAP.G;
    if (t.includes('adiestr') || t.includes('paseo') || t.includes('correa') || t.includes('espera') || t.includes('orden')) return SF_MAP.X;
    if (t.includes('veterinari') || t.includes('salud') || t.includes('torsión') || t.includes('vacuna') || t.includes('articular') || t.includes('frío')) return SF_MAP.V;
    return SF_MAP.E;
  }
}

function mapEstado(estadoRaw, urlPub) {
  const e = (estadoRaw || '').toUpperCase();
  if (urlPub && urlPub.startsWith('http')) {
    if (e.includes('DISCOVER') || e.includes('TOP')) return 'discover';
    return 'publicada';
  }
  if (e.includes('DISCOVER')) return 'discover';
  if (e.includes('RETEN')) return 'retenida';
  if (e.includes('PUBLICAD')) return 'publicada';
  if (e.includes('PENDIENT')) return 'pendiente';
  return 'programada';
}

// Distribución de fechas por semana para fallback secuencial
// Operativo: 23 nov 2026 – 3 ene 2027, 6 semanas, ~20 piezas/semana
function inferDateByIndex(idx, totalRows) {
  const START = new Date("2026-11-23T12:00:00Z");
  const dayOffset = Math.floor(idx / 2);
  const d = new Date(START.getTime() + dayOffset * 86400000);
  return d.toISOString().slice(0, 10);
}

function processCalendarSheet(rows) {
  const dataRows = rows.slice(4).filter(r => r.length > 5 && (r[1] || r[2]));
  const piezas = [];

  dataRows.forEach((r, idx) => {
    const dia = r[1] || 'Lunes';
    const franja = r[2] || '08:30 CET';
    const seccion = r[3] || 'Cocina';
    const formato = r[4] || '';
    const referente = r[5] || '';
    const titular = r[6] || '';
    const regla = r[7] || '';
    const estadoRaw = r[8] || 'PROGRAMADO';
    const urlPub = r[9] || '';
    
    const fecha = parseDateFromRule(regla) || parseDateFromRule(titular) || inferDateByIndex(idx, dataRows.length);
    const horaMatch = franja.match(/(\d{1,2}:\d{2})/);
    const hora = horaMatch ? horaMatch[1].padStart(5, '0') : '08:30';
    const vertical = seccion.toLowerCase().includes('perro') || seccion.toLowerCase().includes('canin') ? 'perros' : 'cocina';
    
    const dUtc = new Date(fecha + "T12:00:00Z");
    const dow = (dUtc.getUTCDay() + 6) % 7;
    let reglaVal = null;
    if (dow === 2 || dow === 3) reglaVal = 'blindaje';
    else if (dow === 5 || dow === 6) reglaVal = 'retencion';
    
    const diffDays = Math.floor((dUtc.getTime() - new Date("2026-11-23T12:00:00Z").getTime()) / 86400000);
    const semana = Math.min(6, Math.max(1, Math.floor(diffDays / 7) + 1));
    
    let hito = null;
    const tLow = (titular + ' ' + regla).toLowerCase();
    if (tLow.includes('alborada') || tLow.includes('arranque')) hito = 'Arranque campaña';
    else if (tLow.includes('velitas')) hito = 'Noche de Velitas';
    else if (tLow.includes('dane')) hito = 'Informe DANE';
    else if (tLow.includes('navidad') || tLow.includes('nochebuena')) hito = 'Cena de Nochebuena';
    else if (tLow.includes('nochevieja') || tLow.includes('año nuevo')) hito = 'Cena de Nochevieja';
    else if (tLow.includes('reyes') || tLow.includes('roscón')) hito = 'Roscón de Reyes';
    
    const subformato = mapSubformat(formato, vertical, titular);
    const estado = mapEstado(estadoRaw, urlPub);
    
    let experimento = null;
    let variante = null;
    if (idx % 2 === 0) {
      const expNum = (idx % 5) + 1;
      experimento = `E${expNum}`;
      variante = (idx % 4 < 2) ? 'control' : 'experimental';
    }
    
    piezas.push({
      id: `P${String(idx + 1).padStart(3, '0')}`,
      semana,
      fecha,
      hora,
      vertical,
      experto: referente || 'Redacción El Tiempo',
      titular,
      subformato,
      experimento,
      variante,
      regla: reglaVal,
      hito,
      estado,
      visitas: null,
      lectura: null,
      rfv: null,
      ai: null,
      indexacion: null,
      retenidaDesde: estado === 'retenida' ? fecha : null,
      urlPublicada: urlPub
    });
  });

  return piezas;
}

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

    experiments.push({
      id: `EXP-${String(experiments.length + 1).padStart(3, '0')}`,
      fecha,
      entidad,
      titular,
      tipoExp,
      seccion,
      url,
      marfeel,
      rendimiento: rendimiento || 'En evaluación',
      hallazgos: hallazgos || 'Seguimiento activo en Marfeel'
    });
  }
  return experiments;
}

function processChefsSheet(rows) {
  const chefs = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[1] || '').trim();
    if (!name || name.toLowerCase().includes('total') || /^(chef|creador|nombre)/i.test(name)) continue;
    const canal = (r[2] || '').trim();
    const url = (r[3] || '').trim();
    const audiencia = (r[4] || '').trim();
    const ganchos = (r[5] || '').trim();
    
    // Extraer estado en Discover (col 6 o por coincidencia)
    let estado = (r[6] || '').trim();
    if (!estado || estado === '—' || estado === '-') {
      for (let c = 5; c < r.length; c++) {
        if (/TOP DISCOVER|ACTIVO|EVALUACI|PROBADO|DESECHADO/i.test(r[c] || '')) {
          estado = r[c].trim();
          break;
        }
      }
    }
    const notasPub = (r[8] || '').trim();

    chefs.push({
      id: `chef-${chefs.length + 1}`,
      nombre: name,
      canal: canal || 'Canal / Redes',
      url,
      audiencia: audiencia || '—',
      ganchos: ganchos || 'Recetas estrella y técnicas culinarias',
      estadoDiscover: estado && estado !== '—' && estado !== '-' ? estado : 'En evaluación',
      notasPublicadas: notasPub || '—'
    });
  }
  return chefs;
}

function processCaninoSheet(rows) {
  const caninos = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[1] || '').trim();
    if (!name || name.toLowerCase().includes('total') || /^(experto|nombre|especialista)/i.test(name)) continue;
    const rol = (r[2] || '').trim();
    const pais = (r[3] || '').trim() || 'España';
    const canal = (r[4] || '').trim();
    const audiencia = (r[7] || r[5] || '').trim();
    const ganchos = (r[8] || r[6] || '').trim();
    const url = (r[10] || '').trim();
    
    // Extraer estado en Discover (col 12 o búsqueda de etiquetas de estado)
    let estado = (r[12] || '').trim();
    if (!estado || estado === '—' || estado === '-' || estado.length > 30) {
      estado = '';
      for (let c = 5; c < r.length; c++) {
        const val = (r[c] || '').trim();
        if (/^(TOP DISCOVER|ACTIVO \/ PROBADO|EN EVALUACI[ÓO]N|DESECHADO|CAUTELA)/i.test(val)) {
          estado = val;
          break;
        }
      }
    }
    const notasPub = (r[14] || r[9] || '').trim();

    caninos.push({
      id: `canino-${caninos.length + 1}`,
      nombre: name,
      rol: rol || 'Especialista Canino',
      pais,
      canal: canal || 'Consulta / Redes',
      audiencia: audiencia || '—',
      ganchos: ganchos || 'Pautas de conducta y bienestar animal',
      url,
      estadoDiscover: estado && estado !== '—' && estado !== '-' ? estado : 'En evaluación',
      notasPublicadas: notasPub || '—'
    });
  }
  return caninos;
}

/* ═══════════════════════════════════════════════════════════════════
   3. CONSTRUCCIÓN DE LA RESPUESTA UNIFICADA
   ═══════════════════════════════════════════════════════════════════ */
async function buildUnifiedSheetData() {
  const [calRows, expRows, chefsRows, caninoRows, rulesRows, trucosRows] = await Promise.all([
    fetchSheetData(GIDS.CALENDARIO),
    fetchSheetData(GIDS.EXPERIMENTOS),
    fetchSheetData(GIDS.CHEFS),
    fetchSheetData(GIDS.CANINO),
    fetchSheetData(GIDS.HORARIOS_REGLAS),
    fetchSheetData(GIDS.TRUCOS)
  ]);

  const piezas = calRows.length ? processCalendarSheet(calRows) : [];
  const experiments = expRows.length ? processExperimentsSheet(expRows) : [];
  const chefs = chefsRows.length ? processChefsSheet(chefsRows) : [];
  const caninos = caninoRows.length ? processCaninoSheet(caninoRows) : [];

  return {
    meta: {
      titulo: "Google Discover España",
      inicio: "2026-11-23",
      fin: "2027-01-03",
      metaTotal: piezas.length || 84,
      totalPautasSheet: piezas.length,
      corte: "2026-11-23T21:00:00+01:00",
      cuotas: { cocina: 65, perros: 35 },
      traficoGlobal: { 0: 0, 1: -4, 2: -16, 3: -19, 4: 5, 5: 34, 6: 23 },
      syncTime: new Date().toISOString(),
      sheetRefs: {
        calendario: `CALENDARIO EDITORIAL · GID ${GIDS.CALENDARIO}`,
        experimentos: `EXPERIMENTOS · GID ${GIDS.EXPERIMENTOS}`,
        chefs: `DIRECTORIO CHEFS · GID ${GIDS.CHEFS}`,
        canino: `DIRECTORIO CANINO · GID ${GIDS.CANINO}`,
        reglas: `HORARIOS Y REGLAS · GID ${GIDS.HORARIOS_REGLAS}`
      }
    },
    piezas,
    experiments,
    chefs,
    caninos
  };
}

let cachedData = null;
let lastFetchTime = 0;
let isSyncing = false;

async function syncData(force = false) {
  if (isSyncing) return cachedData;
  isSyncing = true;
  try {
    const data = await buildUnifiedSheetData();
    if (data && data.piezas && data.piezas.length > 0) {
      cachedData = data;
      lastFetchTime = Date.now();
      console.log(`[Google Sheets] ✅ Sincronizados: ${cachedData.piezas.length} piezas, ${cachedData.experiments.length} exp, ${cachedData.chefs.length} chefs, ${cachedData.caninos.length} caninos.`);
    }
  } catch (e) {
    console.error('[Google Sheets] Error en sincronización:', e.message);
  } finally {
    isSyncing = false;
  }
  return cachedData;
}

// Sincronización automática de fondo cada 60 segundos
setInterval(() => {
  syncData();
}, 60 * 1000);

/* ═══════════════════════════════════════════════════════════════════
   4. KEEP-ALIVE 24/7 PARA RENDER
   ═══════════════════════════════════════════════════════════════════ */
const keepAliveState = {
  enabled: true,
  targetUrl: process.env.KEEP_ALIVE_URL || '',
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
  }).on('error', (err) => {
    keepAliveState.lastPingStatus = `Error: ${err.message}`;
  });
}

// Ping cada 10 minutos para evitar suspensión de Render
setInterval(() => {
  if (keepAliveState.enabled) performSelfPing();
}, 10 * 60 * 1000);

/* ═══════════════════════════════════════════════════════════════════
   5. RUTAS DEL API & FRONTEND
   ═══════════════════════════════════════════════════════════════════ */
app.get(['/api/health', '/health', '/ping'], (req, res) => {
  res.json({
    status: 'ok',
    message: 'Discover Pulse Monitor activo 24/7 en Render',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    sheetConnected: !!(cachedData && cachedData.piezas && cachedData.piezas.length > 0),
    piezasCount: cachedData ? cachedData.piezas.length : 0,
    keepAlive: keepAliveState
  });
});

app.get('/api/data', async (req, res) => {
  const now = Date.now();
  if (!cachedData || req.query.refresh === '1' || (now - lastFetchTime) > 60000) {
    await syncData(true);
  }
  res.json(cachedData || { meta: {}, piezas: [], experiments: [], chefs: [], caninos: [] });
});

app.all(['/api/sync', '/api/refresh'], async (req, res) => {
  try {
    await syncData(true);
    res.json({
      success: true,
      piezasCount: cachedData ? cachedData.piezas.length : 0,
      experimentsCount: cachedData ? cachedData.experiments.length : 0,
      chefsCount: cachedData ? cachedData.chefs.length : 0,
      caninosCount: cachedData ? cachedData.caninos.length : 0,
      syncTime: cachedData ? cachedData.meta.syncTime : new Date().toISOString(),
      data: cachedData
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ═══════════════════════════════════════════════════════════════════
   6. INICIO DEL SERVIDOR
   ═══════════════════════════════════════════════════════════════════ */
app.listen(PORT, async () => {
  console.log(`🚀 Discover Pulse corriendo en puerto ${PORT}`);
  console.log(`📊 Conectado a Google Sheet oficial: ${PUB_BASE}`);
  await syncData(true);
});
