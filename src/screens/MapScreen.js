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

// ESRI World Terrain Base — label-free topographic hillshade tile.
// Has NO text baked in, so Apple Maps provides the one clean label layer (no duplicates).
// ESRI uses {z}/{y}/{x} tile order (y before x).
const TOPO_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}';

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

  // Stats bar slide-in animation
  const statsAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(statsAnim, {
      toValue: isRecording ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isRecording]);

  // Subtle upward slide: stats bar materialises from just above its resting position
  const statsTranslate = statsAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
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
          <UrlTile
            key="topo"
            urlTemplate={TOPO_TILE_URL}
            maximumZ={17}
            shouldReplaceMapContent
          />
        )}
        <TrailLayer points={trailPoints} />
        {currentPosition && <PositionDot coordinate={currentPosition} />}
      </MapView>

      {/* ── Floating UI overlay ─────────────────────────────── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        {/* Stats bar — appears BELOW the GPS coords / toggle row when recording.
            topBase = insets.top + 12.  Pill height ≈ 36 px.  Gap = 10 px.
            So stats bar top = insets.top + 12 + 36 + 10 = insets.top + 58.        */}
        <Animated.View
          style={[
            styles.statsBar,
            { top: insets.top + 58, opacity: statsAnim, transform: [{ translateY: statsTranslate }] },
          ]}
          pointerEvents="none"
        >
          <StatCell label="DISTANCE" value={`${distance.toFixed(2)} km`} />
          <View style={styles.statDivider} />
          <StatCell label="TIME" value={formatElapsed(elapsed)} mono />
          <View style={styles.statDivider} />
          <StatCell label="SPEED" value={`${speed.toFixed(1)} km/h`} />
        </Animated.View>

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

        {/* Start / Stop Hunt button — floating bottom center */}
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

  // ── Stats bar ──────────────────────────────────────────────
  statsBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.88)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 8,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
    lineHeight: 22,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.14)',
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

  // ── Hunt button ─────────────────────────────────────────────
  bottomRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
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
});
