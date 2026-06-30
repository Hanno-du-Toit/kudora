import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, SectionList, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { validateGroupName } from '../utils/validators';
import { friendlyGroupError } from '../utils/groupErrors';
import { toISODate, addDays, parseISODate, formatDateShort } from '../utils/dates';
import { listMyGroups, createGroup, acceptInvite, leaveGroup } from '../services/groups';
import DateTimePicker from '@react-native-community/datetimepicker';

// Split the flat RPC rows into invitations vs. my active hunts.
function toSections(rows) {
  const invites = rows.filter((r) => r.my_status === 'invited');
  const mine = rows.filter((r) => r.my_status === 'owner' || r.my_status === 'joined');
  const sections = [];
  if (invites.length) sections.push({ key: 'invites', title: 'Invitations', data: invites });
  sections.push({ key: 'mine', title: 'Your hunts', data: mine });
  return sections;
}

function dateRangeLabel(startISO, endISO) {
  return `${formatDateShort(parseISODate(startISO))} – ${formatDateShort(parseISODate(endISO))}`;
}

export default function GroupScreen({ navigation }) {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  // create-hunt form
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(() => addDays(new Date(), 1));
  const [creating, setCreating] = useState(false);

  // iOS-first compact pickers update via onChange. Keep end >= start.
  const onStartChange = (_e, d) => {
    if (!d) return;
    setStartDate(d);
    if (d > endDate) setEndDate(d);
  };
  const onEndChange = (_e, d) => { if (d) setEndDate(d); };

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await listMyGroups();
      setRows(data);
    } catch (e) {
      setError(friendlyGroupError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onCreate = async () => {
    setError(null);
    const v = validateGroupName(name);
    if (!v.ok) return setError(v.error);
    setCreating(true);
    try {
      await createGroup({
        name: v.value,
        startDate: toISODate(startDate),
        endDate: toISODate(endDate),
      });
      setName('');
      setStartDate(new Date());
      setEndDate(addDays(new Date(), 1));
      await load();
    } catch (e) {
      setError(friendlyGroupError(e));
    } finally {
      setCreating(false);
    }
  };

  const onAccept = async (groupId) => {
    if (actionBusy) return;
    setActionBusy(true);
    try { await acceptInvite(groupId); await load(); }
    catch (e) { Alert.alert('Could not accept', friendlyGroupError(e)); }
    finally { setActionBusy(false); }
  };

  const onDecline = (item) => {
    Alert.alert('Decline invite', `Decline the invite to "${item.name}"?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive',
        onPress: async () => {
          if (actionBusy) return;
          setActionBusy(true);
          try { await leaveGroup(item.group_id); await load(); }
          catch (e) { Alert.alert('Could not decline', friendlyGroupError(e)); }
          finally { setActionBusy(false); }
        },
      },
    ]);
  };

  const inputStyle = [
    st.input,
    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderColor: T.cardBorder, color: T.text },
  ];

  const Header = (
    <View style={st.createBox}>
      <Text style={[st.createTitle, { color: T.text }]}>New hunt</Text>
      <TextInput
        style={inputStyle} placeholder="Hunt name (e.g. Noord plaas)" placeholderTextColor={T.textDim}
        value={name} onChangeText={setName} autoCorrect={false} maxLength={40}
      />
      <View style={st.formRow}>
        <Text style={[st.formLabel, { color: T.textDim }]}>Starts</Text>
        <DateTimePicker
          value={startDate} mode="date" display="compact"
          themeVariant={isDark ? 'dark' : 'light'} accentColor={GREEN}
          onChange={onStartChange}
        />
      </View>
      <View style={st.formRow}>
        <Text style={[st.formLabel, { color: T.textDim }]}>Ends</Text>
        <DateTimePicker
          value={endDate} mode="date" display="compact" minimumDate={startDate}
          themeVariant={isDark ? 'dark' : 'light'} accentColor={GREEN}
          onChange={onEndChange}
        />
      </View>
      <Text style={[st.rangePreview, { color: T.textDim }]}>
        {dateRangeLabel(toISODate(startDate), toISODate(endDate))}
      </Text>
      <TouchableOpacity
        style={[st.createBtn, { backgroundColor: GREEN, opacity: creating ? 0.6 : 1 }]}
        onPress={onCreate} disabled={creating} activeOpacity={0.85}
      >
        {creating
          ? <ActivityIndicator color="#06210a" />
          : <Text style={st.createBtnText}>Create hunt</Text>}
      </TouchableOpacity>
      {error && <Text style={[st.error, { color: RED_STOP }]}>{error}</Text>}
    </View>
  );

  const renderItem = ({ item }) => {
    const isInvite = item.my_status === 'invited';
    return (
      <TouchableOpacity
        style={[st.row, { borderColor: T.cardBorder }]}
        activeOpacity={isInvite ? 1 : 0.7}
        disabled={isInvite}
        onPress={() => navigation.navigate('GroupDetail', {
          groupId: item.group_id, name: item.name, ownerId: item.owner_id, myStatus: item.my_status,
          startDate: item.start_date, endDate: item.end_date,
        })}
      >
        <View style={{ flex: 1 }}>
          <Text style={[st.name, { color: T.text }]}>{item.name}</Text>
          <Text style={[st.meta, { color: T.textDim }]}>
            {dateRangeLabel(item.start_date, item.end_date)} · {item.member_count} hunter{item.member_count === 1 ? '' : 's'}
            {item.my_status === 'owner' ? ' · owner' : ''}
          </Text>
          {isInvite && (
            <Text style={[st.meta, { color: T.textDim }]}>from @{item.owner_username}</Text>
          )}
        </View>
        {isInvite ? (
          <View style={st.inviteActions}>
            <TouchableOpacity style={[st.accept, { backgroundColor: GREEN, opacity: actionBusy ? 0.5 : 1 }]}
              onPress={() => onAccept(item.group_id)} disabled={actionBusy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={st.acceptText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.iconBtn, { opacity: actionBusy ? 0.5 : 1 }]}
              onPress={() => onDecline(item)} disabled={actionBusy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={RED_STOP} />
            </TouchableOpacity>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={T.textDim} />
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: T.bg }]}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  return (
    <View style={[st.root, { backgroundColor: T.bg, paddingTop: insets.top + 12 }]}>
      <SectionList
        sections={toSections(rows)}
        keyExtractor={(item) => item.group_id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        renderSectionHeader={({ section }) => (
          <Text style={[st.section, { color: T.textDim }]}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.key === 'mine' && section.data.length === 0
            ? <Text style={[st.empty, { color: T.textDim }]}>No hunts yet — create one above.</Text>
            : null
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
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
  createBox: { paddingTop: 4, paddingBottom: 8 },
  createTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  input: { height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, fontSize: 16 },
  formRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12 },
  formLabel: { fontSize: 14, fontWeight: '600' },
  rangePreview: { fontSize: 13, marginTop: 10 },
  createBtn: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  createBtnText: { color: '#06210a', fontSize: 15, fontWeight: '800' },
  error: { fontSize: 13, marginTop: 8 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 6 },
  empty: { fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13, marginTop: 2 },
  inviteActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accept: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#06210a', fontSize: 14, fontWeight: '800' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
