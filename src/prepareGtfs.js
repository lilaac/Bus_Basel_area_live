// One-off/occasional script: filters the (huge, national) static GTFS zip
// down to just Basel-area (BVB/BLT) routes/trips/stops and writes a compact
// JSON file the server loads at startup. Re-run whenever data/gtfs.zip is
// refreshed with a newer download.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const ZIP_PATH = path.join(DATA_DIR, 'gtfs.zip');
const EXTRACT_DIR = path.join(DATA_DIR, 'gtfs-extracted');
const OUTPUT_PATH = path.join(DATA_DIR, 'basel-gtfs.json');

const AGENCY_NAME_PATTERN = /BVB|Basler Verkehrs|BLT|Baselland Transport/i;

function parseCsvFile(filePath, onRecord) {
  return new Promise((resolve, reject) => {
    const parser = fs
      .createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }));
    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) onRecord(record);
    });
    parser.on('error', reject);
    parser.on('end', resolve);
  });
}

async function main() {
  if (!fs.existsSync(ZIP_PATH)) {
    console.error(
      `Missing ${ZIP_PATH}.\n` +
        'Download the latest GTFS zip from ' +
        'https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020 ' +
        'and save it as data/gtfs.zip'
    );
    process.exit(1);
  }

  console.log('Extracting GTFS zip...');
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  new AdmZip(ZIP_PATH).extractAllTo(EXTRACT_DIR, true);

  console.log('Finding Basel agencies...');
  const baselAgencyIds = new Set();
  await parseCsvFile(path.join(EXTRACT_DIR, 'agency.txt'), (row) => {
    if (AGENCY_NAME_PATTERN.test(row.agency_name)) baselAgencyIds.add(row.agency_id);
  });
  if (baselAgencyIds.size === 0) {
    console.error(
      'No agencies matched BVB/BLT name pattern in agency.txt. ' +
        'Open the file and adjust AGENCY_NAME_PATTERN in this script.'
    );
    process.exit(1);
  }
  console.log('Basel agency IDs:', [...baselAgencyIds]);

  console.log('Filtering routes...');
  const routes = new Map();
  await parseCsvFile(path.join(EXTRACT_DIR, 'routes.txt'), (row) => {
    if (baselAgencyIds.has(row.agency_id)) {
      routes.set(row.route_id, {
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        route_long_name: row.route_long_name,
        route_type: row.route_type,
      });
    }
  });
  console.log(`${routes.size} Basel routes`);

  console.log('Filtering trips...');
  const trips = new Map();
  await parseCsvFile(path.join(EXTRACT_DIR, 'trips.txt'), (row) => {
    if (routes.has(row.route_id)) {
      trips.set(row.trip_id, {
        trip_id: row.trip_id,
        route_id: row.route_id,
        service_id: row.service_id,
        trip_headsign: row.trip_headsign,
        direction_id: row.direction_id,
      });
    }
  });
  console.log(`${trips.size} Basel trips`);

  console.log('Filtering stop_times (largest file, may take a while)...');
  const stopTimesByTrip = new Map();
  const usedStopIds = new Set();
  await parseCsvFile(path.join(EXTRACT_DIR, 'stop_times.txt'), (row) => {
    if (!trips.has(row.trip_id)) return;
    usedStopIds.add(row.stop_id);
    let list = stopTimesByTrip.get(row.trip_id);
    if (!list) stopTimesByTrip.set(row.trip_id, (list = []));
    list.push({
      stop_id: row.stop_id,
      arrival_time: row.arrival_time,
      departure_time: row.departure_time,
      stop_sequence: Number(row.stop_sequence),
    });
  });
  for (const list of stopTimesByTrip.values()) list.sort((a, b) => a.stop_sequence - b.stop_sequence);
  console.log(`stop_times kept for ${stopTimesByTrip.size} trips, ${usedStopIds.size} stops referenced`);

  console.log('Filtering stops...');
  const stops = new Map();
  await parseCsvFile(path.join(EXTRACT_DIR, 'stops.txt'), (row) => {
    if (usedStopIds.has(row.stop_id)) {
      stops.set(row.stop_id, {
        stop_id: row.stop_id,
        stop_name: row.stop_name,
        stop_lat: Number(row.stop_lat),
        stop_lon: Number(row.stop_lon),
      });
    }
  });

  const usedServiceIds = new Set([...trips.values()].map((t) => t.service_id));

  console.log('Filtering calendar / calendar_dates...');
  const calendar = [];
  const calendarPath = path.join(EXTRACT_DIR, 'calendar.txt');
  if (fs.existsSync(calendarPath)) {
    await parseCsvFile(calendarPath, (row) => {
      if (usedServiceIds.has(row.service_id)) calendar.push(row);
    });
  }
  const calendarDates = [];
  const calendarDatesPath = path.join(EXTRACT_DIR, 'calendar_dates.txt');
  if (fs.existsSync(calendarDatesPath)) {
    await parseCsvFile(calendarDatesPath, (row) => {
      if (usedServiceIds.has(row.service_id)) calendarDates.push(row);
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    routes: [...routes.values()],
    trips: [...trips.values()],
    stopTimesByTrip: Object.fromEntries(stopTimesByTrip),
    stops: Object.fromEntries(stops),
    calendar,
    calendarDates,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`Wrote ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1)} MB)`);

  console.log('Cleaning up extracted files...');
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
