import demo from "../fixtures/vercel-demo.json" with { type: "json" };

const COLLECTED_AT = "2026-08-20T09:00:00+03:00";
const errors = {
  403: "ключ не даёт доступа к этой компании: песочница ограничена тестовыми id",
  429: "лимит запросов на сегодня исчерпан, повторите через 3600 секунд",
  202: "данные собираются, повторите через 15 секунд",
};

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function problem(status, retryAfter) {
  return json({
    error: errors[status],
    ...(retryAfter ? { retry_after: retryAfter } : {}),
  }, status);
}

export function handleLabsRequest(request, resource, clientId) {
  if (request.method !== "GET") return json({ error: "метод не поддерживается" }, 405);

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (state === "forbidden") return problem(403);
  if (state === "limit") return problem(429, 3600);
  if (state === "loading") return problem(202, 15);

  let payload;
  if (resource === "clients") {
    const items = state === "empty" ? [] : demo.clients.filter((client) => {
      const manager = url.searchParams.get("manager");
      return !manager || manager === client.manager;
    });
    payload = { items, total: items.length, collected_at: items.length ? COLLECTED_AT : null };
  } else if (resource === "leads") {
    const requestedClient = url.searchParams.get("client_id");
    const limitValue = Number.parseInt(url.searchParams.get("limit") || "500", 10);
    const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 0), 500) : 500;
    const items = state === "empty" || (requestedClient && requestedClient !== "cl-01")
      ? []
      : demo.leads.slice(0, limit);
    payload = { items, total: items.length, collected_at: items.length ? COLLECTED_AT : null };
  } else if (resource === "history") {
    if (clientId !== "cl-01") return problem(403);
    const history = demo.history[clientId];
    payload = state === "empty"
      ? { before: null, after: null, collected_at: null }
      : { ...history, collected_at: COLLECTED_AT };
  } else {
    return json({ error: "нет такой ручки, см. api.md" }, 404);
  }

  if (state === "stale") payload.stale = true;
  return json(payload);
}
