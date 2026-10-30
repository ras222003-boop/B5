/** These legacy deployment origins remain explicit until their owner migrates them. */
const legacyPublishedOrigin = "https://basira-ve3h8rof.manus.space";
const previewOrigins = [
  "https://8328-imv45ni0cja578aqjmie4-14cb3a00.sg2.manus.computer",
  "https://3000-imv45ni0cja578aqjmie4-14cb3a00.sg2.manus.computer",
  "https://3001-imv45ni0cja578aqjmie4-14cb3a00.sg2.manus.computer",
];

/** Syntax validation only: domain ownership and deployment are checked separately. */
export function validateAuthPublicOrigin(value: string): string {
  const reject = () => {
    throw new Error(
      "BASIRA_PUBLIC_URL must be a public HTTPS origin without credentials, port, path, query or fragment"
    );
  };
  const match = /^https:\/\/([a-z0-9.-]+)\/?$/i.exec(value);
  if (!match || value !== value.trim()) return reject();
  const host = match[1].toLowerCase(),
    labels = host.split(".");
  if (
    host.length > 253 ||
    labels.length < 2 ||
    !/[a-z]/.test(host) ||
    /\.(?:localhost|local|example|invalid|test)$/.test(host) ||
    labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return reject();
  // WHATWG URL parsing canonicalizes numeric host aliases; reject those aliases.
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return reject();
  }
  if (parsed.hostname !== host) return reject();
  return `https://${host}`;
}

export function authOriginPolicy(options: {
  nodeEnv?: string;
  publicURL?: string;
}) {
  const production = options.nodeEnv !== "development";
  const customOrigin = options.publicURL
    ? validateAuthPublicOrigin(options.publicURL)
    : null;
  const origins = Array.from(
    new Set([
      ...previewOrigins,
      legacyPublishedOrigin,
      ...(customOrigin ? [customOrigin] : []),
    ])
  );
  return {
    production,
    baseURL: {
      allowedHosts: [
        ...origins.map(origin => new URL(origin).host),
        ...(!production ? ["localhost:*", "127.0.0.1:*"] : []),
      ],
      protocol: production ? ("https" as const) : ("http" as const),
      fallback: customOrigin ?? legacyPublishedOrigin,
    },
    trustedOrigins: [
      ...origins,
      ...(!production
        ? [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
          ]
        : []),
      "https://appleid.apple.com",
    ],
  };
}
