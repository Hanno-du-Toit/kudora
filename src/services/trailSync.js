import { getDesired, setDesired, getServerCache, setServerCache } from '../store/shareState';
import { listMyShareRefs, insertSharedTrail, deleteSharedTrail } from './sharedTrails';
import { loadHunt } from './huntStorage';
import { buildTrailPayload } from '../utils/trailPayload';
import { supabase } from './supabase';

const keyOf = (huntId, groupId) => `${huntId}|${groupId}`;

// Pure diff between desired state and actual server rows — the whole sync
// contract (spec Decision 2). Node-testable: no IO.
export function diffShares(desired, serverRefs) {
  const desiredKeys = new Set();
  for (const huntId of Object.keys(desired ?? {})) {
    for (const groupId of Object.keys(desired[huntId] ?? {})) {
      if (desired[huntId][groupId]) desiredKeys.add(keyOf(huntId, groupId));
    }
  }
  const toInsert = [];
  const toDelete = [];
  const serverKeys = new Set();
  for (const r of serverRefs ?? []) {
    const k = keyOf(r.local_hunt_id, r.group_id);
    serverKeys.add(k);
    if (!desiredKeys.has(k)) toDelete.push(r.id);
  }
  for (const k of desiredKeys) {
    if (!serverKeys.has(k)) {
      const [huntId, groupId] = k.split('|');
      toInsert.push({ huntId, groupId });
    }
  }
  return { toInsert, toDelete };
}

const listeners = new Set();
export function onShareSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let inFlight = null;

// Reconcile local desired state with the server. Single-flight: concurrent
// triggers share one run. Never throws — offline just leaves state pending
// for the next trigger.
export function reconcileShares() {
  if (inFlight) return inFlight;
  inFlight = doReconcile().finally(() => { inFlight = null; });
  return inFlight;
}

async function doReconcile() {
  const summary = { uploaded: 0, removed: 0, revoked: 0, failed: 0 };
  try {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) return summary;
    const me = data.user.id;

    const desired = await getDesired();
    const refs = await listMyShareRefs();
    const { toInsert, toDelete } = diffShares(desired, refs);

    for (const { huntId, groupId } of toInsert) {
      try {
        const hunt = await loadHunt(huntId);
        if (!hunt) { await setDesired(huntId, groupId, false); continue; }
        const payload = buildTrailPayload(hunt, groupId, me);
        if (!payload) { await setDesired(huntId, groupId, false); summary.revoked += 1; continue; }
        await insertSharedTrail(payload);
        summary.uploaded += 1;
      } catch (e) {
        if (e?.code === '23505') {
          // Already on the server (race with an earlier run) — success.
          summary.uploaded += 1;
        } else if (e?.code === '42501' || e?.code === '23514') {
          // Not a member of that outing anymore / payload rejected by CHECK:
          // the share can never succeed — drop the desired flag.
          await setDesired(huntId, groupId, false);
          summary.revoked += 1;
        } else {
          summary.failed += 1; // offline etc. — keep the flag, retry later
        }
      }
    }

    for (const id of toDelete) {
      try { await deleteSharedTrail(id); summary.removed += 1; }
      catch { summary.failed += 1; }
    }

    // Refresh the offline status cache from the server's post-reconcile truth.
    try {
      const after = await listMyShareRefs();
      const cache = {};
      for (const r of after) cache[keyOf(r.local_hunt_id, r.group_id)] = r.id;
      await setServerCache(cache);
    } catch {}
  } catch {
    summary.failed += 1; // couldn't even list — fully offline
  }
  for (const fn of listeners) { try { fn(summary); } catch {} }
  return summary;
}
