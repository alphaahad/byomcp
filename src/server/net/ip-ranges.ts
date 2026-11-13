/**
 * Addresses outbound fetches must never reach (SSRF guard, SPEC 7.6):
 * private, loopback, link-local (incl. cloud metadata 169.254.169.254),
 * shared/CGNAT, documentation, multicast, reserved, and IPv6 forms that
 * embed IPv4 (mapped, NAT64, 6to4, Teredo).
 */
import { BlockList, isIP } from "node:net";

const v4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  v4.addSubnet(net, prefix, "ipv4");
}

const v6 = new BlockList();
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 (embeds IPv4)
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo (embeds IPv4)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds IPv4)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // deprecated site-local
  ["ff00::", 8], // multicast
] as const) {
  v6.addSubnet(net, prefix, "ipv6");
}

/** IPv4-mapped (::ffff:a.b.c.d / ::ffff:xxxx:xxxx) or IPv4-compatible (::a.b.c.d) → the IPv4 part. */
function embeddedV4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return undefined;
}

/** True if the address is NOT a public unicast address we may connect to. Unknown input is blocked. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0]; // strip brackets and zone id
  const family = isIP(bare);
  if (family === 4) return v4.check(bare, "ipv4");
  if (family === 6) {
    const mapped = embeddedV4(bare);
    if (mapped) return isIP(mapped) !== 4 || v4.check(mapped, "ipv4");
    return v6.check(bare, "ipv6");
  }
  return true;
}
