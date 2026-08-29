const BASEL_CENTER = [47.5596, 7.5886];
const POLL_INTERVAL_MS = 5000;

const map = L.map('map').setView(BASEL_CENTER, 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

const markersByTripId = new Map();

function markerLabel(vehicle) {
  const delayMin = Math.round(vehicle.delaySeconds / 60);
  const delayText = delayMin === 0 ? 'on time' : delayMin > 0 ? `+${delayMin} min` : `${delayMin} min`;
  return `Route ${vehicle.routeShortName || '?'} → ${vehicle.headsign || ''} (${delayText})`;
}

async function refresh() {
  let data;
  try {
    const res = await fetch('/api/vehicles');
    data = await res.json();
  } catch (err) {
    console.error('Failed to fetch vehicles', err);
    return;
  }

  const seenTripIds = new Set();
  for (const vehicle of data.vehicles) {
    seenTripIds.add(vehicle.tripId);
    const latLng = [vehicle.lat, vehicle.lon];
    let marker = markersByTripId.get(vehicle.tripId);
    if (!marker) {
      marker = L.circleMarker(latLng, { radius: 7, color: '#1a73e8', fillColor: '#1a73e8', fillOpacity: 0.85 });
      marker.addTo(map);
      markersByTripId.set(vehicle.tripId, marker);
    } else {
      marker.setLatLng(latLng);
    }
    marker.bindTooltip(markerLabel(vehicle));
  }

  for (const [tripId, marker] of markersByTripId) {
    if (!seenTripIds.has(tripId)) {
      map.removeLayer(marker);
      markersByTripId.delete(tripId);
    }
  }
}

refresh();
setInterval(refresh, POLL_INTERVAL_MS);
