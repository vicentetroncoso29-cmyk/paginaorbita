/**
 * Worker de Cloudflare — intermediario seguro para pedidos de ÓRBITA.
 *
 * La página web NUNCA conoce la URL real del webhook de Discord.
 * Le habla a este Worker (cuya URL sí puede ser pública), y el Worker
 * reenvía el pedido a Discord usando un secreto guardado del lado del
 * servidor, invisible para cualquier visitante.
 *
 * CONFIGURACIÓN (una sola vez, en el dashboard de Cloudflare):
 *   Settings del Worker → Variables and Secrets → Add
 *     Nombre:  DISCORD_WEBHOOK
 *     Valor:   tu URL de webhook de Discord (marcar como "Secret")
 */

const ALLOWED_ORIGIN = "*"; // opcional: cámbialo por tu dominio real, ej "https://tu-usuario.github.io"

export default {
  async fetch(request, env) {
    // Responder pre-flight de CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return json({ error: "Método no permitido" }, 405);
    }

    // Límite simple contra spam: máximo ~1 pedido cada 3 segundos por IP,
    // usando Cache API como almacenamiento efímero (gratis, sin KV extra).
    const ip = request.headers.get("CF-Connecting-IP") || "desconocida";
    const cacheKey = new Request(`https://ratelimit.local/${ip}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
      return json({ error: "Espera unos segundos antes de enviar otro pedido." }, 429);
    }
    await cache.put(cacheKey, new Response("1", { headers: { "Cache-Control": "max-age=3" } }));

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "JSON inválido" }, 400);
    }

    // Validación mínima de forma, para no reenviar cualquier cosa a Discord
    if (!body || !Array.isArray(body.fields) || body.fields.length === 0 || body.fields.length > 30) {
      return json({ error: "Pedido inválido" }, 400);
    }
    const fields = body.fields.slice(0, 30).map(f => ({
      name: String(f.name || "").slice(0, 200),
      value: String(f.value || "").slice(0, 200),
      inline: false
    }));
    const total = String(body.total || "").slice(0, 60);

    const payload = {
      content: "📦 **Nuevo pedido pendiente**",
      embeds: [{
        title: "Pedido desde ÓRBITA",
        color: 16750935,
        fields,
        footer: { text: total ? `Total: ${total}` : undefined },
        timestamp: new Date().toISOString()
      }]
    };

    const discordRes = await fetch(env.DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!discordRes.ok) {
      return json({ error: "No se pudo enviar a Discord" }, 502);
    }
    return json({ ok: true }, 200);
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}
