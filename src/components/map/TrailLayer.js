import React from 'react';
import { Polyline } from 'react-native-maps';
import { isValidCoord } from '../../utils/geoUtils';

export function TrailLayer({ points, color = '#5FCE5F' }) {
  // Drop any null/empty/(0,0) coordinates so the polyline never draws a leg back
  // to the map origin before the first real GPS fix arrives.
  const valid = (points || []).filter(isValidCoord);
  if (valid.length < 2) return null;
  return (
    <>
      {/* Dark shadow beneath for visibility on both topo and satellite */}
      <Polyline
        coordinates={valid}
        strokeColor="rgba(0, 0, 0, 0.45)"
        strokeWidth={9}
        lineCap="round"
        lineJoin="round"
      />
      {/* Main trail — member colour (own trail defaults to bright green) */}
      <Polyline
        coordinates={valid}
        strokeColor={color}
        strokeWidth={5}
        lineCap="round"
        lineJoin="round"
      />
    </>
  );
}
