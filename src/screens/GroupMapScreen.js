import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapView, { UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { TrailLayer } from '../components/map/TrailLayer';
import { useGroupTrails } from '../hooks/useGroupTrails';
import { listGroupMembers } from '../services/groups';
import { friendlyGroupError } from '../utils/groupErrors';
import { colorForMember } from '../utils/memberColors';
import { reconcileShares } from '../services/trailSync';
import { regionForPoints } from '../utils/mapUtils';
import { isValidCoord } from '../utils/geoUtils';
import { supabase } from '../services/supabase';

export default function GroupMapScreen({ route }) {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { groupId } = route.params ?? {};

  const { trails, loading, error, refresh } = useGroupTrails(groupId);
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState(null);
  const [myId, setMyId] = useState(null);
  const mapRef = useRef(null);
  const didCenterRef = useRef(false);

  // Resolve the signed-in user once — used to pick "self is always green".
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setMyId(data?.user?.id ?? null);
    });
    return () => { active = false; };
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const rows = await listGroupMembers(groupId);
      setMembers(rows);
      setMembersError(null);
    } catch (e) {
      setMembersError(friendlyGroupError(e));
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { loadMembers(); }, [loadMembers]));

  const handleRefresh = useCallback(async () => {
    await reconcileShares();
    refresh();
    loadMembers();
  }, [refresh, loadMembers]);

  const memberIds = members.map((m) => m.user_id);

  const rendered = trails
    .map((trail) => {
      const pts = (trail.trail_points ?? []).filter(isValidCoord);
      if (pts.length < 2) return null;
      return { trail, pts };
    })
    .filter(Boolean);

  const allPoints = rendered.flatMap((r) => r.pts);
  const region = regionForPoints(allPoints);

  // initialRegion is only read at MapView mount, which happens before the
  // trails have loaded — animate to the real bounds once, when the first
  // trails land. One-shot so later refreshes never yank the map mid-pan.
  useEffect(() => {
    if (didCenterRef.current || allPoints.length < 2) return;
    didCenterRef.current = true;
    mapRef.current?.animateToRegion(regionForPoints(allPoints), 600);
  }, [trails]);

  const ownerIds = [...new Set(rendered.map((r) => r.trail.owner_id))];
  const legend = ownerIds.map((id) => {
    const member = members.find((m) => m.user_id === id);
    return {
      id,
      color: colorForMember(id, myId, memberIds),
      name: member?.username ? `@${member.username}` : (id === myId ? 'You' : 'Member'),
    };
  });

  const bannerError = error || membersError;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType="satellite"
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsTraffic={false}
        toolbarEnabled={false}
      >
        <UrlTile
          urlTemplate={
            isDark
              ? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
              : 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
          }
          maximumZ={19}
          shouldReplaceMapContent
        />
        {rendered.map(({ trail, pts }) => (
          <TrailLayer
            key={trail.id}
            points={pts}
            color={colorForMember(trail.owner_id, myId, memberIds)}
          />
        ))}
      </MapView>

      {/* Floating refresh button */}
      <View style={[st.topBar, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={[st.floatBtn, { backgroundColor: T.card, borderColor: T.cardBorder }]}
          onPress={handleRefresh}
          disabled={loading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="refresh" size={18} color={T.text} />
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={st.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={GREEN} />
        </View>
      )}

      {!loading && !!bannerError && (
        <View style={[st.errorBanner, { top: insets.top + 64, backgroundColor: T.card, borderColor: RED_STOP }]}>
          <Text style={[st.errorText, { color: RED_STOP }]}>{bannerError}</Text>
        </View>
      )}

      {!loading && !bannerError && rendered.length === 0 && (
        <View style={st.emptyWrap} pointerEvents="none">
          <View style={[st.emptyCard, { backgroundColor: T.card, borderColor: T.cardBorder }]}>
            <Text style={[st.emptyText, { color: T.textDim }]}>
              No trails shared to this outing yet.
            </Text>
          </View>
        </View>
      )}

      {legend.length > 0 && (
        <View style={[st.legendWrap, { bottom: insets.bottom + 16 }]} pointerEvents="none">
          {legend.map((l) => (
            <View key={l.id} style={[st.legendChip, { backgroundColor: T.card, borderColor: T.cardBorder }]}>
              <View style={[st.legendDot, { backgroundColor: l.color }]} />
              <Text style={[st.legendName, { color: T.text }]} numberOfLines={1}>
                {l.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  topBar: {
    position: 'absolute',
    right: 12,
    zIndex: 10,
  },
  floatBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  legendWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 160,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendName: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
});
