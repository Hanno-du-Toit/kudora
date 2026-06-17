import { StyleSheet, View } from 'react-native';
import MapView, { UrlTile } from 'react-native-maps';

const SOUTH_AFRICA = {
  latitude: -28.4793,
  longitude: 24.6727,
  latitudeDelta: 15,
  longitudeDelta: 15,
};

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={SOUTH_AFRICA} mapType="none">
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
