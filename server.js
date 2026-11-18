const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Google Sheet ID and GIDs
const SHEET_ID = '2PACX-1vT1aBH7iMlllmZk28CNmqa-iLut7lHkfQH1GFXFIpjW6AJkYLwD9PpwSH7SDRVN5JeE3a7hjuT_HkrO';
const GIDS = {
  EXPERIMENTOS: '1146342330',
  CHEFS: '1911090356',
  CANINO: '1981376541',
  REGLAS: '1489175614',
  PLANTILLAS: '93174668',
  TEMPORADAS: '1174868251'
};

// Cache storage
let cache = {
  data: {},
  lastUpdated: null,
  isFetching: false
};

// Helper: HTTP request following redirects
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

// Robust CSV Parser (RFC 4180 compliant)
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
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      currentCell = '';
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Fetch single sheet by gid
async function fetchSheetData(gid) {
  const url = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=${gid}&single=true&output=csv`;
  const rawCsv = await fetchWithRedirect(url);
  return parseCSV(rawCsv);
}

// Parse Editorial Experiments Tab
function processExperiments(rows) {
  // Find KPIs
  let kpis = {
    total: 0,
    explotaron: 0,
    muyBien: 0,
    regular: 0,
    nacioMuerta: 0,
    tasaExito: '0%'
  };

  if (rows.length > 1) {
    // Row 0 or 1 usually has metrics
    const headerRow = rows[0] || [];
    const valuesRow = rows[1] || [];

    headerRow.forEach((colName, idx) => {
      const val = valuesRow[idx] || '';
      const name = colName.toUpperCase();
      if (name.includes('TOTAL EXPERIMENTOS')) kpis.total = parseInt(val, 10) || 0;
      else if (name.includes('EXPLOTÓ')) kpis.explotaron = parseInt(val, 10) || 0;
      else if (name.includes('MUY BIEN')) kpis.muyBien = parseInt(val, 10) || 0;
      else if (name.includes('REGULAR')) kpis.regular = parseInt(val, 10) || 0;
      else if (name.includes('MUERTA')) kpis.nacioMuerta = parseInt(val, 10) || 0;
      else if (name.includes('ÉXITO')) kpis.tasaExito = val || '0%';
    });
  }

  // Find data start row (look for 'FECHA' and 'ENTIDAD' or 'RENDIMIENTO')
  let headerIndex = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const rowStr = rows[i].join(' ').toUpperCase();
    if (rowStr.includes('FECHA') && (rowStr.includes('ENTIDAD') || rowStr.includes('PATRÓN') || rowStr.includes('RENDIMIENTO'))) {
      headerIndex = i;
      break;
    }
  }

  const experiments = [];
  if (headerIndex !== -1) {
    const headers = rows[headerIndex].map(h => h.trim().toUpperCase());
    
    // Map column indices
    const colMap = {
      fecha: headers.findIndex(h => h.includes('FECHA')),
      entidad: headers.findIndex(h => h.includes('ENTIDAD') || h.includes('NOMBRE ÚNICO')),
      titular: headers.findIndex(h => h.includes('PATRÓN') || h.includes('TITULAR') || h.includes('ESTRUCTURA')),
      tipo: headers.findIndex(h => h.includes('TIPO EXPERIMENTO')),
      categoria: headers.findIndex(h => h.includes('SECCIÓN') || h.includes('CATEGORÍA')),
      url: headers.findIndex(h => h.includes('URL ARTÍCULO') || h === 'URL'),
      marfeel: headers.findIndex(h => h.includes('MARFEEL')),
      rendimiento: headers.findIndex(h => h.includes('RENDIMIENTO')),
      hallazgos: headers.findIndex(h => h.includes('HALLAZGOS') || h.includes('HIPÓTESIS'))
    };

    // If some indices not matched, use standard positional fallback
    if (colMap.fecha === -1) colMap.fecha = 1;
    if (colMap.entidad === -1) colMap.entidad = 2;
    if (colMap.titular === -1) colMap.titular = 3;
    if (colMap.tipo === -1) colMap.tipo = 4;
    if (colMap.categoria === -1) colMap.categoria = 5;
    if (colMap.url === -1) colMap.url = 6;
    if (colMap.marfeel === -1) colMap.marfeel = 7;
    if (colMap.rendimiento === -1) colMap.rendimiento = 8;
    if (colMap.hallazgos === -1) colMap.hallazgos = 9;

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const titular = (row[colMap.titular] || '').trim();
      const entidad = (row[colMap.entidad] || '').trim();
      const rendimiento = (row[colMap.rendimiento] || '').trim();
      const fecha = (row[colMap.fecha] || '').trim();

      // Only add valid experiment rows
      if (titular || entidad || rendimiento) {
        // Standardize status for easy filtering
        let normalizedStatus = 'regular';
        const rendUpper = rendimiento.toUpperCase();
        if (rendUpper.includes('EXPLOTÓ') || rendUpper.includes('EXPLOTO')) {
          normalizedStatus = 'exploto';
        } else if (rendUpper.includes('MUY BIEN')) {
          normalizedStatus = 'muy_bien';
        } else if (rendUpper.includes('DECENTE') || rendUpper.includes('REGULAR')) {
          normalizedStatus = 'regular';
        } else if (rendUpper.includes('MUERTA')) {
          normalizedStatus = 'muerta';
        }

        experiments.push({
          id: i - headerIndex,
          fecha: fecha,
          entidad: entidad || 'Sin Entidad',
          titular: titular || '(Sin titular registrado)',
          tipo: (row[colMap.tipo] || 'No especificado').trim(),
          categoria: (row[colMap.categoria] || 'General').trim(),
          url: (row[colMap.url] || '').trim(),
          marfeel: (row[colMap.marfeel] || '').trim(),
          rendimiento: rendimiento || 'No evaluado',
          statusKey: normalizedStatus,
          hallazgos: (row[colMap.hallazgos] || '').trim()
        });
      }
    }
  }

  // Recalculate KPIs if sheet totals were missing or inaccurate
  if (kpis.total === 0 && experiments.length > 0) {
    kpis.total = experiments.length;
    kpis.explotaron = experiments.filter(e => e.statusKey === 'exploto').length;
    kpis.muyBien = experiments.filter(e => e.statusKey === 'muy_bien').length;
    kpis.regular = experiments.filter(e => e.statusKey === 'regular').length;
    kpis.nacioMuerta = experiments.filter(e => e.statusKey === 'muerta').length;
    const exitosas = kpis.explotaron + kpis.muyBien;
    kpis.tasaExito = ((exitosas / kpis.total) * 100).toFixed(1) + '%';
  }

  return { kpis, experiments };
}

// Parse Chefs Directory
function processChefs(rows) {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const rowStr = rows[i].join(' ').toUpperCase();
    if (rowStr.includes('CHEF') || rowStr.includes('CREADOR')) {
      headerIndex = i;
      break;
    }
  }

  const chefs = [];
  if (headerIndex !== -1) {
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const nombre = (row[0] || '').trim();
      if (!nombre || nombre.toUpperCase().includes('TOTAL')) continue;

      chefs.push({
        nombre: nombre,
        canal: (row[1] || '').trim(),
        enlace: (row[2] || '').trim(),
        audiencia: (row[3] || '').trim(),
        ganchos: (row[4] || '').trim(),
        estadoDiscover: (row[5] || '').trim(),
        potencial: (row[6] || '').trim(),
        notasRealizadas: (row[7] || '0').trim(),
        diasPublicacion: (row[8] || '').trim()
      });
    }
  }
  return chefs;
}

// Parse Canine Directory
function processCanine(rows) {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const rowStr = rows[i].join(' ').toUpperCase();
    if (rowStr.includes('EXPERTO') && (rowStr.includes('PERFIL') || rowStr.includes('TIPO'))) {
      headerIndex = i;
      break;
    }
  }

  const experts = [];
  if (headerIndex !== -1) {
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const nombre = (row[0] || '').trim();
      if (!nombre || nombre.toUpperCase().includes('TOTAL')) continue;

      experts.push({
        experto: nombre,
        perfil: (row[1] || '').trim(),
        pais: (row[2] || '').trim(),
        institucion: (row[3] || '').trim(),
        acreditaciones: (row[4] || '').trim(),
        obra: (row[5] || '').trim(),
        impacto: (row[6] || '').trim(),
        areaAutoridad: (row[7] || '').trim(),
        precauciones: (row[8] || '').trim(),
        enlace: (row[9] || '').trim(),
        criterioEditorial: (row[10] || '').trim(),
        estadoDiscover: (row[11] || '').trim(),
        potencial: (row[12] || '').trim(),
        notasRealizadas: (row[13] || '0').trim()
      });
    }
  }
  return experts;
}

// Parse Discover Rules
function processRules(rows) {
  const kpis = {
    picoFinSemana: '+54%',
    sabado: '+34%',
    domingo: '+23%',
    boostNombrePropio: '+20%',
    peorDia: '-19%'
  };

  if (rows.length > 1 && rows[1]) {
    kpis.picoFinSemana = rows[1][0] || '+54%';
    kpis.sabado = rows[1][1] || '+34%';
    kpis.domingo = rows[1][2] || '+23%';
    kpis.boostNombrePropio = rows[1][3] || '+20%';
    kpis.peorDia = rows[1][4] || '-19%';
  }

  let headerIndex = -1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const rowStr = rows[i].join(' ').toUpperCase();
    if (rowStr.includes('BLOQUE') || rowStr.includes('DÍA O REGLA')) {
      headerIndex = i;
      break;
    }
  }

  const rules = [];
  if (headerIndex !== -1) {
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const bloque = (row[0] || '').trim();
      if (!bloque) continue;

      rules.push({
        bloque: bloque,
        impacto: (row[1] || '').trim(),
        prioridad: (row[2] || '').trim(),
        horarioEspana: (row[3] || '').trim(),
        horarioColombia: (row[4] || '').trim(),
        analisis: (row[5] || '').trim(),
        aplicacion: (row[6] || '').trim()
      });
    }
  }

  return { kpis, rules };
}

// Parse Headline Templates
function processTemplates(rows) {
  const templates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] && row[1]) {
      templates.push({
        referente: (row[0] || '').trim(),
        formula: (row[1] || '').trim(),
        gancho: (row[2] || '').trim(),
        diaRecomendado: (row[3] || '').trim()
      });
    }
  }
  return templates;
}

// Load all sheet data
async function refreshAllData() {
  if (cache.isFetching) return;
  cache.isFetching = true;

  try {
    console.log('[Sheets] Sincronizando datos desde Google Sheets...');
    const [expRows, chefRows, canRows, ruleRows, templRows] = await Promise.all([
      fetchSheetData(GIDS.EXPERIMENTOS).catch(err => { console.error('Error experimentos:', err.message); return []; }),
      fetchSheetData(GIDS.CHEFS).catch(err => { console.error('Error chefs:', err.message); return []; }),
      fetchSheetData(GIDS.CANINO).catch(err => { console.error('Error canino:', err.message); return []; }),
      fetchSheetData(GIDS.REGLAS).catch(err => { console.error('Error reglas:', err.message); return []; }),
      fetchSheetData(GIDS.PLANTILLAS).catch(err => { console.error('Error plantillas:', err.message); return []; })
    ]);

    cache.data = {
      experiments: processExperiments(expRows),
      chefs: processChefs(chefRows),
      canine: processCanine(canRows),
      rules: processRules(ruleRows),
      templates: processTemplates(templRows)
    };
    cache.lastUpdated = new Date();
    console.log(`[Sheets] Sincronización exitosa. ${cache.data.experiments.experiments.length} experimentos cargados.`);
  } catch (error) {
    console.error('[Sheets] Error general al actualizar datos:', error);
  } finally {
    cache.isFetching = false;
  }
}

// ==========================================
// SISTEMA ANTI-INACTIVIDAD / KEEP-ALIVE
// ==========================================
const keepAliveState = {
  enabled: true,
  intervalMinutes: 10,
  targetUrl: process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '',
  lastPingTime: null,
  lastPingStatus: null,
  totalPings: 0,
  history: []
};

function performSelfPing() {
  const urlToPing = keepAliveState.targetUrl || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/api/health` : '');
  
  if (!urlToPing) {
    console.log('[Keep-Alive] Modo local: Auto-ping en espera de URL externa (En Render se detecta automáticamente).');
    return;
  }

  const cleanUrl = urlToPing.endsWith('/api/health') ? urlToPing : `${urlToPing.replace(/\/$/, '')}/api/health`;
  const startTime = Date.now();
  const client = cleanUrl.startsWith('https:') ? https : http;

  client.get(cleanUrl, (res) => {
    const duration = Date.now() - startTime;
    keepAliveState.totalPings++;
    keepAliveState.lastPingTime = new Date();
    keepAliveState.lastPingStatus = `HTTP ${res.statusCode} (${duration}ms)`;

    const record = {
      timestamp: new Date().toISOString(),
      url: cleanUrl,
      status: res.statusCode,
      durationMs: duration,
      success: res.statusCode === 200
    };
    keepAliveState.history.unshift(record);
    if (keepAliveState.history.length > 20) keepAliveState.history.pop();

    console.log(`[Keep-Alive] Ping enviado a ${cleanUrl} -> ${res.statusCode} en ${duration}ms`);
  }).on('error', (err) => {
    console.error(`[Keep-Alive] Error en auto-ping a ${cleanUrl}:`, err.message);
    keepAliveState.lastPingStatus = `Error: ${err.message}`;
    keepAliveState.history.unshift({
      timestamp: new Date().toISOString(),
      url: cleanUrl,
      status: 'ERROR',
      error: err.message,
      success: false
    });
    if (keepAliveState.history.length > 20) keepAliveState.history.pop();
  });
}

