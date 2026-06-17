import React from 'react';
import { Polyline } from 'react-native-maps';

export function TrailLayer({ points }) {
  if (!points || points.length < 2) return null;
  return (
    <>
      {/* Dark shadow beneath for visibility on both topo and satellite */}
      <Polyline
        coordinates={points}
        strokeColor="rgba(0, 0, 0, 0.45)"
        strokeWidth={9}
        lineCap="round"
        lineJoin="round"
      />
      {/* Main trail — bright green */}
      <Polyline
        coordinates={points}
        strokeColor="#5FCE5F"
        strokeWidth={5}
        lineCap="round"
        lineJoin="round"
      />
    </>
  );
}
