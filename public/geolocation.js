(function exposeGeolocationGeometry(root) {
  function pointInRing(longitude, latitude, ring) {
    let inside = false;
    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
      const [currentLongitude, currentLatitude] = ring[current];
      const [previousLongitude, previousLatitude] = ring[previous];
      const crosses = (currentLatitude > latitude) !== (previousLatitude > latitude)
        && longitude < ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
          / ((previousLatitude - currentLatitude) || Number.EPSILON) + currentLongitude;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(longitude, latitude, rings) {
    if (!Array.isArray(rings) || !rings.length || !pointInRing(longitude, latitude, rings[0])) return false;
    return !rings.slice(1).some((hole) => pointInRing(longitude, latitude, hole));
  }

  function stateFromCoordinates(longitude, latitude, featureCollection) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || featureCollection?.type !== 'FeatureCollection') return null;
    const match = featureCollection.features.find((feature) => {
      const geometry = feature.geometry || {};
      if (geometry.type === 'Polygon') return pointInPolygon(longitude, latitude, geometry.coordinates);
      if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some((polygon) => pointInPolygon(longitude, latitude, polygon));
      }
      return false;
    });
    return match?.properties?.uf || null;
  }

  const api = Object.freeze({ pointInRing, pointInPolygon, stateFromCoordinates });
  if (root) root.VotoClaroGeo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : null));
