// // Add this at the VERY TOP of app.js
// if (!window.L || !L.Draw) {
//   console.error('Leaflet.draw failed to load!');
//   console.log('Leaflet available:', !!window.L);
//   console.log('Leaflet.draw available:', !!L.Draw);
  
//   // Try fallback loading
//   const script = document.createElement('script');
//   script.src = 'https://cdn.jsdelivr.net/npm/leaflet-draw@1.0.4/dist/leaflet.draw.js';
//   document.head.appendChild(script);
  
//   throw new Error('Leaflet.draw not loaded - attempting fallback. Please refresh.');
// }

// console.log('Leaflet version:', L.version); // Should show 1.9.4
// console.log('Leaflet.draw available:', !!L.Draw); // Should be true
// console.log('Draw Polygon class:', L.Draw.Polygon); // Should show function

// Define the approximate bounds for Long Island Sound
const LIS_BOUNDS = L.latLngBounds(
  L.latLng(39, -76), // SW corner
  L.latLng(43, -70)  // NE corner
);

// Initialize map with constraints
const map = L.map("map", { 
  zoomControl: false,
  minZoom: 9,  // Prevent zooming out too far
  //maxBounds: LIS_BOUNDS,  // Optional: constrain panning
  //maxBoundsViscosity: 1.0  // How strongly to enforce bounds
}).setView([40, -73.0], 7);  // Centered on LIS
L.control.zoom({ position: 'topright' }).addTo(map);

// Set these after map initialization
map.setMaxBounds(LIS_BOUNDS);
map.on('load', function() {
  map.fitBounds(LIS_BOUNDS);
});

// Prevent world wrapping (since we're focused on small area)
map.options.crs = L.CRS.EPSG3857;
map.options.worldCopyJump = false;

const basemaps = {
  satellite: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri", maxZoom: 19 }
  ),
  osm: L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  { 
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }
),
  topo: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri", maxZoom: 19 }
  ),
  terrain: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri", maxZoom: 19 }
  )
};

// Add the default basemap
let currentBasemap = basemaps.satellite;
currentBasemap.addTo(map);

// Handle basemap changes
document.getElementById('basemap-select').addEventListener('change', function(e) {
  const newBasemap = basemaps[e.target.value];
  
  if (currentBasemap) {
    map.removeLayer(currentBasemap);
  }
  
  newBasemap.addTo(map);
  currentBasemap = newBasemap;
  
  // Bring your data layers to front if needed
  if (currentLayer) {
    currentLayer.bringToFront();
  }
  if (overlayLayer) {
    overlayLayer.bringToFront();
  }
  if (polygonLayerGroup) {
    polygonLayerGroup.bringToFront();
  }
});

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles © Esri", maxZoom: 19 }
).addTo(map);


// // Add this check early in your JavaScript code
// if (typeof L.Draw === 'undefined') {
//     console.error('Leaflet.draw not loaded! Check:');
//     console.log('- Script loading order');
//     console.log('- Network tab for failed requests');
//     console.log('- Console for other errors');
//     alert('Drawing tools failed to load. Please refresh the page.');
// }

const baseURL = "https://storage.googleapis.com/lis-olci-netcdfs";
const backendURL = "https://olci-api-372215495851.us-central1.run.app/get_value";
const transectBackendURL = "https://olci-api-372215495851.us-central1.run.app/get_transect";
const timeseriesBackendURL = "https://olci-api-372215495851.us-central1.run.app/get_timeseries";
const overlayBackendURL = "https://olci-api-372215495851.us-central1.run.app/get_insitu_data";
const availableDatesBackendURL = "https://olci-api-372215495851.us-central1.run.app/get_available_dates";
const polygonBackendURL = "https://olci-api-372215495851.us-central1.run.app/get_polygon_stats";

// for development
// const backendURL = "http://localhost:8080/get_value";
// const transectBackendURL = "http://localhost:8080/get_transect";
// const timeseriesBackendURL = "http://localhost:8080/get_timeseries";
// const insituDataBackendURL = "http://localhost:8080/get_insitu_data";
// const availableDatesBackendURL = "http://localhost:8080/get_available_dates";
// const polygonBackendURL = "http://localhost:8080/get_polygon_stats";

const variableSettings = {
  cdom: { max: 12, units: "m⁻¹", label: "CDOM", field: "cdom" },
  spm: { max: 20, units: "mg L⁻¹", label: "SPM", field: "spm" },
  chl: { max: 20, units: "mg m⁻³", label: "Chl-a", field: "chl" },
};

// Function to enforce bounds when zooming
function enforceBounds() {
  if (!map.getBounds().intersects(LIS_BOUNDS)) {
    map.fitBounds(LIS_BOUNDS);
  }
}

