import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../store/ThemeContext';
import { useAuth } from '../../store/AuthContext';
import { GREEN } from '../../constants/themes';
import { validateUsername } from '../../utils/validators';
import { isUsernameAvailable as checkUsername } from '../../services/profiles';

function friendlyAuthError(error) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Wrong email or password';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'That email is already registered';
  if (m.includes('username') || m.includes('duplicate') || m.includes('profiles_'))
    return 'That username is taken';
  if (m.includes('network') || m.includes('fetch'))
    return 'No signal — try again when you have a connection';
  if (m.includes('password')) return 'Password must be at least 6 characters';
  return error?.message || 'Something went wrong';
}

export default function AuthScreen() {
  const { T, isDark } = useTheme();
  const { signIn, signUp } = useAuth();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const inputStyle = [
    styles.input,
    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderColor: T.cardBorder, color: T.text },
  ];

  const submit = async () => {
    setError(null);
    setNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) return setError('Enter a valid email');
    if (password.length < 6) return setError('Password must be at least 6 characters');

    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(cleanEmail, password);
        // onAuthStateChange flips the app to the tabs automatically.
      } else {
        const u = validateUsername(username);
        if (!u.ok) { setBusy(false); return setError(u.error); }
        if (!displayName.trim()) { setBusy(false); return setError('Enter a display name'); }
        const free = await checkUsername(u.value);
        if (!free) { setBusy(false); return setError('That username is taken'); }
        const data = await signUp({
          email: cleanEmail, password,
          username: u.value, displayName: displayName.trim(),
        });
        if (!data.session) {
          setMode('login');
          setNotice('Account created. Check your email to confirm, then log in.');
        }
      }
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 64,
          paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.brand, { color: GREEN }]}>KUDORA</Text>
        <Text style={[styles.subtitle, { color: T.textDim }]}>
          {isSignup ? 'Create your account' : 'Welcome back'}
        </Text>

        {isSignup && (
          <>
            <TextInput
              style={inputStyle} placeholder="Display name"
              placeholderTextColor={T.textDim} value={displayName}
              onChangeText={setDisplayName} autoCapitalize="words"
            />
            <TextInput
              style={inputStyle} placeholder="Username (a–z, 0–9, _)"
              placeholderTextColor={T.textDim} value={username}
              onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
            />
          </>
        )}

        <TextInput
          style={inputStyle} placeholder="Email" placeholderTextColor={T.textDim}
          value={email} onChangeText={setEmail} autoCapitalize="none"
          autoCorrect={false} keyboardType="email-address"
        />
        <TextInput
          style={inputStyle} placeholder="Password" placeholderTextColor={T.textDim}
          value={password} onChangeText={setPassword} secureTextEntry
        />

        {error && <Text style={[styles.error, { color: '#E24B4A' }]}>{error}</Text>}
        {notice && <Text style={[styles.notice, { color: GREEN }]}>{notice}</Text>}

        <TouchableOpacity
          style={[styles.button, { backgroundColor: GREEN, opacity: busy ? 0.6 : 1 }]}
          onPress={submit} disabled={busy} activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color="#06210a" />
            : <Text style={styles.buttonText}>{isSignup ? 'Sign up' : 'Log in'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switch}
          onPress={() => { setMode(isSignup ? 'login' : 'signup'); setError(null); setNotice(null); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.switchText, { color: T.textDim }]}>
            {isSignup ? 'Already have an account? Log in'
                      : "New here? Create an account"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 28, gap: 14 },
  brand: { fontSize: 34, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
  input: {
    height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, fontSize: 16,
  },
  error: { fontSize: 13, marginTop: 2 },
  notice: { fontSize: 13, marginTop: 2 },
  button: {
    height: 52, borderRadius: 12, alignItems: 'center',
    justifyContent: 'center', marginTop: 6,
  },
  buttonText: { color: '#06210a', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  switch: { alignItems: 'center', paddingVertical: 14 },
  switchText: { fontSize: 14 },
});
