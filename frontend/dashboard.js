// ============================================
// STRAVA CONQUEST — Dashboard
// ============================================

window.AppState = {
  currentUser: null,
  activities: [],
  tiles: [],
  leaderboard: [],
  syncInProgress: false,
  lastSync: null
};

// ============================================
// INIT
// ============================================
async function initDashboard() {
  // Check auth
  const tokens = window.StravaAuth.getStoredTokens();
  if (!tokens) {
    showScreen('login-screen');
    return;
  }

  showScreen('loading-screen');
  updateLoadingStatus('Connexion à Strava...');

  try {
    // Try to get athlete from Strava
    const athlete = await window.StravaAPI.getAthlete();

    // Upsert user in Supabase
    const dbUser = await window.DB.UserDB.upsert({
      strava_id: athlete.id,
      username: athlete.username || `${athlete.firstname} ${athlete.lastname}`,
      firstname: athlete.firstname,
      lastname: athlete.lastname,
      avatar_url: athlete.profile,
      city: athlete.city,
      country: athlete.country,
      strava_access_token: tokens.access_token,
      strava_refresh_token: tokens.refresh_token,
      strava_token_expires_at: tokens.expires_at
    });

    window.AppState.currentUser = { ...athlete, db_id: dbUser?.id };
    // Patch stored tokens with db_id
    const storedTokens = window.StravaAuth.getStoredTokens();
    storedTokens.athlete = window.AppState.currentUser;
    localStorage.setItem('strava_tokens', JSON.stringify(storedTokens));

    updateLoadingStatus('Chargement des activités...');
    await loadUserActivities();

    updateLoadingStatus('Chargement des territoires...');
    await loadUserTiles();

    updateLoadingStatus('Initialisation de la carte...');
    showScreen('main-screen');
    window.MapEngine.initMap('map');
    window.MapEngine.syncAndDisplay();

    renderUserProfile();
    renderDashboardStats();
    renderLeaderboard();
    renderActivitiesList();
    renderChallenges();
    renderBadges();

    // Auto-sync if first time
    const tilesCount = window.AppState.tiles.length;
    if (tilesCount === 0) {
      setTimeout(() => syncStravaActivities(), 1000);
    }

  } catch (e) {
    console.error('Init error:', e);
    if (e.message.includes('Token') || e.message.includes('auth')) {
      window.StravaAuth.clearTokens();
      showScreen('login-screen');
    } else {
      showError('Erreur de connexion: ' + e.message);
    }
  }
}

// ============================================
// DATA LOADING
// ============================================
async function loadUserActivities() {
  if (!window.AppState.currentUser?.db_id) return;
  const activities = await window.DB.ActivitiesDB.getUserActivities(
    window.AppState.currentUser.db_id, 50
  );
  window.AppState.activities = activities;
}

async function loadUserTiles() {
  if (!window.AppState.currentUser?.db_id) return;
  const tiles = await window.DB.TilesDB.getUserTiles(window.AppState.currentUser.db_id);
  window.AppState.tiles = tiles;
}