// Set up event listeners
map.on('drag', enforceBounds);
map.on('zoomend', enforceBounds);

function clearAllTools() {
  // Reset transect tool
  resetTransect();
  
  // Reset timeseries tool
  resetTimeseries();
  
  // Clear overlay data
  clearOverlay();
  
  // Clear polygons
  clearPolygons();
  
  // Reset the tools dropdown to default
  document.getElementById('tools-select').value = 'none';
  
  // Disable all tools
  enableValuePicker(false);
  enableTransectTool(false);
  enableTimeseriesTool(false);
  enableOverlayTool(false);
  enablePolygonTool(false);
  
  // Reset cursor
  map.getContainer().style.cursor = '';
  
  // Reset polygon state variables
  drawnPolygon = null;
  polygonEnabled = false;
}

// Colormaps
function turboColorMap(v, max) {
  const t = Math.max(0, Math.min(max, v)) / max;
  const colors = [
    "#30123b", "#4145ab", "#4675ed", "#39a2fc", "#1bcfd4", 
    "#24eca6", "#61fc6c", "#a4fc3b", "#d1e834", "#f3c63a", 
    "#fe9b2d", "#f36315", "#d93806", "#a11907", "#7a0403"
  ];
  return interpolateColor(colors, t);
}

function viridisColorMap(v, max) {
  const t = Math.max(0, Math.min(max, v)) / max;
  const colors = ["#440154","#482777","#3e4989","#31688e","#26828e","#1f9e89","#35b779","#6ece58","#b5de2b","#fde725"];
  return interpolateColor(colors, t);
}

function magmaColorMap(v, max) {
  const t = Math.max(0, Math.min(max, v)) / max;
  const colors = ["#000004","#1b0c41","#4a0c6b","#781c6d","#a52c60","#cf4446","#ed6925","#fb9a06","#f7d13d","#fcfdbf"];
  return interpolateColor(colors, t);
}

function interpolateColor(colors, t) {
  const n = colors.length;
  const idx = Math.floor(t*(n-1));
  const c1 = colors[idx];
  const c2 = colors[Math.min(idx+1, n-1)];
  const ratio = (t*(n-1)) % 1;
  
  function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1),16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }
  
  function rgbToHex([r,g,b]) {
    return "#" + [r,g,b].map(v=>Math.round(v).toString(16).padStart(2,"0")).join("");
  }
  
  const rgb1 = hexToRgb(c1);
  const rgb2 = hexToRgb(c2);
  const rgb = rgb1.map((c,i) => c + (rgb2[i]-c)*ratio);
  return rgbToHex(rgb);
}

function parseDate(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return { path: `${year}/${month}/${day}`, compact: `${year}${month}${day}` };
}

