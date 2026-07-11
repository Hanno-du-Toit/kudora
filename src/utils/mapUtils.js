function regionForPoints(points) {
  if (!points || points.length < 2) {
    return { latitude: -28.4793, longitude: 24.6727, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;
  const latPad = Math.max(latSpan * 0.35, 0.003);
  const lonPad = Math.max(lonSpan * 0.35, 0.003);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: latSpan + latPad * 2,
    longitudeDelta: lonSpan + lonPad * 2,
  };
}

function samplePoints(points, max = 80) {
  if (!points || points.length <= max) return points ?? [];
  const step = Math.ceil(points.length / max);
  return points.filter((_, i) => i % step === 0);
}

export { regionForPoints, samplePoints };
