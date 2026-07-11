import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GREEN } from '../../constants/themes';
import { listMyGroups } from '../../services/groups';
import { friendlyGroupError } from '../../utils/groupErrors';
import { formatDateShort, parseISODate } from '../../utils/dates';
import { getDesired, setDesired, getServerCache } from '../../store/shareState';
import { reconcileShares, onShareSync } from '../../services/trailSync';
import { buildTrailPayload } from '../../utils/trailPayload';

// desired/cached → user-facing sync status for one (hunt, outing) toggle.
// Pure — no IO — so it's trivially node-checkable.
export function shareStatus(desired, cached) {
  if (desired && cached) return 'Shared';
  if (desired && !cached) return 'Waiting for signal';
  if (!desired && cached) return 'Removing…';
  return null;
}

function dateRangeLabel(startISO, endISO) {
  return `${formatDateShort(parseISODate(startISO))} – ${formatDateShort(parseISODate(endISO))}`;
}

const cacheKeyOf = (huntId, groupId) => `${huntId}|${groupId}`;

export default function ShareSheet({ hunt, visible, onClose, T, isDark, insets }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [outings, setOutings] = useState([]);
  const [desiredMap, setDesiredMap] = useState({});
  const [cacheMap, setCacheMap] = useState({});
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [revokedNotice, setRevokedNotice] = useState(false);
  const pendingRef = useRef(new Set());

  const huntId = hunt?.id;
  const unshareable = hunt ? buildTrailPayload(hunt, 'x', 'x') === null : true;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRevokedNotice(false);
    try {
      const [groups, desired, cache] = await Promise.all([
        listMyGroups(),
        getDesired(),
        getServerCache(),
      ]);
      setOutings(groups.filter((g) => g.my_status === 'owner' || g.my_status === 'joined'));
      setDesiredMap(desired);
      setCacheMap(cache);
    } catch (e) {
      setError(friendlyGroupError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // Task-3 re-read contract: both revoke paths mutate the desired store via
  // setDesired(false) BEFORE listeners fire, and the summary carries no
  // hunt/group ids — so we re-read getDesired()/getServerCache() here rather
  // than deriving toggle state from the summary. `revoked` is used only for
  // the generic inline caption below.
  useEffect(() => {
    if (!visible) return undefined;
    const unsub = onShareSync((summary) => {
      Promise.all([getDesired(), getServerCache()]).then(([d, c]) => {
        setDesiredMap(d);
        setCacheMap(c);
      });
      setRevokedNotice(summary.revoked > 0);
    });
    return unsub;
  }, [visible]);

  const handleToggle = useCallback(
    async (groupId, next) => {
      if (!huntId || pendingRef.current.has(groupId)) return;
      pendingRef.current.add(groupId);
      setPendingIds(new Set(pendingRef.current));
      try {
        // Offline-first: write desired state locally first (never block the
        // toggle on the network), then update the UI optimistically, then
        // kick the reconciler without awaiting it.
        await setDesired(huntId, groupId, next);
        setDesiredMap((d) => {
          const huntEntry = { ...(d[huntId] ?? {}) };
          if (next) huntEntry[groupId] = true;
          else delete huntEntry[groupId];
          const out = { ...d };
          if (Object.keys(huntEntry).length) out[huntId] = huntEntry;
          else delete out[huntId];
          return out;
        });
        reconcileShares();
      } finally {
        pendingRef.current.delete(groupId);
        setPendingIds(new Set(pendingRef.current));
      }
    },
    [huntId]
  );

  const renderRow = useCallback(
    ({ item }) => {
      const desired = !!desiredMap[huntId]?.[item.group_id];
      const cached = !!cacheMap[cacheKeyOf(huntId, item.group_id)];
      const status = shareStatus(desired, cached);
      const isPending = pendingIds.has(item.group_id);
      return (
        <View style={[st.row, { borderColor: T.cardBorder }]}>
          <View style={st.rowInfo}>
            <Text style={[st.rowName, { color: T.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[st.rowMeta, { color: T.textDim }]}>
              {dateRangeLabel(item.start_date, item.end_date)}
            </Text>
            {!!status && (
              <Text style={[st.rowStatus, { color: status === 'Shared' ? GREEN : T.textDim }]}>
                {status}
              </Text>
            )}
          </View>
          <Switch
            trackColor={{ true: GREEN }}
            value={desired}
            disabled={unshareable || isPending}
            onValueChange={(next) => handleToggle(item.group_id, next)}
          />
        </View>
      );
    },
    [desiredMap, cacheMap, pendingIds, unshareable, huntId, handleToggle, T]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={st.backdrop} onPress={onClose} />
      <View
        style={[
          st.sheet,
          {
            backgroundColor: T.card,
            borderColor: T.cardBorder,
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        <View style={st.headerRow}>
          <Text style={[st.title, { color: T.text }]}>Share this hunt</Text>
          <Pressable
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={st.closeBtn}
          >
            <Ionicons name="close" size={20} color={T.textDim} />
          </Pressable>
        </View>

        {loading && (
          <View style={st.centerBlock}>
            <ActivityIndicator color={GREEN} size="small" />
          </View>
        )}

        {!loading && !!error && (
          <Text style={[st.errorText, { color: T.textDim }]}>{error}</Text>
        )}

        {!loading && !error && unshareable && (
          <Text style={[st.errorText, { color: T.textDim }]}>
            This hunt is too short to share (needs 2+ GPS points).
          </Text>
        )}

        {!loading && !error && !unshareable && outings.length === 0 && (
          <Text style={[st.errorText, { color: T.textDim }]}>
            You're not in any outings yet — create one on the Group tab.
          </Text>
        )}

        {!loading && !error && outings.length > 0 && (
          <FlatList
            data={outings}
            keyExtractor={(g) => g.group_id}
            renderItem={renderRow}
            style={st.list}
          />
        )}

        {!loading && revokedNotice && (
          <Text style={[st.notice, { color: T.textDim }]}>
            Removed from an outing — that share was cancelled.
          </Text>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 18,
    paddingHorizontal: 20,
    maxHeight: '75%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -12,
  },
  centerBlock: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 24,
    textAlign: 'center',
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  rowStatus: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
    letterSpacing: 0.3,
  },
  notice: {
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 12,
    textAlign: 'center',
  },
});