function generateColorbarGradient(colormapFn, maxVal, steps=20) {
  const stops = [];
  for(let i=0; i<=steps; i++) {
    const val = (i/steps)*maxVal;
    const color = colormapFn(val,maxVal);
    const pct = (i/steps)*100;
    stops.push(`${color} ${pct.toFixed(1)}%`);
  }
  
  // Update the ticks
  updateColorbarTicks(maxVal);
  
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

// Call this when you update the colorbar
function updateColorbarTicks(maxValue) {
  const ticksContainer = document.getElementById('colorbar-ticks');
  if (!ticksContainer) return;

  // Clear existing ticks
  ticksContainer.innerHTML = '';

  // Add three ticks: min, mid, max
  const ticks = [0, maxValue/2, maxValue];
  
  ticks.forEach(value => {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.dataset.value = value.toFixed(1);
    ticksContainer.appendChild(tick);
  });
}

const now = new Date();
let currentMonth = now.getMonth(); // 0-indexed (0=January, 11=December)
let currentYear = now.getFullYear(); 

let currentLayer = null;
let currentVariable = "cdom";
let currentColormap = "turbo";
let currentDate = now.toISOString().split('T')[0]; // "2025-08-15" (today's date)
let valuePickerEnabled = false;
let transectEnabled = false;
let timeseriesEnabled = false;
let overlayEnabled = false;
let polygonEnabled = false;
let transectPoints = [];
let transectLine = null;
let transectMarkers = [];
let timeseriesMarker = null;
let overlayLayer = null;
let currentChart = null;
let currentGraphType = null;
let polygonTool = null;
let drawnPolygon = null;
let polygonLayerGroup = null;


const tooltip = document.getElementById('value-tooltip');


// Tool control functions
function enableValuePicker(enable) {
  valuePickerEnabled = enable;
  if(enable) {
    tooltip.style.display = 'block';
    map.getContainer().style.cursor = 'crosshair';
  } else {
    tooltip.style.display = 'none';
    map.getContainer().style.cursor = '';
  }
}

function enableTransectTool(enable) {
  transectEnabled = enable;
  if (enable) {
    map.getContainer().style.cursor = 'crosshair';
    resetTransect();
  } else {
    map.getContainer().style.cursor = '';
    resetTransect();
  }
}

function enableTimeseriesTool(enable) {
  timeseriesEnabled = enable;
  if (enable) {
    map.getContainer().style.cursor = 'crosshair';
    resetTimeseries();
  } else {
    map.getContainer().style.cursor = '';
    resetTimeseries();
  }
}

function enableOverlayTool(enable) {
  overlayEnabled = enable;
  if (enable) {
    map.getContainer().style.cursor = 'default';
    showInSituDatePicker();
  } else {
    map.getContainer().style.cursor = '';
    clearOverlay();
  }
}

function enablePolygonTool(enable) {
  polygonEnabled = enable;
  
  if (enable) {
    // Initialize the draw control if it doesn't exist
    if (!window.L.Draw) {
      console.error("Leaflet.draw plugin not loaded!");
      alert("Polygon tool requires Leaflet.draw plugin to be loaded");
      return;
    }
    
    if (!polygonTool) {
      polygonTool = new L.Draw.Polygon(map, {
        shapeOptions: {
          color: '#3388ff',
          weight: 2,
          opacity: 1,
          fillColor: '#3388ff',
          fillOpacity: 0.3
        },
        guidelineDistance: 20,
        showArea: true,
        metric: true,
        zIndexOffset: 1000
      });
      
      // Create a layer group for polygons if it doesn't exist
      if (!polygonLayerGroup) {
        polygonLayerGroup = new L.LayerGroup().addTo(map);
      }
      
      // Add event listener for when a polygon is created
      map.on(L.Draw.Event.CREATED, handlePolygonCreated);
    }
    
    // Start drawing
    polygonTool.enable();
    map.getContainer().style.cursor = 'crosshair';
  } else {
    // Disable drawing if it's active
    if (polygonTool) {
      polygonTool.disable();
    }
    map.getContainer().style.cursor = '';
  }
}

function handlePolygonCreated(e) {
  drawnPolygon = e.layer;
  polygonLayerGroup.addLayer(drawnPolygon);
  
  // Get polygon stats
  analyzePolygonArea(drawnPolygon);
}





// Reset functions
function resetTransect() {
  if (transectLine) map.removeLayer(transectLine);
  transectMarkers.forEach(marker => map.removeLayer(marker));
  transectLine = null;
  transectMarkers = [];
  transectPoints = [];
  closeGraph();
}

function resetTimeseries() {
  if (timeseriesMarker) map.removeLayer(timeseriesMarker);
  timeseriesMarker = null;
  closeGraph();
}

function clearOverlay() {
  if (overlayLayer) {
    map.removeLayer(overlayLayer);
    overlayLayer = null;
  }
}

function closeGraph() {
  document.getElementById("graph-container").style.display = 'none';
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }
  currentGraphType = null;
  document.getElementById("download-csv").style.display = 'none';
}

function clearPolygons() {
  if (polygonLayerGroup) {
    polygonLayerGroup.clearLayers();
    drawnPolygon = null;
  }
  const statsPanel = document.getElementById('polygon-stats-panel');
  if (statsPanel) {
    statsPanel.style.display = 'none';
  }
}

// Date picker functions
function showDatePicker() {
  document.getElementById('date-picker-modal').style.display = 'block';
}

function hideDatePicker() {
  document.getElementById('date-picker-modal').style.display = 'none';
}

function handlePolygonCreated(e) {
  drawnPolygon = e.layer;
  polygonLayerGroup.addLayer(drawnPolygon);
  
  // Get polygon stats
  analyzePolygonArea(drawnPolygon);
}


// Map click handler
map.on('click', async e => {
  if (transectEnabled) {
    handleTransectClick(e.latlng);
  } else if (timeseriesEnabled) {
    handleTimeseriesClick(e.latlng);
  } else if (valuePickerEnabled && currentLayer) {
    handleValuePickerClick(e);
  }
});



async function handleTransectClick(point) {
  transectPoints.push(point);
  
  const marker = L.circleMarker(point, {
    radius: 5,
    fillColor: "#ff0000",
    color: "#fff",
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8
  }).addTo(map);
  transectMarkers.push(marker);
  
  if (transectPoints.length === 2) {
    transectLine = L.polyline(transectPoints, {
      color: '#ff0000',
      dashArray: '5,5',
      weight: 2
    }).addTo(map);
    await getTransectData();
  }
}

