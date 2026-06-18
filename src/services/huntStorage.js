import AsyncStorage from '@react-native-async-storage/async-storage';

const HUNT_IDS_KEY = 'kudora_saved_hunt_ids';
const huntKey = (id) => `kudora_hunt_${id}`;

export async function saveHunt(hunt) {
  await AsyncStorage.setItem(huntKey(hunt.id), JSON.stringify(hunt));
  const raw = await AsyncStorage.getItem(HUNT_IDS_KEY);
  const ids = raw ? JSON.parse(raw) : [];
  const updated = [hunt.id, ...ids.filter((i) => i !== hunt.id)];
  await AsyncStorage.setItem(HUNT_IDS_KEY, JSON.stringify(updated));
}

export async function loadAllHunts() {
  const raw = await AsyncStorage.getItem(HUNT_IDS_KEY);
  if (!raw) return [];
  const ids = JSON.parse(raw);
  const results = await Promise.all(
    ids.map(async (id) => {
      const h = await AsyncStorage.getItem(huntKey(id));
      return h ? JSON.parse(h) : null;
    })
  );
  return results.filter(Boolean);
}

export async function loadHunt(id) {
  const raw = await AsyncStorage.getItem(huntKey(id));
  return raw ? JSON.parse(raw) : null;
}

export async function deleteHunt(id) {
  await AsyncStorage.removeItem(huntKey(id));
  const raw = await AsyncStorage.getItem(HUNT_IDS_KEY);
  if (!raw) return;
  const ids = JSON.parse(raw).filter((i) => i !== id);
  await AsyncStorage.setItem(HUNT_IDS_KEY, JSON.stringify(ids));
}
