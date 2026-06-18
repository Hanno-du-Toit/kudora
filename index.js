import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  GPS_TASK_NAME,
  SESSION_ID_KEY,
  trailKey,
  MIN_MOVE_METERS,
  MAX_ACCURACY_METERS,
} from './src/constants/gps';
import { haversineKm, isValidCoord } from './src/utils/geoUtils';
import App from './App';

// Must be defined at top level — not inside any component (CLAUDE.md)
TaskManager.defineTask(GPS_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[GPS background task error]', error);
    return;
  }
  if (!data) return;

  const { locations } = data;
  if (!locations?.length) return;

  const sessionId = await AsyncStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) return;

  const key = trailKey(sessionId);
  const raw = await AsyncStorage.getItem(key);
  const points = raw ? JSON.parse(raw) : [];

  for (const loc of locations) {
    const coord = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    };
    // Same guards as the foreground watcher so saved distance stays accurate:
    // drop (0,0)/garbage fixes, weak-accuracy fixes, and sub-threshold drift.
    if (!isValidCoord(coord)) continue;
    const acc = loc.coords.accuracy;
    if (acc != null && acc > MAX_ACCURACY_METERS) continue;
    const last = points[points.length - 1];
    if (last && haversineKm(last, coord) * 1000 < MIN_MOVE_METERS) continue;

    points.push({
      ...coord,
      accuracy: acc,
      speed: loc.coords.speed ?? 0,
      timestamp: loc.timestamp,
    });
  }

  await AsyncStorage.setItem(key, JSON.stringify(points));
});

registerRootComponent(App);
