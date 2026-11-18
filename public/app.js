// Estado global de la aplicación
const state = {
  experiments: [],
  kpis: {},
  chefs: [],
  canine: [],
  rules: [],
  templates: [],
  currentTab: 'tab-experimentos',
  currentView: 'cards', // 'cards' o 'table'
  filters: {
    search: '',
    status: 'all',
    category: 'all'
  },
  chartPerf: null,
  chartEntities: null
};

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupNavigation();
  setupFilters();
  setupSync();
  setupModal();
  setupSubtabs();
  setupKeepAlive();
  
  // Cargar datos iniciales
  loadAllData();
});

// Manejo de Tema Claro/Oscuro
function initTheme() {
  const isDark = localStorage.getItem('theme') === 'dark' || 
    (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  const btnTheme = document.getElementById('btn-theme');
  btnTheme.addEventListener('click', () => {
    const isNowDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isNowDark ? 'dark' : 'light');
    if (state.chartPerf) updateChartsTheme();
  });
}

// Navegación principal entre Pestañas
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  state.currentTab = tabId;

  // Actualizar botones
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.getAttribute('data-tab') === tabId) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  // Mostrar panel correspondiente
  document.querySelectorAll('.tab-pane').forEach(p => {
    if (p.id === tabId) {
      p.classList.remove('hidden');
    } else {
      p.classList.add('hidden');
    }
  });

  // Si se abre Keep-Alive, refrescar estado
  if (tabId === 'tab-keepalive') {
    fetchKeepAliveStatus();
  }
}

// ==========================================
// CARGA DE DATOS DE LA API
// ==========================================
async function loadAllData() {
  try {
    const [expRes, rulesRes, chefsRes, canRes, templRes] = await Promise.all([
      fetch('/api/experiments').then(r => r.json()),
      fetch('/api/rules').then(r => r.json()),
      fetch('/api/chefs').then(r => r.json()),
      fetch('/api/canine').then(r => r.json()),
      fetch('/api/templates').then(r => r.json())
    ]);

    if (expRes.success) {
      state.experiments = expRes.experiments || [];
      state.kpis = expRes.kpis || {};
      renderKPIs(state.kpis);
      populateCategoryFilter(state.experiments);
      applyFilters();
      renderCharts(state.experiments, state.kpis);
      
      if (expRes.lastUpdated) {
        const d = new Date(expRes.lastUpdated);
        document.getElementById('sync-timestamp').textContent = `Última sinc: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
    }

    if (rulesRes.success) {
      state.rules = rulesRes.rules || [];
      renderRules(state.rules, rulesRes.kpis);
    }

    if (chefsRes.success) {
      state.chefs = chefsRes.chefs || [];
      renderChefs(state.chefs);
    }

    if (canRes.success) {
      state.canine = canRes.experts || [];
      renderCanine(state.canine);
    }

    if (templRes.success) {
      state.templates = templRes.templates || [];
      renderTemplates(state.templates);
    }

  } catch (error) {
    console.error('Error al cargar datos:', error);
    showToast('Error al conectar con el servidor', 'error');
  }
}

// ==========================================
// RENDERIZADO DE KPIs & GRÁFICOS
// ==========================================
function renderKPIs(kpis) {
  document.getElementById('kpi-total').textContent = kpis.total || state.experiments.length;
  document.getElementById('kpi-exploto').textContent = kpis.explotaron || '0';
  document.getElementById('kpi-muybien').textContent = kpis.muyBien || '0';
  document.getElementById('kpi-regular').textContent = kpis.regular || '0';
  document.getElementById('kpi-muerta').textContent = kpis.nacioMuerta || '0';
  document.getElementById('kpi-exito').textContent = kpis.tasaExito || '0%';
}

function renderCharts(experiments, kpis) {
  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? '#334155' : '#e2e8f0';

  // 1. Donut Chart Desempeño
  const ctxPerf = document.getElementById('chart-performance');
  if (ctxPerf) {
    if (state.chartPerf) state.chartPerf.destroy();

    const exploto = kpis.explotaron || experiments.filter(e => e.statusKey === 'exploto').length;
    const muyBien = kpis.muyBien || experiments.filter(e => e.statusKey === 'muy_bien').length;
    const regular = kpis.regular || experiments.filter(e => e.statusKey === 'regular').length;
    const muerta = kpis.nacioMuerta || experiments.filter(e => e.statusKey === 'muerta').length;

    state.chartPerf = new Chart(ctxPerf, {
      type: 'doughnut',
      data: {
        labels: ['Explotó Discover', 'Muy Bien', 'Regular', 'Nació Muerta'],
        datasets: [{
          data: [exploto, muyBien, regular, muerta],
          backgroundColor: [
            '#10b981', // emerald
            '#3b82f6', // blue
            '#f59e0b', // amber
            '#f43f5e'  // rose
          ],
          borderWidth: 2,
          borderColor: isDark ? '#0f172a' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${item.raw} notas`
            }
          }
        },
        cutout: '72%'
      }
    });
  }

  // 2. Bar Chart Entidades
  const ctxEntities = document.getElementById('chart-entities');
  if (ctxEntities) {
    if (state.chartEntities) state.chartEntities.destroy();

    // Contar apariciones y éxitos por entidad
    const entityStats = {};
    experiments.forEach(e => {
      const ent = e.entidad || 'Otros';
      if (!entityStats[ent]) {
        entityStats[ent] = { total: 0, exito: 0 };
      }
      entityStats[ent].total++;
      if (e.statusKey === 'exploto' || e.statusKey === 'muy_bien') {
        entityStats[ent].exito++;
      }
    });

    const sorted = Object.entries(entityStats)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 7);

    state.chartEntities = new Chart(ctxEntities, {
      type: 'bar',
      data: {
        labels: sorted.map(s => s[0]),
        datasets: [
          {
            label: 'Total Notas',
            data: sorted.map(s => s[1].total),
            backgroundColor: isDark ? '#334155' : '#cbd5e1',
            borderRadius: 6
          },
          {
            label: 'Exitosas (Explotó / Muy Bien)',
            data: sorted.map(s => s[1].exito),
            backgroundColor: '#10b981',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: textColor, font: { size: 11 } },
            grid: { display: false }
          },
          y: {
            ticks: { color: textColor, stepSize: 1, precision: 0 },
            grid: { color: gridColor }
          }
        },
        plugins: {
          legend: {
            labels: { color: textColor, font: { size: 11 } }
          }
        }
      }
    });
  }
}

