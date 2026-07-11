import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { reconcileShares } from '../services/trailSync';

// Mounted ONCE in the authed tree (ThemedTabs). Fires the reconciler on app
// start, when connectivity returns, and when the app comes to the foreground.
// reconcileShares is single-flight and never throws, so triggers are cheap.
export function useShareSync() {
  useEffect(() => {
    reconcileShares();
    const unsubNet = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) reconcileShares();
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') reconcileShares();
    });
    return () => { unsubNet(); appSub.remove(); };
  }, []);
}
