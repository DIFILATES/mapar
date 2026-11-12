/**
 * map.js — Motor principal del mapa interactiu de Barcelona
 * 
 * Jerarquia de capes (de baix a dalt):
 *  1. Fons blanc + xarxa de carrers (#FFFFFF)
 *  2. Capa user-paint (traços dels usuaris)
 *  3. Capa bcn-buildings (GeoJSON geomètric, blanc pur, actua com a màscara)
 *  4. Capa street-labels (noms dels carrers per sobre de tot)
 */

// ============================================
// Constants
// ============================================

const BARCELONA_CENTER = [2.1686, 41.3874];
const DEFAULT_ZOOM = 14.5;
const COLORS = ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C'];
const BRUSH_WIDTH_METERS = 6; // Amplada del pinzell en metres
const ERASER_RADIUS_METERS = 15;

// ============================================
// State
// ============================================

let currentTool = 'brush';
let currentColor = COLORS[0];
let isDrawing = false;
let currentStroke = [];
let strokes = []; // Tots els traços locals
let touchCount = 0;

// ============================================
// Initialize Map
// ============================================

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: BARCELONA_CENTER,
  zoom: DEFAULT_ZOOM,
  bearing: 0,
  pitch: 0,
  maxPitch: 0,
  attributionControl: false,
  dragRotate: true,
  touchZoomRotate: true,
  touchPitch: false
});

// Disable map interactions when brush/eraser are active
function updateMapInteractions() {
  if (currentTool === 'move') {
    map.dragPan.enable();
    document.getElementById('map').className = 'cursor-move';
  } else if (currentTool === 'brush') {
    map.dragPan.disable();
    document.getElementById('map').className = 'cursor-brush';
  } else if (currentTool === 'eraser') {
    map.dragPan.disable();
    document.getElementById('map').className = 'cursor-eraser';
  }
}

// ============================================
// Map Style: White Canvas
// ============================================

map.on('load', () => {
  // ---- Step 1: Make the map a white canvas ----
  // Hide all labels, icons, parks, etc. except road lines and street names
  const style = map.getStyle();
  
  style.layers.forEach(layer => {
    // Keep road/street geometry layers but make them white/light gray
    if (layer.id.includes('road') || layer.id.includes('street') || layer.id.includes('highway') ||
        layer.id.includes('path') || layer.id.includes('tunnel') || layer.id.includes('bridge')) {
      if (layer.type === 'line') {
        // Keep road lines but make them very subtle
        map.setPaintProperty(layer.id, 'line-color', '#F0F0F0');
        map.setPaintProperty(layer.id, 'line-opacity', 1);
        return;
      }
    }
    
    // Hide ALL symbol layers (icons, labels) except road labels
    if (layer.type === 'symbol') {
      if (layer.id.includes('road') || layer.id.includes('street') || layer.id.includes('highway')) {
        // Keep road labels — style them
        try {
          map.setPaintProperty(layer.id, 'text-color', '#555555');
          map.setPaintProperty(layer.id, 'text-halo-color', '#FFFFFF');
          map.setPaintProperty(layer.id, 'text-halo-width', 2);
          map.setLayoutProperty(layer.id, 'icon-image', ''); // remove icons
        } catch (e) { /* some props may not exist */ }
        return;
      }
      // Hide all other symbols (POIs, parks, etc.)
      map.setLayoutProperty(layer.id, 'visibility', 'none');
      return;
    }
    
    // Fill layers: make background/land white, hide water features blue → light
    if (layer.type === 'fill') {
      if (layer.id.includes('water') || layer.id.includes('ocean') || layer.id.includes('sea')) {
        map.setPaintProperty(layer.id, 'fill-color', '#F5F5F5');
        return;
      }
      if (layer.id.includes('park') || layer.id.includes('green') || layer.id.includes('land')) {
        map.setPaintProperty(layer.id, 'fill-color', '#FFFFFF');
        return;
      }
      if (layer.id.includes('building')) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
        return;
      }
      // Default: make white
      try {
        map.setPaintProperty(layer.id, 'fill-color', '#FFFFFF');
      } catch (e) {}
    }
    
    // Background layer
    if (layer.type === 'background') {
      map.setPaintProperty(layer.id, 'background-color', '#FFFFFF');
    }
  });

  // ---- Step 2: Add user-paint source and layer ----
  map.addSource('user-paint-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'user-paint',
    type: 'line',
    source: 'user-paint-source',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 1,
        14, 4,
        18, 16,
        22, 64
      ],
      'line-opacity': 0.85
    }
  });

  // ---- Step 3: Add bcn-buildings layer (mask) ----
  map.addSource('bcn-buildings-source', {
    type: 'geojson',
    data: 'data/barcelona-geometric.geojson'
  });

  map.addLayer({
    id: 'bcn-buildings',
    type: 'fill',
    source: 'bcn-buildings-source',
    paint: {
      'fill-color': '#FFFFFF',
      'fill-opacity': 1
    }
  });

  map.addLayer({
    id: 'bcn-buildings-outline',
    type: 'line',
    source: 'bcn-buildings-source',
    paint: {
      'line-color': '#DCDCDC',
      'line-width': 0.8,
      'line-opacity': 0.8
    }
  });

  // ---- Step 4: Move street labels to the top ----
  // Collect all road/street label layers and move them above buildings
  const streetLabelLayers = style.layers
    .filter(l => l.type === 'symbol' && 
      (l.id.includes('road') || l.id.includes('street') || l.id.includes('highway')))
    .map(l => l.id);

  streetLabelLayers.forEach(layerId => {
    try {
      map.moveLayer(layerId); // moves to top
    } catch (e) { /* layer may have been removed */ }
  });

  // ---- Initialize interactions ----
  updateMapInteractions();
  initToolbar();
  initPointerEvents();
  initCompass();
  initSocket();

  console.log('🗺️ Mapar carregat correctament');
});

