import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import MapScreen from './src/screens/MapScreen';
import SessionsScreen from './src/screens/SessionsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

function ThemedApp() {
  const { T } = useTheme();
  return (
    <NavigationContainer>
      <StatusBar style={T.statusBar} />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: {
            backgroundColor: T.headerBg,
            borderBottomColor: T.headerBorder,
          },
          headerTintColor: T.headerText,
          tabBarStyle: {
            backgroundColor: T.tabBar,
            borderTopColor: T.tabBarBorder,
          },
          tabBarActiveTintColor: T.tabBarActive,
          tabBarInactiveTintColor: T.tabBarInactive,
          tabBarIcon: ({ color, size }) => {
            const icons = { Map: 'map', Sessions: 'trail-sign', Profile: 'person' };
            return <Ionicons name={icons[route.name]} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Map" component={MapScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Sessions" component={SessionsScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}
