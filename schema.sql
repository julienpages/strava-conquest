-- ============================================
-- STRAVA CONQUEST — Supabase Schema
-- ============================================

-- Enable PostGIS for geo queries (optional but recommended)
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================
-- USERS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strava_id BIGINT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  firstname TEXT,
  lastname TEXT,
  avatar_url TEXT,
  city TEXT,
  country TEXT,
  strava_access_token TEXT,
  strava_refresh_token TEXT,
  strava_token_expires_at BIGINT,
  total_points INTEGER DEFAULT 0,
  tiles_count INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_activity_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ACTIVITIES
-- ============================================
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strava_activity_id BIGINT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  sport_type TEXT,
  start_date TIMESTAMPTZ,
  distance FLOAT,           -- meters
  moving_time INTEGER,       -- seconds
  elapsed_time INTEGER,      -- seconds
  total_elevation_gain FLOAT, -- meters
  average_speed FLOAT,       -- m/s
  max_speed FLOAT,           -- m/s
  calories INTEGER,
  polyline TEXT,             -- encoded Google polyline
  tiles_captured INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TILES CAPTURED
-- ============================================
CREATE TABLE IF NOT EXISTS tiles_captured (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tile_id TEXT NOT NULL,     -- format: "lat_lng" at 500m grid
  tile_x INTEGER NOT NULL,   -- grid X coordinate
  tile_y INTEGER NOT NULL,   -- grid Y coordinate
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  first_captured_at TIMESTAMPTZ DEFAULT NOW(),
  last_visited_at TIMESTAMPTZ DEFAULT NOW(),
  visit_count INTEGER DEFAULT 1,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  -- Bounding box for map display
  min_lat FLOAT,
  min_lng FLOAT,
  max_lat FLOAT,
  max_lng FLOAT,
  UNIQUE(tile_id)
);

-- ============================================
-- GPS TRACKS (decoded polylines)
-- ============================================
CREATE TABLE IF NOT EXISTS gps_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points JSONB NOT NULL,     -- [{lat, lng}, ...]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- LEADERBOARD SCORES
-- ============================================
CREATE TABLE IF NOT EXISTS leaderboard_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season TEXT NOT NULL,      -- "2024-01", "2024-02" etc.
  total_points INTEGER DEFAULT 0,
  tiles_count INTEGER DEFAULT 0,
  activities_count INTEGER DEFAULT 0,
  total_distance FLOAT DEFAULT 0,
  total_elevation FLOAT DEFAULT 0,
  rank INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season)
);

-- ============================================
-- BADGES
-- ============================================
CREATE TABLE IF NOT EXISTS badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_type TEXT NOT NULL,  -- 'explorer', 'climber', 'regular', etc.
  badge_level INTEGER DEFAULT 1,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_type)
);

-- ============================================
-- CHALLENGES
-- ============================================
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT,       -- 'tiles', 'distance', 'streak', 'elevation'
  target_value FLOAT,
  period TEXT,               -- 'weekly', 'monthly', 'all_time'
  season TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  progress FLOAT DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, challenge_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tiles_owner ON tiles_captured(owner_id);
CREATE INDEX IF NOT EXISTS idx_tiles_xy ON tiles_captured(tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(start_date);
CREATE INDEX IF NOT EXISTS idx_leaderboard_season ON leaderboard_scores(season, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_users_strava ON users(strava_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiles_captured ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- Public read for tiles (see everyone's territory)
CREATE POLICY "tiles_public_read" ON tiles_captured FOR SELECT USING (true);
-- Users can only insert/update their own tiles
CREATE POLICY "tiles_own_write" ON tiles_captured FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Public read for leaderboard
CREATE POLICY "leaderboard_public_read" ON leaderboard_scores FOR SELECT USING (true);

-- Users read their own data
CREATE POLICY "users_own_read" ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users_own_update" ON users FOR UPDATE USING (id = auth.uid());

-- Activities: own read/write
CREATE POLICY "activities_own" ON activities USING (user_id = auth.uid());

-- ============================================
-- DEFAULT CHALLENGES
-- ============================================
INSERT INTO challenges (name, description, challenge_type, target_value, period, icon) VALUES
('Explorer Débutant', 'Capturez 20 tiles cette semaine', 'tiles', 20, 'weekly', '🗺️'),
('Coureur du Dimanche', 'Faites 3 sorties de plus de 10km', 'distance', 30000, 'weekly', '🏃'),
('Grimpeur fou', 'Cumulez 1000m de dénivelé', 'elevation', 1000, 'weekly', '⛰️'),
('Conquistador', 'Capturez 100 tiles ce mois', 'tiles', 100, 'monthly', '👑'),
('Sans repos', 'Activité 7 jours d''affilée', 'streak', 7, 'monthly', '🔥'),
('Tour du monde', 'Capturez 500 tiles total', 'tiles', 500, 'all_time', '🌍')
ON CONFLICT DO NOTHING;
