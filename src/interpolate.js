const WEEKDAY_FIELDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function timeStrToSeconds(hhmmss) {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isServiceActiveOnDate(serviceId, dateObj, calendarByService, calendarExceptions) {
  const dateStr = formatDateYYYYMMDD(dateObj);
  const exception = calendarExceptions.get(`${serviceId}|${dateStr}`);
  if (exception === '1') return true;
  if (exception === '2') return false;

  const cal = calendarByService.get(serviceId);
  if (!cal) return false;
  if (dateStr < cal.start_date || dateStr > cal.end_date) return false;
  return cal[WEEKDAY_FIELDS[dateObj.getDay()]] === '1';
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Estimated {lat, lon} per active trip, derived from the static schedule
// plus any known TripUpdate delay — not true GPS (see README: the Swiss
// GTFS-RT feed doesn't publish VehiclePositions).
export function computeVehiclePositions(now, staticData, delaysByTripId) {
  const { tripsById, routesById, stopTimesByTrip, stopsById, calendarByService, calendarExceptions } = staticData;

  const nowSecondsToday = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);

  const vehicles = [];

  for (const trip of tripsById.values()) {
    const stopTimes = stopTimesByTrip.get(trip.trip_id);
    if (!stopTimes || stopTimes.length < 2) continue;

    // A trip belongs to "today"'s service day, or to "yesterday"'s service
    // day if it runs past midnight (GTFS allows times >= 24:00:00 for that).
    let nowSeconds;
    if (isServiceActiveOnDate(trip.service_id, now, calendarByService, calendarExceptions)) {
      nowSeconds = nowSecondsToday;
    } else if (isServiceActiveOnDate(trip.service_id, yesterday, calendarByService, calendarExceptions)) {
      nowSeconds = nowSecondsToday + 24 * 3600;
    } else {
      continue;
    }

    const delays = delaysByTripId.get(trip.trip_id);

    let prev = null; // { stop_id, estDep }
    for (const st of stopTimes) {
      const schedArr = timeStrToSeconds(st.arrival_time || st.departure_time);
      const schedDep = timeStrToSeconds(st.departure_time || st.arrival_time);
      const delay = delays?.get(st.stop_sequence) ?? 0;
      const estArr = schedArr + delay;
      const estDep = schedDep + delay;

      if (prev && nowSeconds >= prev.estDep && nowSeconds <= estArr) {
        const fromStop = stopsById.get(prev.stop_id);
        const toStop = stopsById.get(st.stop_id);
        if (fromStop && toStop) {
          const span = estArr - prev.estDep;
          const t = span > 0 ? (nowSeconds - prev.estDep) / span : 0;
          const route = routesById.get(trip.route_id);
          vehicles.push({
            tripId: trip.trip_id,
            routeShortName: route?.route_short_name ?? '',
            headsign: trip.trip_headsign ?? '',
            lat: lerp(fromStop.stop_lat, toStop.stop_lat, t),
            lon: lerp(fromStop.stop_lon, toStop.stop_lon, t),
            delaySeconds: delay,
          });
        }
        break;
      }
      prev = { stop_id: st.stop_id, estDep };
    }
  }

  return vehicles;
}
