/** Local UI entry navigation is distinct from cross-origin data/API access. */
export function checkLocalRequest(req, origin) {
  const deny = message => { throw new Error(message); };
  const expected = new URL(origin);
  if (expected.hostname !== '127.0.0.1' || expected.protocol !== 'http:' ||
      req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== expected.host)
    deny('Loopback Host required');
  if (!req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\'))
    deny('Invalid local request target');
  const url = new URL(req.url, origin);
  if (url.origin !== origin) deny('Invalid local request target');
  if (req.headers.origin !== undefined && req.headers.origin !== origin)
    deny('Cross-origin request forbidden');
  const site = req.headers['sec-fetch-site'];
  if (!site || site === 'same-origin' || site === 'none') return url;
  // Only a user-activated top-level GET of the entry page may arrive from another site/port.
  // Cookies/auth still apply; this exception never reaches media/API routes, iframes or mutations.
  if (['same-site', 'cross-site'].includes(site) && req.method === 'GET' &&
      url.pathname === '/' && req.headers.origin === undefined &&
      req.headers['sec-fetch-mode'] === 'navigate' &&
      req.headers['sec-fetch-dest'] === 'document' &&
      req.headers['sec-fetch-user'] === '?1') return url;
  deny('Cross-site request forbidden');
}

export function localCookieName(app, port) {
  if (!/^[a-z_]+$/.test(app) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid local session namespace');
  return `basira_${app}_${port}`;
}

export function readLocalCookie(header, name) {
  const matches = (header ?? '').split(';').map(x => x.trim())
    .filter(x => x.startsWith(name + '='));
  // Duplicate named cookies are ambiguous: require a fresh entry rather than guessing order.
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
