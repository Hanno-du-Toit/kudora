import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FriendsScreen from './src/screens/FriendsScreen';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import { AuthProvider, useAuth } from './src/store/AuthContext';
import { GREEN } from './src/constants/themes';
import MapScreen from './src/screens/MapScreen';
import SessionsScreen from './src/screens/SessionsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/auth/AuthScreen';

const Tab = createBottomTabNavigator();
const ProfileStack = createNativeStackNavigator();

function ProfileStackScreen() {
  const { T } = useTheme();
  return (
    <ProfileStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: T.headerBg },
        headerTintColor: T.headerText,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: T.bg },
      }}
    >
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} options={{ headerShown: false }} />
      <ProfileStack.Screen name="Friends" component={FriendsScreen} options={{ title: 'Friends' }} />
    </ProfileStack.Navigator>
  );
}

function ThemedTabs() {
  const { T } = useTheme();
  return (
    <NavigationContainer>
      <StatusBar style={T.statusBar} />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: T.headerBg, borderBottomColor: T.headerBorder },
          headerTintColor: T.headerText,
          tabBarStyle: { backgroundColor: T.tabBar, borderTopColor: T.tabBarBorder },
          tabBarActiveTintColor: T.tabBarActive,
          tabBarInactiveTintColor: T.tabBarInactive,
          tabBarIcon: ({ color, size }) => {
            const icons = { Map: 'map', Sessions: 'trail-sign', Profile: 'person' };
            return <Ionicons name={icons[route.name]} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Map" component={MapScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Sessions" component={SessionsScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Profile" component={ProfileStackScreen} options={{ headerShown: false }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function Root() {
  const { session, loading } = useAuth();
  const { T } = useTheme();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style={T.statusBar} />
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }
  if (!session) {
    return (
      <>
        <StatusBar style={T.statusBar} />
        <AuthScreen />
      </>
    );
  }
  return <ThemedTabs />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
