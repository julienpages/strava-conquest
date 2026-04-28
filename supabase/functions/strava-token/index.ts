import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  console.log('[strava-token] request:', req.method, req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  try {
    const body = await req.json();
    console.log('[strava-token] body keys:', Object.keys(body));

    const clientId     = Deno.env.get('STRAVA_CLIENT_ID');
    const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      console.error('[strava-token] missing env vars: STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET');
      return new Response(JSON.stringify({ error: 'Server misconfiguration: missing Strava credentials' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let payload: Record<string, string>;

    if (body.code) {
      console.log('[strava-token] grant_type: authorization_code');
      payload = {
        client_id:    clientId,
        client_secret: clientSecret,
        code:          body.code,
        grant_type:    'authorization_code',
      };
    } else if (body.refresh_token) {
      console.log('[strava-token] grant_type: refresh_token');
      payload = {
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: body.refresh_token,
        grant_type:    'refresh_token',
      };
    } else {
      console.warn('[strava-token] missing code or refresh_token');
      return new Response(JSON.stringify({ error: 'Missing code or refresh_token' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log('[strava-token] calling Strava token endpoint');
    const res = await fetch('https://www.strava.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await res.json();
    console.log('[strava-token] Strava response status:', res.status, 'ok:', res.ok);
    if (!res.ok) {
      console.error('[strava-token] Strava error body:', JSON.stringify(data));
    }

    return new Response(JSON.stringify(data), {
      status:  res.ok ? 200 : res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[strava-token] exception:', (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status:  500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
