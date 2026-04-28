// ============================================
// STRAVA CONQUEST — Supabase Client
// ============================================

const SUPABASE_URL = window.ENV?.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

// Initialize Supabase client (loaded via CDN in index.html)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// AUTH HELPERS
// ============================================
const Auth = {
  async getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async getUser() {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error) return null;
    return user;
  },

  onAuthChange(callback) {
    return sb.auth.onAuthStateChange(callback);
  }
};

// ============================================
// USER HELPERS
// ============================================
const UserDB = {
  async upsert(userData) {
    const { data, error } = await sb
      .from('users')
      .upsert(userData, { onConflict: 'strava_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getById(id) {
    const { data, error } = await sb
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return data;
  },

  async getByStravaId(stravaId) {
    const { data, error } = await sb
      .from('users')
      .select('*')
      .eq('strava_id', stravaId)
      .single();
    if (error) return null;
    return data;
  },

  async updateStats(userId, stats) {
    const { error } = await sb
      .from('users')
      .update({ ...stats, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;
  }
};

// ============================================
// TILES HELPERS
// ============================================
const TilesDB = {
  async upsertTile(tileData) {
    const { data, error } = await sb
      .from('tiles_captured')
      .upsert(tileData, { onConflict: 'tile_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getTilesByBounds(minLat, minLng, maxLat, maxLng) {
    const { data, error } = await sb
      .from('tiles_captured')
      .select(`
        *,
        users:owner_id (id, username, avatar_url)
      `)
      .gte('min_lat', minLat - 0.01)
      .lte('max_lat', maxLat + 0.01)
      .gte('min_lng', minLng - 0.01)
      .lte('max_lng', maxLng + 0.01);
    if (error) throw error;
    return data || [];
  },

  async getUserTiles(userId) {
    const { data, error } = await sb
      .from('tiles_captured')
      .select('*')
      .eq('owner_id', userId);
    if (error) throw error;
    return data || [];
  },

  async countUserTiles(userId) {
    const { count, error } = await sb
      .from('tiles_captured')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId);
    if (error) return 0;
    return count || 0;
  },

  async getAllTiles() {
    const { data, error } = await sb
      .from('tiles_captured')
      .select(`
        tile_id, tile_x, tile_y, owner_id, min_lat, min_lng, max_lat, max_lng,
        users:owner_id (id, username, avatar_url)
      `)
      .limit(10000);
    if (error) throw error;
    return data || [];
  }
};

// ============================================
// ACTIVITIES HELPERS
// ============================================
const ActivitiesDB = {
  async upsert(activity) {
    const { data, error } = await sb
      .from('activities')
      .upsert(activity, { onConflict: 'strava_activity_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getUserActivities(userId, limit = 20) {
    const { data, error } = await sb
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async getUnprocessed(userId) {
    const { data, error } = await sb
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .eq('processed', false)
      .not('polyline', 'is', null);
    if (error) throw error;
    return data || [];
  },

  async markProcessed(activityId, tilesCount, pointsEarned) {
    const { error } = await sb
      .from('activities')
      .update({ processed: true, tiles_captured: tilesCount, points_earned: pointsEarned })
      .eq('id', activityId);
    if (error) throw error;
  }
};

// ============================================
// LEADERBOARD HELPERS
// ============================================
const LeaderboardDB = {
  async getTop(season = null, limit = 20) {
    const currentSeason = season || getCurrentSeason();
    const { data, error } = await sb
      .from('leaderboard_scores')
      .select(`
        *,
        users:user_id (id, username, avatar_url, city)
      `)
      .eq('season', currentSeason)
      .order('total_points', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async upsertScore(userId, season, scoreData) {
    const { error } = await sb
      .from('leaderboard_scores')
      .upsert({
        user_id: userId,
        season,
        ...scoreData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,season' });
    if (error) throw error;
  },

  async getUserRank(userId, season = null) {
    const currentSeason = season || getCurrentSeason();
    const { data, error } = await sb
      .rpc('get_user_rank', { p_user_id: userId, p_season: currentSeason });
    if (error) return null;
    return data;
  }
};

// ============================================
// BADGES HELPERS
// ============================================
const BadgesDB = {
  async getUserBadges(userId) {
    const { data, error } = await sb
      .from('badges')
      .select('*')
      .eq('user_id', userId);
    if (error) return [];
    return data || [];
  },

  async awardBadge(userId, badgeType, level = 1) {
    const { error } = await sb
      .from('badges')
      .upsert({ user_id: userId, badge_type: badgeType, badge_level: level },
               { onConflict: 'user_id,badge_type' });
    if (error) console.error('Badge award error:', error);
  }
};

// ============================================
// HELPERS
// ============================================
function getCurrentSeason() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

// Export
window.DB = { Auth, UserDB, TilesDB, ActivitiesDB, LeaderboardDB, BadgesDB, getCurrentSeason, supabase: sb };
