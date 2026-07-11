import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import MapView, { Polyline, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { formatElapsed } from '../utils/geoUtils';
import { loadAllHunts, deleteHunt as deleteHuntFromStorage } from '../services/huntStorage';
import { regionForPoints, samplePoints } from '../utils/mapUtils';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Hunt card ──────────────────────────────────────────────────────────────

const HuntCard = React.memo(function HuntCard({ hunt, onPress, T, isDark }) {
  const pts = samplePoints(hunt.trailPoints);
  const region = regionForPoints(pts);

  return (
    <TouchableOpacity
      style={[st.card, { backgroundColor: T.card, borderColor: T.cardBorder }]}
      onPress={() => onPress(hunt)}
      activeOpacity={0.75}
    >
      {/* Route thumbnail */}
      <View style={st.thumbWrap}>
        <MapView
          style={st.thumb}
          initialRegion={region}
          mapType="satellite"
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          showsPointsOfInterest={false}
          showsBuildings={false}
          showsTraffic={false}
          toolbarEnabled={false}
          pointerEvents="none"
        >
          {hunt.mapType === 'topo' && (
            <UrlTile
              urlTemplate={
                isDark
                  ? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
                  : 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
              }
              maximumZ={19}
              shouldReplaceMapContent
            />
          )}
          {pts.length >= 2 && (
            <Polyline
              coordinates={pts}
              strokeColor={GREEN}
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
            />
          )}
        </MapView>
      </View>

      {/* Hunt metadata */}
      <View style={st.cardBody}>
        <View style={st.cardTopRow}>
          <Text style={[st.cardDate, { color: T.text }]}>{formatDate(hunt.startedAt)}</Text>
          <Text style={[st.cardClock, { color: T.textDim }]}>{formatTime(hunt.startedAt)}</Text>
        </View>

        <Text style={[st.cardDist, { color: GREEN }]}>
          {hunt.distance.toFixed(2)}{' '}
          <Text style={[st.cardDistUnit, { color: GREEN }]}>km</Text>
        </Text>

        <View style={st.cardMetaRow}>
          <Ionicons name="time-outline" size={10} color={T.textDim} style={{ marginRight: 3 }} />
          <Text style={[st.cardMeta, { color: T.textDim, fontFamily: MONO }]}>
            {formatElapsed(hunt.duration)}
          </Text>
          <View style={[st.metaDot, { backgroundColor: T.divider }]} />
          <Ionicons name="speedometer-outline" size={10} color={T.textDim} style={{ marginRight: 3 }} />
          <Text style={[st.cardMeta, { color: T.textDim }]}>
            {hunt.avgSpeed.toFixed(1)} km/h
          </Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={14} color={T.textDim} style={st.chevron} />
    </TouchableOpacity>
  );
});

// ── Hunt detail view ───────────────────────────────────────────────────────

function HuntDetailView({ hunt, onBack, onDeleted, T, isDark, insets }) {
  const [confirming, setConfirming] = useState(false);

  const handleDelete = () => {
    Alert.alert(
      'Delete Hunt',
      `Remove this hunt from ${formatDate(hunt.startedAt)}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setConfirming(true);
            await deleteHuntFromStorage(hunt.id);
            onDeleted(hunt.id);
          },
        },
      ]
    );
  };

  const region = regionForPoints(hunt.trailPoints);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg }]}>
      {/* Full-screen map */}
      <MapView
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
        {hunt.mapType === 'topo' && (
          <UrlTile
            urlTemplate={
              isDark
                ? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
                : 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
            }
            maximumZ={19}
            shouldReplaceMapContent
          />
        )}
        {hunt.trailPoints.length >= 2 && (
          <>
            <Polyline
              coordinates={hunt.trailPoints}
              strokeColor="rgba(0,0,0,0.4)"
              strokeWidth={8}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={hunt.trailPoints}
              strokeColor={GREEN}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          </>
        )}
      </MapView>

      {/* Floating top bar: back + delete */}
      <View style={[st.detailTopBar, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={[st.floatBtn, { backgroundColor: T.card, borderColor: T.cardBorder }]}
          onPress={onBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={16} color={T.text} />
          <Text style={[st.floatBtnLabel, { color: T.text }]}>Sessions</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[st.floatBtn, { backgroundColor: T.card, borderColor: T.cardBorder }]}
          onPress={handleDelete}
          disabled={confirming}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color={RED_STOP} />
        </TouchableOpacity>
      </View>

      {/* Bottom stats panel */}
      <View
        style={[
          st.detailPanel,
          {
            backgroundColor: T.card,
            borderColor: T.cardBorder,
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        {/* Date + time range */}
        <View style={st.detailHeaderRow}>
          <Text style={[st.detailDate, { color: T.text }]}>{formatDate(hunt.startedAt)}</Text>
          <Text style={[st.detailTimeRange, { color: T.textDim }]}>
            {formatTime(hunt.startedAt)} – {formatTime(hunt.endedAt)}
          </Text>
        </View>

        <View style={[st.detailDivider, { backgroundColor: T.divider }]} />

        {/* Three stat cells */}
        <View style={st.detailStatRow}>
          <DetailStat label="DISTANCE" T={T}>
            <Text style={[st.detailBigNum, { color: GREEN }]}>
              {hunt.distance.toFixed(2)}
              <Text style={[st.detailBigUnit, { color: GREEN }]}> km</Text>
            </Text>
          </DetailStat>

          <View style={[st.detailStatDivider, { backgroundColor: T.divider }]} />

          <DetailStat label="DURATION" T={T}>
            <Text style={[st.detailBigNum, { color: T.text, fontFamily: MONO }]}>
              {formatElapsed(hunt.duration)}
            </Text>
          </DetailStat>

          <View style={[st.detailStatDivider, { backgroundColor: T.divider }]} />

          <DetailStat label="AVG SPEED" T={T}>
            <Text style={[st.detailBigNum, { color: T.text }]}>
              {hunt.avgSpeed.toFixed(1)}
              <Text style={[st.detailBigUnit, { color: T.textDim }]}> km/h</Text>
            </Text>
          </DetailStat>
        </View>
      </View>
    </View>
  );
}

function DetailStat({ label, T, children }) {
  return (
    <View style={st.detailStatCell}>
      {children}
      <Text style={[st.detailStatLabel, { color: T.textDim }]}>{label}</Text>
    </View>
  );
}

// ── Main Sessions screen ───────────────────────────────────────────────────

export default function SessionsScreen() {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [hunts, setHunts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHunt, setSelectedHunt] = useState(null);
  const loadedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadAllHunts().then((saved) => {
        if (!active) return;
        setHunts(saved);
        setLoading(false);
        loadedOnce.current = true;
      });
      return () => { active = false; };
    }, [])
  );

  const handleDeleted = useCallback((id) => {
    setHunts((prev) => prev.filter((h) => h.id !== id));
    setSelectedHunt(null);
  }, []);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedHunt) {
    return (
      <HuntDetailView
        hunt={selectedHunt}
        onBack={() => setSelectedHunt(null)}
        onDeleted={handleDeleted}
        T={T}
        isDark={isDark}
        insets={insets}
      />
    );
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: T.bg }]}>
        <ActivityIndicator color={GREEN} size="small" />
      </View>
    );
  }

  // ── Sessions list ────────────────────────────────────────────────────────
  return (
    <View style={[st.root, { backgroundColor: T.bg }]}>
      <FlatList
        data={hunts}
        keyExtractor={(h) => h.id}
        renderItem={({ item }) => (
          <HuntCard hunt={item} onPress={setSelectedHunt} T={T} isDark={isDark} />
        )}
        ListHeaderComponent={
          <View style={[st.listHeader, { paddingTop: insets.top + 16 }]}>
            <Text style={[st.listTitle, { color: T.text }]}>HUNT LOG</Text>
            <Text style={[st.listCount, { color: T.textDim }]}>
              {hunts.length} {hunts.length === 1 ? 'session' : 'sessions'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={st.emptyWrap}>
            <Ionicons name="trail-sign-outline" size={52} color={T.textDim} />
            <Text style={[st.emptyTitle, { color: T.text }]}>No hunts yet</Text>
            <Text style={[st.emptyBody, { color: T.textDim }]}>
              Press Start Hunt on the map{'\n'}to record your first trail
            </Text>
          </View>
        }
        contentContainerStyle={[
          st.listContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // List
  listContent: { paddingHorizontal: 16 },
  listHeader: {
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  listTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2.4,
  },
  listCount: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
  },

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    overflow: 'hidden',
  },
  thumbWrap: {
    width: 96,
    height: 90,
    overflow: 'hidden',
  },
  thumb: {
    width: 96,
    height: 90,
  },
  cardBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  cardClock: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  cardDist: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
    lineHeight: 26,
  },
  cardDistUnit: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    flexWrap: 'wrap',
    gap: 4,
  },
  cardMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    marginHorizontal: 2,
  },
  chevron: {
    marginRight: 14,
    flexShrink: 0,
  },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // Detail view
  detailTopBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  floatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  floatBtnLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  detailPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 16,
  },
  detailDate: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  detailTimeRange: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  detailStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailStatCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
  },
  detailBigNum: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 26,
  },
  detailBigUnit: {
    fontSize: 13,
    fontWeight: '500',
  },
  detailStatLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.8,
    marginTop: 3,
    textTransform: 'uppercase',
  },
});
