import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../store/ThemeContext';

export default function GroupDetailScreen({ route }) {
  const { T } = useTheme();
  return (
    <View style={[st.root, { backgroundColor: T.bg }]}>
      <Text style={{ color: T.textDim }}>{route?.params?.name ?? 'Hunt'}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
