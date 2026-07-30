import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { listGroupTrails } from '../services/sharedTrails';
import { friendlyGroupError } from '../utils/groupErrors';

export function useGroupTrails(groupId) {
  const [trails, setTrails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setTrails(await listGroupTrails(groupId)); }
    catch (e) { setError(friendlyGroupError(e)); }
    finally { setLoading(false); }
  }, [groupId]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  return { trails, loading, error, refresh };
}
