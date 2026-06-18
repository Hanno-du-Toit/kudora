import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { Marker, MarkerAnimated } from 'react-native-maps';
import { isValidCoord } from '../../utils/geoUtils';

const GREEN = '#5FCE5F';

// Screen-space Marker dot — a CONSTANT pixel size at every zoom level (Circles are
// metre-space and vanish when zoomed out / get clipped by the replace-content tiles).
// Markers live in the annotation layer above all overlays, so they are never clipped.
//
// Ghost avoidance: a custom-view Marker rasterises its children into an image and, with
// `tracksViewChanges` true, iOS regenerates that image on every change — each regen can
// spawn a duplicate at the (0,0) origin. So each marker keeps tracksViewChanges true
// only long enough to capture one clean frame of its STATIC view, then false forever.
// The pulse is a breathing OPACITY animation on a separate halo marker: opacity is a
// native annotation property applied to the cached image, so it animates smoothly with
// no regeneration and no ghost. (An expanding/scaling ring is impossible here — scale
// only animates with tracksViewChanges true, which ghosts, or it freezes when false.)
export function PositionDot({ coordinate }) {
  // Guard first — never render anything at an invalid/empty (0,0) fix.
  if (!isValidCoord(coordinate)) return null;
  return (
    <>
      <PulseHalo coordinate={coordinate} />
      <SolidDot coordinate={coordinate} />
    </>
  );
}

// Breathing green halo under the dot — gives a smooth continuous pulse AND a coloured
// glow so the dot stays legible on both light and dark terrain.
const PulseHalo = React.memo(function PulseHalo({ coordinate }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  const [tracks, setTracks] = useState(true);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.12, duration: 1150, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 0.55, duration: 1150, useNativeDriver: false }),
      ])
    );
    anim.start();
    // Capture the static glow once, then stop regenerating the marker image. Opacity
    // keeps animating natively via the animated prop — no regeneration, no ghost.
    const stop = setTimeout(() => setTracks(false), 600);
    return () => {
      anim.stop();
      clearTimeout(stop);
    };
  }, [opacity]);

  return (
    <MarkerAnimated
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      opacity={opacity}
      tracksViewChanges={tracks}
    >
      <View style={styles.haloWrap}>
        <View style={styles.halo} />
      </View>
    </MarkerAnimated>
  );
});

// Solid centre dot — static, high-contrast, always fully visible. Dark outer ring reads
// on light terrain, white ring reads on dark terrain, bright green centre.
const SolidDot = React.memo(function SolidDot({ coordinate }) {
  const [tracks, setTracks] = useState(true);

  useEffect(() => {
    // The view never changes, so one capture is enough — then false forever.
    const stop = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(stop);
  }, []);

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
      <View style={styles.dotWrap}>
        <View style={styles.dotOuter}>
          <View style={styles.dotInner} />
        </View>
      </View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  haloWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(95, 206, 95, 0.6)',
    borderWidth: 2,
    borderColor: 'rgba(95, 206, 95, 0.95)',
  },
  dotWrap: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // White disc with a dark outline: the dark ring stands out on pale/light maps,
  // the white ring stands out on dark maps — visible on any terrain, either theme.
  dotOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  dotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: GREEN,
  },
});
