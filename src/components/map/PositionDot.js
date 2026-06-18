import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { Circle } from 'react-native-maps';
import { isValidCoord } from '../../utils/geoUtils';

// Bright, vivid green per the product colour spec.
const GREEN = '#5FCE5F';
const GREEN_RGB = '95, 206, 95';

// Pulse ring grows from ~5 m to ~30 m (metres — Circles are drawn in map space).
const MIN_RADIUS = 5;
const MAX_RADIUS = 30;
const PULSE_MS = 2000;

// Current-position indicator built from native <Circle> overlays instead of a
// custom-view <Marker>. Circles render directly on the map canvas, so there is no
// marker image to regenerate — which removes the (0,0) "ghost" entirely — no
// tracksViewChanges (so nothing freezes) and no remount/unmount workarounds (so it
// never disappears on START/STOP HUNT). The pulse animates smoothly and continuously.
export function PositionDot({ coordinate }) {
  const t = useRef(new Animated.Value(0)).current;
  const [pulse, setPulse] = useState({ radius: MIN_RADIUS, opacity: 0.4 });

  useEffect(() => {
    // Circle radius is map-space metres, not a nativable transform, so we read the
    // driver value in JS and update the ring's radius/opacity each frame. One small
    // overlay re-rendering is cheap and gives a smooth expanding-and-fading ring.
    const id = t.addListener(({ value }) => {
      setPulse({
        radius: MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * value,
        opacity: 0.4 * (1 - value),
      });
    });
    const anim = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: PULSE_MS,
        useNativeDriver: false,
      })
    );
    anim.start();
    return () => {
      anim.stop();
      t.removeListener(id);
      t.setValue(0);
    };
  }, [t]);

  // Never render at an invalid/empty fix — that is what would land at (0,0).
  if (!isValidCoord(coordinate)) return null;

  return (
    <>
      {/* Pulsing outer ring — expands outward while fading to transparent */}
      <Circle
        center={coordinate}
        radius={pulse.radius}
        strokeColor={`rgba(${GREEN_RGB}, ${pulse.opacity})`}
        fillColor={`rgba(${GREEN_RGB}, ${pulse.opacity * 0.35})`}
        strokeWidth={2}
        zIndex={1}
      />
      {/* Inner solid dot — bright green fill with a white border */}
      <Circle
        center={coordinate}
        radius={4}
        strokeColor="#ffffff"
        strokeWidth={2}
        fillColor={GREEN}
        zIndex={2}
      />
    </>
  );
}
