import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import L from './leaflet-global.js';
import 'leaflet.markercluster';
import { escHtml, formatDate, deadlineText, deadlineClass } from './utils.js';

// Interactive map of Taiwan tournament venues on the tournaments page. Tournaments at the same
// venue share one marker; nearby venues merge into a numbered bubble until you zoom in.

const TAIWAN_CENTER = [23.7, 120.95];
const TAIWAN_ZOOM = 7;
// Coordinates matched only to a district or city centre (see backend/services/geocode.js)
const APPROXIMATE = new Set(['district', 'city']);

let map = null;
let clusters = null;
// tournament id → the marker showing it
let markerFor = new Map();

const isOpen = t => t.deadline && new Date(t.deadline) > new Date();

function createMap(el) {
  map = L.map(el, { center: TAIWAN_CENTER, zoom: TAIWAN_ZOOM, minZoom: 6, scrollWheelZoom: false });
  // The wheel scrolls the page until you click into the map
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
  // OpenStreetMap's own tiles need no key; style.css darkens them to match the site
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
  clusters = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    iconCreateFunction: cluster => {
      const markers = cluster.getAllChildMarkers();
      const count = markers.reduce((n, m) => n + m.options.tournaments.length, 0);
      const open = markers.some(m => m.options.tournaments.some(isOpen));
      return L.divIcon({
        html: `<span>${count}</span>`,
        className: `map-cluster${open ? ' open' : ''}`,
        iconSize: [38, 38],
      });
    },
  });
  map.addLayer(clusters);
}

function venueIcon(tournaments, approximate) {
  const open = tournaments.some(isOpen);
  return L.divIcon({
    html: `<span>${tournaments.length > 1 ? tournaments.length : ''}</span>`,
    className: `map-pin${open ? ' open' : ''}${approximate ? ' approximate' : ''}`,
    iconSize: [26, 26],
    popupAnchor: [0, -10],
  });
}

// "2026-27 超級球聯盟賽 賽季2 — 台北市士林區大西路66號B1": the venue is the popup's heading
const titleOf = t => t.name.split(' — ')[0];

function popupHtml(tournaments, approximate) {
  const items = tournaments.map(t => `
    <li class="map-popup-item">
      <div class="map-popup-name">${escHtml(titleOf(t))}</div>
      <div class="map-popup-meta">📅 ${t.date ? formatDate(t.date) : '日期待公佈'}</div>
      ${t.deadline ? `<div class="deadline-badge ${deadlineClass(t.deadline)}">⏰ ${deadlineText(t.deadline)}</div>` : ''}
      ${t.registrationUrl ? `<a class="map-popup-link" href="${escHtml(t.registrationUrl)}" target="_blank" rel="noopener">${isOpen(t) ? '🎯 報名' : '詳細資訊'} →</a>` : ''}
    </li>`).join('');
  return `
    <div class="map-popup">
      <div class="map-popup-venue">📍 ${escHtml(tournaments[0].location)}</div>
      ${approximate ? '<div class="map-popup-note">找不到確切門牌，標示的是大概的區域</div>' : ''}
      <ul>${items}</ul>
    </div>`;
}

// Show these tournaments on the map in `el` (created on first use, or again after the page re-renders)
export function renderTournamentMap(el, tournaments) {
  if (!map || map.getContainer() !== el) {
    if (map) map.remove();
    createMap(el);
  }
  clusters.clearLayers();
  markerFor = new Map();

  const venues = new Map();
  for (const t of tournaments) {
    if (!t.geo) continue;
    const key = `${t.geo.lat},${t.geo.lng}`;
    if (!venues.has(key)) venues.set(key, []);
    venues.get(key).push(t);
  }

  const markers = [...venues.values()].map(group => {
    // Soonest first inside a venue
    group.sort((a, b) => new Date(a.date || '9999') - new Date(b.date || '9999'));
    const { lat, lng, precision } = group[0].geo;
    const approximate = APPROXIMATE.has(precision);
    const marker = L.marker([lat, lng], { icon: venueIcon(group, approximate), tournaments: group, title: group[0].location });
    marker.bindPopup(popupHtml(group, approximate), { maxWidth: 280, maxHeight: 320 });
    for (const t of group) markerFor.set(t.id, marker);
    return marker;
  });
  clusters.addLayers(markers);

  if (markers.length) {
    map.fitBounds(L.latLngBounds(markers.map(m => m.getLatLng())), { padding: [30, 30], maxZoom: 13 });
  } else {
    map.setView(TAIWAN_CENTER, TAIWAN_ZOOM);
  }
  // The container may have just been shown or resized
  setTimeout(() => map && map.invalidateSize(), 0);
  return markers.length;
}

// Zoom to a tournament's marker and open its popup (the 「地圖」 button on a card)
export function showOnMap(tournamentId) {
  const marker = markerFor.get(tournamentId);
  if (!marker) return false;
  clusters.zoomToShowLayer(marker, () => marker.openPopup());
  return true;
}