// Iniciar intervalo de auto-ping cada 10 minutos (Render suspende a los 15 min)
const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000;
setInterval(() => {
  if (keepAliveState.enabled) {
    performSelfPing();
  }
}, KEEP_ALIVE_INTERVAL);

// ==========================================
// RUTAS Y ENDPOINTS DE LA API
// ==========================================

// Endpoint ligero de healthcheck y keep-alive
app.get(['/api/health', '/health', '/ping'], (req, res) => {
  res.json({
    status: 'ok',
    message: 'Servicio activo y en ejecución',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    keepAliveActive: keepAliveState.enabled
  });
});

// Obtener todas las notas experimentales y sus KPIs
app.get('/api/experiments', async (req, res) => {
  if (!cache.lastUpdated) {
    await refreshAllData();
  }
  res.json({
    success: true,
    lastUpdated: cache.lastUpdated,
    ...cache.data.experiments
  });
});

// Obtener Directorio Chefs
app.get('/api/chefs', async (req, res) => {
  if (!cache.lastUpdated) await refreshAllData();
  res.json({
    success: true,
    lastUpdated: cache.lastUpdated,
    chefs: cache.data.chefs || []
  });
});

// Obtener Directorio Canino
app.get('/api/canine', async (req, res) => {
  if (!cache.lastUpdated) await refreshAllData();
  res.json({
    success: true,
    lastUpdated: cache.lastUpdated,
    experts: cache.data.canine || []
  });
});