// ============================================
// Toolbar
// ============================================

function initToolbar() {
  // Tool buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTool = btn.dataset.tool;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateMapInteractions();
      
      // Show/hide palette
      document.getElementById('color-palette').style.display = 
        currentTool === 'brush' ? 'flex' : 'none';
    });
  });

  // Color palette
  const palette = document.getElementById('color-palette');
  COLORS.forEach((color, i) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (i === 0 ? ' active' : '');
    swatch.style.background = color;
    swatch.addEventListener('click', () => {
      currentColor = color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
    });
    palette.appendChild(swatch);
  });
}

// ============================================
// Pointer Events (Brush, Eraser, Multi-touch)
// ============================================

function initPointerEvents() {
  const canvas = map.getCanvas();

  // ---- TOUCH events for multi-touch detection ----
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

  // ---- MOUSE events (desktop) ----
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseUp);
}

// ---- Touch Handlers ----
function handleTouchStart(e) {
  touchCount = e.touches.length;
  
  if (touchCount >= 2) {
    // Multi-touch: stop drawing, delegate to MapLibre
    cancelDrawing();
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    return; // let MapLibre handle it
  }
  
  // Single touch
  e.preventDefault();
  if (currentTool === 'move') {
    map.dragPan.enable();
    return;
  }
  
  map.dragPan.disable();
  const point = getTouchPoint(e.touches[0]);
  startDrawing(point);
}

function handleTouchMove(e) {
  if (e.touches.length >= 2) {
    // Multi-touch detected mid-stroke
    if (isDrawing) {
      cancelDrawing();
      map.dragPan.enable();
      map.touchZoomRotate.enable();
    }
    return; // let MapLibre handle
  }
  
  e.preventDefault();
  if (!isDrawing || currentTool === 'move') return;
  
  const point = getTouchPoint(e.touches[0]);
  continueDrawing(point);
}

function handleTouchEnd(e) {
  touchCount = e.touches.length;
  
  if (touchCount === 0) {
    if (isDrawing) {
      endDrawing();
    }
    // Restore tool mode
    updateMapInteractions();
  }
}

function getTouchPoint(touch) {
  const rect = map.getCanvas().getBoundingClientRect();
  return new maplibregl.Point(
    touch.clientX - rect.left,
    touch.clientY - rect.top
  );
}

// ---- Mouse Handlers ----
function handleMouseDown(e) {
  if (currentTool === 'move') return; // MapLibre handles
  if (e.button !== 0) return; // Only left click
  
  const point = new maplibregl.Point(e.offsetX, e.offsetY);
  startDrawing(point);
}

function handleMouseMove(e) {
  if (!isDrawing || currentTool === 'move') return;
  
  const point = new maplibregl.Point(e.offsetX, e.offsetY);
  continueDrawing(point);
}

function handleMouseUp() {
  if (isDrawing) {
    endDrawing();
  }
}

// ============================================
// Drawing Logic
// ============================================

function isOverBuilding(point) {
  const features = map.queryRenderedFeatures(point, { layers: ['bcn-buildings'] });
  return features.length > 0;
}

function startDrawing(point) {
  if (currentTool === 'brush') {
    if (isOverBuilding(point)) return; // Don't paint on buildings
    isDrawing = true;
    const lngLat = map.unproject(point);
    currentStroke = [[lngLat.lng, lngLat.lat]];
  } else if (currentTool === 'eraser') {
    isDrawing = true;
    const lngLat = map.unproject(point);
    eraseAt(lngLat);
  }
}

function continueDrawing(point) {
  const lngLat = map.unproject(point);
  
  if (currentTool === 'brush') {
    if (isOverBuilding(point)) return; // Don't paint on buildings
    currentStroke.push([lngLat.lng, lngLat.lat]);
    renderCurrentStroke();
  } else if (currentTool === 'eraser') {
    eraseAt(lngLat);
  }
}

