import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { isValidCoord } from '../../utils/geoUtils';

export function PositionDot({ coordinate }) {
  const ring = useRef(new Animated.Value(0)).current;

  // tracksViewChanges must be true just long enough for react-native-maps to
  // capture the custom view into the marker image, then false. Leaving it true
  // makes iOS regenerate the marker image on every re-render (the elapsed timer,
  // trail updates and stats all re-render the map ~once a second while recording)
  // and spawn a duplicate "ghost" marker at the (0,0) map origin — the bug where
  // a second dot jumps to the top-left corner on START HUNT. The dot still follows
  // GPS via the `coordinate` prop, which moves the marker natively without tracking.
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
    // Capture a couple of pulse cycles, then stop regenerating the image.
    const stopTracking = setTimeout(() => setTracks(false), 2200);
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
}
