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
import { validateUsername } from '../utils/validators';
import { friendlyFriendError } from '../utils/friendErrors';
import {
  listFriendships, sendFriendRequest, acceptRequest, removeFriendship,
} from '../services/friends';

// Split the flat RPC rows into the three on-screen buckets.
function toSections(rows) {
  const incoming = [];
  const outgoing = [];
  const friends = [];
  for (const r of rows) {
    if (r.status === 'accepted') friends.push(r);
    else if (r.is_incoming) incoming.push(r);
    else outgoing.push(r);
  }
  const sections = [];
  if (incoming.length) sections.push({ key: 'incoming', title: 'Requests received', data: incoming });
  if (outgoing.length) sections.push({ key: 'outgoing', title: 'Requests sent', data: outgoing });
  sections.push({ key: 'friends', title: 'Friends', data: friends });
  return sections;
}

export default function FriendsScreen() {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [handle, setHandle] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await listFriendships();
      setRows(data);
    } catch (e) {
      setError(friendlyFriendError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onSend = async () => {
    setError(null);
    setNotice(null);
    const v = validateUsername(handle);
    if (!v.ok) return setError(v.error);
    setSending(true);
    try {
      const target = await sendFriendRequest(v.value);
      setNotice(`Request sent to @${target.username}`);
      setHandle('');
      await load();
    } catch (e) {
      setError(friendlyFriendError(e));
    } finally {
      setSending(false);
    }
  };

  const onAccept = async (id) => {
    if (actionBusy) return;
    setActionBusy(true);
    try { await acceptRequest(id); await load(); }
    catch (e) { Alert.alert('Could not accept', friendlyFriendError(e)); }
    finally { setActionBusy(false); }
  };

  const onRemove = (item) => {
    const labels = item.status === 'accepted'
      ? { title: 'Unfriend', msg: `Remove @${item.other_username} from your friends?`, action: 'Unfriend' }
      : item.is_incoming
        ? { title: 'Decline request', msg: `Decline @${item.other_username}'s request?`, action: 'Decline' }
        : { title: 'Cancel request', msg: `Cancel your request to @${item.other_username}?`, action: 'Cancel request' };
    Alert.alert(labels.title, labels.msg, [
      { text: 'Keep', style: 'cancel' },
      {
        text: labels.action, style: 'destructive',
        onPress: async () => {
          if (actionBusy) return;
          setActionBusy(true);
          try { await removeFriendship(item.id); await load(); }
          catch (e) { Alert.alert('Could not update', friendlyFriendError(e)); }
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

  const renderItem = ({ item }) => (
    <View style={[st.row, { borderColor: T.cardBorder }]}>
      <View style={{ flex: 1 }}>
        <Text style={[st.name, { color: T.text }]}>{item.other_display_name}</Text>
        <Text style={[st.handle, { color: T.textDim }]}>@{item.other_username}</Text>
      </View>
      {item.status === 'pending' && item.is_incoming && (
        <TouchableOpacity style={[st.accept, { backgroundColor: GREEN, opacity: actionBusy ? 0.5 : 1 }]} onPress={() => onAccept(item.id)}
          disabled={actionBusy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.acceptText}>Accept</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => onRemove(item)} style={[st.iconBtn, { opacity: actionBusy ? 0.5 : 1 }]}
        disabled={actionBusy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons
          name={item.status === 'accepted' ? 'person-remove-outline' : 'close'}
          size={20} color={RED_STOP}
        />
      </TouchableOpacity>
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
      <View style={st.addBox}>
        <TextInput
          style={inputStyle} placeholder="Add by username" placeholderTextColor={T.textDim}
          value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false}
          onSubmitEditing={onSend} returnKeyType="send"
        />
        <TouchableOpacity
          style={[st.addBtn, { backgroundColor: GREEN, opacity: sending ? 0.6 : 1 }]}
          onPress={onSend} disabled={sending} activeOpacity={0.85}
        >
          {sending ? <ActivityIndicator color="#06210a" /> : <Ionicons name="add" size={22} color="#06210a" />}
        </TouchableOpacity>
      </View>
      {error && <Text style={[st.error, { color: RED_STOP }]}>{error}</Text>}
      {notice && <Text style={[st.notice, { color: GREEN }]}>{notice}</Text>}

      <SectionList
        sections={toSections(rows)}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[st.section, { color: T.textDim }]}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.key === 'friends' && section.data.length === 0
            ? <Text style={[st.empty, { color: T.textDim }]}>No friends yet — add one above.</Text>
            : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={GREEN} />
        }
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  addBox: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, fontSize: 16 },
  addBtn: { width: 50, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 13, marginTop: 8 },
  notice: { fontSize: 13, marginTop: 8 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 6 },
  empty: { fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 15, fontWeight: '700' },
  handle: { fontSize: 13, marginTop: 1 },
  accept: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#06210a', fontSize: 14, fontWeight: '800' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