async function handleTimeseriesClick(point) {
  if (timeseriesMarker) map.removeLayer(timeseriesMarker);
  
  timeseriesMarker = L.circleMarker(point, {
    radius: 5,
    fillColor: "#ff0000",
    color: "#fff",
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8
  }).addTo(map);
  
  showDatePicker();
  timeseriesMarker.point = point;
}

async function handleValuePickerClick(e) {
  tooltip.style.display = 'block';
  tooltip.style.left = (e.originalEvent.clientX + 15) + 'px';
  tooltip.style.top = (e.originalEvent.clientY + 15) + 'px';
  tooltip.textContent = 'Loading...';

  const { path, compact } = parseDate(currentDate);
  const url = `${baseURL}/${path}/LIS_${compact}_${currentVariable}.tif`;

  try {
    const response = await fetch(`${backendURL}?url=${encodeURIComponent(url)}&lat=${e.latlng.lat}&lon=${e.latlng.lng}`);
    const data = await response.json();

    if(response.ok && data.value !== undefined && data.value !== null) {
      const s = variableSettings[currentVariable];
      tooltip.textContent = `${s.label}: ${parseFloat(data.value).toFixed(3)} ${s.units}`;
    } else {
      tooltip.textContent = 'No data';
    }
  } catch (err) {
    tooltip.textContent = 'Error fetching';
  }
}

// Data fetching functions
async function getTransectData() {
  if (!currentLayer || transectPoints.length !== 2) return;
  
  const { path, compact } = parseDate(currentDate);
  const url = `${baseURL}/${path}/LIS_${compact}_${currentVariable}.tif`;
  
  try {
    const response = await fetch(`${transectBackendURL}?url=${encodeURIComponent(url)}&start_lat=${transectPoints[0].lat}&start_lon=${transectPoints[0].lng}&end_lat=${transectPoints[1].lat}&end_lon=${transectPoints[1].lng}`);
    const data = await response.json();
    
    if (response.ok && data.values) {
      plotGraph(data.values, data.distances, 'Transect Profile', 'transect');
    } else {
      alert('Error getting transect data');
    }
  } catch (err) {
    console.error("Transect error:", err);
    alert('Error getting transect data');
  }
}

async function getTimeseriesData(point, startDate, endDate) {
  const progressContainer = document.querySelector("#date-picker-modal #progress-container");
  const progressBar = document.getElementById("timeseries-progress");
  const progressText = document.getElementById("progress-text");

  try {
    progressContainer.style.display = 'block';
    progressBar.value = 0;
    progressText.textContent = '0%';
    
    const dates = generateDatesInRange(startDate, endDate);
    const values = [];
    const validDates = [];
    
    for (const date of dates) {
      const url = formatUrl(date, currentVariable);
      const value = await getPixelValue(url, point.lat, point.lng);
      
      if (value !== null && value !== -9999) {
        values.push(value);
        validDates.push(date);
      }
      
      const progress = Math.round(((dates.indexOf(date) + 1) / dates.length) * 100);
      progressBar.value = progress;
      progressText.textContent = `${progress}%`;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    progressContainer.style.display = 'none';
    
    if (values.length > 0) {
      hideDatePicker();
      plotGraph(values, validDates, 'Timeseries', 'timeseries');
    } else {
      alert('No valid data available for the selected date range');
    }
  } catch (err) {
    progressContainer.style.display = 'none';
    console.error("Timeseries error:", err);
    alert('Error getting timeseries data');
  }
}

async function loadOverlayData() {
  if (!overlayEnabled) return;
  
  try {
    // Use the date string directly (no transformation needed)
    console.log("Fetching overlay data for:", currentVariable, currentDate);
    
    const response = await fetch(`${insituDataBackendURL}?variable=${currentVariable}&date=${currentDate}`);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || "Failed to load data");
    }
    
    const { data } = await response.json();
    
    if (!data || data.length === 0) {
      console.log(`No in situ data for ${currentVariable} on ${currentDate}`);
      alert(`No in situ data available for ${currentVariable} on ${currentDate}`);
      return;
    }
    
    updateOverlay(data);
  } catch (err) {
    console.error("Overlay data error:", err);
    alert(`Error loading in situ data: ${err.message}`);
  }
}

// In Situ Date Picker Functions
async function getAvailableInSituDates() {
  try {
    const response = await fetch(`${availableDatesBackendURL}?variable=${currentVariable}`);
    if (!response.ok) throw new Error('Failed to fetch available dates');
    const { dates } = await response.json();
    return dates;
  } catch (err) {
    console.error("Error fetching available dates:", err);
    return [];
  }
}

