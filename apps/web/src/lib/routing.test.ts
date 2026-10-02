import { describe, expect, it } from 'vitest';
import { fieldMessage } from './forms';
import { internalPath } from './routing';

describe('host routing', () => {
  const base = 'tuello.app';
  it('sends the apex to the signup tree', () => {
    expect(internalPath('tuello.app', '/', base)).toBe('/apex');
    expect(internalPath('app.tuello.app', '/signup', base)).toBe('/apex/signup');
  });
  it('sends tenant subdomains and custom domains to the workspace tree', () => {
    expect(internalPath('acme.tuello.app', '/login', base)).toBe('/t/login');
    expect(internalPath('media.acme-photos.com', '/', base)).toBe('/t');
  });
  it('cannot reach the other tree by path', () => {
    expect(internalPath('acme.tuello.app', '/apex/signup', base)).toBe('/t/apex/signup');
  });
  it('rejects invalid hosts', () => {
    expect(internalPath(null, '/', base)).toBeNull();
    expect(internalPath('x.y.tuello.app', '/', base)).toBeNull();
  });
});

describe('form messages', () => {
  it('translates validation keys', () => {
    expect(fieldMessage('validation.email')).toBe('Enter a valid email address.');
    expect(fieldMessage('Already a member')).toBe('Already a member');
    expect(fieldMessage(undefined)).toBeUndefined();
  });
});
