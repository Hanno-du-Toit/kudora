import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { GPS_TASK_NAME, SESSION_ID_KEY, trailKey } from './src/constants/gps';
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
    points.push({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
      speed: loc.coords.speed ?? 0,
      timestamp: loc.timestamp,
    });
  }

  await AsyncStorage.setItem(key, JSON.stringify(points));
});

registerRootComponent(App);
