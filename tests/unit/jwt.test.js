const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
} = require('../../config/jwt');

// FIX: JWT now carries id, role, email ONLY
// is_verified removed — DB is source of truth for mutable state
const testUser = {
  id:          1,
  email:       'test@example.com',
  role:        'jobseeker',
  is_verified: true, // still passed in but should NOT appear in token
};

// ── generateAccessToken() ─────────────────────────────────────────
describe('generateAccessToken()', () => {
  it('generates a valid JWT with 3 parts',
    () => expect(generateAccessToken(testUser).split('.')).toHaveLength(3));

  it('contains id in payload',
    () => expect(verifyAccessToken(generateAccessToken(testUser)).id).toBe(1));

  it('contains role in payload',
    () => expect(verifyAccessToken(generateAccessToken(testUser)).role).toBe('jobseeker'));

  it('contains email in payload',
    () => expect(verifyAccessToken(generateAccessToken(testUser)).email).toBe('test@example.com'));

  // FIX: is_verified must NOT be in the token payload
  // DB is the source of truth — token carries identity only
  it('does NOT contain is_verified in payload', () => {
    const decoded = verifyAccessToken(generateAccessToken(testUser));
    expect(decoded.is_verified).toBeUndefined();
  });

  it('contains iat (issued at) timestamp',
    () => expect(verifyAccessToken(generateAccessToken(testUser)).iat).toBeDefined());

  it('contains exp (expiry) timestamp',
    () => expect(verifyAccessToken(generateAccessToken(testUser)).exp).toBeDefined());

  it('exp is greater than iat (token has future expiry)',
    () => {
      const decoded = verifyAccessToken(generateAccessToken(testUser));
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
    });
});

// ── generateRefreshToken() ────────────────────────────────────────
describe('generateRefreshToken()', () => {
  it('generates a valid JWT with 3 parts',
    () => expect(generateRefreshToken(testUser).split('.')).toHaveLength(3));

  it('contains only id in payload (minimal)',
    () => {
      const decoded = verifyRefreshToken(generateRefreshToken(testUser));
      expect(decoded.id).toBe(1);
      expect(decoded.role).toBeUndefined();
      expect(decoded.email).toBeUndefined();
    });

  it('different secret from access token',
    () => {
      const access  = generateAccessToken(testUser);
      const refresh = generateRefreshToken(testUser);
      // Cannot verify refresh with access secret and vice versa
      expect(() => verifyAccessToken(refresh)).toThrow();
    });
});

// ── verifyAccessToken() ───────────────────────────────────────────
describe('verifyAccessToken()', () => {
  it('verifies a valid token',
    () => expect(verifyAccessToken(generateAccessToken(testUser)).id).toBe(1));

  it('throws JsonWebTokenError on invalid token',
    () => {
      expect(() => verifyAccessToken('invalid.token.here')).toThrow();
    });

  it('throws on tampered payload',
    () => {
      const t = generateAccessToken(testUser);
      const tampered = t.slice(0, -5) + 'XXXXX';
      expect(() => verifyAccessToken(tampered)).toThrow();
    });

  it('throws on empty string',
    () => expect(() => verifyAccessToken('')).toThrow());

  it('throws when refresh token used as access token',
    () => {
      const refresh = generateRefreshToken(testUser);
      expect(() => verifyAccessToken(refresh)).toThrow();
    });
});

// ── verifyRefreshToken() ──────────────────────────────────────────
describe('verifyRefreshToken()', () => {
  it('verifies a valid refresh token',
    () => expect(verifyRefreshToken(generateRefreshToken(testUser)).id).toBe(1));

  it('throws on invalid token',
    () => expect(() => verifyRefreshToken('bad.token.here')).toThrow());

  it('throws when access token used as refresh token',
    () => {
      const access = generateAccessToken(testUser);
      expect(() => verifyRefreshToken(access)).toThrow();
    });
});

// ── hashToken() ───────────────────────────────────────────────────
describe('hashToken()', () => {
  it('is consistent — same input always same output',
    () => expect(hashToken('abc')).toBe(hashToken('abc')));

  it('differs for different inputs',
    () => expect(hashToken('abc')).not.toBe(hashToken('xyz')));

  it('returns a 64-character hex string',
    () => {
      const h = hashToken('any-token');
      expect(h).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(h)).toBe(true);
    });

  it('handles long token strings',
    () => {
      const long = 'a'.repeat(500);
      expect(hashToken(long)).toHaveLength(64);
    });
});
