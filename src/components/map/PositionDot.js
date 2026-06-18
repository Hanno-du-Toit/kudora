import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Marker } from 'react-native-maps';

export const PositionDot = React.memo(function PositionDot({ coordinate }) {
  const ring = useRef(new Animated.Value(0)).current;

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
    return () => anim.stop();
  }, [ring]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.8] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.7, 0.3, 0] });

  return (
    // tracksViewChanges={false}: prevents react-native-maps from re-snapshotting the
    // marker's view on every parent re-render (theme toggles, etc.). The native-driver
    // animation drives the native view directly, so re-capturing would freeze it at
    // whatever opacity the ring happens to be at — making the dot appear to vanish.
    // Coordinate updates still propagate natively; only the view content is stable.
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
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