function updateChartsTheme() {
  if (state.experiments.length > 0) {
    renderCharts(state.experiments, state.kpis);
  }
}

// ==========================================
// FILTROS Y BÚSQUEDA
// ==========================================
function setupFilters() {
  const searchInput = document.getElementById('filter-search');
  const statusSelect = document.getElementById('filter-status');
  const catSelect = document.getElementById('filter-category');
  const btnReset = document.getElementById('btn-filter-reset');

  searchInput.addEventListener('input', (e) => {
    state.filters.search = e.target.value.toLowerCase().trim();
    applyFilters();
  });

  statusSelect.addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    applyFilters();
  });

  catSelect.addEventListener('change', (e) => {
    state.filters.category = e.target.value;
    applyFilters();
  });

  btnReset.addEventListener('click', () => {
    searchInput.value = '';
    statusSelect.value = 'all';
    catSelect.value = 'all';
    state.filters = { search: '', status: 'all', category: 'all' };
    applyFilters();
  });

  // Switch vista Cards / Tabla
  const btnCards = document.getElementById('btn-view-cards');
  const btnTable = document.getElementById('btn-view-table');

  btnCards.addEventListener('click', () => {
    state.currentView = 'cards';
    btnCards.classList.add('active-view');
    btnCards.classList.remove('text-slate-500');
    btnTable.classList.remove('active-view');
    btnTable.classList.add('text-slate-500');
    document.getElementById('container-cards').classList.remove('hidden');
    document.getElementById('container-table').classList.add('hidden');
  });

  btnTable.addEventListener('click', () => {
    state.currentView = 'table';
    btnTable.classList.add('active-view');
    btnTable.classList.remove('text-slate-500');
    btnCards.classList.remove('active-view');
    btnCards.classList.add('text-slate-500');
    document.getElementById('container-table').classList.remove('hidden');
    document.getElementById('container-cards').classList.add('hidden');
  });
}

