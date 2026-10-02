/**
 * The path as it may appear in logs: no query string (links carry one-time tokens) and no
 * token path segments (invite links are /v1/invites/token/{token}).
 */
export function logPath(url: string): string {
  return url.split('?')[0]!.replace(/\/token\/[^/]+/g, '/token/[redacted]');
}
