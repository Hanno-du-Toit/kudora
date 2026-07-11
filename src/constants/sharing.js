// Cap on points uploaded per shared trail — sampled client-side; the DB CHECK
// allows up to 2000 as headroom so the cap can be raised without a migration.
export const MAX_SHARED_TRAIL_POINTS = 1000;

// Other members' trail colours on the group map (self is always GREEN).
// Assigned by position in the group's member ids sorted ascending (deterministic
// on every device), wrapping via modulo. First two match CLAUDE.md (dad amber,
// brother blue).
export const MEMBER_TRAIL_COLORS = ['#F4A623', '#6AB0E8', '#C77DD8', '#E8875C'];