// ============================================
// STRAVA SYNC
// ============================================
async function syncStravaActivities() {
  if (window.AppState.syncInProgress) return;
  window.AppState.syncInProgress = true;

  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) {
    syncBtn.innerHTML = '<span class="spin">⟳</span> Sync en cours...';
    syncBtn.disabled = true;
  }

  showNotification('🔄 Synchronisation Strava en cours...', 'info');

  try {
    // Get recent activities (last 3 months)
    const since = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const stravaActivities = await window.StravaAPI.getAllActivities(since);

    showNotification(`📥 ${stravaActivities.length} activités trouvées`, 'info');

    let processed = 0;
    let newTilesTotal = 0;
    let pointsTotal = 0;

    for (const act of stravaActivities) {
      // Save activity to DB
      const dbActivity = await window.DB.ActivitiesDB.upsert({
        strava_activity_id: act.id,
        user_id: window.AppState.currentUser.db_id,
        name: act.name,
        sport_type: act.sport_type || act.type,
        start_date: act.start_date,
        distance: act.distance,
        moving_time: act.moving_time,
        elapsed_time: act.elapsed_time,
        total_elevation_gain: act.total_elevation_gain,
        average_speed: act.average_speed,
        max_speed: act.max_speed,
        calories: act.calories,
        polyline: act.map?.summary_polyline || act.map?.polyline
      });

      // Process tiles if not already done
      if (!dbActivity?.processed && dbActivity?.id) {
        act.db_id = dbActivity.id;
        const result = await window.TileEngine.ActivityProcessor.processActivity(
          act, window.AppState.currentUser.db_id
        );

        if (result.totalTiles > 0) {
          await window.DB.ActivitiesDB.markProcessed(dbActivity.id, result.tilesNew, result.points);
          newTilesTotal += result.tilesNew;
          pointsTotal += result.points;
        }
      }

      processed++;
      updateSyncProgress(processed, stravaActivities.length);
    }

    // Update user stats
    await updateUserStats();
    await loadUserActivities();
    await loadUserTiles();

    renderDashboardStats();
    renderActivitiesList();
    window.MapEngine.loadVisibleTiles();

    showNotification(
      `✅ Sync terminée! +${newTilesTotal} tiles, +${pointsTotal} pts`,
      'success', 5000
    );

    window.AppState.lastSync = new Date();
    if (syncBtn) {
      syncBtn.innerHTML = '⟳ Synchroniser Strava';
      syncBtn.disabled = false;
    }

  } catch (e) {
    console.error('Sync error:', e);
    showNotification('❌ Erreur de synchronisation: ' + e.message, 'error');
    if (syncBtn) {
      syncBtn.innerHTML = '⟳ Synchroniser Strava';
      syncBtn.disabled = false;
    }
  }

  window.AppState.syncInProgress = false;
}

function updateSyncProgress(current, total) {
  const pct = Math.round((current / total) * 100);
  const el = document.getElementById('sync-progress');
  if (el) el.style.width = pct + '%';
}

async function updateUserStats() {
  if (!window.AppState.currentUser?.db_id) return;

  const userId = window.AppState.currentUser.db_id;
  const tiles = await window.DB.TilesDB.getUserTiles(userId);
  const activities = await window.DB.ActivitiesDB.getUserActivities(userId, 200);

  const totalPoints = activities.reduce((s, a) => s + (a.points_earned || 0), 0);
  const totalElevation = activities.reduce((s, a) => s + (a.total_elevation_gain || 0), 0);
  const streak = calculateStreak(activities);

  await window.DB.UserDB.updateStats(userId, {
    total_points: totalPoints,
    tiles_count: tiles.length,
    current_streak: streak.current,
    longest_streak: streak.longest,
    last_activity_date: activities[0]?.start_date
  });

  // Update leaderboard
  await window.DB.LeaderboardDB.upsertScore(userId, window.DB.getCurrentSeason(), {
    total_points: totalPoints,
    tiles_count: tiles.length,
    activities_count: activities.length,
    total_distance: activities.reduce((s, a) => s + (a.distance || 0), 0),
    total_elevation: totalElevation
  });

  // Check badges
  const badges = window.TileEngine.ScoreEngine.checkBadges({
    tiles: tiles.length,
    elevation: totalElevation,
    streak: streak.current
  });
  for (const badge of badges) {
    await window.DB.BadgesDB.awardBadge(userId, badge.type);
  }
}

