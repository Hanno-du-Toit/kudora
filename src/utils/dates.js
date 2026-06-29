// Pure date helpers — no RN imports so they're trivially node-testable.
// All operate in LOCAL time and map to/from the Postgres `date` type ('YYYY-MM-DD').

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso) {
  const [y, m, d] = (iso ?? '').split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d, n) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

export function formatDateShort(d) {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
