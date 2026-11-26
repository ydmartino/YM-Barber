let csrfToken = "";
let onUnauthorized = () => {};

export function setCsrfToken(token) {
  csrfToken = token || "";
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function api(route, options = {}) {
  const { query, ...requestOptions } = options;
  const headers = { Accept: "application/json", ...(requestOptions.headers || {}) };
  if (requestOptions.body !== undefined) headers["Content-Type"] = "application/json";
  if (requestOptions.method && !["GET", "HEAD"].includes(requestOptions.method)) {
    const publicCookie = document.cookie.split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("navalha_booking_csrf="));
    headers["X-CSRF-Token"] = csrfToken || (publicCookie ? publicCookie.slice(publicCookie.indexOf("=") + 1) : "");
  }
  const queryString = query ? `&${new URLSearchParams(query)}` : "";
  const response = await fetch(`/api?route=${encodeURIComponent(route)}${queryString}`, {
    ...requestOptions,
    headers,
    credentials: "same-origin",
    body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    throw new Error(payload.error || `Erro na solicitação (${response.status}).`);
  }
  return payload;
}
