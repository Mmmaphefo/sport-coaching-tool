// Venue map pin — the coach can drop/move the marker on the map in the event
// edit form, and the coordinates are stored so the venue map and weather
// widget centre on the exact pitch instead of re-geocoding the place name.
exports.up = (pgm) => {
  pgm.addColumns('events', {
    location_lat: { type: 'double precision' },
    location_lng: { type: 'double precision' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('events', ['location_lat', 'location_lng']);
};
