/**
 * Cloudflare Worker — Replicate CORS proxy for theNiche on GitHub Pages.
 *
 * Deploy:
 *   cd proxy
 *   npx wrangler deploy
 *
 * Then set VITE_REPLICATE_PROXY=https://<worker-name>.<your-subdomain>.workers.dev
 * as a GitHub environment secret so the build bakes the URL in.
 */

const REPLICATE_BASE = 'https://api.replicate.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Prefer',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const target = REPLICATE_BASE + url.pathname + url.search;

    const proxied = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    const headers = new Headers(proxied.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      headers.set(k, v);
    }

    return new Response(proxied.body, { status: proxied.status, headers });
  },
};
