// ============================================
// STRAVA CONQUEST — Strava OAuth 2.0
// ============================================

const STRAVA_CONFIG = {
  clientId: window.ENV?.STRAVA_CLIENT_ID || 'YOUR_STRAVA_CLIENT_ID',
  clientSecret: window.ENV?.STRAVA_CLIENT_SECRET || 'YOUR_STRAVA_CLIENT_SECRET',
  redirectUri: window.location.origin + '/callback.html',
  scope: 'read,activity:read_all,profile:read_all',
  authUrl: 'https://www.strava.com/oauth/authorize',
  tokenUrl: 'https://www.strava.com/oauth/token',
  apiBase: 'https://www.strava.com/api/v3'
};

// ============================================
// AUTH FLOW
// ============================================
const StravaAuth = {
  // Step 1: Redirect user to Strava login
  initiateOAuth() {
    const params = new URLSearchParams({
      client_id: STRAVA_CONFIG.clientId,
      redirect_uri: STRAVA_CONFIG.redirectUri,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: STRAVA_CONFIG.scope
    });
    window.location.href = `${STRAVA_CONFIG.authUrl}?${params}`;
  },

  // Step 2: Exchange code for token (called from callback page)
  async exchangeCodeForToken(code) {
    const response = await fetch(STRAVA_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CONFIG.clientId,
        client_secret: STRAVA_CONFIG.clientSecret,
        code,
        grant_type: 'authorization_code'
      })
    });
    if (!response.ok) throw new Error('Token exchange failed');
    return response.json();
  },

  // Step 3: Refresh expired token
  async refreshToken(refreshToken) {
    const response = await fetch(STRAVA_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CONFIG.clientId,
        client_secret: STRAVA_CONFIG.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    if (!response.ok) throw new Error('Token refresh failed');
    return response.json();
  },

  // Store tokens in localStorage (for demo) or Supabase
  saveTokens(tokenData, userData) {
    localStorage.setItem('strava_tokens', JSON.stringify({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
      athlete: tokenData.athlete || userData
    }));
  },

  getStoredTokens() {
    const stored = localStorage.getItem('strava_tokens');
    return stored ? JSON.parse(stored) : null;
  },

  clearTokens() {
    localStorage.removeItem('strava_tokens');
  },

  async getValidToken() {
    const tokens = this.getStoredTokens();
    if (!tokens) return null;

    const now = Math.floor(Date.now() / 1000);
    if (tokens.expires_at < now + 300) {
      // Refresh if expires within 5 minutes
      try {
        const refreshed = await this.refreshToken(tokens.refresh_token);
        this.saveTokens(refreshed, tokens.athlete);
        return refreshed.access_token;
      } catch (e) {
        this.clearTokens();
        return null;
      }
    }
    return tokens.access_token;
  },

  isLoggedIn() {
    const tokens = this.getStoredTokens();
    return tokens && tokens.access_token;
  },

  getCurrentAthlete() {
    const tokens = this.getStoredTokens();
    return tokens?.athlete || null;
  }
};

// ============================================
// STRAVA API CALLS
// ============================================
const StravaAPI = {
  async get(endpoint, params = {}) {
    const token = await StravaAuth.getValidToken();
    if (!token) throw new Error('Not authenticated');

    const url = new URL(`${STRAVA_CONFIG.apiBase}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 401) {
      StravaAuth.clearTokens();
      throw new Error('Token expired');
    }
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  },

  async getAthlete() {
    return this.get('/athlete');
  },

  async getActivities(page = 1, perPage = 30, after = null) {
    const params = { page, per_page: perPage };
    if (after) params.after = after;
    return this.get('/athlete/activities', params);
  },

  async getActivity(id) {
    return this.get(`/activities/${id}`);
  },

  async getAllActivities(after = null) {
    const activities = [];
    let page = 1;
    while (true) {
      const batch = await this.getActivities(page, 100, after);
      if (!batch.length) break;
      activities.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    return activities;
  },

  // Get starred segments in a region
  async getSegmentsExplorer(bounds) {
    return this.get('/segments/explore', { bounds, activity_type: 'running' });
  }
};

window.StravaAuth = StravaAuth;
window.StravaAPI = StravaAPI;
