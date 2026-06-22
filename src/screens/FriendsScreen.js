import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../store/ThemeContext';

export default function FriendsScreen() {
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.root, { backgroundColor: T.bg, paddingTop: insets.top + 24 }]}>
      <Text style={{ color: T.textDim }}>Friends</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
