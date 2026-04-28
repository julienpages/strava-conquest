import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  try {
    const body = await req.json();
    const clientId     = Deno.env.get('STRAVA_CLIENT_ID')!;
    const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET')!;

    let payload: Record<string, string>;

    if (body.code) {
      payload = {
        client_id:    clientId,
        client_secret: clientSecret,
        code:          body.code,
        grant_type:    'authorization_code',
      };
    } else if (body.refresh_token) {
      payload = {
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: body.refresh_token,
        grant_type:    'refresh_token',
      };
    } else {
      return new Response(JSON.stringify({ error: 'Missing code or refresh_token' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const res  = await fetch('https://www.strava.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      status:  res.ok ? 200 : res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status:  500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
