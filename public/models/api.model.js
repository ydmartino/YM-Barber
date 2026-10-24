let csrfToken = "";
let onUnauthorized = () => {};

export function setCsrfToken(token) {
  csrfToken = token || "";
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function api(route, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.method && !["GET", "HEAD"].includes(options.method)) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  const response = await fetch(`/api?route=${encodeURIComponent(route)}`, {
    ...options,
    headers,
    credentials: "same-origin",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    throw new Error(payload.error || `Erro na solicitação (${response.status}).`);
  }
  return payload;
}
