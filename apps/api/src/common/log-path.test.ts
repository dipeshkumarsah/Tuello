import { describe, expect, it } from 'vitest';
import { logPath } from './log-path';

describe('logPath', () => {
  it('drops query strings and token segments', () => {
    expect(logPath('/v1/invites/token/abcDEF123/accept?x=1')).toBe(
      '/v1/invites/token/[redacted]/accept',
    );
    expect(logPath('/v1/auth/verify-email?token=secret')).toBe('/v1/auth/verify-email');
    expect(logPath('/v1/members')).toBe('/v1/members');
  });
});