async function showInSituDatePicker() {
  const modal = document.getElementById('insitu-date-modal');
  const dateList = document.getElementById('insitu-date-list');
  
  // Show loading state
  dateList.innerHTML = '<li class="loading">Loading available dates...</li>';
  modal.style.display = 'block';
  
  try {
    // Fetch available dates for the current variable
    const response = await fetch(`${availableDatesBackendURL}?variable=${currentVariable}`);
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status} ${response.statusText}`);
    }
    
    const { dates } = await response.json();
    
    // Clear the list
    dateList.innerHTML = '';
    
    if (!dates || dates.length === 0) {
      dateList.innerHTML = '<li class="no-dates">No in situ data available for selected variable</li>';
      return;
    }
    
    // Populate the list with clickable dates
    dates.forEach(dateStr => {
      const li = document.createElement('li');
      
      // Use the date string directly (already in YYYY-MM-DD format)
      li.textContent = formatDisplayDate(dateStr);
      li.dataset.date = dateStr;  // Store the original date string
      
      li.addEventListener('click', async () => {
        currentDate = dateStr;  // Use the original date string
        // Update the main date picker
        updateMainDatePicker(dateStr);
        await loadVariable(currentVariable);
        await loadOverlayData();
        modal.style.display = 'none';
      });
      
      dateList.appendChild(li);
    });
  } catch (err) {
    console.error("Error loading dates:", err);
    dateList.innerHTML = `
      <li class="error">Failed to load dates</li>
      <li class="error-detail">${err.message}</li>
      <li class="retry" onclick="showInSituDatePicker()">Click to retry</li>
    `;
  }
}

async function analyzePolygonArea(polygon) {
  if (!currentLayer || !polygon) return;
  
  const { path, compact } = parseDate(currentDate);
  const url = `${baseURL}/${path}/LIS_${compact}_${currentVariable}.tif`;
  
  // Get polygon coordinates
  const coords = polygon.getLatLngs()[0].map(ll => [ll.lng, ll.lat]);
  
  try {
    const response = await fetch(polygonBackendURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        polygon: {
          type: "Polygon",
          coordinates: [coords]
        }
      })
    });
    
    if (!response.ok) {
      // Handle 404 (no data) differently from other errors
      if (response.status === 404) {
        showPolygonError("No valid data available for this date/area");
        return;
      }
      
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`${response.status}: ${error.detail || "Failed to get polygon stats"}`);
    }
    
    const stats = await response.json();
    
    // Additional check for empty data
    if (stats.count === 0 || stats.mean === null) {
      showPolygonError("No valid data points found in this area");
    } else {
      showPolygonStats(stats);
    }
  } catch (err) {
    console.error("Polygon analysis error:", err);
    // More user-friendly error message
      showPolygonError("No data available in polygon area");
  }
}




function updateMainDatePicker(dateStr) {
  // Parse the date string as UTC to avoid timezone issues
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  
  // Update the current month/year if needed
  if (date.getUTCMonth() !== currentMonth || date.getUTCFullYear() !== currentYear) {
    currentMonth = date.getUTCMonth();
    currentYear = date.getUTCFullYear();
    renderCalendar();
  }
  
  // Find and select the day in the calendar
  const calendarEl = document.getElementById('calendar');
  const days = calendarEl.querySelectorAll('.calendar-day:not(.other-month)');
  
  days.forEach(dayEl => {
    dayEl.classList.remove('selected');
    const dayNum = parseInt(dayEl.textContent);
    if (dayNum === date.getUTCDate()) {
      dayEl.classList.add('selected');
    }
  });
  
  // Update the current date display
  const currentDateEl = document.getElementById('current-date-display');
  if (currentDateEl) {
    currentDateEl.textContent = formatDisplayDate(dateStr);
  }
}

function updateOverlay(data) {
  try {
    clearOverlay();
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.log("No valid data points to display");
      return;
    }

    overlayLayer = L.layerGroup().addTo(map);
    
    const cmap = colormaps[currentColormap];
    const maxVal = variableSettings[currentVariable].max;
    
    data.forEach(item => {
      try {
        if (!item.lat || !item.lon || item.value === undefined) {
          console.warn("Invalid data point:", item);
          return;
        }
        
        const latLng = L.latLng(item.lat, item.lon);
        
        const color = cmap(item.value, maxVal);
        
        const marker = L.circleMarker(latLng, {
          radius: 8,
          fillColor: color,
          color: '#fff',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(overlayLayer);
        
        const s = variableSettings[currentVariable];
        marker.bindPopup(`
          <div style="text-align:center">
            <strong>${s.label}</strong><br>
            Value: ${item.value.toFixed(3)} ${s.units}<br>
            Location: ${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}<br>
            Date: ${item.date || currentDate}
          </div>
        `);
      } catch (e) {
        console.warn("Error creating marker:", e);
      }
    });
    
  } catch (err) {
    console.error("Error updating overlay:", err);
    alert("Error displaying in situ data: " + err.message);
  }
}

// Helper function to format date for display
function formatDisplayDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[parseInt(month)-1]} ${parseInt(day)}, ${year}`;
}


