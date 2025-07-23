const map = L.map("map", { zoomControl: false }).setView([41.0, -72.0], 9);
L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles © Esri", maxZoom: 19 }
).addTo(map);

const baseURL = "https://storage.googleapis.com/lis-olci-netcdfs";
const backendURL = "https://olci-api-372215495851.us-central1.run.app/get_value";
const transectBackendURL = "https://olci-api-372215495851.us-central1.run.app/get_transect";
const timeseriesBackendURL = "https://olci-api-372215495851.us-central1.run.app/get_timeseries";


const variableSettings = {
  cdom: { max: 12, units: "m⁻¹", label: "CDOM" },
  spm: { max: 20, units: "mg L⁻¹", label: "SPM" },
  chl: { max: 20, units: "mg m⁻³", label: "Chl-a" },
};

// Colormaps
function turboColorMap(v, max) {
  const t = Math.max(0, Math.min(max, v)) / max;
  const r = Math.floor(34 + 220 * t);
  const g = Math.floor(34 + 175 * (1 - Math.abs(t - 0.5) * 2));
  const b = Math.floor(58 + 190 * (1 - t));
  return `rgb(${r},${g},${b})`;
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
    return [(bigint >> 16) & 255,(bigint >> 8) & 255, bigint & 255];
  }
  function rgbToHex([r,g,b]){
    return "#" + [r,g,b].map(v=>Math.round(v).toString(16).padStart(2,"0")).join("");
  }
  const rgb1 = hexToRgb(c1);
  const rgb2 = hexToRgb(c2);
  const rgb = rgb1.map((c,i) => c + (rgb2[i]-c)*ratio);
  return rgbToHex(rgb);
}

function parseDate(dateStr){
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return { path: `${year}/${month}/${day}`, compact: `${year}${month}${day}` };
}

