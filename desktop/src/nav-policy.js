"use strict";

const LOCAL_FFB_BRIDGE_ORIGINS = new Set([
  "ws://127.0.0.1:47821",
  "ws://localhost:47821",
]);

/**
 * Parse a URL string safely, returning null for malformed input.
 * @param {unknown} rawUrl
 * @returns {URL | null}
 */
function parseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * Validate that an allowedOrigin is strictly an HTTP loopback origin on 127.0.0.1.
 * @param {unknown} allowedOrigin
 * @returns {string | null}
 */
function normalizeAllowedOrigin(allowedOrigin) {
  const parsed = parseUrl(allowedOrigin);
  if (!parsed) return null;
  if (parsed.protocol !== "http:") return null;
  if (parsed.hostname !== "127.0.0.1") return null;
  return parsed.origin;
}

/**
 * True only for URLs on the active local loopback server (`http://127.0.0.1:<port>`).
 * @param {unknown} rawUrl
 * @param {string} allowedOrigin
 * @returns {boolean}
 */
function isAllowedAppUrl(rawUrl, allowedOrigin) {
  const origin = normalizeAllowedOrigin(allowedOrigin);
  if (!origin) return false;
  const url = parseUrl(rawUrl);
  return url !== null && url.origin === origin;
}

/**
 * Hard egress firewall for Electron's `session.webRequest.onBeforeRequest`:
 * Permits ONLY:
 *  - requests to the active loopback static server (`http://127.0.0.1:<port>`)
 *  - in-memory `blob:` and `data:` URIs (Three.js textures, Web Workers, ghost JSON exports)
 *  - `devtools:` internal inspector resources
 *  - the optional local steering wheel FFB WebSocket bridge on 127.0.0.1:47821
 * Every external domain, IP, or remote socket is cancelled at the Chromium network layer.
 * @param {unknown} rawUrl
 * @param {string} allowedOrigin
 * @returns {boolean}
 */
function isAllowedNetworkRequest(rawUrl, allowedOrigin) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return false;
  const url = parseUrl(rawUrl);
  if (!url) return false;

  if (url.protocol === "data:" || url.protocol === "devtools:") return true;
  if (url.protocol === "blob:") {
    const innerOrigin = normalizeAllowedOrigin(allowedOrigin);
    if (!innerOrigin) return false;
    return rawUrl.startsWith(`blob:${innerOrigin}/`);
  }
  if (url.protocol === "ws:" && LOCAL_FFB_BRIDGE_ORIGINS.has(url.origin)) {
    return true;
  }
  return isAllowedAppUrl(rawUrl, allowedOrigin);
}

/**
 * Decide how the air-gapped Electron window handles a navigation or popup target.
 * External links are NEVER opened automatically in offline mode; only loopback app routes navigate in-app.
 * @param {unknown} rawUrl
 * @param {string} allowedOrigin
 * @returns {{ allowInApp: boolean, openExternal: boolean }}
 */
function decideNavigation(rawUrl, allowedOrigin) {
  if (isAllowedAppUrl(rawUrl, allowedOrigin)) {
    return { allowInApp: true, openExternal: false };
  }
  return { allowInApp: false, openExternal: false };
}

module.exports = {
  LOCAL_FFB_BRIDGE_ORIGINS,
  normalizeAllowedOrigin,
  isAllowedAppUrl,
  isAllowedNetworkRequest,
  decideNavigation,
};