// Helper functions for date generation and URL formatting
function generateDatesInRange(startDate, endDate) {
const dates = [];
let current = new Date(startDate);
const end = new Date(endDate);

while (current <= end) {
  dates.push(current.toISOString().split('T')[0]);
  current.setDate(current.getDate() + 1);
}

return dates;
}

function formatUrl(date, variable) {
  const dt = new Date(date);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${baseURL}/${year}/${month}/${day}/LIS_${year}${month}${day}_${variable}.tif`;
}

function showPolygonStats(stats) {
  const s = variableSettings[currentVariable];
  
  // Create or update stats display
  let statsPanel = document.getElementById('polygon-stats-panel');
  if (!statsPanel) {
    statsPanel = document.createElement('div');
    statsPanel.id = 'polygon-stats-panel';
    statsPanel.className = 'stats-panel';
    document.body.appendChild(statsPanel);
  }
  
  statsPanel.innerHTML = `
    <h3>Polygon Statistics (${s.label})</h3>
    <div class="stat-row"><span>Mean:</span> ${stats.mean.toFixed(3)} ${s.units}</div>
    <div class="stat-row"><span>Min:</span> ${stats.min.toFixed(3)} ${s.units}</div>
    <div class="stat-row"><span>Max:</span> ${stats.max.toFixed(3)} ${s.units}</div>
    <div class="stat-row"><span>Std Dev:</span> ${stats.std.toFixed(3)} ${s.units}</div>
    <div class="stat-row"><span>Valid Pixels:</span> ${stats.count}</div>
    <button id="export-polygon-data">Export Data</button>
    <button id="close-polygon-stats">Close</button>
  `;
  
  // Position the panel (adjust as needed)
  statsPanel.style.display = 'block';
  
  // Add event listeners
  document.getElementById('export-polygon-data').addEventListener('click', () => {
    exportPolygonData(stats);
  });
  
  document.getElementById('close-polygon-stats').addEventListener('click', () => {
    statsPanel.style.display = 'none';
  });
}

function showPolygonError(message) {
  const s = variableSettings[currentVariable];
  
  let statsPanel = document.getElementById('polygon-stats-panel');
  if (!statsPanel) {
    statsPanel = document.createElement('div');
    statsPanel.id = 'polygon-stats-panel';
    statsPanel.className = 'stats-panel';
    document.body.appendChild(statsPanel);
  }
  
  statsPanel.innerHTML = `
    <h3>Polygon Statistics (${s.label})</h3>
    <div class="error-message">
      <i class="warning-icon">⚠️</i>
      ${message}
    </div>
    <div class="error-detail">Date: ${formatDisplayDate(currentDate)}</div>
    <button id="close-polygon-stats">Close</button>
  `;
  
  statsPanel.style.display = 'block';
  
  document.getElementById('close-polygon-stats').addEventListener('click', () => {
    statsPanel.style.display = 'none';
  });
}

function exportPolygonData(stats) {
  const s = variableSettings[currentVariable];
  const dateStr = currentDate.replace(/-/g, '');
  
  let csvContent = `Polygon Statistics - ${s.label} (${s.units})\n`;
  csvContent += `Date: ${currentDate}\n\n`;
  csvContent += `Statistic,Value\n`;
  csvContent += `Mean,${stats.mean}\n`;
  csvContent += `Min,${stats.min}\n`;
  csvContent += `Max,${stats.max}\n`;
  csvContent += `Standard Deviation,${stats.std}\n`;
  csvContent += `Valid Pixels,${stats.count}\n`;
  
  // Add polygon coordinates
  csvContent += `\nPolygon Coordinates (Lat,Lng)\n`;
  drawnPolygon.getLatLngs()[0].forEach(point => {
    csvContent += `${point.lat},${point.lng}\n`;
  });
  
  // Download as CSV
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `polygon_stats_${currentVariable}_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function getPixelValue(url, lat, lon) {
  try {
    const response = await fetch(`${backendURL}?url=${encodeURIComponent(url)}&lat=${lat}&lon=${lon}`);
    const data = await response.json();
    return response.ok && data.value !== undefined ? data.value : null;
  } catch (err) {
    return null;
  }
}

// Chart functions
function plotGraph(values, labels, title, graphType) {
  const container = document.getElementById("graph-container");
  container.style.display = 'block';
  
  document.getElementById("graph-title").textContent = title;
  document.getElementById("download-csv").style.display = 'block';
  currentGraphType = graphType;
  
  const ctx = document.getElementById("graph-canvas").getContext('2d');
  if (currentChart) currentChart.destroy();
  
  const s = variableSettings[currentVariable];
  const label = `${s.label} (${s.units})`;
  const labelText = document.getElementById("colorbar-label").innerText;
  const match = labelText.match(/range:\s*0–(\d+(\.\d+)?)/);
  const dataMax = match ? parseFloat(match[1]) : s.max;
  
  currentChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: values,
        borderColor: '#66aaff',
        backgroundColor: graphType === 'timeseries' ? 'transparent' : 'rgba(102, 170, 255, 0.2)',
        borderWidth: 2,
        pointRadius: graphType === 'timeseries' ? 3 : 1,
        pointHoverRadius: graphType === 'timeseries' ? 5 : 3,
        fill: graphType === 'timeseries' ? false : true,
        spanGaps: true
      }]
    },
    options: getChartOptions(graphType, label, dataMax)
  });
}