function calculateStreak(activities) {
  if (!activities.length) return { current: 0, longest: 0 };

  const sortedDates = activities
    .map(a => new Date(a.start_date).toDateString())
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => new Date(b) - new Date(a));

  let current = 0;
  let longest = 0;
  let streak = 1;
  const today = new Date().toDateString();

  // Check if active today or yesterday
  const lastDate = new Date(sortedDates[0]);
  const daysDiff = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));
  if (daysDiff > 1) return { current: 0, longest: 1 };

  for (let i = 1; i < sortedDates.length; i++) {
    const d1 = new Date(sortedDates[i - 1]);
    const d2 = new Date(sortedDates[i]);
    const diff = Math.floor((d1 - d2) / (1000 * 60 * 60 * 24));
    if (diff === 1) {
      streak++;
      longest = Math.max(longest, streak);
    } else {
      break;
    }
  }

  current = streak;
  longest = Math.max(longest, streak);
  return { current, longest };
}

// ============================================
// RENDERING
// ============================================
function renderUserProfile() {
  const user = window.AppState.currentUser;
  if (!user) return;

  const el = document.getElementById('user-profile');
  if (!el) return;

  el.innerHTML = `
    <div class="user-avatar" style="background-image: url('${user.profile || ''}')">
      ${!user.profile ? (user.firstname?.[0] || '?') : ''}
    </div>
    <div class="user-info">
      <div class="user-name">${user.firstname} ${user.lastname}</div>
      <div class="user-location">${user.city || ''} ${user.country || ''}</div>
    </div>
  `;
}

function renderDashboardStats() {
  const GS = window.TileEngine.GamifiedStats;
  const tiles = window.AppState.tiles;
  const activities = window.AppState.activities;

  const totalPoints = activities.reduce((s, a) => s + (a.points_earned || 0), 0);
  const totalDist = activities.reduce((s, a) => s + (a.distance || 0), 0);
  const totalElevation = activities.reduce((s, a) => s + (a.total_elevation_gain || 0), 0);
  const totalCalories = activities.reduce((s, a) => s + (a.calories || 0), 0);
  const streak = calculateStreak(activities);

  const distFmt = GS.formatDistance(totalDist);
  const elevFmt = GS.formatElevation(totalElevation);
  const calFmt = GS.formatCalories(totalCalories);

  setStatCard('stat-points', totalPoints.toLocaleString(), 'Points de conquête', '⚔️');
  setStatCard('stat-tiles', tiles.length.toLocaleString(), 'Territoires capturés', '🗺️');
  setStatCard('stat-distance', `${distFmt.value} ${distFmt.unit}`, distFmt.fun || 'Distance totale', '🛣️');
  setStatCard('stat-elevation', `${elevFmt.value} ${elevFmt.unit}`, elevFmt.fun, '⛰️');
  setStatCard('stat-calories', `${calFmt.value}`, calFmt.fun, '🔥');
  setStatCard('stat-streak', `${streak.current} jours`, `Record: ${streak.longest} jours`, '💪');
  setStatCard('stat-activities', activities.length.toString(), 'Activités totales', '🏆');

  // Weekly chart
  renderWeeklyChart(activities);
}

function setStatCard(id, value, subtitle, icon) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('.stat-value').textContent = value;
  el.querySelector('.stat-sub').textContent = subtitle;
  el.querySelector('.stat-icon').textContent = icon;
}

