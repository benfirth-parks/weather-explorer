const {
  STATIONS,
  INITIAL_SEED_HOURS,
  readArchive,
  syncStation,
  selectHours
} = require('./_weather-archive');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const stationId = event.queryStringParameters?.station;
    const requestedHours = Number(
      event.queryStringParameters?.hours || 24
    );

    if (!stationId || !STATIONS[stationId]) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid station' })
      };
    }

    let archive = await readArchive(stationId);
    let seeded = false;

    if (!archive.observations.length) {
      await syncStation(stationId, INITIAL_SEED_HOURS);
      archive = await readArchive(stationId);
      seeded = true;
    }

    const observations = selectHours(archive, requestedHours);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control':
          'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
        'X-Weather-Data-Source': 'netlify-blobs-archive',
        'X-Archive-Last-Synced': archive.lastSyncedAt || '',
        'X-Archive-Seeded': String(seeded)
      },
      body: JSON.stringify(observations)
    };
  } catch (error) {
    console.error(error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        error: 'Weather archive unavailable',
        details: error.message
      })
    };
  }
};
