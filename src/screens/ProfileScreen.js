import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { getMyProfile, updateMyProfile } from '../services/profiles';

const SAFETY = { min: 1000, max: 20000, step: 500 };   // metres (1–20 km)
const WARNING = { min: 50, max: 1000, step: 50 };       // metres

function clampStep(value, dir, { min, max, step }) {
  const next = value + dir * step;
  return Math.max(min, Math.min(max, next));
}

function Stepper({ label, value, unit, T, onChange }) {
  return (
    <View style={st.settingRow}>
      <Text style={[st.settingLabel, { color: T.text }]}>{label}</Text>
      <View style={st.stepper}>
        <TouchableOpacity style={[st.stepBtn, { borderColor: T.cardBorder }]}
          onPress={() => onChange(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="remove" size={18} color={T.text} />
        </TouchableOpacity>
        <Text style={[st.stepValue, { color: GREEN }]}>{unit(value)}</Text>
        <TouchableOpacity style={[st.stepBtn, { borderColor: T.cardBorder }]}
          onPress={() => onChange(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="add" size={18} color={T.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const { T } = useTheme();
  const { session, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getMyProfile()
        .then((p) => { if (active) { setProfile(p); setLoading(false); } })
        .catch(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [])
  );

  const persistRange = async (field, value) => {
    const previous = profile?.[field];
    setProfile((prev) => ({ ...prev, [field]: value }));   // optimistic
    try {
      await updateMyProfile({ [field]: value });
    } catch {
      setProfile((prev) => ({ ...prev, [field]: previous }));   // revert on failure
      Alert.alert('Could not save', 'No signal — your change was not saved.');
    }
  };

  const confirmLogout = () => {
    Alert.alert('Log out', 'Sign out of Kudora on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: T.bg }]}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  return (
    <View style={[st.root, { backgroundColor: T.bg, paddingTop: insets.top + 24,
      paddingBottom: insets.bottom + 24 }]}>
      <View style={[st.avatar, { backgroundColor: 'rgba(95,206,95,0.15)' }]}>
        <Text style={[st.avatarText, { color: GREEN }]}>
          {(profile?.display_name || '?').slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <Text style={[st.name, { color: T.text }]}>{profile?.display_name || '—'}</Text>
      <Text style={[st.handle, { color: T.textDim }]}>@{profile?.username || '—'}</Text>
      <Text style={[st.email, { color: T.textDim }]}>{session?.user?.email || ''}</Text>

      <View style={[st.divider, { backgroundColor: T.divider }]} />

      <Stepper
        label="Visible range" T={T}
        value={profile?.safety_range_m ?? 5000}
        unit={(m) => `${(m / 1000).toFixed(1)} km`}
        onChange={(dir) =>
          persistRange('safety_range_m', clampStep(profile?.safety_range_m ?? 5000, dir, SAFETY))}
      />
      <Stepper
        label="Warning distance" T={T}
        value={profile?.warning_range_m ?? 300}
        unit={(m) => `${m} m`}
        onChange={(dir) =>
          persistRange('warning_range_m', clampStep(profile?.warning_range_m ?? 300, dir, WARNING))}
      />

      <TouchableOpacity
        style={[st.linkRow, { borderColor: T.cardBorder }]}
        onPress={() => navigation.navigate('Friends')}
        activeOpacity={0.8}
      >
        <Ionicons name="people-outline" size={20} color={T.text} />
        <Text style={[st.linkText, { color: T.text }]}>Friends</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={18} color={T.textDim} />
      </TouchableOpacity>

      <View style={{ flex: 1 }} />

      <TouchableOpacity style={[st.logout, { borderColor: T.cardBorder }]}
        onPress={confirmLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color={RED_STOP} />
        <Text style={[st.logoutText, { color: RED_STOP }]}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center',
    justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 30, fontWeight: '800' },
  name: { fontSize: 22, fontWeight: '800', letterSpacing: 0.3 },
  handle: { fontSize: 14, marginTop: 2 },
  email: { fontSize: 13, marginTop: 6 },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 24 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', paddingVertical: 12 },
  settingLabel: { fontSize: 15, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 15, fontWeight: '700', minWidth: 64, textAlign: 'center' },
  logout: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 50,
    paddingHorizontal: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch', justifyContent: 'center' },
  logoutText: { fontSize: 15, fontWeight: '700' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 50,
    paddingHorizontal: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch', marginTop: 12 },
  linkText: { fontSize: 15, fontWeight: '600' },
});