function getChartOptions(graphType, label, dataMax) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 10, bottom: 10, left: 10, right: 10 } },
    scales: {
      x: {
        title: { display: true, text: graphType === 'timeseries' ? 'Date' : 'Distance (km)', color: '#ddd' },
        grid: { color: 'rgba(255,255,255,0.1)' },
        ticks: { color: '#ddd', maxRotation: 45, minRotation: 45 }
      },
      y: {
        min: 0,
        max: dataMax * 1.1,
        title: { display: true, text: label, color: '#ddd' },
        grid: { color: 'rgba(255,255,255,0.1)' },
        ticks: { color: '#ddd' }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0,0,0,0.8)',
        titleColor: '#66aaff',
        bodyColor: '#eee'
      }
    }
  };
}

async function loadVariable(variable) {
  currentVariable = variable;
  const { path, compact } = parseDate(currentDate);
  const { max, units, label } = variableSettings[variable];
  document.getElementById("colorbar").style.background = generateColorbarGradient(colormaps[currentColormap], max);
  updateColorbarTicks(max);
  const fullURL = `${baseURL}/${path}/LIS_${compact}_${variable}.tif`;

  if (currentLayer) map.removeLayer(currentLayer);

  try {
    const response = await fetch(fullURL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const georaster = await parseGeoraster(arrayBuffer);

    currentLayer = new GeoRasterLayer({
      georaster,
      opacity: 0.8,
      resolution: 512,
      pixelValuesToColorFn: values => {
        const val = values[0];
        return val === null || val === -9999 ? null : colormaps[currentColormap](val, max);
      }
    });

    currentLayer.addTo(map);
    map.fitBounds(currentLayer.getBounds());

    document.getElementById("colorbar-label").innerText = `${label} (${units})`;
    document.getElementById("colorbar").style.background = generateColorbarGradient(colormaps[currentColormap], max);

    // Only recalculate polygon stats if polygon tool is enabled and a polygon exists
    if (polygonEnabled && drawnPolygon) {
      analyzePolygonArea(drawnPolygon);
    }

    if (overlayEnabled) loadOverlayData();
  } catch(err) {
    console.error("Failed to load GeoTIFF:", err);
    // Show error in stats panel if polygon tool is active
    if (polygonEnabled && drawnPolygon) {
      showPolygonError(`Error loading data for ${currentDate}`);
    } else {
      alert(`Error loading ${variable} layer for date ${currentDate}`);
    }
  }
}

// Event listeners
document.getElementById("variable-select").addEventListener("change", e => {
  loadVariable(e.target.value);
});

document.getElementById("colormap-select").addEventListener("change", e => {
  currentColormap = e.target.value;
  loadVariable(currentVariable);
});

document.getElementById("tools-select").addEventListener("change", e => {
  const tool = e.target.value;
  enableValuePicker(tool === "value-picker");
  enableTransectTool(tool === "transect");
  enableTimeseriesTool(tool === "timeseries");
  enableOverlayTool(tool === "overlay");
  enablePolygonTool(tool === "polygon");
  
  // Reset all other tools when one is selected
  if (tool !== "value-picker") enableValuePicker(false);
  if (tool !== "transect") enableTransectTool(false);
  if (tool !== "timeseries") enableTimeseriesTool(false);
  if (tool !== "overlay") enableOverlayTool(false);
  if (tool !== "polygon") enablePolygonTool(false);
});

document.getElementById("graph-close").addEventListener('click', closeGraph);
document.getElementById("date-picker-cancel").addEventListener('click', () => {
  hideDatePicker();
  resetTimeseries();
});

document.getElementById("date-picker-submit").addEventListener('click', async () => {
  const startDate = document.getElementById("start-date").value;
  const endDate = document.getElementById("end-date").value;
  if (startDate && endDate && timeseriesMarker && timeseriesMarker.point) {
    await getTimeseriesData(timeseriesMarker.point, startDate, endDate);
  }
  hideDatePicker();
});



function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  while (calendarEl.children.length > 7) {
    calendarEl.removeChild(calendarEl.lastChild);
  }
  
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
  
  const monthNames = ["January", "February", "March", "April", "May", "June", 
                     "July", "August", "September", "October", "November", "December"];
  document.getElementById('calendar-title').textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  document.getElementById('month-select').value = currentMonth;
  document.getElementById('year-select').value = currentYear;
  
  // Previous month days
  for (let i = 0; i < firstDay; i++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day other-month disabled';
    dayEl.textContent = daysInPrevMonth - firstDay + i + 1;
    calendarEl.appendChild(dayEl);
  }
  
  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    
    if (dateStr === currentDate) dayEl.classList.add('selected');
    if (dateStr === new Date().toISOString().split('T')[0]) dayEl.classList.add('today');
    
    dayEl.textContent = i;
    dayEl.addEventListener('click', () => {
      if (!dayEl.classList.contains('disabled')) {
        document.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected'));
        dayEl.classList.add('selected');
        currentDate = dateStr;
        loadVariable(currentVariable);
      }
    });
    
    calendarEl.appendChild(dayEl);
  }
  
  // Next month days
  const remainingCells = 42 - (firstDay + daysInMonth);
  for (let i = 1; i <= remainingCells; i++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day other-month disabled';
    dayEl.textContent = i;
    calendarEl.appendChild(dayEl);
  }
}

