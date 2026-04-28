// ============================================
// STRAVA CONQUEST — Strava OAuth 2.0
// ============================================

const STRAVA_CONFIG = {
  clientId:    window.ENV?.STRAVA_CLIENT_ID || 'YOUR_STRAVA_CLIENT_ID',
  redirectUri: window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'frontend/callback.html',
  scope:       'read,activity:read_all,profile:read_all',
  authUrl:     'https://www.strava.com/oauth/authorize',
  apiBase:     'https://www.strava.com/api/v3',
  edgeFnUrl:   () => `${window.ENV?.SUPABASE_URL}/functions/v1/strava-token`,
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

  // Step 2: Exchange code for token — proxied through Edge Function (secret stays server-side)
  async exchangeCodeForToken(code) {
    const response = await fetch(STRAVA_CONFIG.edgeFnUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    if (!response.ok) throw new Error('Token exchange failed');
    return response.json();
  },

  // Step 3: Refresh expired token — proxied through Edge Function
  async refreshToken(refreshToken) {
    const response = await fetch(STRAVA_CONFIG.edgeFnUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
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

  async getActivities(page = 1, perPage = 150, after = null) {
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
    const perPage = 200; // Strava API max per_page is 200
    while (true) {
      const batch = await this.getActivities(page, perPage, after);
      console.log(`Page ${page}: récupéré ${batch.length} activités`);
      if (!batch.length) break;
      activities.push(...batch);
      if (batch.length < perPage) break;
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
