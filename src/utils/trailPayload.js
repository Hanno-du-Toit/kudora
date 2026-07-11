import { isValidCoord } from './geoUtils.js';
import { samplePoints } from './mapUtils.js';
import { MAX_SHARED_TRAIL_POINTS } from '../constants/sharing.js';

// Local hunt → shared_trails row. Returns null when the hunt has fewer than 2
// valid points (unshareable; the DB CHECK would reject it anyway). Points are
// reduced to {latitude, longitude, timestamp?} — speed/accuracy are not needed
// to draw a polyline and payload size matters on farm signal.
export function buildTrailPayload(hunt, groupId, ownerId) {
  const valid = (hunt?.trailPoints ?? []).filter(isValidCoord);
  if (valid.length < 2) return null;
  const pts = samplePoints(valid, MAX_SHARED_TRAIL_POINTS).map((p) => {
    const out = { latitude: p.latitude, longitude: p.longitude };
    if (p.timestamp != null) out.timestamp = p.timestamp;
    return out;
  });
  // Shared trails must end where the hunt really ended; samplePoints alone
  // doesn't guarantee the true last point survives sampling. Ensure it does,
  // replacing the final sampled point when at the cap so length stays ≤ max.
  const lastValid = valid[valid.length - 1];
  const last = { latitude: lastValid.latitude, longitude: lastValid.longitude };
  if (lastValid.timestamp != null) last.timestamp = lastValid.timestamp;
  const tail = pts[pts.length - 1];
  if (
    tail.latitude !== last.latitude ||
    tail.longitude !== last.longitude ||
    tail.timestamp !== last.timestamp
  ) {
    if (pts.length >= MAX_SHARED_TRAIL_POINTS) {
      pts[pts.length - 1] = last;
    } else {
      pts.push(last);
    }
  }
  return {
    owner_id: ownerId,
    group_id: groupId,
    local_hunt_id: hunt.id,
    started_at: hunt.startedAt,
    ended_at: hunt.endedAt,
    distance_km: hunt.distance ?? 0,
    duration_ms: hunt.duration ?? 0,
    avg_speed_kmh: hunt.avgSpeed ?? 0,
    map_type: hunt.mapType === 'satellite' ? 'satellite' : 'topo',
    trail_points: pts,
  };
}
