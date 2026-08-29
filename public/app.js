const BASEL_CENTER = [47.5596, 7.5886];
const POLL_INTERVAL_MS = 5000;

const map = L.map('map').setView(BASEL_CENTER, 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

const lineSelect = document.getElementById('line-select');
let selectedLine = '';
lineSelect.addEventListener('change', () => {
  selectedLine = lineSelect.value;
  refresh();
});

async function loadRoutes() {
  try {
    const res = await fetch('/api/routes');
    const data = await res.json();
    for (const route of data.routes) {
      const option = document.createElement('option');
      option.value = route.routeShortName;
      option.textContent = route.routeLongName
        ? `${route.routeShortName} — ${route.routeLongName}`
        : route.routeShortName;
      lineSelect.appendChild(option);
    }
  } catch (err) {
    console.error('Failed to load route list', err);
  }
}

function badgeIcon(routeShortName) {
  return L.divIcon({
    className: '',
    html: `<div class="vehicle-badge">${routeShortName || '?'}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function tooltipText(vehicle) {
  const delayMin = Math.round(vehicle.delaySeconds / 60);
  const delayText = delayMin === 0 ? 'on time' : delayMin > 0 ? `+${delayMin} min` : `${delayMin} min`;
  return `Line ${vehicle.routeShortName || '?'} → ${vehicle.headsign || ''}<br>${delayText}`;
}

const markersByTripId = new Map();

async function refresh() {
  let data;
  try {
    const res = await fetch('/api/vehicles');
    data = await res.json();
  } catch (err) {
    console.error('Failed to fetch vehicles', err);
    return;
  }

  const visible = selectedLine
    ? data.vehicles.filter((v) => v.routeShortName === selectedLine)
    : data.vehicles;

  const seenTripIds = new Set();
  for (const vehicle of visible) {
    seenTripIds.add(vehicle.tripId);
    const latLng = [vehicle.lat, vehicle.lon];
    let marker = markersByTripId.get(vehicle.tripId);
    if (!marker) {
      marker = L.marker(latLng, { icon: badgeIcon(vehicle.routeShortName) });
      marker.addTo(map);
      markersByTripId.set(vehicle.tripId, marker);
    } else {
      marker.setLatLng(latLng);
    }
    marker.bindTooltip(tooltipText(vehicle));
  }

  for (const [tripId, marker] of markersByTripId) {
    if (!seenTripIds.has(tripId)) {
      map.removeLayer(marker);
      markersByTripId.delete(tripId);
    }
  }
}

loadRoutes();
refresh();
setInterval(refresh, POLL_INTERVAL_MS);
