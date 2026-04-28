// ============================================
// STRAVA CONQUEST — Map Engine
// ============================================

let map = null;
let tileLayer = null;
let userTileGroup = null;
let allTileGroup = null;
let activityLayerGroup = null;

// Color palette for users
const USER_COLORS = [
  '#FF4444', '#4488FF', '#44CC44', '#FFAA00',
  '#AA44FF', '#FF44AA', '#00CCCC', '#FF8844'
];

let colorIndex = 0;
const userColorMap = new Map();

function getUserColor(userId, isCurrentUser = false) {
  if (isCurrentUser) return '#FF4444';
  if (!userColorMap.has(userId)) {
    userColorMap.set(userId, USER_COLORS[colorIndex % USER_COLORS.length]);
    colorIndex++;
  }
  return userColorMap.get(userId);
}

// ============================================
// MAP INIT
// ============================================
function initMap(containerId = 'map') {
  map = L.map(containerId, {
    center: [48.8566, 2.3522], // Paris
    zoom: 13,
    zoomControl: true,
    attributionControl: false
  });

  // Dark gaming-style tile layer
  tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '©OpenStreetMap ©CartoDB',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // Layer groups
  allTileGroup = L.layerGroup().addTo(map);
  userTileGroup = L.layerGroup().addTo(map);
  activityLayerGroup = L.layerGroup().addTo(map);

  // Load tiles on map move
  map.on('moveend', debounce(loadVisibleTiles, 300));
  map.on('zoomend', debounce(loadVisibleTiles, 300));

  // Initial load
  loadVisibleTiles();

  return map;
}

// ============================================
// TILE RENDERING
// ============================================
function renderTile(tile, isCurrentUser = false) {
  if (!tile.min_lat || !tile.min_lng) return null;

  const userId = tile.owner_id;
  const color = getUserColor(userId, isCurrentUser);
  const opacity = isCurrentUser ? 0.55 : 0.35;

  const bounds = [
    [tile.min_lat, tile.min_lng],
    [tile.max_lat, tile.max_lng]
  ];

  const rect = L.rectangle(bounds, {
    color: color,
    fillColor: color,
    fillOpacity: opacity,
    weight: 0.5,
    opacity: 0.7,
    className: 'conquest-tile'
  });

  // Popup info
  const ownerName = tile.users?.username || 'Unknown';
  rect.bindPopup(`
    <div class="tile-popup">
      <strong>${isCurrentUser ? '🏴 Votre territoire' : `⚔️ ${ownerName}`}</strong>
      <br><small>Capturé le ${tile.first_captured_at ? new Date(tile.first_captured_at).toLocaleDateString('fr-FR') : '?'}</small>
      ${tile.visit_count > 1 ? `<br><small>Visité ${tile.visit_count} fois</small>` : ''}
    </div>
  `, { className: 'conquest-popup' });

  return rect;
}

async function loadVisibleTiles() {
  if (!map || map.getZoom() < 10) {
    if (allTileGroup) allTileGroup.clearLayers();
    return;
  }

  const bounds = map.getBounds();
  const currentUser = window.StravaAuth?.getCurrentAthlete();

  try {
    const tiles = await window.DB.TilesDB.getTilesByBounds(
      bounds.getSouth(),
      bounds.getWest(),
      bounds.getNorth(),
      bounds.getEast()
    );

    allTileGroup.clearLayers();

    tiles.forEach(tile => {
      const isOwn = currentUser && tile.owner_id === currentUser.db_id;
      const rect = renderTile(tile, isOwn);
      if (rect) rect.addTo(allTileGroup);
    });

  } catch (e) {
    console.error('Error loading tiles:', e);
  }
}

