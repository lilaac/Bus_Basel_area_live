import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const FEED_URL = 'https://api.opentransportdata.swiss/la/gtfs-rt';

// opentransportdata.swiss only publishes TripUpdates (delays) and Service
// Alerts via GTFS-RT — no VehiclePositions entity is available. We use the
// delays here to shift each trip's scheduled stop times, then interpolate
// position along the route (see interpolate.js).
export async function fetchTripDelays(apiKey) {
  const res = await fetch(FEED_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/octet-stream',
    },
  });
  if (!res.ok) {
    throw new Error(`GTFS-RT fetch failed: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

  // trip_id -> Map(stop_sequence -> delaySeconds)
  const delaysByTripId = new Map();
  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    const tripId = tripUpdate?.trip?.tripId;
    if (!tripId) continue;

    const stopSequenceDelays = new Map();
    for (const stu of tripUpdate.stopTimeUpdate || []) {
      const delay = stu.arrival?.delay ?? stu.departure?.delay ?? 0;
      if (stu.stopSequence != null) stopSequenceDelays.set(stu.stopSequence, delay);
    }
    delaysByTripId.set(tripId, stopSequenceDelays);
  }
  return delaysByTripId;
}
