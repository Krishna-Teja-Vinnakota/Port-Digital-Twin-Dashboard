/**
 * Shared geospatial guardrails for Port map entities.
 */

export const Port_MAP_BOUNDS = {
  minLat: 18.78,
  maxLat: 18.99,
  minLng: 72.66,
  maxLng: 73.08,
};

// minLng pushed east to 72.945 so randomly-spawned trucks always fall on the
// Port landmass — the Thane Creek / Arabian Sea water body starts west of 72.94.
export const Port_TRUCK_BOUNDS = {
  minLat: 18.928,
  maxLat: 18.958,
  minLng: 72.945,
  maxLng: 72.985,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidPosition(position) {
  return !!position && isFiniteCoordinate(position.lat) && isFiniteCoordinate(position.lng);
}

export function isWithinBounds(position, bounds) {
  if (!isValidPosition(position)) return false;
  return (
    position.lat >= bounds.minLat &&
    position.lat <= bounds.maxLat &&
    position.lng >= bounds.minLng &&
    position.lng <= bounds.maxLng
  );
}

export function clampToBounds(position, bounds) {
  if (!isValidPosition(position)) return null;
  return {
    lat: clamp(position.lat, bounds.minLat, bounds.maxLat),
    lng: clamp(position.lng, bounds.minLng, bounds.maxLng),
  };
}

export const Port_TRUCK_LAND_ANCHORS = [
  { lat: 18.952, lng: 72.964 },
  { lat: 18.948, lng: 72.968 },
  { lat: 18.944, lng: 72.972 },
  { lat: 18.94, lng: 72.95 },
  { lat: 18.936, lng: 72.958 },
];

function dist2(a, b) {
  const dLat = a.lat - b.lat;
  const dLng = a.lng - b.lng;
  return dLat * dLat + dLng * dLng;
}

export function snapToTruckLand(position) {
  const clamped = clampToBounds(position, Port_TRUCK_BOUNDS);
  if (!clamped) return null;
  const nearest = Port_TRUCK_LAND_ANCHORS.reduce(
    (best, p) => (dist2(clamped, p) < best.d ? { d: dist2(clamped, p), p } : best),
    { d: Number.POSITIVE_INFINITY, p: Port_TRUCK_LAND_ANCHORS[0] },
  ).p;
  const jitter = () => (Math.random() - 0.5) * 0.0005;
  return (
    clampToBounds(
      { lat: nearest.lat + jitter(), lng: nearest.lng + jitter() },
      Port_TRUCK_BOUNDS,
    ) ?? clamped
  );
}
