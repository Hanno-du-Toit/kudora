import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import MapScreen from './src/screens/MapScreen';
import SessionsScreen from './src/screens/SessionsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: '#111', borderBottomColor: '#222' },
          headerTintColor: '#fff',
          tabBarStyle: { backgroundColor: '#0d0d0d', borderTopColor: '#1f1f1f' },
          tabBarActiveTintColor: '#5FCE5F',
          tabBarInactiveTintColor: '#555',
          tabBarIcon: ({ focused, color, size }) => {
            const icons = { Map: 'map', Sessions: 'trail-sign', Profile: 'person' };
            return <Ionicons name={icons[route.name]} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{ headerShown: false }}
        />
        <Tab.Screen name="Sessions" component={SessionsScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
