// ============================================
// STRAVA CONQUEST — Tile Engine
// ============================================
// Grid system: 500m x 500m tiles using Mercator projection
// Tile ID format: "X_Y" where X/Y are grid coordinates

const TILE_SIZE_METERS = 500;
const EARTH_CIRCUMFERENCE = 40075016.686; // meters at equator

// ============================================
// POLYLINE DECODER (Google Encoded Polyline)
// ============================================
const PolylineDecoder = {
  decode(encoded) {
    if (!encoded) return [];
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : result >> 1;

      shift = 0; result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : result >> 1;

      points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
    }
    return points;
  }
};

// ============================================
// COORDINATE → TILE CONVERSION
// ============================================
const TileGrid = {
  // Convert lat/lng to tile X/Y coordinates
  latLngToTile(lat, lng) {
    // Use a simple grid: 1 tile ≈ 0.0045° lat × 0.0045°/cos(lat) lng ≈ 500m
    const latTileSize = TILE_SIZE_METERS / 111320; // degrees per 500m latitude
    const lngTileSize = TILE_SIZE_METERS / (111320 * Math.cos(lat * Math.PI / 180));

    const tileX = Math.floor(lng / lngTileSize);
    const tileY = Math.floor(lat / latTileSize);
    return { tileX, tileY };
  },

  // Convert tile X/Y back to bounding box lat/lng
  tileToBounds(tileX, tileY, refLat = 0) {
    const latTileSize = TILE_SIZE_METERS / 111320;
    const lngTileSize = TILE_SIZE_METERS / (111320 * Math.cos(refLat * Math.PI / 180));

    return {
      minLat: tileY * latTileSize,
      maxLat: (tileY + 1) * latTileSize,
      minLng: tileX * lngTileSize,
      maxLng: (tileX + 1) * lngTileSize
    };
  },

  // Generate unique tile ID
  tileId(tileX, tileY) {
    return `${tileX}_${tileY}`;
  }
};

// ============================================
// PATH → TILES
// ============================================
const PathProcessor = {
  // Extract all unique tiles from a GPS path
  extractTiles(points) {
    const tiles = new Map();

    for (const point of points) {
      const { tileX, tileY } = TileGrid.latLngToTile(point.lat, point.lng);
      const id = TileGrid.tileId(tileX, tileY);

      if (!tiles.has(id)) {
        const bounds = TileGrid.tileToBounds(tileX, tileY, point.lat);
        tiles.set(id, {
          tile_id: id,
          tile_x: tileX,
          tile_y: tileY,
          min_lat: bounds.minLat,
          min_lng: bounds.minLng,
          max_lat: bounds.maxLat,
          max_lng: bounds.maxLng
        });
      }
    }

    return Array.from(tiles.values());
  },

  // Interpolate points along a path (fill gaps)
  interpolatePoints(points, maxDistanceMeters = 100) {
    if (points.length < 2) return points;
    const result = [points[0]];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dist = this.distanceMeters(prev, curr);

      if (dist > maxDistanceMeters) {
        const steps = Math.ceil(dist / maxDistanceMeters);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          result.push({
            lat: prev.lat + (curr.lat - prev.lat) * t,
            lng: prev.lng + (curr.lng - prev.lng) * t
          });
        }
      }
      result.push(curr);
    }
    return result;
  },

  // Haversine distance in meters
  distanceMeters(p1, p2) {
    const R = 6371000;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
};

// ============================================
// SCORE CALCULATOR
// ============================================
const ScoreEngine = {
  // Calculate points for an activity
  calculateActivityPoints(activity, newTilesCount, existingTilesCount) {
    let points = 0;

    // Base: +10 per new tile
    points += newTilesCount * 10;

    // Revisit bonus: +2 per revisited tile
    points += existingTilesCount * 2;

    // Speed bonus (avg speed > 15 km/h for cycling, > 12 km/h for running)
    const speedKmh = (activity.average_speed || 0) * 3.6;
    const sportType = (activity.sport_type || '').toLowerCase();
    const speedThreshold = sportType.includes('ride') ? 25 : 14;
    if (speedKmh > speedThreshold) {
      points += Math.floor((speedKmh - speedThreshold) * 5);
    }

    // Elevation bonus: +1 per 10m gain
    if (activity.total_elevation_gain > 0) {
      points += Math.floor(activity.total_elevation_gain / 10);
    }

    // Distance bonus: +50 per 10km
    if (activity.distance > 0) {
      points += Math.floor(activity.distance / 10000) * 50;
    }

    // Long activity bonus (>2 hours)
    if (activity.moving_time > 7200) {
      points += 100;
    }

    return points;
  },

  // Badge thresholds
  checkBadges(stats) {
    const earned = [];

    // Explorer badges
    if (stats.tiles >= 100) earned.push({ type: 'explorer_bronze', label: 'Explorateur Bronze', icon: '🗺️' });
    if (stats.tiles >= 500) earned.push({ type: 'explorer_silver', label: 'Explorateur Argent', icon: '🗺️' });
    if (stats.tiles >= 2000) earned.push({ type: 'explorer_gold', label: 'Explorateur Or', icon: '🏅' });

    // Climber badges
    if (stats.elevation >= 10000) earned.push({ type: 'climber', label: 'Grimpeur', icon: '⛰️' });
    if (stats.elevation >= 50000) earned.push({ type: 'alpinist', label: 'Alpiniste', icon: '🏔️' });

    // Streak badges
    if (stats.streak >= 7) earned.push({ type: 'streak_week', label: '7 jours de feu', icon: '🔥' });
    if (stats.streak >= 30) earned.push({ type: 'streak_month', label: 'Mois sans repos', icon: '💪' });

    return earned;
  }
};

