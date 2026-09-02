const { slugify, getPagination, paginationMeta } = require('../../utils/helpers');

// ── slugify() ─────────────────────────────────────────────────────
describe('slugify()', () => {
  it('converts text to lowercase slug',
    () => expect(slugify('Hello World')).toBe('hello-world'));

  it('removes special characters',
    () => expect(slugify('Node.js & Express!')).toBe('nodejs-express'));

  it('collapses multiple spaces',
    () => expect(slugify('Backend   Developer')).toBe('backend-developer'));

  it('trims leading and trailing dashes',
    () => expect(slugify('  Hello  ')).toBe('hello'));

  it('handles numbers',
    () => expect(slugify('Top 10 Tips')).toBe('top-10-tips'));

  it('handles already clean slugs',
    () => expect(slugify('hello-world')).toBe('hello-world'));

  it('handles empty string',
    () => expect(slugify('')).toBe(''));

  it('handles strings with only special characters',
    () => expect(slugify('!@#$%^&*()')).toBe(''));
});

// ── getPagination() ───────────────────────────────────────────────
describe('getPagination()', () => {
  it('returns defaults when no params',
    () => expect(getPagination({})).toEqual({ page: 1, limit: 10, offset: 0 }));

  it('calculates offset correctly for page 2',
    () => expect(getPagination({ page: '2', limit: '10' }).offset).toBe(10));

  it('calculates offset correctly for page 3',
    () => expect(getPagination({ page: '3', limit: '10' }).offset).toBe(20));

  it('enforces minimum page of 1 for negative input',
    () => expect(getPagination({ page: '-5' }).page).toBe(1));

  it('enforces minimum page of 1 for zero',
    () => expect(getPagination({ page: '0' }).page).toBe(1));

  it('enforces maximum limit of 50',
    () => expect(getPagination({ limit: '100' }).limit).toBe(50));

  it('handles non-numeric page gracefully',
    () => expect(getPagination({ page: 'abc' }).page).toBe(1));

  it('handles non-numeric limit gracefully',
    () => expect(getPagination({ limit: 'abc' }).limit).toBe(10));
});

// ── paginationMeta() ──────────────────────────────────────────────
describe('paginationMeta()', () => {
  it('calculates total pages correctly',
    () => expect(paginationMeta(100, 1, 10).pages).toBe(10));

  it('rounds up for partial last page',
    () => expect(paginationMeta(47, 1, 10).pages).toBe(5));

  it('hasNext true when more pages exist',
    () => expect(paginationMeta(100, 1, 10).hasNext).toBe(true));

  it('hasNext false on last page',
    () => expect(paginationMeta(100, 10, 10).hasNext).toBe(false));

  it('hasPrev false on first page',
    () => expect(paginationMeta(100, 1, 10).hasPrev).toBe(false));

  it('hasPrev true when not on first page',
    () => expect(paginationMeta(100, 2, 10).hasPrev).toBe(true));

  it('returns correct total',
    () => expect(paginationMeta(47, 1, 10).total).toBe(47));

  it('handles zero results',
    () => expect(paginationMeta(0, 1, 10)).toEqual({
      total: 0, page: 1, limit: 10, pages: 0, hasNext: false, hasPrev: false,
    }));
});
