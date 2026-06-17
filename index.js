import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

import App from './App';

export const GPS_TASK_NAME = 'kudora-gps-trail';

// Must be defined at top level — not inside any component
TaskManager.defineTask(GPS_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  if (!data) return;

  const { locations } = data;
  if (!locations?.length) return;

  const sessionId = await AsyncStorage.getItem('kudora_active_session_id');
  if (!sessionId) return;

  const key = `kudora_trail_${sessionId}`;
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
