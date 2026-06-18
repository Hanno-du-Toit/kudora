export const GPS_TASK_NAME = 'kudora-gps-trail';
export const SESSION_ID_KEY = 'kudora_active_session_id';
export const trailKey = (sessionId) => `kudora_trail_${sessionId}`;

// Movement filter — reject GPS drift so a stationary hunter (e.g. sitting in a
// blind) doesn't accumulate fake distance. A new fix is only recorded to the
// trail when it is at least this far from the last recorded point. Tune here.
export const MIN_MOVE_METERS = 5;

// Discard fixes worse than this reported accuracy (metres). Indoor / weak-signal
// fixes wander widely and would otherwise inflate distance and jitter the trail.
export const MAX_ACCURACY_METERS = 20;
