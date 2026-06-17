import { StyleSheet } from 'react-native';

// Fixed accents — identical in both themes per product spec
export const GREEN = '#5FCE5F';
export const RED_STOP = '#E24B4A';

const HILLSHADE_DARK_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}';
const HILLSHADE_LIGHT_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';

export const DARK = {
  // ── Map tiles ─────────────────────────────────────────────────
  topoBase: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  hillshadeUrl: HILLSHADE_DARK_URL,
  hillshadeOpacity: 0.25,

  // ── UI colours ─────────────────────────────────────────────────
  bg: '#0d0d0d',
  card: 'rgba(8,8,8,0.82)',
  cardBorder: 'rgba(255,255,255,0.10)',
  text: 'rgba(255,255,255,0.88)',
  textMono: 'rgba(255,255,255,0.85)',
  textDim: 'rgba(255,255,255,0.42)',
  divider: 'rgba(255,255,255,0.14)',
  toggleActive: 'rgba(95,206,95,0.18)',
  toggleText: 'rgba(255,255,255,0.38)',
  toggleTextActive: '#5FCE5F',

  // ── Navigation chrome ──────────────────────────────────────────
  tabBar: '#0d0d0d',
  tabBarBorder: '#1f1f1f',
  tabBarActive: '#5FCE5F',
  tabBarInactive: '#555',
  headerBg: '#111',
  headerBorder: '#222',
  headerText: '#fff',
  statusBar: 'light',
};

export const LIGHT = {
  // ── Map tiles ─────────────────────────────────────────────────
  // CartoDB Voyager: clean outdoor style, readable in bright sunlight
  topoBase: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  hillshadeUrl: HILLSHADE_LIGHT_URL,
  hillshadeOpacity: 0.10,

  // ── UI colours ─────────────────────────────────────────────────
  bg: '#f1f0eb',
  card: 'rgba(255,255,255,0.90)',
  cardBorder: 'rgba(0,0,0,0.10)',
  text: 'rgba(15,15,15,0.88)',
  textMono: 'rgba(15,15,15,0.82)',
  textDim: 'rgba(0,0,0,0.45)',
  divider: 'rgba(0,0,0,0.12)',
  toggleActive: 'rgba(40,130,40,0.12)',
  toggleText: 'rgba(0,0,0,0.38)',
  toggleTextActive: '#2e8c2e',

  // ── Navigation chrome ──────────────────────────────────────────
  tabBar: '#f7f6f1',
  tabBarBorder: '#ddddd5',
  tabBarActive: '#2e8c2e',
  tabBarInactive: '#9a9890',
  headerBg: '#f1f0eb',
  headerBorder: '#ddddd5',
  headerText: '#111',
  statusBar: 'dark',
};
