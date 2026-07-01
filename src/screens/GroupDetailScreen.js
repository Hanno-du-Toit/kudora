import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, SectionList, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { listGroupMembers } from '../services/groups';
import { friendlyGroupError } from '../utils/groupErrors';
import { parseISODate, formatDateFull } from '../utils/dates';

const STATUS_ORDER = { owner: 0, joined: 1, invited: 2 };
const SECTION_TITLE = { owner: 'Owner', joined: 'Joined', invited: 'Invited' };

// Group the flat roster rows into Owner / Joined / Invited sections (in that order).
function toSections(roster) {
  const buckets = { owner: [], joined: [], invited: [] };
  for (const m of roster) (buckets[m.status] ?? buckets.joined).push(m);
  return ['owner', 'joined', 'invited']
    .filter((k) => buckets[k].length)
    .map((k) => ({ key: k, title: SECTION_TITLE[k], data: buckets[k] }));
}

export default function GroupDetailScreen({ route, navigation }) {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const { groupId, name, ownerId, myStatus, startDate } = route.params ?? {};
  const isOwner = myStatus === 'owner';

  const [roster, setRoster] = useState([]);
  const [endDate, setEndDate] = useState(route.params?.endDate ?? '');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    setLoadError(null);
    try {
      const members = await listGroupMembers(groupId);
      setRoster(members);
    } catch (e) {
      setLoadError(friendlyGroupError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const Header = (
    <View>
      <View style={[st.card, { borderColor: T.cardBorder }]}>
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Starts</Text>
          <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(startDate))}</Text>
        </View>
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Ends</Text>
          <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(endDate))}</Text>
        </View>
      </View>
      {loadError && <Text style={[st.error, { color: RED_STOP }]}>{loadError}</Text>}
    </View>
  );

  const renderItem = ({ item }) => (
    <View style={[st.row, { borderColor: T.cardBorder }]}>
      <View style={{ flex: 1 }}>
        <Text style={[st.name, { color: T.text }]}>
          {item.display_name}{item.is_me ? ' (you)' : ''}
        </Text>
        {item.username ? <Text style={[st.handle, { color: T.textDim }]}>@{item.username}</Text> : null}
      </View>
      {item.status === 'invited' && (
        <Text style={[st.pending, { color: T.textDim }]}>pending</Text>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: T.bg }]}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  return (
    <View style={[st.root, { backgroundColor: T.bg }]}>
      <SectionList
        sections={toSections(roster)}
        keyExtractor={(item) => item.user_id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        renderSectionHeader={({ section }) => (
          <Text style={[st.section, { color: T.textDim }]}>{section.title}</Text>
        )}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={GREEN} />
        }
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, marginBottom: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  dateLabel: { fontSize: 14, fontWeight: '600' },
  dateValue: { fontSize: 15, fontWeight: '700' },
  error: { fontSize: 13, marginTop: 8 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '700' },
  handle: { fontSize: 13, marginTop: 1 },
  pending: { fontSize: 13, fontStyle: 'italic' },
});
