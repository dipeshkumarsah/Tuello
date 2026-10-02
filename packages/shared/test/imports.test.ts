import { describe, expect, it } from 'vitest';
import { normalizePhone, parseImportRow, suggestMapping } from '../src';

describe('import mapping', () => {
  it('maps common header spellings', () => {
    expect(suggestMapping('clients', ['First Name', 'Last_Name', 'E-mail', 'Mobile', 'Brokerage', 'Zip'])).toEqual({
      firstName: 'First Name',
      lastName: 'Last_Name',
      email: 'E-mail',
      phone: 'Mobile',
      brokerage: 'Brokerage',
      postalCode: 'Zip',
    });
  });

  it('uses a full-name column only when first/last are absent', () => {
    expect(suggestMapping('clients', ['Agent Name', 'Email'])).toEqual({ fullName: 'Agent Name', email: 'Email' });
  });
});

describe('import rows', () => {
  const mapping = { fullName: 'Name', email: 'Email', phone: 'Phone', tags: 'Tags', externalRef: 'ID' };

  it('normalises a valid client row', () => {
    const r = parseImportRow('clients', { Name: 'Mary Jo Smith', Email: ' MJ@Example.com ', Phone: '+1 (415) 555-0100', Tags: 'vip; luxury', ID: '' }, mapping);
    expect(r).toEqual({
      ok: true,
      value: expect.objectContaining({ firstName: 'Mary Jo', lastName: 'Smith', email: 'mj@example.com', phoneNormalized: '4155550100', tags: ['vip', 'luxury'] }),
    });
  });

  it('reports every problem in a row', () => {
    const r = parseImportRow('clients', { Name: '', Email: 'nope', Phone: '12', Tags: '', ID: '' }, mapping);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['Invalid email "nope"', 'Invalid phone "12"']));
  });

  it('requires a dedupe key', () => {
    const r = parseImportRow('clients', { Name: 'No Contact', Email: '', Phone: '', Tags: '', ID: '' }, mapping);
    expect(r.ok).toBe(false);
    const ok = parseImportRow('clients', { Name: 'Has Ref', Email: '', Phone: '', Tags: '', ID: 'crm-1' }, mapping);
    expect(ok.ok).toBe(true);
  });

  it('validates brokerages', () => {
    expect(parseImportRow('brokerages', { N: 'Compass' }, { name: 'N' })).toMatchObject({ ok: true, value: { name: 'Compass' } });
    expect(parseImportRow('brokerages', { N: ' ' }, { name: 'N' }).ok).toBe(false);
  });

  it('normalises phones for matching', () => {
    expect(normalizePhone('+1 415-555-0100')).toBe('4155550100');
    expect(normalizePhone('020 7946 0958')).toBe('02079460958');
  });
});
