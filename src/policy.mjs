import { isIP } from 'node:net';

export const MAX_NAME = 255;
export function checkName(raw) {
  if (typeof raw !== 'string' || raw.length < 2 || raw.length > MAX_NAME || !/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/.test(raw)) {
    throw new Error('Invalid resource name. Use 2–255 letters/digits/._-; start and end with a letter or digit.');
  }
  return raw;
}
export function checkZone(zone, region) {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d+[a-z]$/.test(zone) || !zone.startsWith(`${region}`) || zone.length !== region.length + 1) {
    throw new Error(`Availability Zone must belong to selected region ${region} (example: ${region}a).`);
  }
  return zone;
}
export function checkPort(raw) {
  if (!/^(0|[1-9]\d{0,4})$/.test(String(raw))) throw new Error('Port must be an integer 0–65535.');
  const value = Number(raw);
  if (value > 65535) throw new Error('Port must be 0–65535.');
  return value;
}
export function checkCIDR(raw) {
  if (typeof raw !== 'string') throw new Error('Invalid CIDR.');
  const [ip, mask, extra] = raw.split('/');
  const version = isIP(ip ?? '');
  if (!version || extra !== undefined) throw new Error('Expected IPv4/IPv6 CIDR, e.g. 203.0.113.1/32.');
  const max = version === 4 ? 32 : 128;
  const prefix = mask === undefined ? max : Number(mask);
  if (mask !== undefined && !/^(0|[1-9]\d*)$/.test(mask)) throw new Error('Invalid CIDR mask.');
  if (prefix < 0 || prefix > max) throw new Error('Invalid CIDR mask.');
  return { value: `${ip}/${prefix}`, version };
}
export function makePortInfo(protocol, from, to, rawCidr) {
  if (!['tcp', 'udp'].includes(protocol)) throw new Error('Supported protocols: tcp, udp.');
  const fromPort = checkPort(from);
  const toPort = checkPort(to);
  if (toPort < fromPort) throw new Error('End port must be >= start port.');
  const cidr = checkCIDR(rawCidr);
  return {
    protocol,
    fromPort,
    toPort,
    ...(cidr.version === 4 ? { cidrs: [cidr.value] } : { ipv6Cidrs: [cidr.value] })
  };
}
export function checkAlias(alias) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/.test(alias ?? '')) throw new Error('Invalid account alias.');
  return alias;
}
export function checkRegion(region) {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/.test(region ?? '')) throw new Error('Invalid AWS region.');
  return region;
}
export function checkScriptName(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.sh$/.test(name ?? '')) throw new Error('Script must be a simple *.sh filename (no folders).');
  return name;
}