function endDrawing() {
  isDrawing = false;
  
  if (currentTool === 'brush' && currentStroke.length >= 2) {
    const stroke = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      color: currentColor,
      width_meters: BRUSH_WIDTH_METERS,
      coordinates: currentStroke,
      created_at: new Date().toISOString()
    };
    
    strokes.push(stroke);
    emitStroke(stroke);
  }
  
  currentStroke = [];
  renderAllStrokes();
}

function cancelDrawing() {
  isDrawing = false;
  currentStroke = [];
  renderAllStrokes();
}

// ============================================
// Erase Logic
// ============================================

function eraseAt(lngLat) {
  const eraserRadiusDeg = ERASER_RADIUS_METERS / 111320; // approximate degrees
  const toRemove = [];
  
  strokes = strokes.filter(stroke => {
    // Check if any point of the stroke is within eraser radius
    const hit = stroke.coordinates.some(coord => {
      const dx = coord[0] - lngLat.lng;
      const dy = coord[1] - lngLat.lat;
      return Math.sqrt(dx * dx + dy * dy) < eraserRadiusDeg;
    });
    
    if (hit) {
      toRemove.push(stroke.id);
    }
    return !hit;
  });
  
  if (toRemove.length > 0) {
    emitErase(toRemove);
    renderAllStrokes();
  }
}

// ============================================
// Rendering
// ============================================

function renderCurrentStroke() {
  const features = strokes.map(strokeToFeature);
  
  // Add current in-progress stroke
  if (currentStroke.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { color: currentColor },
      geometry: {
        type: 'LineString',
        coordinates: currentStroke
      }
    });
  }
  
  map.getSource('user-paint-source').setData({
    type: 'FeatureCollection',
    features
  });
}

function renderAllStrokes() {
  const features = strokes.map(strokeToFeature);
  
  map.getSource('user-paint-source').setData({
    type: 'FeatureCollection',
    features
  });
}

function strokeToFeature(stroke) {
  return {
    type: 'Feature',
    properties: { color: stroke.color },
    geometry: {
      type: 'LineString',
      coordinates: stroke.coordinates
    }
  };
}

// ============================================
// Compass & Orientation
// ============================================

function initCompass() {
  const compassSvg = document.getElementById('compass-svg');
  const compassBtn = document.getElementById('compass-btn');
  const alignBtn = document.getElementById('align-eixample-btn');

  // Update compass rotation on map rotate
  map.on('rotate', () => {
    const bearing = map.getBearing();
    compassSvg.style.transform = `rotate(${-bearing}deg)`;
  });

  // Click compass → reset to North
  compassBtn.addEventListener('click', () => {
    map.easeTo({ bearing: 0, duration: 500 });
  });

  // Click align → Eixample grid (-45°)
  alignBtn.addEventListener('click', () => {
    map.easeTo({ bearing: -45, duration: 800, easing: t => t * (2 - t) });
  });
}

// ============================================
// Socket.io / Persistence (Dual Mode)
// ============================================

let socket = null;
let useLocalStorage = false;

function initSocket() {
  // Try Socket.io connection
  if (window.__SOCKET_UNAVAILABLE || typeof io === 'undefined') {
    console.log('📴 Socket.io no disponible, usant localStorage');
    useLocalStorage = true;
    loadFromLocalStorage();
    return;
  }

  try {
    socket = io({ transports: ['websocket', 'polling'] });
    
    socket.on('connect', () => {
      console.log('🔌 Connectat al servidor');
    });

    socket.on('connect_error', () => {
      console.log('📴 Error de connexió, canviant a localStorage');
      useLocalStorage = true;
      socket.disconnect();
      socket = null;
      loadFromLocalStorage();
    });

    socket.on('init_strokes', (data) => {
      strokes = data;
      renderAllStrokes();
    });

    socket.on('draw_stroke', (stroke) => {
      strokes.push(stroke);
      renderAllStrokes();
    });

    socket.on('erase_area', (strokeIds) => {
      strokes = strokes.filter(s => !strokeIds.includes(s.id));
      renderAllStrokes();
    });

    socket.on('user_count', (count) => {
      document.getElementById('user-count-num').textContent = count;
    });

  } catch (e) {
    console.log('📴 Socket.io no disponible, usant localStorage');
    useLocalStorage = true;
    loadFromLocalStorage();
  }
}

function emitStroke(stroke) {
  if (socket && socket.connected) {
    socket.emit('draw_stroke', stroke);
  } else {
    saveToLocalStorage();
  }
}

function emitErase(strokeIds) {
  if (socket && socket.connected) {
    socket.emit('erase_area', strokeIds);
  } else {
    saveToLocalStorage();
  }
}

// ---- localStorage fallback ----
function saveToLocalStorage() {
  try {
    localStorage.setItem('mapar_strokes', JSON.stringify(strokes));
  } catch (e) { /* quota exceeded, ignore */ }
}

function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem('mapar_strokes');
    if (saved) {
      strokes = JSON.parse(saved);
      renderAllStrokes();
    }
  } catch (e) { /* corrupt data, ignore */ }
}