// ============================================
// ACTIVITY TRACK RENDERING
// ============================================
function renderActivityTrack(points, color = '#FF4444', animate = true) {
  if (!points || points.length === 0) return;

  activityLayerGroup.clearLayers();

  const latlngs = points.map(p => [p.lat, p.lng]);

  // Glow effect: render twice (thick blur + thin sharp)
  const glowLine = L.polyline(latlngs, {
    color: color,
    weight: 10,
    opacity: 0.2,
    smoothFactor: 1
  }).addTo(activityLayerGroup);

  const trackLine = L.polyline(latlngs, {
    color: color,
    weight: 3,
    opacity: 0.9,
    smoothFactor: 1
  }).addTo(activityLayerGroup);

  // Start/end markers
  if (latlngs.length > 0) {
    L.circleMarker(latlngs[0], {
      radius: 7, fillColor: '#44FF44', color: '#fff',
      weight: 2, fillOpacity: 1
    }).bindPopup('Départ').addTo(activityLayerGroup);

    L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 7, fillColor: '#FF4444', color: '#fff',
      weight: 2, fillOpacity: 1
    }).bindPopup('Arrivée').addTo(activityLayerGroup);
  }

  // Fit map to track
  map.fitBounds(trackLine.getBounds(), { padding: [50, 50] });

  if (animate) {
    animateTrack(trackLine);
  }
}

function animateTrack(polyline) {
  // Animate track drawing using dash offset trick
  const el = polyline.getElement();
  if (!el) return;

  const totalLength = el.getTotalLength ? el.getTotalLength() : 1000;
  el.style.strokeDasharray = totalLength;
  el.style.strokeDashoffset = totalLength;
  el.style.transition = 'stroke-dashoffset 2s ease-in-out';

  requestAnimationFrame(() => {
    el.style.strokeDashoffset = '0';
  });
}

// ============================================
// NEW TILE CAPTURE ANIMATION
// ============================================
function animateTileCapture(tile) {
  const bounds = [
    [tile.min_lat, tile.min_lng],
    [tile.max_lat, tile.max_lng]
  ];

  // Flash animation
  const flashRect = L.rectangle(bounds, {
    color: '#FFD700',
    fillColor: '#FFD700',
    fillOpacity: 0.9,
    weight: 2
  }).addTo(map);

  let opacity = 0.9;
  const fade = setInterval(() => {
    opacity -= 0.05;
    if (opacity <= 0) {
      clearInterval(fade);
      map.removeLayer(flashRect);
      // Add permanent tile
      const rect = renderTile({ ...tile, owner_id: 'current' }, true);
      if (rect) rect.addTo(allTileGroup);
    } else {
      flashRect.setStyle({ fillOpacity: opacity });
    }
  }, 40);
}

// ============================================
// LIVE SYNC
// ============================================
async function syncAndDisplay() {
  const currentUser = window.AppState?.currentUser;
  if (!currentUser) return;

  // Subscribe to realtime tile updates
  window.DB.supabase
    .channel('tiles-changes')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'tiles_captured'
    }, payload => {
      const tile = payload.new;
      const isOwn = tile.owner_id === currentUser.id;
      const rect = renderTile(tile, isOwn);
      if (rect) {
        rect.addTo(allTileGroup);
        if (isOwn) animateTileCapture(tile);
      }
    })
    .subscribe();
}

// ============================================
// MAP CONTROLS
// ============================================
function flyToLocation(lat, lng, zoom = 14) {
  map.flyTo([lat, lng], zoom, { duration: 1.5 });
}

function fitToUserTiles(tiles) {
  if (!tiles || tiles.length === 0) return;
  const bounds = tiles.reduce((acc, t) => {
    acc.extend([[t.min_lat, t.min_lng], [t.max_lat, t.max_lng]]);
    return acc;
  }, L.latLngBounds([[tiles[0].min_lat, tiles[0].min_lng]]));
  map.fitBounds(bounds, { padding: [40, 40] });
}

// Toggle layers
function setMapStyle(style) {
  map.removeLayer(tileLayer);
  const styles = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  };
  tileLayer = L.tileLayer(styles[style] || styles.dark, {
    maxZoom: 19,
    subdomains: style === 'dark' || style === 'light' ? 'abcd' : undefined
  }).addTo(map);
}

// Debounce utility
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

window.MapEngine = {
  initMap,
  loadVisibleTiles,
  renderActivityTrack,
  animateTileCapture,
  syncAndDisplay,
  flyToLocation,
  fitToUserTiles,
  setMapStyle,
  getUserColor
};
