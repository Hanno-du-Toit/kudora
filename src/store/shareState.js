import AsyncStorage from '@react-native-async-storage/async-storage';

// Desired share state: { [localHuntId]: { [groupId]: true } }. Only true entries
// are stored — unshare DELETES the entry, which is what makes an offline
// share-then-unshare net to a structural no-op for the reconciler.
const DESIRED_KEY = 'kudora_share_state_v1';
// Reconciler's last-known server rows: { 'huntId|groupId': serverRowId }.
// Lets the UI label toggles offline (desired∧cached=Shared, desired∧¬cached=
// Waiting for signal, ¬desired∧cached=Removing…).
const CACHE_KEY = 'kudora_share_server_cache_v1';

async function readJSON(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function getDesired() {
  return readJSON(DESIRED_KEY, {});
}

export async function setDesired(huntId, groupId, shared) {
  const all = await getDesired();
  if (shared) {
    all[huntId] = { ...(all[huntId] ?? {}), [groupId]: true };
  } else if (all[huntId]) {
    delete all[huntId][groupId];
    if (Object.keys(all[huntId]).length === 0) delete all[huntId];
  }
  await AsyncStorage.setItem(DESIRED_KEY, JSON.stringify(all));
}

// Local hunt deleted → intent gone → reconciler unshares any server copies.
export async function removeHunt(huntId) {
  const all = await getDesired();
  if (all[huntId]) {
    delete all[huntId];
    await AsyncStorage.setItem(DESIRED_KEY, JSON.stringify(all));
  }
}

export async function getServerCache() {
  return readJSON(CACHE_KEY, {});
}

export async function setServerCache(map) {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(map ?? {}));
}