function generateColorbarGradient(colormapFn, maxVal, steps=20){
  const stops = [];
  for(let i=0; i<=steps; i++){
    const val = (i/steps)*maxVal;
    const color = colormapFn(val,maxVal);
    const pct = (i/steps)*100;
    stops.push(`${color} ${pct.toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

let currentLayer = null;
let currentVariable = "cdom";
let currentColormap = "turbo";
let currentDate = "2025-07-14";
let valuePickerEnabled = false;
let transectEnabled = false;
let timeseriesEnabled = false;
let transectPoints = [];
let transectLine = null;
let transectMarkers = [];
let timeseriesMarker = null;
let currentChart = null;
let currentGraphType = null;

const tooltip = document.getElementById('value-tooltip');

function enableValuePicker(enable) {
  valuePickerEnabled = enable;
  if(enable){
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

function resetTransect() {
  if (transectLine) {
    map.removeLayer(transectLine);
    transectLine = null;
  }
  transectMarkers.forEach(marker => map.removeLayer(marker));
  transectMarkers = [];
  transectPoints = [];
  closeGraph();
}

function resetTimeseries() {
  if (timeseriesMarker) {
    map.removeLayer(timeseriesMarker);
    timeseriesMarker = null;
  }
  closeGraph();
}

function closeGraph() {
  document.getElementById("graph-container").style.display = 'none';
  if (currentChart) {
      currentChart.destroy();
      currentChart = null;
  }
  currentGraphType = null;
  document.getElementById("download-csv").style.display = 'none'; // Add this line
}

function showDatePicker() {
  document.getElementById('date-picker-modal').style.display = 'block';
}

function hideDatePicker() {
  document.getElementById('date-picker-modal').style.display = 'none';
}

map.on('click', async e => {
  if (transectEnabled) {
    const point = e.latlng;
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
  } else if (timeseriesEnabled) {
    const point = e.latlng;
    
    // Remove previous marker if exists
    if (timeseriesMarker) {
      map.removeLayer(timeseriesMarker);
    }
    
    // Add new marker
    timeseriesMarker = L.circleMarker(point, {
      radius: 5,
      fillColor: "#ff0000",
      color: "#fff",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);
    
    // Show date picker
    showDatePicker();
    
    // Store the point for later use when dates are selected
    timeseriesMarker.point = point;
  } else if (valuePickerEnabled && currentLayer) {
    tooltip.style.display = 'block';
    tooltip.style.left = (e.originalEvent.clientX + 15) + 'px';
    tooltip.style.top = (e.originalEvent.clientY + 15) + 'px';
    tooltip.textContent = 'Loading...';

    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    const { path, compact } = parseDate(currentDate);
    const url = `${baseURL}/${path}/LIS_${compact}_${currentVariable}.tif`;

    try {
      const response = await fetch(`${backendURL}?url=${encodeURIComponent(url)}&lat=${lat}&lon=${lon}`);
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
});

async function getTransectData() {
  if (!currentLayer || transectPoints.length !== 2) return;
  
  const { path, compact } = parseDate(currentDate);
  const url = `${baseURL}/${path}/LIS_${compact}_${currentVariable}.tif`;
  const startLat = transectPoints[0].lat;
  const startLon = transectPoints[0].lng;
  const endLat = transectPoints[1].lat;
  const endLon = transectPoints[1].lng;
  
  try {
    const response = await fetch(`${transectBackendURL}?url=${encodeURIComponent(url)}&start_lat=${startLat}&start_lon=${startLon}&end_lat=${endLat}&end_lon=${endLon}`);
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
  // Show progress bar
  progressContainer.style.display = 'block';
  progressBar.value = 0;
  progressText.textContent = '0%';
  
  // Get all dates first
  const dates = generateDatesInRange(startDate, endDate);
  const totalDates = dates.length;
  let processed = 0;
  
  const values = [];
  const validDates = [];
  
  for (const date of dates) {
    const url = formatUrl(date, currentVariable);
    const value = await getPixelValue(url, point.lat, point.lng);
    
    // Only include valid values (not null and not -9999)
    if (value !== null && value !== -9999) {
      values.push(value);
      validDates.push(date);
    }
    
    // Update progress
    processed++;
    const progress = Math.round((processed / totalDates) * 100);
    progressBar.value = progress;
    progressText.textContent = `${progress}%`;
    
    // Small delay to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Hide progress bar when done
  progressContainer.style.display = 'none';
  
  if (values.length > 0) {
    hideDatePicker();  // Close the date picker when done
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

async function getPixelValue(url, lat, lon) {
try {
  const response = await fetch(`${backendURL}?url=${encodeURIComponent(url)}&lat=${lat}&lon=${lon}`);
  const data = await response.json();
  return response.ok && data.value !== undefined ? data.value : null;
} catch (err) {
  return null;
}
}

function plotGraph(values, labels, title, graphType) {
  const container = document.getElementById("graph-container");
  container.style.display = 'block';
  
  document.getElementById("graph-title").textContent = title;
  document.getElementById("download-csv").style.display = 'block'; // Add this line
  currentGraphType = graphType;
  
  const ctx = document.getElementById("graph-canvas").getContext('2d');
  
  if (currentChart) {
    currentChart.destroy();
  }
  
  const s = variableSettings[currentVariable];
  const label = `${s.label} (${s.units})`;
  
  // Get the range from the colorbar label
  const labelText = document.getElementById("colorbar-label").innerText;
  const match = labelText.match(/range:\s*0–(\d+(\.\d+)?)/);
  let dataMax = 1;
  if (match) {
    dataMax = parseFloat(match[1]);
  }
  
  // Calculate reasonable min/max for y-axis
  const dataMin = 0;
  const padding = 0;
  
  currentChart = new Chart(ctx, {
      type: graphType === 'timeseries' ? 'line' : 'line',
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
              // Add this to handle missing data
              spanGaps: true
              }]
          },

    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 10,
          bottom: 10,
          left: 10,
          right: 10
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: graphType === 'timeseries' ? 'Date' : 'Distance (km)',
            color: '#ddd',
            font: {
              size: 12
            }
          },
          grid: {
            color: 'rgba(255,255,255,0.1)'
          },
          ticks: {
            color: '#ddd',
            maxRotation: graphType === 'timeseries' ? 45 : 45,
            minRotation: graphType === 'timeseries' ? 45 : 45
          }
        },
        y: {
          min: Math.max(0, dataMin - padding),
          max: dataMax + padding,
          title: {
            display: true,
            text: label,
            color: '#ddd',
            font: {
              size: 12
            }
          },
          grid: {
            color: 'rgba(255,255,255,0.1)'
          },
          ticks: {
            color: '#ddd'
          }
        }
      },
      plugins: {
        legend: {
          display: false,
          labels: {
            color: '#ddd',
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0,0,0,0.8)',
          titleColor: '#66aaff',
          bodyColor: '#eee',
          bodyFont: {
            size: 12
          },
          titleFont: {
            size: 12
          }
        }
      }
    }
  });
}

map.on('mouseout', () => {
  tooltip.style.display = 'none';
});

async function loadVariable(variable){
  currentVariable = variable;
  const { path, compact } = parseDate(currentDate);
  const { max, units, label } = variableSettings[variable];
  const fullURL = `${baseURL}/${path}/LIS_${compact}_${variable}.tif`;

  if(currentLayer){
    map.removeLayer(currentLayer);
    currentLayer = null;
  }

  try {
    const response = await fetch(fullURL);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const georaster = await parseGeoraster(arrayBuffer);

    currentLayer = new GeoRasterLayer({
      georaster,
      opacity: 0.8,
      resolution: 512,
      pixelValuesToColorFn: values => {
        const val = values[0];
        if(val === null || val === -9999) return null;
        return colormaps[currentColormap](val, max);
      }
    });

    currentLayer.addTo(map);
    map.fitBounds(currentLayer.getBounds());

    document.getElementById("colorbar-label").innerText = `${label} (${units}), range: 0–${max}`;
    document.getElementById("colorbar").style.background = generateColorbarGradient(colormaps[currentColormap], max);

  } catch(err) {
    console.error("Failed to load GeoTIFF:", err);
    alert(`Error loading ${variable} layer for date ${currentDate}`);
  }
}

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
});

document.getElementById("graph-close").addEventListener('click', () => {
  closeGraph();
});

// Date picker event handlers
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

const colormaps = { turbo: turboColorMap, viridis: viridisColorMap, magma: magmaColorMap };

// Calendar functionality
let currentMonth = 6; // July (0-indexed)
let currentYear = 2025;

function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  // Clear existing days (except headers)
  while (calendarEl.children.length > 7) {
    calendarEl.removeChild(calendarEl.lastChild);
  }
  
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
  
  // Update title
  const monthNames = ["January", "February", "March", "April", "May", "June", 
                     "July", "August", "September", "October", "November", "December"];
  document.getElementById('calendar-title').textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  // Update dropdown selections
  document.getElementById('month-select').value = currentMonth;
  document.getElementById('year-select').value = currentYear;
  
  // Previous month days
  for (let i = 0; i < firstDay; i++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day other-month';
    dayEl.textContent = daysInPrevMonth - firstDay + i + 1;
    dayEl.classList.add('disabled');
    calendarEl.appendChild(dayEl);
  }
  
  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';
    dayEl.textContent = i;
    
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    
    if (dateStr === currentDate) {
      dayEl.classList.add('selected');
    }
    
    if (dateStr === new Date().toISOString().split('T')[0]) {
      dayEl.classList.add('today');
    }
    
    dayEl.addEventListener('click', () => {
      if (dayEl.classList.contains('disabled')) return;
      
      // Remove selected from all days
      document.querySelectorAll('.calendar-day').forEach(el => {
        el.classList.remove('selected');
      });
      
      dayEl.classList.add('selected');
      currentDate = dateStr;
      loadVariable(currentVariable);
    });
    
    calendarEl.appendChild(dayEl);
  }
  
  // Next month days
  const totalCells = 7 * 6; // 6 rows max
  const remainingCells = totalCells - (firstDay + daysInMonth);
  for (let i = 1; i <= remainingCells; i++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day other-month';
    dayEl.textContent = i;
    dayEl.classList.add('disabled');
    calendarEl.appendChild(dayEl);
  }
}

document.getElementById('prev-month').addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  renderCalendar();
});

document.getElementById('next-month').addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  renderCalendar();
});

document.getElementById("download-csv").addEventListener('click', () => {
if (!currentChart) return;

let csvContent = "";
const labels = currentChart.data.labels;
const values = currentChart.data.datasets[0].data;
const s = variableSettings[currentVariable];

if (currentGraphType === 'transect') {
  // For transect data, include distance and coordinates
  csvContent = "Distance (km),Value,Latitude,Longitude\n";
  
  // Calculate coordinates along the transect line
  const start = transectPoints[0];
  const end = transectPoints[1];
  const totalDistance = Math.sqrt(
    Math.pow(end.lat - start.lat, 2) + 
    Math.pow(end.lng - start.lng, 2)
  );
  
  for (let i = 0; i < labels.length; i++) {
    const fraction = labels[i] / labels[labels.length - 1];
    const lat = start.lat + (end.lat - start.lat) * fraction;
    const lng = start.lng + (end.lng - start.lng) * fraction;
    
    csvContent += `${labels[i]},${values[i]},${lat},${lng}\n`;
  }
} else if (currentGraphType === 'timeseries') {
  // For timeseries data, include date and fixed coordinates
  csvContent = "Date,Value,Latitude,Longitude\n";
  const point = timeseriesMarker.point;
  
  for (let i = 0; i < labels.length; i++) {
    csvContent += `${labels[i]},${values[i]},${point.lat},${point.lng}\n`;
  }
}

// Create download link
const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.setAttribute('href', url);
link.setAttribute('download', `${currentGraphType}_${currentVariable}_data.csv`);
link.style.visibility = 'hidden';
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
});

// Month/year dropdown functionality
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

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('month-year-dropdown');
  if (!dropdown.contains(e.target) && e.target.id !== 'calendar-title') {
    dropdown.classList.remove('show');
  }
});

// Initial render
renderCalendar();
loadVariable(currentVariable);
enableValuePicker(false);