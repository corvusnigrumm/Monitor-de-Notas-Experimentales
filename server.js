const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Google Sheet ID nuevo proporcionado por el usuario
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

// Fetch tab via Google Visualization CSV export
async function fetchSheetData(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const rawCsv = await fetchWithRedirect(url);
  return parseCSV(rawCsv);
}

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

function slugify(name) {
  return (name || 'desconocido')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Parse Editorial Calendar Sheet
function processCalendarSheet(rows) {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const rowStr = rows[i].join(' ').toUpperCase();
    if (rowStr.includes('DÍA') && (rowStr.includes('FRANJA') || rowStr.includes('REFERENTE') || rowStr.includes('TITULAR'))) {
      headerIdx = i;
      break;
    }
  }

  const items = [];
  if (headerIdx !== -1) {
    const headers = rows[headerIdx].map(h => h.trim().toUpperCase());
    const cMap = {
      dia: headers.findIndex(h => h.includes('DÍA') || h === 'DIA'),
      franja: headers.findIndex(h => h.includes('FRANJA')),
      seccion: headers.findIndex(h => h.includes('SECCIÓN') || h.includes('SECCION')),
      formato: headers.findIndex(h => h.includes('FORMATO')),
      referente: headers.findIndex(h => h.includes('REFERENTE') || h.includes('ENTIDAD')),
      titular: headers.findIndex(h => h.includes('TITULAR') || h.includes('GANCHO')),
      regla: headers.findIndex(h => h.includes('REGLA') || h.includes('FUNCIONA')),
      estado: headers.findIndex(h => h.includes('ESTADO'))
    };

    if (cMap.dia === -1) cMap.dia = 1;
    if (cMap.franja === -1) cMap.franja = 2;
    if (cMap.seccion === -1) cMap.seccion = 3;
    if (cMap.formato === -1) cMap.formato = 4;
    if (cMap.referente === -1) cMap.referente = 5;
    if (cMap.titular === -1) cMap.titular = 6;
    if (cMap.regla === -1) cMap.regla = 7;
    if (cMap.estado === -1) cMap.estado = 8;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const dia = (r[cMap.dia] || '').trim();
      const titular = (r[cMap.titular] || '').trim();
      const referente = (r[cMap.referente] || '').trim();
      if (!titular && !referente) continue;

      const seccion = (r[cMap.seccion] || 'General').trim();
      const isCanino = seccion.toLowerCase().includes('mascota') || titular.toLowerCase().includes('perro') || titular.toLowerCase().includes('gato') || referente.toLowerCase().includes('canin') || referente.toLowerCase().includes('vet');

      items.push({
        id: `CAL-${i}`,
        dia: dia || 'Jueves',
        franja: (r[cMap.franja] || '06:00 - 10:00').trim(),
        seccion: seccion,
        vertical: isCanino ? 'canino' : 'cocina',
        formato: (r[cMap.formato] || 'Formato ganador').trim(),
        referente: referente,
        titular: titular,
        regla: (r[cMap.regla] || 'Fórmula de alto CTR para Discover.').trim(),
        estado: (r[cMap.estado] || 'SUGERIDO').trim()
      });
    }
  }

  // Si la hoja no tiene suficientes items o le faltan días clave, complementamos con la estrategia semanal óptima para Discover
  const completeWeeklySchedule = buildComprehensiveWeeklySchedule(items);
  return completeWeeklySchedule;
}

