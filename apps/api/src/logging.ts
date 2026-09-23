export const HTTP_LOG_REDACTION = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
    "req.body.password",
    "req.body.accessToken",
    "req.body.refreshToken",
    "req.params.token",
    "req.params.path",
  ],
  censor: "[REDACTED]",
};

const PUBLIC_TOKEN_PATH = /(\/public\/v1\/(?:orders|quotes)\/)[^/?#]+/gu;

export function redactPublicTokenUrl(url: string | undefined): string | undefined {
  return url?.replace(PUBLIC_TOKEN_PATH, "$1[REDACTED]");
}

export function redactPublicTokenRequest<T extends { url?: string; params?: unknown }>(
  request: T,
): T {
  const url = redactPublicTokenUrl(request.url);
  if (url === request.url) return request;
  return { ...request, url, params: "[REDACTED]" };
}