function populateCategoryFilter(experiments) {
  const catSelect = document.getElementById('filter-category');
  const categories = new Set();
  experiments.forEach(e => {
    if (e.categoria && e.categoria !== 'General') categories.add(e.categoria);
  });

  catSelect.innerHTML = '<option value="all">Todas las Categorías</option>';
  Array.from(categories).sort().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSelect.appendChild(opt);
  });
}

function applyFilters() {
  const { search, status, category } = state.filters;

  const filtered = state.experiments.filter(exp => {
    // 1. Status
    if (status !== 'all' && exp.statusKey !== status) return false;

    // 2. Category
    if (category !== 'all' && exp.categoria !== category) return false;

    // 3. Search text
    if (search) {
      const matchTitular = exp.titular.toLowerCase().includes(search);
      const matchEntidad = exp.entidad.toLowerCase().includes(search);
      const matchHallazgo = exp.hallazgos.toLowerCase().includes(search);
      const matchTipo = exp.tipo.toLowerCase().includes(search);
      if (!matchTitular && !matchEntidad && !matchHallazgo && !matchTipo) return false;
    }

    return true;
  });

  renderExperiments(filtered);
  document.getElementById('counter-results').textContent = `Mostrando ${filtered.length} de ${state.experiments.length} experimentos`;
}

// ==========================================
// RENDERIZADO DE EXPERIMENTOS
// ==========================================
function getStatusBadge(exp) {
  switch (exp.statusKey) {
    case 'exploto':
      return {
        class: 'badge-exploto',
        icon: 'fa-solid fa-fire',
        label: exp.rendimiento || 'Explotó en SEO/Discover'
      };
    case 'muy_bien':
      return {
        class: 'badge-muybien',
        icon: 'fa-solid fa-arrow-trend-up',
        label: exp.rendimiento || 'Le fue muy bien'
      };
    case 'regular':
      return {
        class: 'badge-regular',
        icon: 'fa-solid fa-minus',
        label: exp.rendimiento || 'Regular / Decente'
      };
    case 'muerta':
    default:
      return {
        class: 'badge-muerta',
        icon: 'fa-solid fa-skull',
        label: exp.rendimiento || 'Nació totalmente muerta'
      };
  }
}

