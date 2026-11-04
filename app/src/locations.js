// Event locations (migration 49). A location is { name, address, lat, lng, placeId }: name is what people call the
// place ("Eastside Leisure Centre"), address is Google's formatted address, lat/lng drop the map pin. Only name is
// required; a location typed without the Google search has no pin.
//
// The bout location lives in events.venue / venue_address / venue_lat / venue_lng / venue_place_id. The weigh-in
// location lives in events.weigh_in_venue / …; when weigh_in_venue is empty, weigh-ins are at the bout location.

export const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
// Pins (AdvancedMarker) need a Map ID. Google's DEMO_MAP_ID works until one is set up in the Cloud console.
export const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'
export const mapsEnabled = Boolean(GOOGLE_MAPS_KEY)

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

function read(event, prefix) {
  const name = event?.[prefix === 'venue' ? 'venue' : `${prefix}_venue`]
  if (!name) return null
  return {
    name,
    address: event[`${prefix}_address`] || '',
    lat: num(event[`${prefix}_lat`]),
    lng: num(event[`${prefix}_lng`]),
    placeId: event[`${prefix}_place_id`] || '',
  }
}

// Where the bouts are. null when no location is set yet.
export const boutLocation = (event) => read(event, 'venue')
// True when the weigh-ins have no location of their own, so they are at the bout location.
export const weighInSameAsBouts = (event) => !event?.weigh_in_venue
// Where the weigh-ins are: their own location, or the bout location.
export const weighInLocation = (event) => (weighInSameAsBouts(event) ? boutLocation(event) : read(event, 'weigh_in'))

export const hasPin = (loc) => Boolean(loc && loc.lat !== null && loc.lng !== null)

// The database columns for a location. prefix is 'venue' (bouts) or 'weigh_in'. An empty location clears them all.
export function locationColumns(loc, prefix) {
  const name = loc?.name?.trim() || null
  const pin = name && hasPin(loc)
  return {
    [prefix === 'venue' ? 'venue' : `${prefix}_venue`]: name,
    [`${prefix}_address`]: (name && loc.address?.trim()) || null,
    [`${prefix}_lat`]: pin ? loc.lat : null,
    [`${prefix}_lng`]: pin ? loc.lng : null,
    [`${prefix}_place_id`]: (name && loc.placeId) || null,
  }
}

// A Google Maps link that opens the place (or searches for its name when it has no pin).
export function mapsLink(loc) {
  if (!loc) return null
  const query = hasPin(loc) ? `${loc.lat},${loc.lng}` : [loc.name, loc.address].filter(Boolean).join(', ')
  const params = new URLSearchParams({ api: '1', query })
  if (loc.placeId) params.set('query_place_id', loc.placeId)
  return `https://www.google.com/maps/search/?${params}`
}

// One line of text: "Eastside Leisure Centre, 123 Main St, Winnipeg".
export function locationText(loc) {
  if (!loc) return ''
  return loc.address && !loc.address.startsWith(loc.name) ? `${loc.name}, ${loc.address}` : loc.address || loc.name
}
