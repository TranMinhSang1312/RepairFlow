export const HTTP_LOG_REDACTION = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    'req.headers["x-request-id"]',
    'req.headers["x-repairflow-invitation-token"]',
    'res.headers["set-cookie"]',
    "req.body.password",
    "req.body.accessToken",
    "req.body.refreshToken",
    "req.params.token",
    "req.params.path",
  ],
  censor: "[REDACTED]",
};

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u;

export function acceptedRequestId(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && SAFE_REQUEST_ID.test(value) ? value : undefined;
}

const PUBLIC_TOKEN_PATH = /(\/(?:public\/v1\/(?:orders|quotes)|join)\/)[^/?#]+/gu;

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
