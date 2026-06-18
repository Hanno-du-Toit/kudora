import React, { useRef, useEffect, useState, useMemo } from 'react';
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

import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { useGPSTracking } from '../hooks/useGPSTracking';
import { TrailLayer } from '../components/map/TrailLayer';
import { PositionDot } from '../components/map/PositionDot';
import { formatElapsed, formatCoord } from '../utils/geoUtils';

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
  const { T, isDark, toggleTheme } = useTheme();

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

  // Theme-aware dynamic styles
  const S = useMemo(() => makeStyles(T), [T]);

  // Stats card fade + slide animation
  const statsAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(statsAnim, {
      toValue: isRecording ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isRecording]);

  // Slides up from just below the button into position
  const statsTranslate = statsAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
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
        await stopRecording(mapType);
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
    <View style={[staticStyles.root, { backgroundColor: T.bg }]}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={SOUTH_AFRICA}
        // Always satellite so Apple Maps never renders text labels.
        // CartoDB tiles with shouldReplaceMapContent cover it completely in topo mode.
        mapType="satellite"
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsTraffic={false}
        toolbarEnabled={false}
        rotateEnabled={false}
      >
        {mapType === 'topo' && (
          <>
            {/* Base: replaces satellite layer completely — single label source */}
            <UrlTile
              key={`base-${isDark ? 'dark' : 'light'}`}
              urlTemplate={T.topoBase}
              maximumZ={19}
              shouldReplaceMapContent
            />
            {/* Terrain depth: hillshade only, zero text */}
            <UrlTile
              key={`shade-${isDark ? 'dark' : 'light'}`}
              urlTemplate={T.hillshadeUrl}
              maximumZ={16}
              opacity={T.hillshadeOpacity}
            />
          </>
        )}
        <TrailLayer points={trailPoints} />
        {/*
          key forces a fresh marker instance whenever the tile layers remount
          (theme toggle or TOPO/SAT switch). Without it react-native-maps orphans
          the existing annotation during the native children reshuffle and the dot
          vanishes. currentPosition itself is unaffected — it lives in the GPS hook.
        */}
        {currentPosition && (
          <PositionDot
            key={`pos-${isDark ? 'dark' : 'light'}-${mapType}`}
            coordinate={currentPosition}
          />
        )}
      </MapView>

      {/* ── Floating UI overlay ─────────────────────────────── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        {/* GPS coordinate pill — top left */}
        <View
          style={[S.coordPill, { top: topBase }]}
          pointerEvents="none"
        >
          <View style={staticStyles.coordDot} />
          <Text style={S.coordText}>
            {currentPosition
              ? `${formatCoord(currentPosition.latitude, 'N', 'S')}  ${formatCoord(currentPosition.longitude, 'E', 'W')}`
              : 'Acquiring GPS…'}
          </Text>
        </View>

        {/* Top right: theme toggle + map type toggle */}
        <View style={[staticStyles.topRight, { top: topBase }]}>
          <TouchableOpacity
            style={S.themeBtn}
            onPress={toggleTheme}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={isDark ? 'sunny-outline' : 'moon-outline'}
              size={14}
              color={T.text}
            />
          </TouchableOpacity>

          <View style={S.mapToggle}>
            <TouchableOpacity
              style={[staticStyles.toggleBtn, mapType === 'topo' && S.toggleBtnActive]}
              onPress={() => setMapType('topo')}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text style={[S.toggleText, mapType === 'topo' && S.toggleTextActive]}>
                TOPO
              </Text>
            </TouchableOpacity>
            <View style={S.toggleDivider} />
            <TouchableOpacity
              style={[staticStyles.toggleBtn, mapType === 'satellite' && S.toggleBtnActive]}
              onPress={() => setMapType('satellite')}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text style={[S.toggleText, mapType === 'satellite' && S.toggleTextActive]}>
                SAT
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Bottom stack: hunt button then stats card below */}
        <View style={[staticStyles.bottomRow, { paddingBottom: insets.bottom + 24 }]}>

          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <TouchableOpacity
              style={[
                staticStyles.huntBtn,
                isRecording ? staticStyles.huntBtnStop : staticStyles.huntBtnStart,
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
                style={staticStyles.huntIcon}
              />
              <Text style={staticStyles.huntLabel}>
                {isRecording ? 'STOP HUNT' : 'START HUNT'}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Compact stats card — appears below the button while recording */}
          <Animated.View
            style={[
              S.statsCard,
              { opacity: statsAnim, transform: [{ translateY: statsTranslate }] },
            ]}
            pointerEvents="none"
          >
            <StatCell label="DISTANCE" value={`${distance.toFixed(2)} km`} T={T} />
            <View style={S.statDivider} />
            <StatCell label="TIME" value={formatElapsed(elapsed)} mono T={T} />
            <View style={S.statDivider} />
            <StatCell label="SPEED" value={`${speed.toFixed(1)} km/h`} T={T} />
          </Animated.View>

        </View>

      </View>
    </View>
  );
}

function StatCell({ label, value, mono, T }) {
  return (
    <View style={staticStyles.statCell}>
      <Text style={[staticStyles.statValue, mono && { fontFamily: MONO }, { color: T.text }]}>
        {value}
      </Text>
      <Text style={[staticStyles.statLabel, { color: T.textDim }]}>{label}</Text>
    </View>
  );
}

// ── Theme-aware styles (recreated when theme changes) ───────────
function makeStyles(T) {
  return {
    coordPill: {
      position: 'absolute',
      left: 12,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: T.card,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: T.cardBorder,
    },
    coordText: {
      fontFamily: MONO,
      color: T.textMono,
      fontSize: 10,
      letterSpacing: 0.3,
    },
    themeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: T.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: T.cardBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mapToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: T.card,
      borderRadius: 20,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: T.cardBorder,
    },
    toggleBtnActive: {
      backgroundColor: T.toggleActive,
    },
    toggleText: {
      color: T.toggleText,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.4,
    },
    toggleTextActive: {
      color: T.toggleTextActive,
    },
    toggleDivider: {
      width: StyleSheet.hairlineWidth,
      height: 20,
      backgroundColor: T.divider,
    },
    statsCard: {
      width: 280,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: T.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: T.cardBorder,
      paddingVertical: 12,
      marginTop: 12,
    },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      height: 28,
      backgroundColor: T.divider,
    },
  };
}

// ── Static styles (colours never change) ───────────────────────
const staticStyles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // GPS dot — always green (spec: position dot stays green in both themes)
  coordDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GREEN,
    marginRight: 7,
    shadowColor: GREEN,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },

  // ── Top right cluster ──────────────────────────────────────────
  topRight: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // ── Map type toggle button (layout only, colours in makeStyles) ─
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    minWidth: 44,
    alignItems: 'center',
  },

  // ── Bottom stack ────────────────────────────────────────────────
  bottomRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // ── Hunt button — fixed green/red, same in both themes ─────────
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
    backgroundColor: GREEN,
    shadowColor: GREEN,
  },
  huntBtnStop: {
    backgroundColor: RED_STOP,
    shadowColor: RED_STOP,
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

  // ── Stats card cells (layout only, colours via T in StatCell) ──
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 20,
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
});