function renderWeeklyChart(activities) {
  const canvas = document.getElementById('weekly-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  // Count activities per day of week
  const counts = new Array(7).fill(0);
  const distances = new Array(7).fill(0);

  activities.forEach(a => {
    const day = new Date(a.start_date).getDay();
    const adjustedDay = day === 0 ? 6 : day - 1; // Monday = 0
    counts[adjustedDay]++;
    distances[adjustedDay] += (a.distance || 0) / 1000;
  });

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const maxCount = Math.max(...counts, 1);
  const barWidth = (canvas.width - 40) / 7;
  const maxBarHeight = canvas.height - 50;

  // Draw bars
  counts.forEach((count, i) => {
    const barHeight = (count / maxCount) * maxBarHeight;
    const x = 20 + i * barWidth + barWidth * 0.1;
    const y = canvas.height - 30 - barHeight;
    const w = barWidth * 0.8;

    // Gradient
    const grad = ctx.createLinearGradient(0, y, 0, canvas.height - 30);
    grad.addColorStop(0, 'rgba(255,68,68,0.9)');
    grad.addColorStop(1, 'rgba(255,68,68,0.2)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, barHeight, 4);
    ctx.fill();

    // Day label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(days[i], x + w / 2, canvas.height - 8);

    // Count
    if (count > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(count, x + w / 2, y - 5);
    }
  });
}

function renderActivitiesList() {
  const el = document.getElementById('activities-list');
  if (!el) return;

  const GS = window.TileEngine.GamifiedStats;
  const sports = {
    Run: '🏃', Ride: '🚴', Walk: '🚶', Hike: '⛰️',
    Swim: '🏊', Ski: '⛷️', Default: '💪'
  };

  const html = window.AppState.activities.slice(0, 15).map(act => {
    const sport = Object.keys(sports).find(k =>
      (act.sport_type || '').includes(k)
    ) || 'Default';
    const dist = GS.formatDistance(act.distance || 0);
    const time = GS.formatTime(act.moving_time || 0);
    const date = new Date(act.start_date).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short'
    });

    return `
      <div class="activity-item" onclick="showActivityOnMap('${act.strava_activity_id}')">
        <div class="activity-icon">${sports[sport]}</div>
        <div class="activity-info">
          <div class="activity-name">${act.name || 'Activité'}</div>
          <div class="activity-meta">${date} · ${dist.value}${dist.unit} · ${time}</div>
        </div>
        <div class="activity-points">
          ${act.points_earned ? `<span class="pts">+${act.points_earned}</span>` : ''}
          ${act.tiles_captured ? `<span class="tiles-badge">${act.tiles_captured} 🗺️</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = html || '<div class="empty-state">Aucune activité. Synchronisez Strava!</div>';
}

async function renderLeaderboard() {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;

  try {
    const scores = await window.DB.LeaderboardDB.getTop(null, 10);
    window.AppState.leaderboard = scores;

    const currentUserId = window.AppState.currentUser?.db_id;
    const medals = ['🥇', '🥈', '🥉'];

    el.innerHTML = scores.map((score, i) => {
      const isMe = score.user_id === currentUserId;
      const user = score.users;
      return `
        <div class="leaderboard-item ${isMe ? 'is-me' : ''}">
          <div class="rank">${medals[i] || (i + 1)}</div>
          <div class="lb-avatar">${user?.username?.[0]?.toUpperCase() || '?'}</div>
          <div class="lb-info">
            <div class="lb-name">${user?.username || 'Joueur'} ${isMe ? '(vous)' : ''}</div>
            <div class="lb-sub">${score.tiles_count} tiles · ${score.activities_count} activités</div>
          </div>
          <div class="lb-score">${score.total_points?.toLocaleString()} pts</div>
        </div>
      `;
    }).join('') || '<div class="empty-state">Classement vide — Soyez le premier!</div>';

  } catch (e) {
    el.innerHTML = '<div class="empty-state">Classement indisponible</div>';
  }
}

function renderChallenges() {
  const el = document.getElementById('challenges-list');
  if (!el) return;

  const challenges = [
    { name: 'Explorateur Hebdo', desc: 'Capturer 20 tiles cette semaine', progress: 12, target: 20, icon: '🗺️' },
    { name: '3 sorties 10km+', desc: 'Trois sorties de plus de 10km', progress: 1, target: 3, icon: '🏃' },
    { name: 'Grimpeur', desc: 'Cumuler 1000m de D+', progress: 640, target: 1000, icon: '⛰️' },
    { name: 'Nouvelles zones', desc: 'Explorer 5 nouveaux quartiers', progress: 2, target: 5, icon: '🌍' }
  ];

  el.innerHTML = challenges.map(c => {
    const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
    return `
      <div class="challenge-item">
        <div class="challenge-icon">${c.icon}</div>
        <div class="challenge-info">
          <div class="challenge-name">${c.name}</div>
          <div class="challenge-desc">${c.desc}</div>
          <div class="challenge-bar">
            <div class="challenge-fill" style="width: ${pct}%"></div>
          </div>
          <div class="challenge-progress">${c.progress} / ${c.target} (${pct}%)</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderBadges() {
  const el = document.getElementById('badges-grid');
  if (!el) return;

  const allBadges = [
    { type: 'explorer_bronze', icon: '🗺️', name: 'Explorateur', desc: '100 tiles', locked: false },
    { type: 'explorer_silver', icon: '🗺️', name: 'Grand Explorateur', desc: '500 tiles', locked: true },
    { type: 'climber', icon: '⛰️', name: 'Grimpeur', desc: '10 000m D+', locked: true },
    { type: 'streak_week', icon: '🔥', name: 'Sans repos', desc: '7 jours', locked: false },
    { type: 'conquistador', icon: '👑', name: 'Conquistador', desc: '2000 tiles', locked: true },
    { type: 'alpinist', icon: '🏔️', name: 'Alpiniste', desc: '50 000m D+', locked: true }
  ];

  const userBadgeTypes = window.AppState.userBadges?.map(b => b.badge_type) || [];

  el.innerHTML = allBadges.map(b => {
    const earned = userBadgeTypes.includes(b.type) || !b.locked;
    return `
      <div class="badge-item ${earned ? 'earned' : 'locked'}">
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
        ${earned ? '<div class="badge-check">✓</div>' : '<div class="badge-lock">🔒</div>'}
      </div>
    `;
  }).join('');
}

// ============================================
// ACTIVITY MAP VIEW
// ============================================
async function showActivityOnMap(stravaId) {
  try {
    const activity = await window.StravaAPI.getActivity(stravaId);
    if (activity.map?.polyline || activity.map?.summary_polyline) {
      const polyline = activity.map.polyline || activity.map.summary_polyline;
      const points = window.TileEngine.PolylineDecoder.decode(polyline);
      window.MapEngine.renderActivityTrack(points);
      switchTab('map');
    }
  } catch (e) {
    showNotification('Erreur: ' + e.message, 'error');
  }
}

// ============================================
// UI HELPERS
// ============================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function updateLoadingStatus(msg) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = msg;
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  if (tab === 'map') {
    setTimeout(() => window.MapEngine?.map?.invalidateSize(), 100);
  }
}

function showNotification(message, type = 'info', duration = 3000) {
  const container = document.getElementById('notifications');
  if (!container) return;

  const note = document.createElement('div');
  note.className = `notification notif-${type}`;
  note.textContent = message;
  container.appendChild(note);

  setTimeout(() => note.classList.add('show'), 10);
  setTimeout(() => {
    note.classList.remove('show');
    setTimeout(() => note.remove(), 300);
  }, duration);
}

function showError(msg) {
  showNotification(msg, 'error', 5000);
}

// ============================================
// LOGIN
// ============================================
function loginWithStrava() {
  window.StravaAuth.initiateOAuth();
}

function logout() {
  window.StravaAuth.clearTokens();
  window.AppState.currentUser = null;
  showScreen('login-screen');
}

// ============================================
// CALLBACK HANDLER
// ============================================
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    window.location.href = '/?error=' + error;
    return;
  }

  if (!code) {
    window.location.href = '/';
    return;
  }

  try {
    const tokenData = await window.StravaAuth.exchangeCodeForToken(code);
    window.StravaAuth.saveTokens(tokenData, tokenData.athlete);
    window.location.href = '/';
  } catch (e) {
    window.location.href = '/?error=auth_failed';
  }
}

window.Dashboard = {
  init: initDashboard,
  syncStravaActivities,
  showActivityOnMap,
  switchTab,
  showScreen,
  showNotification,
  loginWithStrava,
  logout,
  handleOAuthCallback
};
