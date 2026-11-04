import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { AutoComplete, Button, Input, Space } from 'antd'
import { AimOutlined, EnvironmentOutlined } from '@ant-design/icons'
import { APIProvider, AdvancedMarker, Map, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { GOOGLE_MAPS_KEY, GOOGLE_MAPS_MAP_ID, hasPin, locationText, mapsEnabled, mapsLink } from './locations'
import { Muted, Text } from './ui'

// Google Maps for event locations, through @vis.gl/react-google-maps (Google's React wrapper). Without
// VITE_GOOGLE_MAPS_API_KEY everything still works as plain text: no search, no map.

// Winnipeg, where most events are, until a place is picked.
const START = { lat: 49.8951, lng: -97.1384 }
const PIN_ZOOM = 15
const NAVY = '#1e3a8a'
const NAVY_DEEP = '#14245a'
const GOLD = '#f5b800'

// Loads the Maps script once for the whole app. Renders the children alone when there is no key.
export function MapsProvider({ children }) {
  if (!mapsEnabled) return children
  return <APIProvider apiKey={GOOGLE_MAPS_KEY} language="en" region="CA">{children}</APIProvider>
}

// If Google Maps breaks (a bad key, a blocked script), only the map goes; the page and the text stay.
class MapBoundary extends Component {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch(error) {
    console.warn('Google Maps failed:', error)
  }
  render() {
    if (this.state.broken) return <Muted>The map couldn't load. The location and the Google Maps link still work.</Muted>
    return this.props.children
  }
}

function GoldPin() {
  return <Pin background={GOLD} borderColor={NAVY_DEEP} glyphColor={NAVY} scale={1.3} />
}

// Moves the map to the pin whenever the pin moves somewhere new.
function FollowPin({ position }) {
  const map = useMap()
  const last = useRef(null)
  useEffect(() => {
    if (!map || !position) return
    const key = `${position.lat},${position.lng}`
    if (last.current === key) return
    const first = last.current === null
    last.current = key
    map.panTo(position)
    if (first || map.getZoom() < 12) map.setZoom(PIN_ZOOM)
  }, [map, position])
  return null
}

// A searchable Google Maps location with a pin. value and onChange use { name, address, lat, lng, placeId } or null.
// Pick a place from the list to drop the pin; click the map or drag the pin to move it.
export function LocationInput({ value, onChange, id, placeholder = 'Search for a venue or address' }) {
  if (!mapsEnabled) {
    return (
      <Input
        id={id}
        value={value?.name ?? ''}
        placeholder="e.g. Eastside Leisure Centre"
        onChange={(e) => onChange(e.target.value ? { ...(value ?? {}), name: e.target.value, address: value?.address ?? '', lat: null, lng: null, placeId: '' } : null)}
      />
    )
  }
  return <MapsLocationInput value={value} onChange={onChange} id={id} placeholder={placeholder} />
}

function MapsLocationInput({ value, onChange, id, placeholder }) {
  const places = useMapsLibrary('places')
  const [text, setText] = useState(value?.name ?? '')
  const [suggestions, setSuggestions] = useState([])
  const [searchError, setSearchError] = useState(null)
  const session = useRef(null)
  const timer = useRef(null)
  const asked = useRef('')
  const position = hasPin(value) ? { lat: value.lat, lng: value.lng } : null

  // Keep the box in step when the form resets the value from outside.
  useEffect(() => {
    setText(value?.name ?? '')
  }, [value?.name])

  useEffect(() => () => clearTimeout(timer.current), [])

  function search(input) {
    clearTimeout(timer.current)
    if (!places || input.trim().length < 3) {
      setSuggestions([])
      return
    }
    timer.current = setTimeout(async () => {
      asked.current = input
      try {
        if (!session.current) session.current = new places.AutocompleteSessionToken()
        const { suggestions: found } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: session.current })
        if (asked.current !== input) return
        setSuggestions(found.map((s) => s.placePrediction).filter(Boolean))
        setSearchError(null)
      } catch (err) {
        setSuggestions([])
        setSearchError(err.message?.includes('API') ? 'Google search isn\'t working right now. Type the name and click the map to drop the pin.' : err.message)
      }
    }, 250)
  }

  async function pick(placeId) {
    const prediction = suggestions.find((p) => p.placeId === placeId)
    if (!prediction) return
    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] })
      session.current = null // One search session ends with one pick.
      const name = place.displayName || prediction.mainText?.text || prediction.text.text
      setText(name)
      setSuggestions([])
      onChange({ name, address: place.formattedAddress || '', lat: place.location?.lat() ?? null, lng: place.location?.lng() ?? null, placeId: place.id || placeId })
    } catch (err) {
      setSearchError(err.message)
    }
  }

  function typed(next) {
    if (suggestions.some((p) => p.placeId === next)) return // AutoComplete reports the picked option's value too.
    setText(next)
    // Renaming keeps the pin, so "Main hall, Eastside Leisure Centre" can stay on the same spot.
    onChange(next ? { name: next, address: value?.address ?? '', lat: value?.lat ?? null, lng: value?.lng ?? null, placeId: value?.placeId ?? '' } : null)
    search(next)
  }

  function dropPin(latLng) {
    if (!latLng) return
    const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat
    const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng
    // A dropped pin is no longer Google's place, so its id goes; the name and address stay as typed.
    onChange({ name: value?.name || text || 'Pinned location', address: value?.address ?? '', lat, lng, placeId: '' })
  }

  const options = useMemo(
    () =>
      suggestions.map((p) => ({
        value: p.placeId,
        label: (
          <div className="place-option">
            <Text strong>{p.mainText?.text ?? p.text.text}</Text>
            {p.secondaryText?.text && <Text type="secondary">{p.secondaryText.text}</Text>}
          </div>
        ),
      })),
    [suggestions],
  )

  return (
    <div className="location-input">
      <AutoComplete
        id={id}
        value={text}
        options={options}
        onChange={typed}
        onSelect={pick}
        showSearch={{ filterOption: false }}
        allowClear
        placeholder={placeholder}
        popupMatchSelectWidth
        notFoundContent={text.trim().length >= 3 && places ? 'No places found. Keep typing, or click the map to drop a pin.' : null}
      >
        <Input prefix={<EnvironmentOutlined aria-hidden />} />
      </AutoComplete>
      {searchError && <Text type="danger">{searchError}</Text>}
      <MapBoundary>
      <div className="location-map">
        <Map
          mapId={GOOGLE_MAPS_MAP_ID}
          defaultCenter={position ?? START}
          defaultZoom={position ? PIN_ZOOM : 10}
          gestureHandling="cooperative"
          clickableIcons={false}
          streetViewControl={false}
          mapTypeControl={false}
          onClick={(e) => dropPin(e.detail.latLng)}
        >
          {position && (
            <AdvancedMarker position={position} draggable title={value?.name} onDragEnd={(e) => dropPin(e.latLng)}>
              <GoldPin />
            </AdvancedMarker>
          )}
          <FollowPin position={position} />
        </Map>
      </div>
      </MapBoundary>
      <Muted>
        <AimOutlined aria-hidden /> {position ? 'Drag the pin, or click the map, to move it to the exact door.' : 'Pick a place from the list to drop the pin, or click the map.'}
      </Muted>
      {value?.address && <Text type="secondary">{value.address}</Text>}
    </div>
  )
}

// Shows a location: its name and address, a link that opens Google Maps, and a small map with the pin.
export function LocationView({ location, map = true, empty = '—' }) {
  if (!location) return empty
  const link = mapsLink(location)
  const pinned = hasPin(location)
  return (
    <div className="location-view">
      <Space wrap size={4}>
        <Text>{locationText(location)}</Text>
        <Button type="link" size="small" href={link} target="_blank" rel="noopener noreferrer" icon={<EnvironmentOutlined aria-hidden />}>
          Open in Google Maps
        </Button>
      </Space>
      {map && pinned && mapsEnabled && (
        <MapBoundary>
        <div className="location-map small">
          <Map
            mapId={GOOGLE_MAPS_MAP_ID}
            defaultCenter={{ lat: location.lat, lng: location.lng }}
            defaultZoom={PIN_ZOOM}
            gestureHandling="cooperative"
            disableDefaultUI
            zoomControl
            clickableIcons={false}
          >
            <AdvancedMarker position={{ lat: location.lat, lng: location.lng }} title={location.name}>
              <GoldPin />
            </AdvancedMarker>
            <FollowPin position={{ lat: location.lat, lng: location.lng }} />
          </Map>
        </div>
        </MapBoundary>
      )}
    </div>
  )
}