function renderExperiments(list) {
  const cardsContainer = document.getElementById('container-cards');
  const tableBody = document.getElementById('table-body');

  cardsContainer.innerHTML = '';
  tableBody.innerHTML = '';

  if (list.length === 0) {
    const emptyHtml = `
      <div class="col-span-full py-12 text-center text-slate-400">
        <i class="fa-solid fa-filter text-3xl mb-2 opacity-50"></i>
        <p class="text-sm">No se encontraron experimentos con los filtros actuales.</p>
      </div>
    `;
    cardsContainer.innerHTML = emptyHtml;
    tableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">Sin resultados</td></tr>`;
    return;
  }

  list.forEach(exp => {
    const badge = getStatusBadge(exp);

    // 1. Tarjeta (Card)
    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition flex flex-col justify-between';
    
    // Icono según categoría
    const isMascotas = exp.categoria.toLowerCase().includes('mascota') || exp.categoria.toLowerCase().includes('canino');
    const isCocina = exp.categoria.toLowerCase().includes('gastro') || exp.categoria.toLowerCase().includes('receta');
    const catIcon = isMascotas ? 'fa-paw' : (isCocina ? 'fa-utensils' : 'fa-newspaper');

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between text-xs mb-2.5">
          <div class="flex items-center space-x-2">
            <span class="font-mono text-[11px] text-slate-400 font-semibold">${exp.fecha || 'Sin fecha'}</span>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <i class="fa-solid ${catIcon} mr-1 text-slate-400"></i> ${exp.categoria}
            </span>
          </div>
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${badge.class}">
            <i class="${badge.icon} mr-1"></i> ${badge.label}
          </span>
        </div>

        <div class="mb-2">
          <span class="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/40">
            <i class="fa-solid fa-user-tag mr-1"></i> ${exp.entidad}
          </span>
        </div>

        <h4 class="text-sm font-semibold text-slate-900 dark:text-white leading-snug line-clamp-3 mb-3" title="${exp.titular}">
          ${exp.titular}
        </h4>

        ${exp.hallazgos ? `
          <div class="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-2.5 mb-3 border border-slate-100 dark:border-slate-800">
            <div class="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Aprendizaje:</div>
            <p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">${exp.hallazgos}</p>
          </div>
        ` : ''}
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
        <button class="btn-open-modal text-indigo-600 dark:text-indigo-400 hover:underline font-semibold flex items-center">
          <i class="fa-solid fa-circle-info mr-1"></i> Análisis
        </button>
        <div class="flex items-center space-x-1.5">
          ${exp.url ? `
            <a href="${exp.url}" target="_blank" rel="noopener noreferrer" title="Ver en El Tiempo" class="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
          ` : ''}
          ${exp.marfeel ? `
            <a href="${exp.marfeel}" target="_blank" rel="noopener noreferrer" title="Ver en Marfeel Compass" class="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <i class="fa-solid fa-chart-simple"></i>
            </a>
          ` : ''}
        </div>
      </div>
    `;

    card.querySelector('.btn-open-modal').addEventListener('click', () => openModal(exp));
    cardsContainer.appendChild(card);

    // 2. Fila de Tabla
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition';
    tr.innerHTML = `
      <td class="py-3 px-4 whitespace-nowrap">
        <div class="font-bold text-slate-900 dark:text-white">${exp.entidad}</div>
        <div class="text-[11px] font-mono text-slate-400">${exp.fecha}</div>
      </td>
      <td class="py-3 px-4 max-w-md">
        <div class="font-medium text-slate-900 dark:text-slate-100 line-clamp-2" title="${exp.titular}">
          ${exp.titular}
        </div>
        <div class="text-[11px] text-slate-400 mt-0.5">${exp.tipo}</div>
      </td>
      <td class="py-3 px-4 whitespace-nowrap text-slate-500 dark:text-slate-400 text-xs">
        ${exp.categoria}
      </td>
      <td class="py-3 px-4 whitespace-nowrap">
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${badge.class}">
          <i class="${badge.icon} mr-1"></i> ${badge.label}
        </span>
      </td>
      <td class="py-3 px-4 max-w-xs text-xs text-slate-600 dark:text-slate-300">
        <span class="line-clamp-2" title="${exp.hallazgos}">${exp.hallazgos || '—'}</span>
      </td>
      <td class="py-3 px-4 whitespace-nowrap text-right">
        <div class="inline-flex items-center space-x-1">
          <button class="btn-open-modal p-1.5 rounded text-indigo-600 dark:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Ver Análisis">
            <i class="fa-solid fa-circle-info"></i>
          </button>
          ${exp.url ? `<a href="${exp.url}" target="_blank" class="p-1.5 rounded text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800" title="El Tiempo"><i class="fa-solid fa-newspaper"></i></a>` : ''}
          ${exp.marfeel ? `<a href="${exp.marfeel}" target="_blank" class="p-1.5 rounded text-slate-500 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800" title="Marfeel Compass"><i class="fa-solid fa-chart-simple"></i></a>` : ''}
        </div>
      </td>
    `;
    tr.querySelector('.btn-open-modal').addEventListener('click', () => openModal(exp));
    tableBody.appendChild(tr);
  });
}

// ==========================================
// MODAL DE EXPERIMENTO
// ==========================================
function setupModal() {
  const modal = document.getElementById('modal-experiment');
  const closeBtn = document.getElementById('modal-close');

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function openModal(exp) {
  const modal = document.getElementById('modal-experiment');
  const badge = getStatusBadge(exp);

  const statusBadge = document.getElementById('modal-badge-status');
  statusBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold ${badge.class}`;
  statusBadge.innerHTML = `<i class="${badge.icon} mr-1"></i> ${badge.label}`;

  document.getElementById('modal-badge-cat').textContent = exp.categoria;
  document.getElementById('modal-date-entity').textContent = `${exp.fecha} · ${exp.entidad} (${exp.tipo})`;
  document.getElementById('modal-title').textContent = exp.titular;
  document.getElementById('modal-findings').textContent = exp.hallazgos || 'Sin observaciones registradas para este experimento.';

  const linkArticle = document.getElementById('modal-link-article');
  if (exp.url) {
    linkArticle.href = exp.url;
    linkArticle.classList.remove('hidden');
  } else {
    linkArticle.classList.add('hidden');
  }

  const linkMarfeel = document.getElementById('modal-link-marfeel');
  if (exp.marfeel) {
    linkMarfeel.href = exp.marfeel;
    linkMarfeel.classList.remove('hidden');
  } else {
    linkMarfeel.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

// ==========================================
// RENDER REGLAS DISCOVER
// ==========================================
function renderRules(rules, kpis) {
  if (kpis) {
    if (kpis.picoFinSemana) document.getElementById('rule-pico').textContent = kpis.picoFinSemana;
    if (kpis.sabado) document.getElementById('rule-sabado').textContent = kpis.sabado;
    if (kpis.domingo) document.getElementById('rule-domingo').textContent = kpis.domingo;
    if (kpis.boostNombrePropio) document.getElementById('rule-boost').textContent = kpis.boostNombrePropio;
    if (kpis.peorDia) document.getElementById('rule-peor').textContent = kpis.peorDia;
  }

  const container = document.getElementById('rules-container');
  container.innerHTML = '';

  rules.forEach(rule => {
    const isTop = rule.prioridad.includes('1') || rule.impacto.includes('+34%') || rule.impacto.includes('+23%');
    const isBad = rule.prioridad.includes('4') || rule.impacto.includes('-');

    let borderClass = 'border-slate-200 dark:border-slate-800';
    let impactBadge = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    if (isTop) {
      borderClass = 'border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10';
      impactBadge = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300';
    } else if (isBad) {
      borderClass = 'border-rose-200 dark:border-rose-900/40 bg-rose-50/20 dark:bg-rose-950/10';
      impactBadge = 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300';
    }

    const item = document.createElement('div');
    item.className = `p-4 rounded-xl border ${borderClass} space-y-2`;
    item.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="flex items-center space-x-2">
          <h4 class="text-sm font-bold text-slate-900 dark:text-white">${rule.bloque}</h4>
          <span class="inline-flex px-2 py-0.5 rounded text-xs font-bold ${impactBadge}">
            ${rule.impacto}
          </span>
        </div>
        <span class="text-xs text-slate-400 font-medium">${rule.prioridad}</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
        <div class="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
          <div class="font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center">
            <i class="fa-regular fa-clock mr-1.5 text-indigo-500"></i> Ventanas Horarias:
          </div>
          <div class="text-slate-600 dark:text-slate-300 space-y-0.5">
            <div><strong>España (CET):</strong> ${rule.horarioEspana || 'Todo el día'}</div>
            <div><strong>Colombia (COT):</strong> ${rule.horarioColombia || 'Todo el día'}</div>
          </div>
        </div>

        <div class="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
          <div class="font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center">
            <i class="fa-solid fa-bullseye mr-1.5 text-emerald-500"></i> Aplicación Práctica:
          </div>
          <p class="text-slate-600 dark:text-slate-300">${rule.aplicacion || rule.analisis}</p>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

// ==========================================
// RENDER DIRECTORIOS & PLANTILLAS
// ==========================================
function setupSubtabs() {
  const tabs = [
    { btn: 'subtab-btn-chefs', panel: 'subpanel-chefs' },
    { btn: 'subtab-btn-canine', panel: 'subpanel-canine' },
    { btn: 'subtab-btn-templates', panel: 'subpanel-templates' }
  ];

  tabs.forEach(t => {
    const btnEl = document.getElementById(t.btn);
    btnEl.addEventListener('click', () => {
      tabs.forEach(other => {
        const b = document.getElementById(other.btn);
        const p = document.getElementById(other.panel);
        if (other.btn === t.btn) {
          b.className = 'subtab-btn active pb-3 text-sm font-semibold border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400';
          p.classList.remove('hidden');
        } else {
          b.className = 'subtab-btn pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400';
          p.classList.add('hidden');
        }
      });
    });
  });

  // Filtros de búsqueda para directorios
  document.getElementById('search-chefs').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = state.chefs.filter(c => c.nombre.toLowerCase().includes(q) || c.ganchos.toLowerCase().includes(q));
    renderChefs(filtered);
  });

  document.getElementById('search-canine').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = state.canine.filter(c => c.experto.toLowerCase().includes(q) || c.areaAutoridad.toLowerCase().includes(q) || c.perfil.toLowerCase().includes(q));
    renderCanine(filtered);
  });
}

function renderChefs(chefs) {
  const grid = document.getElementById('chefs-grid');
  grid.innerHTML = '';
  chefs.forEach(chef => {
    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <h4 class="font-bold text-sm text-slate-900 dark:text-white flex items-center">
          <i class="fa-solid fa-utensils mr-2 text-indigo-500"></i> ${chef.nombre}
        </h4>
        <span class="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          ${chef.potencial || 'Potencial'}
        </span>
      </div>
      <div class="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span><i class="fa-solid fa-users mr-1"></i> ${chef.audiencia} subs</span>
        <span>Notas: <strong>${chef.notasRealizadas}</strong></span>
      </div>
      <div class="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg text-xs text-slate-600 dark:text-slate-300">
        <strong class="text-slate-700 dark:text-slate-200 block mb-1">Ganchos estrella / CTR:</strong>
        <p class="line-clamp-3">${chef.ganchos}</p>
      </div>
      ${chef.enlace ? `
        <div class="pt-1 text-right">
          <a href="${chef.enlace}" target="_blank" rel="noopener noreferrer" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center">
            Ver Canal / Red <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>
          </a>
        </div>
      ` : ''}
    `;
    grid.appendChild(card);
  });
}

function renderCanine(experts) {
  const grid = document.getElementById('canine-grid');
  grid.innerHTML = '';
  experts.forEach(exp => {
    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <h4 class="font-bold text-sm text-slate-900 dark:text-white flex items-center">
          <i class="fa-solid fa-shield-dog mr-2 text-emerald-500"></i> ${exp.experto}
        </h4>
        <span class="text-[11px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
          ${exp.perfil}
        </span>
      </div>
      <div class="text-xs text-slate-500 dark:text-slate-400">
        ${exp.pais ? `<span class="mr-2"><i class="fa-solid fa-location-dot mr-1"></i> ${exp.pais}</span>` : ''}
        ${exp.institucion ? `<span>${exp.institucion}</span>` : ''}
      </div>
      <div class="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg text-xs text-slate-600 dark:text-slate-300">
        <strong class="text-slate-700 dark:text-slate-200 block mb-0.5">Autoridad:</strong>
        <p class="line-clamp-2">${exp.areaAutoridad || exp.acreditaciones}</p>
      </div>
      ${exp.precauciones ? `
        <div class="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200 dark:border-amber-900/40">
          <i class="fa-solid fa-triangle-exclamation mr-1"></i> ${exp.precauciones}
        </div>
      ` : ''}
    `;
    grid.appendChild(card);
  });
}

function renderTemplates(templates) {
  const grid = document.getElementById('templates-grid');
  grid.innerHTML = '';
  templates.forEach(t => {
    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2 relative';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-xs text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
          ${t.referente}
        </span>
        <span class="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          Lanzar: ${t.diaRecomendado}
        </span>
      </div>
      <div class="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">
        "${t.formula}"
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        <strong>Gancho:</strong> ${t.gancho}
      </p>
      <div class="pt-2 text-right">
        <button class="btn-copy-template text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-slate-700 transition">
          <i class="fa-regular fa-copy mr-1"></i> Copiar Fórmula
        </button>
      </div>
    `;

    card.querySelector('.btn-copy-template').addEventListener('click', () => {
      navigator.clipboard.writeText(t.formula);
      showToast('Fórmula copiada al portapapeles', 'success');
    });

    grid.appendChild(card);
  });
}

// ==========================================
// SISTEMA ANTI-INACTIVIDAD / KEEP-ALIVE
// ==========================================
function setupKeepAlive() {
  const btnSave = document.getElementById('btn-save-keepalive');
  const btnTest = document.getElementById('btn-test-ping');

  btnSave.addEventListener('click', async () => {
    const url = document.getElementById('keepalive-url').value.trim();
    try {
      const res = await fetch('/api/keepalive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: url, enabled: true })
      }).then(r => r.json());

      if (res.success) {
        showToast('Configuración de Keep-Alive guardada', 'success');
        fetchKeepAliveStatus();
      }
    } catch (e) {
      showToast('Error al guardar configuración', 'error');
    }
  });

  btnTest.addEventListener('click', async () => {
    showToast('Enviando ping de prueba...', 'info');
    try {
      const res = await fetch('/api/health').then(r => r.json());
      showToast(`Ping exitoso (${res.status})`, 'success');
      setTimeout(fetchKeepAliveStatus, 800);
    } catch (e) {
      showToast('Fallo al realizar ping', 'error');
    }
  });
}

async function fetchKeepAliveStatus() {
  try {
    const res = await fetch('/api/keepalive').then(r => r.json());
    
    const inputUrl = document.getElementById('keepalive-url');
    if (res.targetUrl && !inputUrl.value) {
      inputUrl.value = res.targetUrl;
    } else if (res.renderUrlDetected && !inputUrl.value) {
      inputUrl.value = res.renderUrlDetected;
    }

    document.getElementById('stat-total-pings').textContent = res.totalPings;
    document.getElementById('stat-last-ping').textContent = res.lastPingStatus || 'Ninguno aún';
    document.getElementById('stat-uptime').textContent = `${res.uptimeMinutes} min`;

    // Tabla de historial
    const tbody = document.getElementById('ping-history-body');
    if (res.history && res.history.length > 0) {
      tbody.innerHTML = '';
      res.history.forEach(item => {
        const d = new Date(item.timestamp);
        const timeStr = d.toLocaleTimeString();
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="py-1.5 px-3 whitespace-nowrap font-mono text-[11px]">${timeStr}</td>
          <td class="py-1.5 px-3 truncate max-w-[180px]">${item.url}</td>
          <td class="py-1.5 px-3">
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${item.success ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300'}">
              ${item.status}
            </span>
          </td>
          <td class="py-1.5 px-3 text-right font-mono text-[11px]">${item.durationMs || 0}ms</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (e) {
    console.error('Error al obtener estado de Keep-Alive:', e);
  }
}

// ==========================================
// SINCRONIZACIÓN MANUAL
// ==========================================
function setupSync() {
  const btnSync = document.getElementById('btn-sync');
  const syncIcon = document.getElementById('sync-icon');

  btnSync.addEventListener('click', async () => {
    syncIcon.classList.add('fa-spin');
    showToast('Sincronizando con Google Sheets...', 'info');

    try {
      const res = await fetch('/api/refresh', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        showToast(`Sincronización exitosa (${res.totalExperiments} experimentos)`, 'success');
        await loadAllData();
      } else {
        showToast('Error al actualizar datos', 'error');
      }
    } catch (e) {
      showToast('Error en la conexión', 'error');
    } finally {
      syncIcon.classList.remove('fa-spin');
    }
  });
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  if (toastTimer) clearTimeout(toastTimer);

  toastMsg.textContent = message;
  toastIcon.className = 'mr-2 text-sm ' + (
    type === 'success' ? 'fa-solid fa-circle-check text-emerald-400' :
    type === 'error' ? 'fa-solid fa-circle-xmark text-rose-400' :
    'fa-solid fa-circle-info text-blue-400'
  );

  toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
  toast.classList.add('translate-y-0', 'opacity-100');

  toastTimer = setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3500);
}
