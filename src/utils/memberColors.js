import { MEMBER_TRAIL_COLORS } from '../constants/sharing.js';

const GREEN = '#5FCE5F';

// Viewer-relative colour: self is ALWAYS green ("green = me" is the field
// invariant); everyone else gets a stable palette slot from the sorted member
// ids so the assignment is identical on every device and across sessions.
export function colorForMember(userId, myId, memberIds) {
  if (userId === myId) return GREEN;
  const others = [...new Set(memberIds)].filter((id) => id !== myId).sort();
  const idx = others.indexOf(userId);
  if (idx === -1) return MEMBER_TRAIL_COLORS[0];
  return MEMBER_TRAIL_COLORS[idx % MEMBER_TRAIL_COLORS.length];
}
