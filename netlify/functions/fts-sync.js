const { schedule } = require('@netlify/functions');

const {
  STATIONS,
  syncStation
} = require('./_weather-archive');

async function syncArchive() {
  const results = [];

  // Sequential by design: avoids bursting FTS360 with many simultaneous calls.
  for (const stationId of Object.keys(STATIONS)) {
    try {
      results.push({
        ok: true,
        ...(await syncStation(stationId))
      });
    } catch (error) {
      console.error(`Sync failed for ${stationId}`, error);

      results.push({
        stationId,
        ok: false,
        error: error.message
      });
    }
  }

  const succeeded = results.filter(result => result.ok).length;

  console.log(
    JSON.stringify({
      event: 'fts-archive-sync',
      succeeded,
      total: results.length,
      results
    })
  );

  if (!succeeded) {
    throw new Error('All station archive syncs failed');
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      succeeded,
      total: results.length,
      results
    })
  };
}

// Runs every hour at 10 minutes past the hour, UTC.
exports.handler = schedule('10 * * * *', syncArchive);
