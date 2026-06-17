const DEG2RAD = Math.PI / 180;

export function haversineKm(a, b) {
  const dLat = (b.latitude - a.latitude) * DEG2RAD;
  const dLon = (b.longitude - a.longitude) * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * DEG2RAD) *
      Math.cos(b.latitude * DEG2RAD) *
      Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatCoord(val, pos, neg) {
  if (val == null) return '---';
  const dir = val >= 0 ? pos : neg;
  return `${Math.abs(val).toFixed(5)}° ${dir}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}
