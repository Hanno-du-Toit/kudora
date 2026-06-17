import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import MapView, { UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useGPSTracking } from '../hooks/useGPSTracking';
import { TrailLayer } from '../components/map/TrailLayer';
import { PositionDot } from '../components/map/PositionDot';
import { formatElapsed, formatCoord } from '../utils/geoUtils';

// CartoDB Dark Matter — dark, clean base with roads and place labels.
// No Apple Maps below (mapType="none"), so labels appear exactly once.
const TOPO_BASE_URL = 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

// ESRI Hillshade — pure terrain shading, zero text.
// Overlaid at 30 % opacity to add elevation depth without label duplication.
// ESRI services use {z}/{y}/{x} tile order (y before x).
const HILLSHADE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';

const SOUTH_AFRICA = {
  latitude: -28.4793,
  longitude: 24.6727,
  latitudeDelta: 12,
  longitudeDelta: 12,
};

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);
  const [mapType, setMapType] = useState('topo');

  const {
    isRecording,
    trailPoints,
    currentPosition,
    distance,
    elapsed,
    speed,
    startRecording,
    stopRecording,
  } = useGPSTracking();

  // Stats card fade + slide animation
  const statsAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(statsAnim, {
      toValue: isRecording ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isRecording]);

  // Slides down 8px into position from just above (natural reveal for a card below a button)
  const statsTranslate = statsAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 0],
  });

  // Button press scale animation
  const btnScale = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(btnScale, { toValue: 0.94, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(btnScale, { toValue: 1, useNativeDriver: true }).start();

  const handleHunt = async () => {
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        const ok = await startRecording();
        if (ok && currentPosition && mapRef.current) {
          mapRef.current.animateToRegion(
            {
              latitude: currentPosition.latitude,
              longitude: currentPosition.longitude,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            },
            900
          );
        }
      }
    } catch (e) {
      console.error('[MapScreen] handleHunt error:', e);
    }
  };

  const topBase = insets.top + 12;

  return (
    <View style={styles.root}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={SOUTH_AFRICA}
        mapType={mapType === 'satellite' ? 'satellite' : 'none'}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        toolbarEnabled={false}
        rotateEnabled={false}
      >
        {mapType === 'topo' && (
          <>
            {/* Dark base: replaces Apple Maps entirely — single source of labels */}
            <UrlTile
              key="carto-dark"
              urlTemplate={TOPO_BASE_URL}
              maximumZ={19}
              shouldReplaceMapContent
            />
            {/* Terrain depth overlay: hillshade only, no text — no duplicate labels */}
            <UrlTile
              key="hillshade"
              urlTemplate={HILLSHADE_URL}
              maximumZ={13}
              opacity={0.3}
            />
          </>
        )}
        <TrailLayer points={trailPoints} />
        {currentPosition && <PositionDot coordinate={currentPosition} />}
      </MapView>

      {/* ── Floating UI overlay ─────────────────────────────── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        {/* GPS coordinate pill — top left */}
        <View
          style={[styles.coordPill, { top: topBase }]}
          pointerEvents="none"
        >
          <View style={styles.coordDot} />
          <Text style={styles.coordText}>
            {currentPosition
              ? `${formatCoord(currentPosition.latitude, 'N', 'S')}  ${formatCoord(currentPosition.longitude, 'E', 'W')}`
              : 'Acquiring GPS…'}
          </Text>
        </View>

        {/* Map type toggle — top right */}
        <View style={[styles.mapToggle, { top: topBase }]}>
          <TouchableOpacity
            style={[styles.toggleBtn, mapType === 'topo' && styles.toggleBtnActive]}
            onPress={() => setMapType('topo')}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          >
            <Text style={[styles.toggleText, mapType === 'topo' && styles.toggleTextActive]}>
              TOPO
            </Text>
          </TouchableOpacity>
          <View style={styles.toggleDivider} />
          <TouchableOpacity
            style={[styles.toggleBtn, mapType === 'satellite' && styles.toggleBtnActive]}
            onPress={() => setMapType('satellite')}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          >
            <Text style={[styles.toggleText, mapType === 'satellite' && styles.toggleTextActive]}>
              SAT
            </Text>
          </TouchableOpacity>
        </View>

        {/* Bottom stack: hunt button, then stats card below it */}
        <View style={[styles.bottomRow, { paddingBottom: insets.bottom + 24 }]}>

          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <TouchableOpacity
              style={[
                styles.huntBtn,
                isRecording ? styles.huntBtnStop : styles.huntBtnStart,
              ]}
              onPress={handleHunt}
              onPressIn={onPressIn}
              onPressOut={onPressOut}
              activeOpacity={1}
            >
              <Ionicons
                name={isRecording ? 'stop-circle' : 'location'}
                size={22}
                color="#fff"
                style={styles.huntIcon}
              />
              <Text style={styles.huntLabel}>
                {isRecording ? 'STOP HUNT' : 'START HUNT'}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Compact stats card — appears below the button while recording */}
          <Animated.View
            style={[
              styles.statsCard,
              { opacity: statsAnim, transform: [{ translateY: statsTranslate }] },
            ]}
            pointerEvents="none"
          >
            <StatCell label="DISTANCE" value={`${distance.toFixed(2)} km`} />
            <View style={styles.statDivider} />
            <StatCell label="TIME" value={formatElapsed(elapsed)} mono />
            <View style={styles.statDivider} />
            <StatCell label="SPEED" value={`${speed.toFixed(1)} km/h`} />
          </Animated.View>

        </View>

      </View>
    </View>
  );
}

function StatCell({ label, value, mono }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, mono && { fontFamily: MONO }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },

  // ── Coord pill ─────────────────────────────────────────────
  coordPill: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.78)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  coordDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#5FCE5F',
    marginRight: 7,
    shadowColor: '#5FCE5F',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  coordText: {
    fontFamily: MONO,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    letterSpacing: 0.3,
  },

  // ── Map type toggle ─────────────────────────────────────────
  mapToggle: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.78)',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    minWidth: 44,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(95, 206, 95, 0.18)',
  },
  toggleText: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  toggleTextActive: {
    color: '#5FCE5F',
  },
  toggleDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },

  // ── Bottom stack ────────────────────────────────────────────
  bottomRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // ── Hunt button ─────────────────────────────────────────────
  huntBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingVertical: 18,
    borderRadius: 40,
    minWidth: 200,
    minHeight: 60,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  huntBtnStart: {
    backgroundColor: '#5FCE5F',
    shadowColor: '#5FCE5F',
  },
  huntBtnStop: {
    backgroundColor: '#E24B4A',
    shadowColor: '#E24B4A',
  },
  huntIcon: {
    marginRight: 10,
  },
  huntLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.8,
  },

  // ── Compact stats card ──────────────────────────────────────
  statsCard: {
    width: 280,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.88)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 12,
    marginTop: 12,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 20,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
});
