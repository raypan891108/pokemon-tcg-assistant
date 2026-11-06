import L from 'leaflet';

// leaflet.markercluster attaches itself to a global L, so it has to exist before that import runs
window.L = L;

export default L;
