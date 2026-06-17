import { useState, useRef, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { haversineKm } from '../utils/geoUtils';
import { GPS_TASK_NAME } from '../../index';

const SESSION_ID_KEY = 'kudora_active_session_id';
const trailKey = (id) => `kudora_trail_${id}`;

export function useGPSTracking() {
  const [isRecording, setIsRecording] = useState(false);
  const [trailPoints, setTrailPoints] = useState([]);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [speed, setSpeed] = useState(0);

  const recordingWatcher = useRef(null);
  const idleWatcher = useRef(null);
  const timer = useRef(null);
  const activeSessionId = useRef(null);
  const lastCoord = useRef(null);
  const totalDist = useRef(0);
  const startTimeRef = useRef(null);

  // Always-on low-accuracy watcher for the position dot
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || !mounted) return;
      idleWatcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 5 },
        (loc) => {
          setCurrentPosition({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      );
    })();
    return () => {
      mounted = false;
      idleWatcher.current?.remove();
    };
  }, []);

  const startRecording = useCallback(async () => {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') return;

    // Best-effort — user may deny background, foreground still works
    await Location.requestBackgroundPermissionsAsync();

    const id = `session_${Date.now()}`;
    activeSessionId.current = id;
    lastCoord.current = null;
    totalDist.current = 0;
    startTimeRef.current = Date.now();

    await AsyncStorage.setItem(SESSION_ID_KEY, id);
    await AsyncStorage.setItem(trailKey(id), JSON.stringify([]));

    setTrailPoints([]);
    setDistance(0);
    setElapsed(0);
    setSpeed(0);
    setIsRecording(true);

    // Background task — survives screen-off
    try {
      await Location.startLocationUpdatesAsync(GPS_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 5000,
        distanceInterval: 2,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.Fitness,
      });
    } catch (e) {
      // Background location may not be available in Expo Go without "Always" permission
      console.log('Background task:', e.message);
    }

    // High-accuracy foreground watcher for real-time trail drawing
    recordingWatcher.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 5000,
        distanceInterval: 2,
      },
      async (loc) => {
        const coord = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        const spd = Math.max(0, (loc.coords.speed ?? 0) * 3.6);

        setCurrentPosition(coord);
        setSpeed(spd);

        if (lastCoord.current) {
          const d = haversineKm(lastCoord.current, coord);
          totalDist.current += d;
          setDistance(totalDist.current);
        }
        lastCoord.current = coord;
        setTrailPoints((prev) => [...prev, coord]);

        // Persist — background task also writes here, this covers foreground
        const sid = activeSessionId.current;
        if (!sid) return;
        const raw = await AsyncStorage.getItem(trailKey(sid));
        const points = raw ? JSON.parse(raw) : [];
        points.push({ ...coord, speed: spd, timestamp: loc.timestamp });
        await AsyncStorage.setItem(trailKey(sid), JSON.stringify(points));
      }
    );

    // Elapsed clock
    timer.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 1000);
  }, []);

  const stopRecording = useCallback(async () => {
    recordingWatcher.current?.remove();
    recordingWatcher.current = null;
    clearInterval(timer.current);

    try {
      const running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME);
      if (running) await Location.stopLocationUpdatesAsync(GPS_TASK_NAME);
    } catch (e) {}

    await AsyncStorage.removeItem(SESSION_ID_KEY);
    activeSessionId.current = null;
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      recordingWatcher.current?.remove();
      idleWatcher.current?.remove();
      clearInterval(timer.current);
    };
  }, []);

  return {
    isRecording,
    trailPoints,
    currentPosition,
    distance,
    elapsed,
    speed,
    startRecording,
    stopRecording,
  };
}