// ============================================
// GAMIFIED STATS
// ============================================
const GamifiedStats = {
  EIFFEL_TOWER_HEIGHT: 330,        // meters
  EVEREST_HEIGHT: 8849,             // meters
  PIZZA_CALORIES: 285,              // kcal per slice
  EARTH_CIRCUMFERENCE: 40075000,   // meters

  formatDistance(meters) {
    const eiffelTowers = (meters / this.EIFFEL_TOWER_HEIGHT).toFixed(1);
    const earthPercent = ((meters / this.EARTH_CIRCUMFERENCE) * 100).toFixed(3);

    if (meters < 1000) return { value: meters.toFixed(0), unit: 'm', fun: null };
    if (meters < 10000) return {
      value: (meters / 1000).toFixed(1),
      unit: 'km',
      fun: `${eiffelTowers}× Tour Eiffel en hauteur`
    };
    return {
      value: (meters / 1000).toFixed(0),
      unit: 'km',
      fun: `${earthPercent}% du tour du monde 🌍`
    };
  },

  formatElevation(meters) {
    const everests = (meters / this.EVEREST_HEIGHT).toFixed(2);
    return {
      value: meters >= 1000 ? (meters / 1000).toFixed(1) : Math.round(meters),
      unit: meters >= 1000 ? 'km' : 'm',
      fun: `${everests}× l'Everest 🏔️`
    };
  },

  formatCalories(kcal) {
    const pizzas = Math.floor(kcal / this.PIZZA_CALORIES);
    const bigmacs = Math.floor(kcal / 550);
    return {
      value: kcal,
      unit: 'kcal',
      fun: pizzas > 0 ? `${pizzas} parts de pizza 🍕` : `${bigmacs} Big Mac 🍔`
    };
  },

  formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
  },

  formatSpeed(ms) {
    return (ms * 3.6).toFixed(1) + ' km/h';
  }
};

// ============================================
// MAIN ACTIVITY PROCESSOR
// ============================================
const ActivityProcessor = {
  async processActivity(activity, userId) {
    if (!activity.map?.summary_polyline && !activity.map?.polyline) {
      console.log('No polyline for activity', activity.id);
      return { tilesNew: 0, tilesRevisited: 0, points: 0 };
    }

    const polyline = activity.map.polyline || activity.map.summary_polyline;
    const rawPoints = PolylineDecoder.decode(polyline);

    if (rawPoints.length === 0) return { tilesNew: 0, tilesRevisited: 0, points: 0 };

    // Interpolate for better tile coverage
    const points = PathProcessor.interpolatePoints(rawPoints, 150);

    // Extract tiles from path
    const tiles = PathProcessor.extractTiles(points);

    console.log(`Activity ${activity.id}: ${points.length} points → ${tiles.length} tiles`);

    // Save to DB and count new vs revisited
    let newTiles = 0;
    let revisitedTiles = 0;

    for (const tile of tiles) {
      try {
        const existing = await window.DB.TilesDB.upsertTile({
          ...tile,
          owner_id: userId,
          activity_id: activity.db_id,
          last_visited_at: new Date().toISOString()
        });
        // If tile already existed (same tile_id), it's a revisit
        if (existing && existing.visit_count > 1) {
          revisitedTiles++;
        } else {
          newTiles++;
        }
      } catch (e) {
        console.error('Tile upsert error:', e);
      }
    }

    // Calculate points
    const points_earned = ScoreEngine.calculateActivityPoints(activity, newTiles, revisitedTiles);

    return {
      tilesNew: newTiles,
      tilesRevisited: revisitedTiles,
      points: points_earned,
      totalTiles: tiles.length
    };
  },

  // Process multiple activities in batch
  async processBatch(activities, userId, onProgress) {
    let totalNew = 0;
    let totalPoints = 0;

    for (let i = 0; i < activities.length; i++) {
      const activity = activities[i];
      const result = await this.processActivity(activity, userId);
      totalNew += result.tilesNew;
      totalPoints += result.points;
      if (onProgress) onProgress(i + 1, activities.length, result);
    }

    return { totalNew, totalPoints };
  }
};

window.TileEngine = {
  PolylineDecoder,
  TileGrid,
  PathProcessor,
  ScoreEngine,
  GamifiedStats,
  ActivityProcessor
};
