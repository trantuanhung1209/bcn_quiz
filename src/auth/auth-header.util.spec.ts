import {
  appendBearerTokenAsCookie,
  extractBearerToken,
} from './auth-header.util';

describe('auth header utilities', () => {
  describe('extractBearerToken', () => {
    it('extracts bearer tokens case-insensitively', () => {
      expect(extractBearerToken('bearer abc.def')).toBe('abc.def');
    });

    it('ignores non-bearer authorization headers', () => {
      expect(extractBearerToken('Basic abc.def')).toBeUndefined();
    });
  });

  describe('appendBearerTokenAsCookie', () => {
    it('adds a bearer token as the requested cookie', () => {
      expect(
        appendBearerTokenAsCookie('foo=bar', 'Bearer abc.def', 'access_token'),
      ).toBe('foo=bar; access_token=abc.def');
    });

    it('keeps an existing cookie value', () => {
      expect(
        appendBearerTokenAsCookie(
          'access_token=from-cookie',
          'Bearer from-header',
          'access_token',
        ),
      ).toBe('access_token=from-cookie');
    });
  });
});
