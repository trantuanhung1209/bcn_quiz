export function extractBearerToken(authorization?: string): string | undefined {
  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }

  return token.length > 0 ? token : undefined;
}

export function appendBearerTokenAsCookie(
  cookieHeader: string | undefined,
  authorization: string | undefined,
  cookieName: string,
): string | undefined {
  const bearerToken = extractBearerToken(authorization);
  if (!bearerToken || hasCookie(cookieHeader, cookieName)) {
    return cookieHeader;
  }

  const cookiePair = `${cookieName}=${encodeURIComponent(bearerToken)}`;
  return cookieHeader?.trim() ? `${cookieHeader}; ${cookiePair}` : cookiePair;
}

function hasCookie(
  cookieHeader: string | undefined,
  cookieName: string,
): boolean {
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${cookieName}=`));
}
