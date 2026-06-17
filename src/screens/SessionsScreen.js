import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../store/ThemeContext';

export default function SessionsScreen() {
  const { T } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: T.bg }]}>
      <Text style={[styles.text, { color: T.textDim }]}>Sessions</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 18 },
});
