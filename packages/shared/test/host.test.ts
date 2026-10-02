import { describe, expect, it } from 'vitest';
import { classifyHost, isValidSlug, normalizeHost } from '../src';

const base = 'tuello.app';

describe('classifyHost', () => {
  it('recognises the apex', () => {
    expect(classifyHost('tuello.app', base)).toEqual({ kind: 'apex' });
    expect(classifyHost('app.tuello.app', base)).toEqual({ kind: 'apex' });
    expect(classifyHost('WWW.Tuello.App:443', base)).toEqual({ kind: 'apex' });
  });

  it('extracts a tenant slug', () => {
    expect(classifyHost('acme.tuello.app', base)).toEqual({ kind: 'subdomain', slug: 'acme' });
    expect(classifyHost('acme-media.tuello.app:3000', base)).toEqual({
      kind: 'subdomain',
      slug: 'acme-media',
    });
  });

  it('rejects nested or malformed subdomains', () => {
    expect(classifyHost('a.b.tuello.app', base)).toEqual({ kind: 'invalid' });
    expect(classifyHost('-x.tuello.app', base)).toEqual({ kind: 'invalid' });
    expect(classifyHost('', base)).toEqual({ kind: 'invalid' });
    expect(classifyHost(undefined, base)).toEqual({ kind: 'invalid' });
    expect(classifyHost('[::1]:3000', base)).toEqual({ kind: 'invalid' });
  });

  it('treats other hosts as custom domains', () => {
    expect(classifyHost('media.example.com', base)).toEqual({
      kind: 'custom',
      hostname: 'media.example.com',
    });
    expect(classifyHost('evil.tuello.app.example.com', base)).toEqual({
      kind: 'custom',
      hostname: 'evil.tuello.app.example.com',
    });
  });

  it('does not confuse a suffix match without a dot', () => {
    expect(classifyHost('nottuello.app', base)).toEqual({
      kind: 'custom',
      hostname: 'nottuello.app',
    });
  });

  it('works for the local base domain', () => {
    expect(classifyHost('acme.tuello.localhost:3000', 'tuello.localhost')).toEqual({
      kind: 'subdomain',
      slug: 'acme',
    });
  });
});

describe('slugs', () => {
  it('validates', () => {
    expect(isValidSlug('acme')).toBe(true);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('a--b')).toBe(false);
    expect(isValidSlug('Acme')).toBe(false);
    expect(isValidSlug('acme-')).toBe(false);
    expect(isValidSlug('a'.repeat(41))).toBe(false);
  });

  it('normalises hosts', () => {
    expect(normalizeHost(' Acme.Tuello.App:8080 ')).toBe('acme.tuello.app');
    expect(normalizeHost('acme.tuello.app., other')).toBe('acme.tuello.app');
  });
});