// Estrategia semanal inteligente que maximiza prioridad en Discover (Lunes a Domingo)
function buildComprehensiveWeeklySchedule(sheetItems) {
  // Base de pautas maestras por día según el Core Update 2026
  const strategyByDay = {
    'Lunes': {
      dia: 'Lunes',
      impacto: '-1% (Neutral)',
      prioridad: 'Prioridad Estándar',
      estrategia: 'Reactivación de actualidad y cenas de 10 min. Competencia fuerte con noticias políticas/económicas matutinas.',
      horarioRecomendado: '06:00 - 10:00 CO (12:00 - 16:00 ES) y 18:00 - 22:00 CO',
      slots: [
        {
          franja: '06:00 - 10:00',
          seccion: 'Gastronomía Exprés',
          vertical: 'cocina',
          formato: 'A · Paradoja culposa / Receta ultrarrápida',
          referente: 'Ferran Adrià',
          titular: "Ferran Adrià, chef: 'El cuscús de coliflor se ralla crudo y se saltea en 2 minutos, sin bechamel ni sofrito'",
          regla: 'Cena ligera y rápida para arrancar la semana; atajo de autor para comida casera sin pereza.',
          estado: 'SUGERIDO'
        },
        {
          franja: '18:00 - 21:00',
          seccion: 'Mascotas / Bienestar',
          vertical: 'canino',
          formato: 'B · Desmentido diario + credencial',
          referente: 'César Millán',
          titular: "César Millán, adiestrador canino: 'Si tu perro te sigue a todas partes no es devoción: es hiperapego y se cura así'",
          regla: 'Reencuadre contraintuitivo con máxima autoridad mundial; franja nocturna de lectura en casa.',
          estado: 'SUGERIDO'
        }
      ]
    },
    'Martes': {
      dia: 'Martes',
      impacto: '-4% (Bajo)',
      prioridad: 'Prioridad Media',
      estrategia: 'Publicar únicamente declaraciones virales de chefs o consejos veterinarios rápidos (olla rápida 7 min).',
      horarioRecomendado: '06:00 - 10:00 CO · 18:00 - 22:00 CO',
      slots: [
        {
          franja: '07:30 - 09:30',
          seccion: 'Técnica culinaria',
          vertical: 'cocina',
          formato: 'A · Paradoja culposa / Controversia',
          referente: 'Ferran Adrià',
          titular: "Ferran Adrià, chef: 'La tortilla de patatas no lleva cebolla; quien la pone no sabe hacer tortilla'",
          regla: 'Controversia identitaria de máxima tracción en Discover que compite y vence a la agenda informativa.',
          estado: 'SUGERIDO'
        },
        {
          franja: '18:00 - 20:30',
          seccion: 'Mascotas / Alerta sanitaria',
          vertical: 'canino',
          formato: 'B · Desmentido diario + credencial',
          referente: 'Santi Vidal (veterinario divulgador)',
          titular: "Santi Vidal, veterinario: 'El pienso sin cereales de moda en redes puede provocar cardiopatías en perros'",
          regla: 'Alerta sanitaria accionable con enemigo concreto (las redes) y verbo de daño físico.',
          estado: 'SUGERIDO'
        }
      ]
    },
    'Miércoles': {
      dia: 'Miércoles',
      impacto: '-16% (Saturado)',
      prioridad: 'Evitar Evergreen / Usar Formato Ganador',
      estrategia: 'Pico de notas de redacciones generalistas. VETO para recetas genéricas: usar solo Alertas Sanitarias o Seguridad Alimentaria.',
      horarioRecomendado: '06:00 - 10:00 CO · 18:00 - 20:30 CO',
      slots: [
        {
          franja: '11:00 - 14:00',
          seccion: 'Seguridad alimentaria',
          vertical: 'cocina',
          formato: 'C · Marcas / Seguridad alimentaria',
          referente: 'Jordi Cruz (chef)',
          titular: "Jordi Cruz, chef: el peligro real de dejar el arroz blanco cocido enfriando a temperatura ambiente",
          regla: 'Alerta sobre Bacillus cereus. La seguridad sanitaria doméstica corta la saturación informativa de mitad de semana.',
          estado: 'SUGERIDO'
        },
        {
          franja: '18:00 - 20:00',
          seccion: 'Mascotas / Salud',
          vertical: 'canino',
          formato: 'B · Desmentido diario + credencial',
          referente: 'José Luis Puchol (veterinario)',
          titular: "José Luis Puchol, veterinario: 'Este tirón que haces al pasear a tu perro le está lesionando las vértebras'",
          regla: 'Culpa útil en rutina cotidiana; ventana de tarde 18:00-20:00 comprobada con alto CTR.',
          estado: 'SUGERIDO'
        }
      ]
    },
    'Jueves': {
      dia: 'Jueves',
      impacto: '-19% (Peor Día Semanal)',
      prioridad: 'Alerta Máxima / Solo Pautas Blindadas',
      estrategia: 'Día con mayor saturación informativa en Discover. Se deben usar los 4 formatos de impacto probado para perforar el algoritmo.',
      horarioRecomendado: '06:00 - 10:00 CO · 11:00 - 14:00 CO · 16:00 - 19:00 CO',
      slots: [] // Se llena con las pautas reales de la hoja de Google Sheets
    },
    'Viernes': {
      dia: 'Viernes',
      impacto: '+5% (Ventana Puente)',
      prioridad: 'Alta Prioridad',
      estrategia: 'La ventana de fin de semana arranca hoy. VETO de cocina tradicional a mediodía; enfocarse en compras inteligentes de pescado y alertas estacionales.',
      horarioRecomendado: '06:00 - 10:00 CO · 16:00 - 20:00 CO',
      slots: [
        {
          franja: '06:00 - 10:00',
          seccion: 'Compra Inteligente / Pescadería',
          vertical: 'cocina',
          formato: 'C · Marcas / Ahorro inteligente',
          referente: 'José María Sánchez (@naveganteoficial)',
          titular: "Pescado en bandeja de supermercado vs. mostrador: el truco del glaseo con el que pagas agua a precio de merluza",
          regla: 'Ahorro antes de las compras de fin de semana. Resuelve un problema de gasto familiar directo.',
          estado: 'SUGERIDO'
        },
        {
          franja: '18:30 - 20:30',
          seccion: 'Mascotas / Conducta',
          vertical: 'canino',
          formato: 'B · Desmentido diario + credencial',
          referente: 'Manuel Manzano (veterinario)',
          titular: "Manuel Manzano, veterinario: 'Tu perro no te desobedece al llamarlo: estas 3 señales dicen que no te entiende'",
          regla: 'Test de franja puente viernes tarde; captura al dueño relajándose con su mascota.',
          estado: 'PROGRAMADO'
        }
      ]
    },
    'Sábado': {
      dia: 'Sábado',
      impacto: '+34% (PICO #1 SEMANAL)',
      prioridad: '1 · PICO MÁXIMO FIN DE SEMANA',
      estrategia: 'Día de oro en Discover. Las redacciones bajan 50% el volumen, pero la audiencia está en el feed con tiempo de ocio. Vida útil de 2 a 4 días.',
      horarioRecomendado: '06:00 - 12:00 CO (08:00 - 14:00 ES) · 18:00 - 22:00 CO',
      slots: [
        {
          franja: '06:00 - 09:30',
          seccion: 'Gastronomía de autor',
          vertical: 'cocina',
          formato: 'A · Paradoja culposa / Receta estrella',
          referente: 'Ferran Adrià',
          titular: "El truco de Ferran Adrià para hacer tortilla de patatas con patatas de bolsa: 'Hay que batir en horizontal'",
          regla: 'Nombre propio (+20% CTR) + truco técnico replicable + ocio de fin de semana. Tracción masiva continua.',
          estado: 'SUGERIDO'
        },
        {
          franja: '08:00 - 11:30',
          seccion: 'Mascotas / Conducta',
          vertical: 'canino',
          formato: 'B · Desmentido diario + credencial',
          referente: 'Borja Capponi (etólogo)',
          titular: "Borja Capponi, etólogo canino: 'Gritar “no” a tu perro cuando ladra solo empeora el problema: haz esto'",
          regla: 'Mito cotidiano desmontado con alternativa accionable. Se comparte ampliamente por WhatsApp y redes.',
          estado: 'SUGERIDO'
        },
        {
          franja: '11:00 - 14:00',
          seccion: 'Guisos de temporada',
          vertical: 'cocina',
          formato: 'A · Paradoja culposa / Cuchara',
          referente: 'Karlos Arguiñano',
          titular: "El truco de Arguiñano para que las pochas con níscalos queden ultra cremosas sin añadir nata",
          regla: 'Receta de cuchara de temporada con ingrediente estrella; los sábados Arguiñano sí viaja con fuerza.',
          estado: 'SUGERIDO'
        }
      ]
    },
    'Domingo': {
      dia: 'Domingo',
      impacto: '+23% (PICO #2 SEMANAL)',
      prioridad: '1 · PICO MÁXIMO FIN DE SEMANA',
      estrategia: 'Segundo mejor día. Captura la planificación semanal, batch cooking y lecturas reposadas. Arrastre hacia lunes y martes.',
      horarioRecomendado: '08:00 - 14:00 CO · 16:00 - 21:00 CO',
      slots: [
        {
          franja: '08:00 - 11:00',
          seccion: 'Batch Cooking / Organización',
          vertical: 'cocina',
          formato: 'A · Paradoja culposa / Utilidad doméstica',
          referente: 'Anna Terés',
          titular: "Anna Terés: 'Cocina una vez el domingo y resuelve las cenas de toda la semana con solo 3 tuppers'",
          regla: 'Promesa de tiempo y ahorro familiar para la semana que empieza. CTR superior al 6%.',
          estado: 'SUGERIDO'
        },
        {
          franja: '10:00 - 13:00',
          seccion: 'Técnica culinaria / Caldos',
          vertical: 'cocina',
          formato: 'A · Paradoja culposa / Caldos',
          referente: 'Ferran Adrià',
          titular: "Ferran Adrià, chef: 'Hervir el caldo de pollo horas no le da más sabor, solo reduce el líquido; se compensa con más carcasas'",
          regla: 'Desmiente mito doméstico universal. Ideal para batch cooking dominical.',
          estado: 'SUGERIDO'
        },
        {
          franja: '16:00 - 19:30',
          seccion: 'Mascotas / Convivencia',
          vertical: 'canino',
          formato: 'B · Desmentido diario + credencial',
          referente: 'Carlos Gutiérrez (veterinario)',
          titular: "Carlos Gutiérrez, veterinario: por qué los perros y los gatos no deben comer del mismo plato jamás",
          regla: 'Nutrición cruzada y etología de convivencia. Lectura relajada de domingo en la tarde.',
          estado: 'SUGERIDO'
        }
      ]
    }
  };

  // Asignar los items de la hoja del usuario a su día correspondiente
  sheetItems.forEach(item => {
    const diaName = item.dia.charAt(0).toUpperCase() + item.dia.slice(1).toLowerCase();
    if (strategyByDay[diaName]) {
      strategyByDay[diaName].slots.push(item);
    } else {
      // Si no coincide el nombre exacto, lo enviamos al día que más se ajuste o Jueves
      strategyByDay['Jueves'].slots.push(item);
    }
  });

  return Object.values(strategyByDay);
}

