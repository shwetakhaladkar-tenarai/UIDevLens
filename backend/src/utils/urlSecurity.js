/**
 * URL security and validation utilities.
 * Prevents SSRF by rejecting non-http(s) schemes and private/loopback/
 * link-local/metadata targets.
 *
 * A DEV-ONLY escape hatch (config.allowLocalTargets, set via
 * ALLOW_LOCAL_TARGETS=true) permits localhost/loopback/private targets so the
 * bundled demo-site can be analyzed locally. Production defaults keep full
 * protection — the escape hatch never weakens the default behaviour.
 */
import { config } from "../config/env.js";

// Only these schemes are ever allowed.
const ALLOWED_PROTOCOLS = ["http:", "https:"];

// Explicitly rejected schemes (defense-in-depth; anything not http(s) is blocked
// anyway, but we give clearer errors for these common dangerous ones).
const BLOCKED_SCHEMES = ["file:", "ftp:", "data:", "javascript:", "ws:", "wss:", "gopher:"];

// Hostnames that always resolve to the local machine / internal names.
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "[::1]",
  "::1",
  "metadata.google.internal",   // GCP metadata
  "instance-data",              // AWS legacy metadata alias
]);

// Private / reserved IPv4 ranges + link-local + metadata, matched on hostname.
const BLOCKED_IPV4_PATTERNS = [
  /^127\./,                              // loopback 127.0.0.0/8
  /^0\./,                                // "this" network 0.0.0.0/8
  /^10\./,                               // private 10.0.0.0/8
  /^192\.168\./,                         // private 192.168.0.0/16
  /^172\.(1[6-9]|2\d|3[01])\./,          // private 172.16.0.0/12
  /^169\.254\./,                         // link-local 169.254.0.0/16 (incl. metadata 169.254.169.254)
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];

// Private / reserved IPv6 prefixes.
function isBlockedIpv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;       // loopback / unspecified
  if (h.startsWith("fe80:")) return true;            // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — extract the v4 part and re-check.
    const v4 = h.split(":").pop();
    return BLOCKED_IPV4_PATTERNS.some((re) => re.test(v4));
  }
  return false;
}

/** Detect an internal/undotted hostname (e.g. "intranet", "db", "router"). */
function looksInternalHostname(host) {
  // No dot and not an IP → likely an internal short name.
  return !host.includes(".") && !/^\d/.test(host) && !host.includes(":");
}

/**
 * Validate a user-supplied URL for SSRF safety.
 *
 * @param {string} raw
 * @param {{ allowLocal?: boolean }} [opts]  Override the dev escape hatch.
 * @returns {{ valid: boolean; url?: string; hostname?: string; error?: string }}
 */
export function validateUrl(raw, opts = {}) {
  const allowLocal = opts.allowLocal ?? config.allowLocalTargets;

  if (!raw || typeof raw !== "string") {
    return { valid: false, error: "URL is required and must be a string." };
  }

  const trimmed = raw.trim();

  // Reject dangerous schemes early with a clear message.
  const lower = trimmed.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return { valid: false, error: `Scheme "${scheme}" is not allowed. Use http:// or https://.` };
    }
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: `"${trimmed}" is not a valid URL.` };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return {
      valid: false,
      error: `Protocol "${parsed.protocol}" is not allowed. Use http:// or https://.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Dev escape hatch: skip the SSRF host checks (schemes still enforced above).
  if (allowLocal) {
    return { valid: true, url: trimmed, hostname };
  }

  // ── Full SSRF host checks (production default) ──────────────────────────
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAMES.has(parsed.host.toLowerCase())) {
    return { valid: false, error: "The URL targets a local or restricted address." };
  }

  if (looksInternalHostname(hostname)) {
    return { valid: false, error: "Internal/private hostnames are not allowed." };
  }

  // IPv4 literal checks
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (BLOCKED_IPV4_PATTERNS.some((re) => re.test(hostname))) {
      return { valid: false, error: "The URL targets a private or reserved IP range." };
    }
  }

  // IPv6 literal checks (hostname is bracket-stripped by URL for .hostname)
  if (hostname.includes(":") && isBlockedIpv6(hostname)) {
    return { valid: false, error: "The URL targets a private or reserved IPv6 range." };
  }

  return { valid: true, url: trimmed, hostname };
}

/**
 * Async variant: after the static checks, resolve the hostname via DNS and
 * inspect the RESOLVED addresses to catch names that point at private ranges
 * (DNS rebinding / sneaky CNAMEs). Falls back to the sync result if DNS fails.
 *
 * @param {string} raw
 * @param {{ allowLocal?: boolean }} [opts]
 * @returns {Promise<{ valid: boolean; url?: string; hostname?: string; resolved?: string[]; error?: string }>}
 */
export async function validateUrlWithDns(raw, opts = {}) {
  const allowLocal = opts.allowLocal ?? config.allowLocalTargets;
  const base = validateUrl(raw, opts);
  if (!base.valid) return base;
  if (allowLocal) return base; // dev: don't second-guess resolved IPs

  // Resolve and inspect actual addresses.
  let addresses = [];
  try {
    const dns = await import("dns");
    const { lookup } = dns.promises;
    const results = await lookup(base.hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    // DNS failed — allow the static-validated URL through; the browser
    // navigation will fail safely if the host is truly unreachable.
    return base;
  }

  for (const addr of addresses) {
    const isV4 = /^\d+\.\d+\.\d+\.\d+$/.test(addr);
    if (isV4 && BLOCKED_IPV4_PATTERNS.some((re) => re.test(addr))) {
      return { valid: false, error: "The URL resolves to a private or reserved IP range." };
    }
    if (!isV4 && isBlockedIpv6(addr)) {
      return { valid: false, error: "The URL resolves to a private or reserved IPv6 range." };
    }
    if (addr === "0.0.0.0" || addr === "::") {
      return { valid: false, error: "The URL resolves to a restricted address." };
    }
  }

  return { ...base, resolved: addresses };
}