document.getElementById('prev-month').addEventListener('click', () => {
  currentMonth = currentMonth < 1 ? 11 : currentMonth - 1;
  if (currentMonth === 11) currentYear--;
  renderCalendar();
});

document.getElementById('next-month').addEventListener('click', () => {
  currentMonth = currentMonth > 10 ? 0 : currentMonth + 1;
  if (currentMonth === 0) currentYear++;
  renderCalendar();
});

document.getElementById("download-csv").addEventListener('click', () => {
  if (!currentChart) return;
  
  let csvContent = "";
  const labels = currentChart.data.labels;
  const values = currentChart.data.datasets[0].data;
  const s = variableSettings[currentVariable];
  
  if (currentGraphType === 'transect') {
    csvContent = "Distance (km),Value,Latitude,Longitude\n";
    const start = transectPoints[0];
    const end = transectPoints[1];
    
    for (let i = 0; i < labels.length; i++) {
      const fraction = labels[i] / labels[labels.length - 1];
      const lat = start.lat + (end.lat - start.lat) * fraction;
      const lng = start.lng + (end.lng - start.lng) * fraction;
      csvContent += `${labels[i]},${values[i]},${lat},${lng}\n`;
    }
  } else if (currentGraphType === 'timeseries') {
    csvContent = "Date,Value,Latitude,Longitude\n";
    const point = timeseriesMarker.point;
    for (let i = 0; i < labels.length; i++) {
      csvContent += `${labels[i]},${values[i]},${point.lat},${point.lng}\n`;
    }
  }
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${currentGraphType}_${currentVariable}_data.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Month/year dropdown
document.getElementById('calendar-title').addEventListener('click', (e) => {
  const dropdown = document.getElementById('month-year-dropdown');
  const rect = e.target.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top = `${rect.bottom + 5}px`;
  dropdown.classList.toggle('show');
});

document.getElementById('apply-month-year').addEventListener('click', () => {
  currentMonth = parseInt(document.getElementById('month-select').value);
  currentYear = parseInt(document.getElementById('year-select').value);
  document.getElementById('month-year-dropdown').classList.remove('show');
  renderCalendar();
});



document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('month-year-dropdown');
  if (!dropdown.contains(e.target) && e.target.id !== 'calendar-title') {
    dropdown.classList.remove('show');
  }
});

document.getElementById('clear-all-tools').addEventListener('click', clearAllTools);

// Initialize
const colormaps = {
  turbo: turboColorMap,
  viridis: viridisColorMap,
  magma: magmaColorMap
}



renderCalendar();
loadVariable(currentVariable);
enableValuePicker(false);