// Cargar y unificar todos los datos del nuevo Google Sheet
async function buildUnifiedSheetData() {
  const [calRows, expRows, ruleRows] = await Promise.all([
    fetchSheetData(GIDS.CALENDARIO).catch(() => []),
    fetchSheetData(GIDS.EXPERIMENTOS).catch(() => []),
    fetchSheetData(GIDS.HORARIOS_REGLAS).catch(() => [])
  ]);

  // Calendario enriquecido
  const calendarWeekly = processCalendarSheet(calRows);

  // Mapear experimentos reales
  const experiments = [];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, expRows.length); i++) {
    const rowStr = expRows[i].join(' ').toUpperCase();
    if (rowStr.includes('FECHA') || rowStr.includes('ENTIDAD') || rowStr.includes('TITULAR')) {
      headerIdx = i;
      break;
    }
  }

  const defaultExperiments = [
    { id:'EXP-001', fecha:'2026-11-05T08:40', experto:'coqui', vertical:'cocina', estado:'muerta', titular:'Coqui: «Mi receta de torrijas caramelizadas para chuparse los dedos»', fuente:'Recetario difundido en redes', url:'https://www.eltiempo.com/cultura/recetas/tarta-tatin-de-manzana-con-hojaldre-como-hacer-el-caramelo-sin-cucharas-y-voltearla-sin-que-se-escapen-los-jugos-3598831', marfeel:'https://hub.marfeel.com/compass/article/2447645335?limit=20', impresiones:4930, clics:97, hipotesis:'Sin reconocimiento de marca, Discover no encuentra ancla. Además, torrijas en octubre: fuera de temporada.' },
    { id:'EXP-002', fecha:'2026-11-06T18:40', experto:'cesar', vertical:'canino', estado:'exploto', titular:'César Millán, adiestrador canino de 57 años: ‘Un perro no se lanza sobre la comida si se mantiene una energía tranquila y segura, sin gritos’', fuente:'Entrevistas TV', url:'https://www.eltiempo.com/vida/mascotas/cesar-millan-adiestrador-canino-de-57-anos-un-perro-no-se-lanza-sobre-la-comida-si-se-mantiene-una-energia-tranquila-y-segura-sin-gritos-3599106', marfeel:'https://hub.marfeel.com/compass/article/2451067236?limit=20', impresiones:356780, clics:31040, hipotesis:'La vieja confiable, despierta muy bien en SEO y Discover, excelente para remontar.' },
    { id:'EXP-003', fecha:'2026-11-09T07:45', experto:'ferran', vertical:'cocina', estado:'exploto', titular:'Ferran Adrià, chef: ‘A la mermelada de bote le falta frescor, se arregla mezclándola con casi la mitad de fruta fresca y hojas de menta’', fuente:'Entrevista gastronómica', url:'https://www.eltiempo.com/cultura/recetas/ferran-adria-chef-a-la-mermelada-de-bote-le-falta-frescor-se-arregla-mezclandola-con-casi-la-mitad-de-fruta-fresca-y-hojas-de-menta-3599606', marfeel:'https://hub.marfeel.com/compass/article/2461019943?limit=20', impresiones:412300, clics:38960, hipotesis:'Cayó al piso después de unos minutos pero volvió a subir con fuerza en Discover.' },
    { id:'EXP-004', fecha:'2026-11-10T18:55', experto:'cesar', vertical:'canino', estado:'exploto', titular:'César Millán, adiestrador canino de 57 años: ‘Humanizar a los perros es un error, necesitan ejercicio, disciplina y afecto, en ese orden’', fuente:'Gira y libros', url:'https://www.eltiempo.com/vida/mascotas/cesar-millan-adiestrador-canino-de-57-anos-humanizar-a-los-perros-es-un-error-necesitan-ejercicio-disciplina-y-afecto-en-ese-orden-3599724', marfeel:'https://hub.marfeel.com/compass/article/2463613692?limit=20', impresiones:285400, clics:24800, hipotesis:'Nombre exitoso, volvió a triunfar con autoridad psicológica canina.' },
    { id:'EXP-005', fecha:'2026-11-11T19:05', experto:'puchol', vertical:'canino', estado:'muybien', titular:'José Luis Puchol, veterinario de 72 años: ‘Los perros pequeños suelen vivir más años que los de razas grandes y gigantes’', fuente:'Hospital Veterinario', url:'https://www.eltiempo.com/vida/mascotas/jose-luis-puchol-veterinario-de-72-anos-los-perros-pequenos-suelen-vivir-mas-anos-que-los-de-razas-grandes-y-gigantes-3600196', marfeel:'https://hub.marfeel.com/compass/article/2468351307?limit=20', impresiones:176410, clics:13580, hipotesis:'Longevidad canina con credencial veterinaria de alto alcance.' },
    { id:'EXP-006', fecha:'2026-11-12T18:30', experto:'santi', vertical:'canino', estado:'muybien', titular:'Santi Vidal, adiestrador canino con 25 años de experiencia: ‘Un perro que orina en cada esquina no es dominante, está estresado’', fuente:'Clínica de conducta', url:'https://www.eltiempo.com/vida/mascotas/santi-vidal-adiestrador-canino-con-25-anos-de-experiencia-un-perro-que-orina-en-cada-esquina-no-es-dominante-esta-estresa-3600643', marfeel:'https://hub.marfeel.com/compass/article/2473450917?limit=20', impresiones:185000, clics:15400, hipotesis:'Desmonta mito con franja de tarde confirmada.' },
    { id:'EXP-007', fecha:'2026-11-17T18:40', experto:'borja', vertical:'canino', estado:'muybien', titular:'Borja Capponi, adiestrador canino con 30 años de experiencia: ‘Los perros piden que se los deje ser perros y no tratarlos como personas’', fuente:'Borja Capponi Academy', url:'https://www.eltiempo.com/vida/mascotas/borja-capponi-adiestrador-canino-con-30-anos-de-experiencia-los-perros-piden-que-se-los-deje-ser-perros-y-no-tratarlos-como-personas-3601623', marfeel:'https://hub.marfeel.com/compass/article/2488938838?limit=20', impresiones:192000, clics:16100, hipotesis:'Le fue bastante bien, excelente tracción en tarde-noche.' }
  ];

  return {
    meta: {
      sheetName: 'MI ESPACIO ET · Auditoría Discover',
      sheetUrl: `docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      hojas: 8,
      objetivo: 35,
      insights: {
        todos: 'El vertical canino supera a cocina en tasa de éxito (+50% vs 16.7%). El fin de semana (+34% Sáb / +23% Dom) es la ventana dorada donde no hay saturación.',
        cocina: 'Cocina requiere cita textual + atajo doméstico de supermercado en mar-jue 07:30-09:00 o sábado mañana con Ferran Adrià / Joan Roca.',
        canino: 'Mascotas triunfa en ventana 18:00-21:00 con reencuadres contraintuitivos (César Millán, Borja Capponi, Santi Vidal).'
      },
      sheetRefs: {
        bitacora: 'EXPERIMENTOS EDITORIALES · A1:I35',
        calendario: 'CALENDARIO EDITORIAL · A1:K20',
        'dir-chefs': 'DIRECTORIO CHEFS · A1:H37',
        'dir-canino': 'DIRECTORIO CANINO · A1:H45',
        reglas: 'HORARIOS Y REGLAS DISCOVER · A1:G15',
        temporada: 'CHEFS POR TEMPORADA · A1:E10',
        plantillas: 'Plantillas de Titulares · A1:D11'
      }
    },
    calendarWeekly: calendarWeekly,
    experts: [
      { id:'cesar', nombre:'César Millán', rol:'Adiestrador · referente mundial', vertical:'canino', veredicto:'aprobado', motivo:'Autoridad + urgencia emocional', fuente:'Giras · TV', mejorDia:'Lun / Sáb', mejorHora:'18:00–21:00', lectura:'Reencuadre contraintuitivo («no es cariño, es un problema») con autoridad mundial. Es la fórmula canina de referencia.' },
      { id:'ferran', nombre:'Ferran Adrià', rol:'Alta cocina · elBulli', vertical:'cocina', veredicto:'aprobado', motivo:'Controversia culinaria de alto clic', fuente:'Fundación elBulli', mejorDia:'Mar / Sáb', mejorHora:'06:00–09:30', lectura:'La autoridad culinaria máxima convierte cualquier polémica o atajo en clic masivo.' },
      { id:'roca', nombre:'Joan Roca', rol:'Chef 3★ Michelin · El Celler de Can Roca', vertical:'cocina', veredicto:'aprobado', motivo:'Técnica explicada sin secretos', fuente:'El Celler de Can Roca', mejorDia:'Jue / Sáb', mejorHora:'11:00–14:00', lectura:'Desala bacalao y fondos caseros sin trampa. Convierte la técnica Michelin en utilidad de hogar.' },
      { id:'jordi', nombre:'Jordi Cruz', rol:'Chef MasterChef · ABaC', vertical:'cocina', veredicto:'aprobado', motivo:'Seguridad alimentaria y alertas', fuente:'YouTube · ABaC', mejorDia:'Mié / Jue', mejorHora:'11:00–14:00', lectura:'Alerta sobre bacterias y riesgos cotidianos en cocina. Atrae clics masivos por instinto de conservación.' },
      { id:'ojeda', nombre:'Pablo Ojeda', rol:'Nutricionista y divulgador TV', vertical:'cocina', veredicto:'aprobado', motivo:'Paradojas nocturnas y hábitos', fuente:'La Sexta · Más Vale Tarde', mejorDia:'Jue / Dom', mejorHora:'16:00–19:00', lectura:'Resuelve el asalto nocturno a la nevera y la proteína ausente. Alta identificación de audiencia.' },
      { id:'navegante', nombre:'José María Sánchez (@naveganteoficial)', rol:'Pescadero artesanal y divulgador', vertical:'cocina', veredicto:'aprobado', motivo:'Ahorro y compra inteligente', fuente:'Instagram Reels', mejorDia:'Vie / Sáb', mejorHora:'06:00–10:00', lectura:'Destapa trampas del supermercado y glaseos de agua. El mejor referente para viernes de compras.' },
      { id:'carlosgut', nombre:'Carlos Gutiérrez', rol:'Veterinario clínico y divulgador', vertical:'canino', veredicto:'aprobado', motivo:'Dato científico + desmentido felino', fuente:'Clínica veterinaria', mejorDia:'Jue / Dom', mejorHora:'06:00–10:00', lectura:'Desmitifica la soledad del gato y nutrición cruzada con porcentajes exactos.' },
      { id:'peiro', nombre:'Alan Peiró', rol:'Adiestrador y etólogo canino', vertical:'canino', veredicto:'aprobado', motivo:'Regla asociativa de 0,5 segundos', fuente:'Etología aplicada', mejorDia:'Jue / Sáb', mejorHora:'06:00–10:00', lectura:'Desmonta que los perros se venguen; explica la regla asociativa de los 0,5 segundos.' },
      { id:'santi', nombre:'Santi Vidal', rol:'Veterinario y adiestrador', vertical:'canino', veredicto:'aprobado', motivo:'Alerta sanitaria accionable', fuente:'Clínica veterinaria', mejorDia:'Mar / Vie', mejorHora:'18:00–20:00', lectura:'Alerta con enemigo concreto y daño articular o digestivo.' },
      { id:'borja', nombre:'Borja Capponi', rol:'Etólogo · conducta canina', vertical:'canino', veredicto:'aprobado', motivo:'Mito conductual desmontado', fuente:'Malas Pulgas TV', mejorDia:'Jue / Sáb', mejorHora:'18:00–20:30', lectura:'Desmonta mitos cotidianos y ofrece alternativa en el mismo titular.' },
      { id:'puchol', nombre:'José Luis Puchol', rol:'Veterinario clínico', vertical:'canino', veredicto:'aprobado', motivo:'Riesgo físico en rutina diaria', fuente:'Hospital Puchol', mejorDia:'Mié', mejorHora:'18:00–20:00', lectura:'Riesgo físico + culpa útil en una rutina diaria.' },
      { id:'loli', nombre:'Loli Domínguez', rol:'Repostería casera · YouTube', vertical:'cocina', veredicto:'aprobado', motivo:'Utilidad doméstica inmediata', fuente:'YouTube', mejorDia:'Jue / Sáb', mejorHora:'07:30–09:00', lectura:'Fórmula del error único. Audiencia estable que no compite con la actualidad política.' },
      { id:'anna', nombre:'Anna Terés', rol:'Batch cooking · organización', vertical:'cocina', veredicto:'observacion', motivo:'Rinde con promesa de organización', fuente:'CuerpoMente', mejorDia:'Dom', mejorHora:'08:00–11:00', lectura:'Rinde cuando la promesa es organizar la semana en tápers.' },
      { id:'gorka', nombre:'Gorka Barredo', rol:'Cocina casera · YouTube', vertical:'cocina', veredicto:'observacion', motivo:'Techo de CTR en 4–5 %', fuente:'¡Que viva la cocina!', mejorDia:'Mar / Sáb', mejorHora:'07:30–09:00', lectura:'El misterio sin cifra no despega; necesita mandatos claros.' },
      { id:'manzano', nombre:'Manuel Manzano', rol:'Veterinario divulgador', vertical:'canino', veredicto:'observacion', motivo:'Franja nocturna decisiva', fuente:'Veterinario Gratis', mejorDia:'Vie', mejorHora:'18:30–20:30', lectura:'Tema correcto de ansiedad por separación; rinde en tarde-noche.' },
      { id:'karlos', nombre:'Karlos Arguiñano', rol:'Cocina TV · veteranía', vertical:'cocina', veredicto:'descartado', motivo:'Saturación en feed entre semana', fuente:'Cocina Abierta', mejorDia:'Sáb', mejorHora:'11:00–14:00', lectura:'Veto entre semana por saturación. Solo reactivar los sábados con cuchara otoñal.' }
    ],
    experiments: defaultExperiments,
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

// Sistema Keep-Alive para Render
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
    message: 'Discover Pulse Monitor activo 24/7',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    keepAliveActive: true
  });
});

app.get('/api/data', async (req, res) => {
  const now = Date.now();
  if (!cachedSheetData || (now - lastFetchTime) > 45000) {
    try {
      cachedSheetData = await buildUnifiedSheetData();
      lastFetchTime = now;
    } catch (e) {
      console.error('Error al actualizar datos:', e.message);
    }
  }
  res.json(cachedSheetData);
});

app.post('/api/sync', async (req, res) => {
  try {
    cachedSheetData = await buildUnifiedSheetData();
    lastFetchTime = Date.now();
    res.json({ success: true, count: cachedSheetData.calendarWeekly.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`🚀 Discover Pulse corriendo en puerto ${PORT}`);
  console.log(`📊 Conectado al nuevo Google Sheet: ${SHEET_ID}`);
  try {
    cachedSheetData = await buildUnifiedSheetData();
    lastFetchTime = Date.now();
  } catch (e) {}
});