// Obtener Reglas Discover
app.get('/api/rules', async (req, res) => {
  if (!cache.lastUpdated) await refreshAllData();
  res.json({
    success: true,
    lastUpdated: cache.lastUpdated,
    ...cache.data.rules
  });
});

// Obtener Plantillas de Titulares
app.get('/api/templates', async (req, res) => {
  if (!cache.lastUpdated) await refreshAllData();
  res.json({
    success: true,
    lastUpdated: cache.lastUpdated,
    templates: cache.data.templates || []
  });
});

// Forzar refresco manual desde Google Sheets
app.post('/api/refresh', async (req, res) => {
  try {
    await refreshAllData();
    res.json({
      success: true,
      message: 'Datos actualizados desde Google Sheets',
      lastUpdated: cache.lastUpdated,
      totalExperiments: (cache.data.experiments && cache.data.experiments.experiments) ? cache.data.experiments.experiments.length : 0
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener estado del Keep-Alive
app.get('/api/keepalive', (req, res) => {
  res.json({
    ...keepAliveState,
    renderUrlDetected: process.env.RENDER_EXTERNAL_URL || null,
    uptimeMinutes: Math.floor(process.uptime() / 60)
  });
});

// Configurar URL del Keep-Alive manualmente si se desea
app.post('/api/keepalive', (req, res) => {
  const { targetUrl, enabled } = req.body;
  if (typeof enabled === 'boolean') keepAliveState.enabled = enabled;
  if (typeof targetUrl === 'string') {
    keepAliveState.targetUrl = targetUrl.trim();
  }
  // Ejecutar un ping inmediato de prueba si se proporciona URL
  if (keepAliveState.targetUrl) {
    setTimeout(performSelfPing, 500);
  }
  res.json({
    success: true,
    message: 'Configuración de Keep-Alive guardada',
    state: keepAliveState
  });
});

// Página principal SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Servidor de Notas Experimentales corriendo en el puerto ${PORT}`);
  console.log(`🌐 URL Local: http://localhost:${PORT}`);
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`🌐 Render URL detectada: ${process.env.RENDER_EXTERNAL_URL}`);
  }
  console.log(`=======================================================`);
  
  // Carga inicial de datos
  await refreshAllData();
  
  // Realizar primer ping de prueba si está configurado
  if (keepAliveState.targetUrl) {
    setTimeout(performSelfPing, 3000);
  }
});
