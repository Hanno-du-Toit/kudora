import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { isValidCoord } from '../../utils/geoUtils';

export const PositionDot = React.memo(function PositionDot({ coordinate }) {
  const ring = useRef(new Animated.Value(0)).current;

  // tracksViewChanges must be true only long enough for react-native-maps to capture
  // the custom view into the marker image, then false. While it is true, iOS
  // regenerates the marker image on every change/re-render and each regeneration can
  // spawn a duplicate "ghost" marker at the (0,0) origin — the corner dot on START
  // HUNT. The recording screen re-renders ~once a second (elapsed/trail/stats), so a
  // long tracking window guarantees ghosts. We keep the window short and let React.memo
  // (below) shield the marker from those parent re-renders entirely. After it settles
  // the dot still follows GPS — the `coordinate` prop moves the marker natively.
  const [tracks, setTracks] = useState(true);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(ring, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    // Capture one clean frame of the view, then stop regenerating the image.
    const stopTracking = setTimeout(() => {
      setTracks(false);
      anim.stop();
    }, 700);
    return () => {
      anim.stop();
      clearTimeout(stopTracking);
    };
  }, [ring]);

  // Never render a marker for an invalid/empty fix — that is what lands at (0,0).
  if (!isValidCoord(coordinate)) return null;

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.8] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.7, 0.3, 0] });

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
      <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        {/* Pulsing outer ring */}
        <Animated.View
          style={{
            position: 'absolute',
            width: 30,
            height: 30,
            borderRadius: 15,
            borderWidth: 2,
            borderColor: '#5FCE5F',
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          }}
        />
        {/* Inner dot */}
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: '#5FCE5F',
            borderWidth: 2.5,
            borderColor: '#ffffff',
            shadowColor: '#5FCE5F',
            shadowOpacity: 0.9,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
      </View>
    </Marker>
  );
});
