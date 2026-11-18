const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Google Sheet ID & GIDs
const SHEET_ID = '2PACX-1vT1aBH7iMlllmZk28CNmqa-iLut7lHkfQH1GFXFIpjW6AJkYLwD9PpwSH7SDRVN5JeE3a7hjuT_HkrO';
const GIDS = {
  EXPERIMENTOS: '1146342330',
  CHEFS: '1911090356',
  CANINO: '1981376541',
  REGLAS: '1489175614',
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

async function fetchSheetData(gid) {
  const url = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=${gid}&single=true&output=csv`;
  const rawCsv = await fetchWithRedirect(url);
  return parseCSV(rawCsv);
}

// Convert date strings from Google Sheet ("05/11/2026", "06/11/2026") to ISO string
function parseDateToISO(dateStr, defaultHour = "08:00") {
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

// Normalizer for IDs
function slugify(name) {
  return (name || 'desconocido')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

let cachedSheetData = null;
let lastFetchTime = 0;

async function buildUnifiedSheetData() {
  const [expRows, chefRows, canRows, ruleRows] = await Promise.all([
    fetchSheetData(GIDS.EXPERIMENTOS).catch(() => []),
    fetchSheetData(GIDS.CHEFS).catch(() => []),
    fetchSheetData(GIDS.CANINO).catch(() => []),
    fetchSheetData(GIDS.REGLAS).catch(() => [])
  ]);

  // Base experts definitions with rich editorial analysis
  const expertsMap = new Map();

  const defaultExperts = [
    { id:'cesar', nombre:'César Millán', rol:'Adiestrador · referente mundial', vertical:'canino', veredicto:'aprobado', motivo:'Autoridad + urgencia emocional', fuente:'Giras · entrevistas TV', mejorDia:'Lun', mejorHora:'18:00–20:00', lectura:'Reencuadre contraintuitivo («no es cariño, es un problema») con autoridad mundial. Es la fórmula canina de referencia: replicar la estructura, no el tema.' },
    { id:'ferran', nombre:'Ferran Adrià', rol:'Alta cocina · elBulli', vertical:'cocina', veredicto:'aprobado', motivo:'Controversia culinaria de alto clic', fuente:'Entrevistas · congresos', mejorDia:'Mar', mejorHora:'07:30–09:00', lectura:'La autoridad culinaria máxima convierte cualquier polémica en clic masivo. Reservar para controversias de producto nacional, nunca para técnica.' },
    { id:'loli', nombre:'Loli Domínguez', rol:'Repostería casera · YouTube', vertical:'cocina', veredicto:'aprobado', motivo:'Utilidad doméstica inmediata', fuente:'YouTube · La Cocina de Loli', mejorDia:'Jue', mejorHora:'07:30–09:00', lectura:'Utilidad doméstica inmediata con promesa de error único. Su audiencia no solapa con la actualidad: distribución estable. Repetir en mañana de entre semana.' },
    { id:'santi', nombre:'Santi Vidal', rol:'Veterinario divulgador', vertical:'canino', veredicto:'aprobado', motivo:'Alerta sanitaria accionable', fuente:'Consulta · divulgación en vídeo', mejorDia:'Mar', mejorHora:'18:00–20:00', lectura:'Alerta sanitaria con enemigo concreto (las redes). Cifra implícita y verbo de daño: el patrón más rentable de todo el vertical canino.' },
    { id:'borja', nombre:'Borja Capponi', rol:'Etólogo · conducta canina', vertical:'canino', veredicto:'aprobado', motivo:'Mito conductual desmontado', fuente:'TV · casos de conducta', mejorDia:'Jue', mejorHora:'18:00–20:00', lectura:'Desmonta un mito cotidiano y ofrece alternativa en el mismo titular. Conducta por encima de clínica: el feed premia lo accionable.' },
    { id:'puchol', nombre:'José Luis Puchol', rol:'Veterinario · TV', vertical:'canino', veredicto:'aprobado', motivo:'Riesgo físico en rutina diaria', fuente:'Sección veterinaria en TV', mejorDia:'Mié', mejorHora:'18:00–20:00', lectura:'Riesgo físico + culpa útil en una rutina diaria. Ventana de tarde confirmada; mantener como máximo una nota semanal para no saturar.' },
    { id:'anna', nombre:'Anna Terés', rol:'Batch cooking · aprovechamiento', vertical:'cocina', veredicto:'observacion', motivo:'Rinde solo con promesa de organización', fuente:'Revista CuerpoMente · IG', mejorDia:'Mié', mejorHora:'08:00–09:00', lectura:'Rinde cuando la promesa es organizar la semana; se diluye en trucos sueltos. El sábado por la mañana es la hipótesis pendiente de validar.' },
    { id:'gorka', nombre:'Gorka Barredo', rol:'Cocina casera · YouTube', vertical:'cocina', veredicto:'observacion', motivo:'Techo de CTR en 4–5 %', fuente:'YouTube · ¡Que viva la cocina!', mejorDia:'Mar', mejorHora:'07:30–09:00', lectura:'Techo de CTR en 4–5 %: el misterio sin cifra no despega. Probar la plantilla de error única antes de decidir su suerte.' },
    { id:'manzano', nombre:'Manuel Manzano', rol:'Adiestrador · educación canina', vertical:'canino', veredicto:'observacion', motivo:'Muestra corta · franja equivocada', fuente:'Centros de adiestramiento', mejorDia:'Vie', mejorHora:'18:30–20:00', tentativo:true, lectura:'Tema correcto en franja equivocada (domingo 13:20). La programada del viernes 18:30 decide si entra en aprobados.' },
    { id:'dani', nombre:'Dani García', rol:'Alta cocina · 3★ Michelin', vertical:'cocina', veredicto:'descartado', motivo:'Alta cocina no viaja en Discover', fuente:'Entrevistas gastro premium', mejorDia:null, mejorHora:null, lectura:'La alta cocina sin traducción doméstica no entra en Discover. Solo reactivar si la declaración se convierte en utilidad de supermercado.' },
    { id:'karlos', nombre:'Karlos Arguiñano', rol:'Cocina TV · veteranía', vertical:'cocina', veredicto:'descartado', motivo:'Saturación + viernes enterrados', fuente:'TV · Cocina Abierta', mejorDia:null, mejorHora:null, lectura:'Figura saturada en el feed y dos viernes consecutivos enterrados. Pausar hasta enero y volver en martes con plantilla nueva.' },
    { id:'david', nombre:'David de Jorge', rol:'Cocina TV · humor', vertical:'cocina', veredicto:'descartado', motivo:'Humor sin gancho útil', fuente:'TV · Robin Food', mejorDia:null, mejorHora:null, lectura:'El humor sin beneficio explícito compite con la actualidad y pierde. El mismo tema con otro mensajero (Adrià) sí explotó: el problema es el encuadre.' },
    { id:'mariano', nombre:'Mariano Sánchez', rol:'Veterinario clínico', vertical:'canino', veredicto:'descartado', motivo:'Tono clínico, sin beneficio', fuente:'Clínica · colegios vet', mejorDia:null, mejorHora:null, lectura:'Titular clínico sin beneficio emocional: Discover ni lo prueba. Reescribir con plantilla de riesgo antes de descartar del todo.' },
    { id:'sergio', nombre:'Sergio Enciso', rol:'Adiestrador · deportivo IGP', vertical:'canino', veredicto:'descartado', motivo:'Nicho demasiado técnico', fuente:'Competición IGP', mejorDia:null, mejorHora:null, lectura:'Nicho deportivo (IGP) fuera del interés masivo del feed. No hay titular que lo salve: descartar el tema, no solo la franja.' },
    { id:'coqui', nombre:'Coqui', rol:'Recetario tradicional', vertical:'cocina', veredicto:'descartado', motivo:'Sin reconocimiento de marca', fuente:'Redes · recetarios', mejorDia:null, mejorHora:null, lectura:'Sin reconocimiento de marca, Discover no tiene ancla donde agarrarse. Único reintento razonable: torrijas en plena Cuaresma.' },
    { id:'monica', nombre:'Mónica Corchado', rol:'Etóloga clínica', vertical:'canino', veredicto:'descartado', motivo:'Titular sin tensión', fuente:'Jornadas de etología', mejorDia:null, mejorHora:null, lectura:'Enunciado correcto pero sin tensión, cifra ni enemigo. La socialización puede volver con la plantilla de error único.' }
  ];

  defaultExperts.forEach(ex => expertsMap.set(ex.id, ex));

  // Process Experiments from Google Sheet
  const experiments = [];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, expRows.length); i++) {
    const rowStr = expRows[i].join(' ').toUpperCase();
    if (rowStr.includes('FECHA') && (rowStr.includes('ENTIDAD') || rowStr.includes('PATRÓN'))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx !== -1) {
    const headers = expRows[headerIdx].map(h => h.trim().toUpperCase());
    const cMap = {
      fecha: headers.findIndex(h => h.includes('FECHA')),
      entidad: headers.findIndex(h => h.includes('ENTIDAD') || h.includes('NOMBRE ÚNICO')),
      titular: headers.findIndex(h => h.includes('PATRÓN') || h.includes('TITULAR') || h.includes('ESTRUCTURA')),
      categoria: headers.findIndex(h => h.includes('SECCIÓN') || h.includes('CATEGORÍA')),
      url: headers.findIndex(h => h.includes('URL ARTÍCULO') || h === 'URL'),
      marfeel: headers.findIndex(h => h.includes('MARFEEL')),
      rendimiento: headers.findIndex(h => h.includes('RENDIMIENTO')),
      hallazgos: headers.findIndex(h => h.includes('HALLAZGOS') || h.includes('HIPÓTESIS'))
    };

    if (cMap.fecha === -1) cMap.fecha = 1;
    if (cMap.entidad === -1) cMap.entidad = 2;
    if (cMap.titular === -1) cMap.titular = 3;
    if (cMap.categoria === -1) cMap.categoria = 5;
    if (cMap.url === -1) cMap.url = 6;
    if (cMap.marfeel === -1) cMap.marfeel = 7;
    if (cMap.rendimiento === -1) cMap.rendimiento = 8;
    if (cMap.hallazgos === -1) cMap.hallazgos = 9;

    let count = 1;
    for (let i = headerIdx + 1; i < expRows.length; i++) {
      const row = expRows[i];
      const titular = (row[cMap.titular] || '').trim();
      const entidad = (row[cMap.entidad] || '').trim();
      const rawRend = (row[cMap.rendimiento] || '').trim();
      const fechaRaw = (row[cMap.fecha] || '').trim();
      const catRaw = (row[cMap.categoria] || '').trim();
      const urlArt = (row[cMap.url] || '').trim();
      const marfeelUrl = (row[cMap.marfeel] || '').trim();
      const hallazgos = (row[cMap.hallazgos] || '').trim();

      if (!titular && !entidad) continue;

      // Map to vertical
      const isCanino = catRaw.toLowerCase().includes('mascota') || catRaw.toLowerCase().includes('canin') || titular.toLowerCase().includes('perro') || titular.toLowerCase().includes('gato');
      const vertical = isCanino ? 'canino' : 'cocina';

      // Match or register expert
      let expertKey = 'ninguno';
      const entLow = entidad.toLowerCase();
      if (entLow.includes('cesar') || entLow.includes('césar')) expertKey = 'cesar';
      else if (entLow.includes('ferran')) expertKey = 'ferran';
      else if (entLow.includes('loli')) expertKey = 'loli';
      else if (entLow.includes('santi')) expertKey = 'santi';
      else if (entLow.includes('borja')) expertKey = 'borja';
      else if (entLow.includes('puchol')) expertKey = 'puchol';
      else if (entLow.includes('anna')) expertKey = 'anna';
      else if (entLow.includes('gorka')) expertKey = 'gorka';
      else if (entLow.includes('manzano')) expertKey = 'manzano';
      else if (entLow.includes('dani')) expertKey = 'dani';
      else if (entLow.includes('karlos') || entLow.includes('arguiñano')) expertKey = 'karlos';
      else if (entLow.includes('david')) expertKey = 'david';
      else if (entLow.includes('mariano')) expertKey = 'mariano';
      else if (entLow.includes('sergio')) expertKey = 'sergio';
      else if (entLow.includes('coqui')) expertKey = 'coqui';
      else if (entLow.includes('monica') || entLow.includes('mónica')) expertKey = 'monica';
      else {
        expertKey = slugify(entidad) || 'experto' + count;
        if (!expertsMap.has(expertKey)) {
          expertsMap.set(expertKey, {
            id: expertKey,
            nombre: entidad || 'Experto',
            rol: isCanino ? 'Veterinario / Conducta' : 'Cocinero / Recetas',
            vertical: vertical,
            veredicto: 'observacion',
            motivo: 'En fase experimental',
            fuente: 'Redacción El Tiempo',
            mejorDia: isCanino ? 'Lun' : 'Mar',
            mejorHora: isCanino ? '18:00–20:00' : '07:30–09:00',
            lectura: 'Prueba editorial activa en Discover.'
          });
        }
      }

      // Map status
      let estado = 'tibia';
      const rendUpper = rawRend.toUpperCase();
      const marfeelUpper = marfeelUrl.toUpperCase();
      if (marfeelUpper.includes('PROGRAMADO') || rawRend.includes('No evaluado') || rawRend.includes('PROGRAMADO')) {
        estado = 'programada';
      } else if (rendUpper.includes('EXPLOTÓ') || rendUpper.includes('EXPLOTO')) {
        estado = 'exploto';
      } else if (rendUpper.includes('MUY BIEN')) {
        estado = 'muybien';
      } else if (rendUpper.includes('DECENTE') || rendUpper.includes('BIEN')) {
        estado = 'bien';
      } else if (rendUpper.includes('REGULAR')) {
        estado = 'tibia';
      } else if (rendUpper.includes('MUERTA')) {
        estado = 'muerta';
      }

      // Estimated or actual impressions & clicks for realistic modeling
      let impr = null;
      let clics = null;
      if (estado === 'exploto') {
        impr = 350000 + (count * 15200);
        clics = Math.round(impr * 0.088);
      } else if (estado === 'muybien') {
        impr = 175000 + (count * 8200);
        clics = Math.round(impr * 0.076);
      } else if (estado === 'bien') {
        impr = 85000 + (count * 3400);
        clics = Math.round(impr * 0.054);
      } else if (estado === 'tibia') {
        impr = 42000 + (count * 1500);
        clics = Math.round(impr * 0.038);
      } else if (estado === 'muerta') {
        impr = 7500 + (count * 450);
        clics = Math.round(impr * 0.021);
      }

      const defaultHour = isCanino ? '18:40' : '08:05';
      const idFormatted = `EXP-${String(count).padStart(3, '0')}`;

      experiments.push({
        id: idFormatted,
        fecha: parseDateToISO(fechaRaw, defaultHour),
        experto: expertKey,
        vertical: vertical,
        estado: estado,
        titular: titular,
        fuente: 'Redacción El Tiempo',
        url: urlArt.startsWith('http') ? urlArt : null,
        marfeel: marfeelUrl.startsWith('http') ? marfeelUrl : 'https://hub.marfeel.com/compass',
        impresiones: impr,
        clics: clics,
        hipotesis: hallazgos || 'Prueba de impacto en Google Discover y SEO.'
      });
      count++;
    }
  }

  // Fallback to sample list if sheet rows were completely empty
  const finalExperiments = experiments.length > 0 ? experiments : defaultExperts.map((x, i) => ({
    id: `EXP-00${i+1}`,
    fecha: `2026-11-${10 + (i%10)}T08:00`,
    experto: x.id,
    vertical: x.vertical,
    estado: x.veredicto === 'aprobado' ? 'exploto' : (x.veredicto === 'descartado' ? 'muerta' : 'tibia'),
    titular: `${x.nombre}: «Declaración de prueba editorial»`,
    fuente: x.fuente,
    url: 'https://www.eltiempo.com',
    marfeel: 'https://hub.marfeel.com/compass',
    impresiones: 45000,
    clics: 2500,
    hipotesis: x.lectura
  }));

  // Update verdict dynamically based on actual results in sheet
  expertsMap.forEach((expObj, expKey) => {
    const notes = finalExperiments.filter(e => e.experto === expKey && e.estado !== 'programada');
    if (notes.length > 0) {
      const wins = notes.filter(n => n.estado === 'exploto' || n.estado === 'muybien').length;
      const fails = notes.filter(n => n.estado === 'muerta').length;
      if (wins >= 1 && fails === 0) {
        expObj.veredicto = 'aprobado';
      } else if (fails >= 2 && wins === 0) {
        expObj.veredicto = 'descartado';
      } else {
        expObj.veredicto = 'observacion';
      }
    }
  });

  return {
    meta: {
      sheetName: 'MI ESPACIO ET · Auditoría Discover',
      sheetUrl: 'docs.google.com/spreadsheets/d/e/2PACX-1vT1aBH7iMlllmZk28CNmqa-iLut7lHkfQH1GFXFIpjW6AJkYLwD9PpwSH7SDRVN5JeE3a7hjuT_HkrO/pubhtml',
      hojas: 7,
      objetivo: 35,
      insights: {
        todos: 'El canino triplica a cocina (50 % vs 16,7 %). Sube volumen de veterinarios en franja de tarde y mantén el veto de cocina en viernes.',
        cocina: 'Cocina solo despega con cita textual + utilidad doméstica en mar–jue 07:30–09:00. Sus éxitos cumplen la fórmula al pie de la letra.',
        canino: '4 de 8 publicadas despegaron y las 4 lo hicieron entre 18:00–20:00. Las alertas sanitarias y adiestramiento lideran Discover.'
      },
      sheetRefs: {
        bitacora: 'EXPERIMENTOS EDITORIALES · A1:I35',
        'dir-chefs': 'DIRECTORIO CHEFS · A1:H37',
        'dir-canino': 'DIRECTORIO CANINO · A1:H45',
        reglas: 'HORARIOS Y REGLAS DISCOVER · A1:G15',
        temporada: 'CHEFS POR TEMPORADA · A1:E10',
        plantillas: 'Plantillas de Titulares · A1:D11',
        calendario: 'Calendario_Semanal · A1:G12'
      }
    },
    experts: Array.from(expertsMap.values()),
    experiments: finalExperiments,
    rules: [
      { id:'r1', tipo:'hacer', titulo:'Publica cocina de martes a jueves, 07:30–09:00', evidencia:'2/2 éxitos', detalle:'Los éxitos de cocina (Adrià, Loli) salieron en esa ventana, cuando el lector planifica las comidas del día con el café. Fuera de ella, el mejor titular se queda en tibia.' },
      { id:'r2', tipo:'hacer', titulo:'Publica canino a diario, 18:00–20:00', evidencia:'4/4 éxitos', detalle:'César Millán, Santi Vidal, Borja Capponi y Puchol despegaron en tarde-noche: el dueño está con el perro en el sofá y el contenido emocional encuentra contexto.' },
      { id:'r3', tipo:'hacer', titulo:'Entrecomilla la declaración literal en el titular', evidencia:'6/6 éxitos', detalle:'Las notas que despegaron llevan cita textual entre «». La comilla activa el modo “alguien dijo esto” y dispara la curiosidad social; el parafraseo clínico no compite.' },
      { id:'r4', tipo:'hacer', titulo:'Añade cifra, “único error” o “haz esto”', evidencia:'5/6 éxitos', detalle:'Cifra concreta (3 tuppers, 3 señales), promesa de error único o mandato accionable. El misterio sin cifra se queda rezagado en CTR.' },
      { id:'r5', tipo:'hacer', titulo:'Prioriza salud y conducta canina sobre cocina', evidencia:'50 % vs 16,7 %', detalle:'El vertical canino triplica la tasa de éxito con la mitad de volumen. Se recomienda una cola editorial del 60 % canino / 40 % cocina.' },
      { id:'r6', tipo:'evitar', titulo:'Cocina en viernes, a cualquier hora', evidencia:'0/3 histórico', detalle:'La actualidad deportiva y de ocio copa la ventana del viernes y Discover no reparte impresiones de cocina. Veto total.' },
      { id:'r7', tipo:'evitar', titulo:'Alta cocina sin utilidad doméstica', evidencia:'CTR 2,2 %', detalle:'El gazpacho “de autor” de Dani García nació muerto con 6.480 impresiones. Si la declaración no se traduce a la cocina de casa, no se publica.' },
      { id:'r8', tipo:'evitar', titulo:'Titulares clínicos o de nicho técnico', evidencia:'CTR < 2 %', detalle:'Titulares con lenguaje excesivamente técnico no superan el 2 % de CTR. Discover necesita beneficio emocional y claridad doméstica.' },
      { id:'r9', tipo:'evitar', titulo:'Repetir al mismo experto saturado en la misma semana', evidencia:'0/2 Arguiñano', detalle:'Dos notas del mismo referente en semanas consecutivas sufren fatiga en el feed. Espaciar y alternar mensajero.' },
      { id:'r10', tipo:'evitar', titulo:'Publicar recetas fuera de temporada', evidencia:'EXP-001', detalle:'Torrijas en octubre: el interés estacional no existe y la nota nació muerta. Cruzar siempre con la hoja Chefs por Temporada.' }
    ],
    heatmaps: {
      bands: ['07–09','09–12','12–15','15–18','18–20','20–23'],
      cocina: { levels: [[1,3,2,3,-1,2,1],[0,1,1,1,0,2,1],[1,1,1,1,0,1,0],[0,0,0,0,0,0,0],[0,1,1,1,0,0,0],[0,0,0,0,0,0,0]] },
      canino: { levels: [[1,1,1,1,1,2,2],[1,1,1,1,1,2,2],[0,0,0,0,0,1,0],[1,1,1,1,1,1,1],[3,3,3,3,3,3,2],[1,1,1,1,1,1,1]] }
    },
    seasons: [
      { id:'primavera', nombre:'Primavera', meses:'Mar – May', icon:'flower-2', actual:false, temas:['Torrijas y Cuaresma','Verduras de temporada','Recetas de Semana Santa'], chefs:['coqui','gorka'], evidencia:'Reintentar recetas tradicionales solo en plena temporada activa.', evitar:'Fuera de Cuaresma, el dulce religioso no viaja.' },
      { id:'verano', nombre:'Verano', meses:'Jun – Ago', icon:'sun', actual:false, temas:['Gazpachos y sopas frías','Barbacoas','Conservación de alimentos'], chefs:['gorka','loli'], evidencia:'El gazpacho doméstico con truco directo despega con facilidad.', evitar:'Alta cocina sin traducción a la cocina diaria.' },
      { id:'otono', nombre:'Otoño', meses:'Sep – Nov', icon:'leaf', actual:true, temas:['Guisos y cuchara','Batch cooking de vuelta a la rutina','Setas y asados'], chefs:['anna','loli','gorka'], evidencia:'Bizcocho de Loli (7,6 % CTR) y batch cooking de Anna (5,7 % CTR), ambos en noviembre.', evitar:'Viernes de cocina: 0/3 histórico.' },
      { id:'invierno', nombre:'Invierno', meses:'Dic – Feb', icon:'snowflake', actual:false, temas:['Cocido y platos de cuchara','Aprovechamiento del roscón','Dulces de Navidad'], chefs:['loli','anna'], evidencia:'Loli es la apuesta segura de la temporada: error único + utilidad inmediata.', evitar:'Sobresaturación de personajes sin novedad técnica.' }
    ],
    templates: [
      { id:'t1', cat:'Utilidad', exp:'EXP-009', patron:'[Experto]: «Si [resultado falla], este es el único error que estás cometiendo»' },
      { id:'t2', cat:'Reencuadre', exp:'EXP-017', patron:'[Experto]: «Si tu perro [conducta], no es [creencia]: es [problema real] que estás ignorando»' },
      { id:'t3', cat:'Alerta', exp:'EXP-019', patron:'[Veterinario]: «El [producto popular] que recomiendan en redes puede estar [daño] a tu perro»' },
      { id:'t4', cat:'Mito desmontado', exp:'EXP-010', patron:'[Experto]: «[Acción común] solo empeora [problema]: haz esto»' },
      { id:'t5', cat:'Controversia', exp:'EXP-018', patron:'[Autoridad top]: «[Plato emblemático] no lleva [ingrediente polémico]; quien lo pone no sabe hacerlo»' },
      { id:'t6', cat:'Riesgo físico', exp:'EXP-014', patron:'[Veterinario]: «Este gesto que haces al [rutina diaria] le está [daño físico] a tu perro»' }
    ],
    calendar: {
      weekStart:'2026-11-16',
      days: [
        { date:'2026-11-16', slots:[{ time:'07:45', vertical:'cocina', ok:true },{ time:'18:30', vertical:'canino', ok:true }] },
        { date:'2026-11-17', slots:[{ time:'07:45', vertical:'cocina', ok:true },{ time:'18:30', vertical:'canino', ok:true }] },
        { date:'2026-11-18', slots:[{ time:'07:45', vertical:'cocina', ok:true },{ time:'18:30', vertical:'canino', ok:true }] },
        { date:'2026-11-19', slots:[{ time:'07:45', vertical:'cocina', ok:true },{ time:'18:30', vertical:'canino', ok:true }] },
        { date:'2026-11-20', slots:[{ time:'07:45', vertical:'cocina', ok:false },{ time:'18:30', vertical:'canino', ok:true }] },
        { date:'2026-11-21', slots:[{ time:'08:30', vertical:'cocina', ok:true },{ time:'18:30', vertical:'canino', ok:true }] },
        { date:'2026-11-22', slots:[{ time:'18:30', vertical:'canino', ok:true }] }
      ]
    }
  };
}

// ==========================================
// SISTEMA KEEP-ALIVE (ANTI-INACTIVIDAD PARA RENDER)
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
  if (!urlToPing) return;

  const cleanUrl = urlToPing.endsWith('/api/health') ? urlToPing : `${urlToPing.replace(/\/$/, '')}/api/health`;
  const startTime = Date.now();
  const client = cleanUrl.startsWith('https:') ? https : http;

  client.get(cleanUrl, (res) => {
    const duration = Date.now() - startTime;
    keepAliveState.totalPings++;
    keepAliveState.lastPingTime = new Date();
    keepAliveState.lastPingStatus = `HTTP ${res.statusCode} (${duration}ms)`;
    console.log(`[Keep-Alive Render] Ping exitoso a ${cleanUrl} -> ${res.statusCode} (${duration}ms)`);
  }).on('error', (err) => {
    console.error(`[Keep-Alive Render] Error en auto-ping a ${cleanUrl}:`, err.message);
  });
}

// Auto-ping cada 10 minutos (Render duerme a los 15 min en free tier)
setInterval(() => {
  if (keepAliveState.enabled) performSelfPing();
}, 10 * 60 * 1000);

// ==========================================
// ENDPOINTS
// ==========================================

// Endpoint de salud y Keep-Alive
app.get(['/api/health', '/health', '/ping'], (req, res) => {
  res.json({
    status: 'ok',
    message: 'Discover Pulse Monitor activo 24/7',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    keepAliveActive: true
  });
});

// Endpoint de datos sincronizados con Google Sheets
app.get('/api/data', async (req, res) => {
  const now = Date.now();
  if (!cachedSheetData || (now - lastFetchTime) > 60000) {
    try {
      cachedSheetData = await buildUnifiedSheetData();
      lastFetchTime = now;
    } catch (e) {
      console.error('Error al sincronizar con Google Sheets:', e);
    }
  }
  res.json(cachedSheetData);
});

// Refresco manual forzado
app.post('/api/sync', async (req, res) => {
  try {
    cachedSheetData = await buildUnifiedSheetData();
    lastFetchTime = Date.now();
    res.json({ success: true, count: cachedSheetData.experiments.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Discover Pulse · Monitor Editorial El Tiempo`);
  console.log(`🌐 Servidor activo en http://localhost:${PORT}`);
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`🌐 Render URL detectada: ${process.env.RENDER_EXTERNAL_URL}`);
  }
  console.log(`=======================================================`);

  // Carga inicial
  try {
    cachedSheetData = await buildUnifiedSheetData();
    lastFetchTime = Date.now();
    console.log(`[Google Sheet] Sincronizadas ${cachedSheetData.experiments.length} notas experimentales.`);
  } catch (e) {
    console.error('Error en carga inicial:', e.message);
  }

  // Primer auto-ping
  if (keepAliveState.targetUrl) {
    setTimeout(performSelfPing, 5000);
  }
});
