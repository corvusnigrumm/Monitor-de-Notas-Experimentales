# 🚀 Monitor de Notas Experimentales & Directorio Editorial

Aplicativo web completo para el monitoreo en tiempo real de **notas experimentales**, fórmulas de titulares, directorios de **chefs gastronómicos**, **especialistas caninos/veterinarios** e **inteligencia algorítmica para Google Discover 2026**, conectado directamente al Google Sheet de redacción.

Incluye un **sistema Keep-Alive (Anti-Sleep) activo** diseñado para que al desplegar en **Render (Plan Free)** la aplicación permanezca despierta y no se suspenda por inactividad.

---

## 📋 Características Principales

1. **Dashboard de Notas Experimentales (Pestaña Principal)**:
   - Tarjetas KPI dinámicas (Total notas, Explotó Discover, Muy bien, Regular/Decente, Nació muerta, Tasa de éxito %).
   - Gráficos interactivos de balance de desempeño y efectividad por entidad.
   - Filtros en vivo: por desempeño, categoría, búsqueda libre de texto (titular, chef, aprendizajes).
   - Doble vista: Vista de Tarjetas visuales (Cards) y Vista de Tabla compacta.
   - Modal de análisis editorial con aprendizajes, enlaces directos a la nota en **El Tiempo** y métricas en **Marfeel Compass**.
   - Sincronización instantánea con Google Sheets con un clic.

2. **Reglas & Horarios Discover 2026**:
   - Multiplicadores de impacto: Sábado (+34%), Domingo (+23%), Boost de Nombre Propio (+20%), Cita directa (+3.1% a +5.5%), Peor día (-19%).
   - Cruce de ventanas horarias óptimas España (CET) vs Colombia (COT).
   - Reglas de autoridad E-E-A-T, imágenes limpias 16:9 y filtro de frescura (SDF).

3. **Directorio de Chefs & Veterinarios**:
   - **Directorio de Chefs**: 32 referentes con audiencia, ganchos de alto CTR y días recomendados.
   - **Directorio Canino**: 40 etólogos clínicos, veterinarios y adiestradores, acreditaciones y advertencias editoriales.
   - **Plantillas de Titulares**: Fórmulas probadas listas para copiar al portapapeles.

4. **Sistema Anti-Inactividad para Render**:
   - Auto-ping programado cada 10 minutos (Render duerme a los 15 minutos en el plan gratuito).
   - Detección automática de la URL pública de Render mediante la variable `RENDER_EXTERNAL_URL`.
   - Historial de pings con código HTTP y latencia en vivo.

---

## 🛠️ Ejecución en Local

1. Asegúrate de tener **Node.js** instalado (v18 o superior).
2. Abre la terminal en esta carpeta e instala las dependencias (si no lo has hecho):
   ```bash
   npm install
   ```
3. Inicia la aplicación:
   ```bash
   npm start
   ```
4. Abre en tu navegador:
   ```
   http://localhost:3000
   ```

---

## ☁️ Cómo Subir la App a On Render (Paso a Paso)

Render permite alojar servicios web Node.js de forma totalmente gratuita.

### Paso 1: Subir el proyecto a GitHub
1. Si no tienes un repositorio de Git creado en la carpeta, inicialízalo:
   ```bash
   git init
   git add .
   git commit -m "feat: Monitor de Notas Experimentales y Directorio"
   ```
2. Crea un nuevo repositorio en [GitHub.com](https://github.com/new).
3. Vincula y sube los cambios:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git branch -M main
   git push -u origin main
   ```

### Paso 2: Crear el Web Service en Render
1. Inicia sesión en [render.com](https://render.com).
2. Haz clic en **New +** y selecciona **Web Service**.
3. Conecta tu cuenta de GitHub y selecciona el repositorio que acabas de subir.
4. Render detectará automáticamente el archivo `render.yaml` o puedes configurar estos valores:
   - **Name**: `monitor-notas-experimentales` (o el nombre que prefieras).
   - **Region**: La más cercana a tu audiencia (ej. *Frankfurt* o *Oregon*).
   - **Branch**: `main`.
   - **Runtime**: `Node`.
   - **Build Command**: `npm install`.
   - **Start Command**: `npm start`.
   - **Instance Type**: **Free**.
5. Haz clic en **Create Web Service**.

---

## 🛡️ Cómo Evitar que Render se Cierre por Inactividad

En el plan gratuito, Render apaga (*spins down*) los servicios que pasen 15 minutos sin recibir visitas. Para evitar esto:

### Método 1: Auto-Ping Integrado (Automático)
- La aplicación **ya tiene programado internamente un auto-ping cada 10 minutos** a su endpoint `/api/health`.
- Cuando la despliegas en Render, este inyecta automáticamente la variable `RENDER_EXTERNAL_URL` (ej. `https://monitor-notas.onrender.com`). El servidor detecta esta URL y comienza a enviarse peticiones periódicas a sí mismo para mantenerse 100% activo.
- Puedes verificar el estado en la pestaña **"Render Anti-Sleep"** dentro de la web.

### Método 2: Respaldo Externo Gratuito con UptimeRobot (100% Garantizado)
A veces Render puede suspender procesos en segundo plano muy agresivos si no reciben tráfico desde fuera de su red. Para garantizar que **NUNCA** se duerma:

1. Ve a [uptimerobot.com](https://uptimerobot.com) y crea una cuenta gratuita.
2. Haz clic en **Add New Monitor**.
3. Configuración del monitor:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Keep-Alive Notas Experimentales`
   - **URL (or IP)**: `https://tu-app-en-render.onrender.com/api/health`
   - **Monitoring Interval**: `5 minutes` (o 10 minutes)
4. Haz clic en **Create Monitor**.

Con UptimeRobot enviando un ping exterior cada 5 minutos, Render considerará la web en uso continuo y **nunca se cerrará por inactividad**.

---

## 📊 Fuente de Datos (Google Sheet Conectado)
- **Documento**: `MI ESPACIO ET`
- **URL Pública**: [Google Sheet Web](https://docs.google.com/spreadsheets/d/e/2PACX-1vT1aBH7iMlllmZk28CNmqa-iLut7lHkfQH1GFXFIpjW6AJkYLwD9PpwSH7SDRVN5JeE3a7hjuT_HkrO/pubhtml)
- Los cambios realizados en el Google Sheet se reflejan inmediatamente al hacer clic en el botón **"Sincronizar"** en la barra superior de la aplicación.
