export const HTTP_LOG_REDACTION = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
    "req.body.password",
    "req.body.accessToken",
    "req.body.refreshToken",
  ],
  censor: "[REDACTED]",
};
