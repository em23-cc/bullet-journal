/* worker.js — Cloudflare Worker: JSON sync by syncCode → KV */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, "");
    // path: /:syncCode  e.g. /AB3X9K

    if (!path || path.length > 20) {
      return new Response("Bad request", { status: 400 });
    }

    const key = "sync:" + path.toUpperCase();

    switch (request.method) {
      case "GET": {
        const raw = await env.BULLET_SYNC.get(key);
        if (!raw) return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
        return new Response(raw, {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      case "PUT": {
        const body = await request.text();
        try { JSON.parse(body); } catch { return new Response("Invalid JSON", { status: 422 }); }
        await env.BULLET_SYNC.put(key, body);
        return new Response("ok", {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      case "OPTIONS": {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      default:
        return new Response("Method not allowed", { status: 405 });
    }
  },
};
