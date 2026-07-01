import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, SectionList, RefreshControl, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { listGroupMembers, inviteFriend, updateGroupEndDate } from '../services/groups';
import { listFriendships } from '../services/friends';
import { friendlyGroupError } from '../utils/groupErrors';
import { parseISODate, formatDateFull, toISODate } from '../utils/dates';

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
  const [friendships, setFriendships] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    setLoadError(null);
    try {
      const [members, friends] = await Promise.all([
        listGroupMembers(groupId),
        isOwner ? listFriendships() : Promise.resolve([]),
      ]);
      setRoster(members);
      setFriendships(friends);
    } catch (e) {
      setLoadError(friendlyGroupError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, isOwner]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Accepted friends who are not already in the roster (owner/joined/invited).
  const rosterIds = new Set(roster.map((m) => m.user_id));
  const eligibleFriends = friendships.filter(
    (f) => f.status === 'accepted' && !rosterIds.has(f.other_id),
  );

  const onInvite = async (friendId) => {
    if (actionBusy) return;
    setActionBusy(true);
    try { await inviteFriend(groupId, friendId); await load(); }
    catch (e) { Alert.alert('Could not invite', friendlyGroupError(e)); }
    finally { setActionBusy(false); }
  };

  const onEndDateChange = async (_e, picked) => {
    if (!picked) return;
    const nextISO = toISODate(picked);
    if (nextISO === endDate) return;
    const prevISO = endDate;
    setEndDate(nextISO); // optimistic
    setActionBusy(true);
    try {
      await updateGroupEndDate(groupId, nextISO);
    } catch (e) {
      setEndDate(prevISO); // revert on failure
      Alert.alert('Could not update end date', friendlyGroupError(e));
    } finally {
      setActionBusy(false);
    }
  };

  const Header = (
    <View>
      <View style={[st.card, { borderColor: T.cardBorder }]}>
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Starts</Text>
          <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(startDate))}</Text>
        </View>
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Ends</Text>
          {isOwner ? (
            <DateTimePicker
              value={parseISODate(endDate)} mode="date" display="compact"
              minimumDate={parseISODate(startDate)}
              themeVariant={isDark ? 'dark' : 'light'} accentColor={GREEN}
              onChange={onEndDateChange} disabled={actionBusy}
            />
          ) : (
            <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(endDate))}</Text>
          )}
        </View>
      </View>
      {isOwner && (
        <View style={[st.card, { borderColor: T.cardBorder }]}>
          <TouchableOpacity
            style={st.inviteToggle} activeOpacity={0.7}
            onPress={() => setInviteOpen((o) => !o)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name={inviteOpen ? 'chevron-down' : 'chevron-forward'} size={18} color={T.textDim} />
            <Text style={[st.inviteTitle, { color: T.text }]}>Invite a friend</Text>
          </TouchableOpacity>
          {inviteOpen && (
            eligibleFriends.length === 0 ? (
              <Text style={[st.inviteEmpty, { color: T.textDim }]}>
                {friendships.some((f) => f.status === 'accepted')
                  ? 'All your friends are already in this outing.'
                  : 'Add friends on the Friends tab first.'}
              </Text>
            ) : (
              eligibleFriends.map((f) => (
                <View key={f.other_id} style={[st.inviteRow, { borderColor: T.cardBorder }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.name, { color: T.text }]}>{f.other_display_name}</Text>
                    <Text style={[st.handle, { color: T.textDim }]}>@{f.other_username}</Text>
                  </View>
                  <TouchableOpacity
                    style={[st.inviteAdd, { backgroundColor: GREEN, opacity: actionBusy ? 0.5 : 1 }]}
                    onPress={() => onInvite(f.other_id)} disabled={actionBusy}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="add" size={20} color="#06210a" />
                  </TouchableOpacity>
                </View>
              ))
            )
          )}
        </View>
      )}
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
  inviteToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteTitle: { fontSize: 15, fontWeight: '700' },
  inviteEmpty: { fontSize: 13, marginTop: 10 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth },
  inviteAdd: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
