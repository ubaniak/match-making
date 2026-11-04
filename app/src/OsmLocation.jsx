import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { AutoComplete, Input } from 'antd'
import { AimOutlined, EnvironmentOutlined } from '@ant-design/icons'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { hasPin } from './locations'
import { Muted, Text } from './ui'

// The free map: OpenStreetMap tiles drawn with Leaflet (react-leaflet), and place search from Photon
// (photon.komoot.io, OpenStreetMap data). No key, account or card. Used whenever the site has no Google Maps key.

const START = [49.8951, -97.1384] // Winnipeg, where most events are, until a place is picked.
const PIN_ZOOM = 16
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const SEARCH = 'https://photon.komoot.io/api/'

// A gold pin with a navy edge, drawn in CSS (.osm-pin in index.css) so no image files are needed.
const pinIcon = L.divIcon({ className: 'osm-pin', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 30] })

// "Eastside Leisure Centre" / "1200 Main Street, Winnipeg, Manitoba, Canada" from a Photon result.
function describe(feature) {
  const p = feature.properties ?? {}
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const name = p.name || street || p.city || 'Pinned location'
  const address = [street !== name ? street : null, p.city !== name ? p.city : null, p.state, p.postcode, p.country].filter(Boolean).join(', ')
  const [lng, lat] = feature.geometry?.coordinates ?? []
  return { key: `${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lng}`}`, name, address, lat, lng, placeId: '' }
}

async function searchPlaces(text, near) {
  const params = new URLSearchParams({ q: text, limit: '6', lang: 'en' })
  if (near) {
    params.set('lat', String(near.lat))
    params.set('lon', String(near.lng))
  } else {
    params.set('lat', String(START[0]))
    params.set('lon', String(START[1]))
  }
  const response = await fetch(`${SEARCH}?${params}`)
  if (!response.ok) throw new Error('The place search isn\'t answering right now.')
  const data = await response.json()
  return (data.features ?? []).map(describe).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

function FollowPin({ position }) {
  const map = useMap()
  const last = useRef(null)
  useEffect(() => {
    if (!position) return
    const key = `${position.lat},${position.lng}`
    if (last.current === key) return
    const first = last.current === null
    last.current = key
    map.setView([position.lat, position.lng], first || map.getZoom() < 12 ? PIN_ZOOM : map.getZoom())
  }, [map, position])
  return null
}

function ClickToPin({ onPin }) {
  useMapEvents({ click: (e) => onPin(e.latlng) })
  return null
}

export function OsmMap({ position, title, onPin, small }) {
  return (
    <div className={small ? 'location-map small' : 'location-map'}>
      <MapContainer
        center={position ? [position.lat, position.lng] : START}
        zoom={position ? PIN_ZOOM : 11}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={TILES} attribution={ATTRIBUTION} />
        {position && (
          <Marker
            position={[position.lat, position.lng]}
            icon={pinIcon}
            title={title}
            draggable={Boolean(onPin)}
            eventHandlers={onPin ? { dragend: (e) => onPin(e.target.getLatLng()) } : undefined}
          />
        )}
        {onPin && <ClickToPin onPin={onPin} />}
        <FollowPin position={position} />
      </MapContainer>
    </div>
  )
}

// Same value and onChange as the Google version: { name, address, lat, lng, placeId } or null.
export function OsmLocationInput({ value, onChange, id, placeholder, Boundary }) {
  const [text, setText] = useState(value?.name ?? '')
  const [results, setResults] = useState([])
  const [searchError, setSearchError] = useState(null)
  const [searching, setSearching] = useState(false)
  const timer = useRef(null)
  const asked = useRef('')
  const position = hasPin(value) ? { lat: value.lat, lng: value.lng } : null

  useEffect(() => {
    setText(value?.name ?? '')
  }, [value?.name])

  useEffect(() => () => clearTimeout(timer.current), [])

  function search(input) {
    clearTimeout(timer.current)
    if (input.trim().length < 3) {
      setResults([])
      return
    }
    // Photon is a free shared service, so wait until typing pauses before asking.
    timer.current = setTimeout(async () => {
      asked.current = input
      setSearching(true)
      try {
        const found = await searchPlaces(input, position)
        if (asked.current !== input) return
        setResults(found)
        setSearchError(null)
      } catch (err) {
        setResults([])
        setSearchError(`${err.message} Type the name and click the map to drop the pin.`)
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  function pick(key) {
    const place = results.find((p) => p.key === key)
    if (!place) return
    setText(place.name)
    setResults([])
    onChange({ name: place.name, address: place.address, lat: place.lat, lng: place.lng, placeId: '' })
  }

  function typed(next) {
    if (results.some((p) => p.key === next)) return // AutoComplete reports the picked option's value too.
    setText(next)
    // Renaming keeps the pin, so "Main hall, Eastside Leisure Centre" can stay on the same spot.
    onChange(next ? { name: next, address: value?.address ?? '', lat: value?.lat ?? null, lng: value?.lng ?? null, placeId: '' } : null)
    search(next)
  }

  function dropPin(latLng) {
    if (!latLng) return
    onChange({ name: value?.name || text || 'Pinned location', address: value?.address ?? '', lat: latLng.lat, lng: latLng.lng, placeId: '' })
  }

  const options = useMemo(
    () =>
      results.map((p) => ({
        value: p.key,
        label: (
          <div className="place-option">
            <Text strong>{p.name}</Text>
            {p.address && <Text type="secondary">{p.address}</Text>}
          </div>
        ),
      })),
    [results],
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
        notFoundContent={text.trim().length >= 3 && !searching ? 'No places found. Try the street address, or click the map to drop a pin.' : null}
      >
        <Input prefix={<EnvironmentOutlined aria-hidden />} />
      </AutoComplete>
      {searchError && <Text type="danger">{searchError}</Text>}
      {createElement(Boundary, null, <OsmMap position={position} title={value?.name} onPin={dropPin} />)}
      <Muted>
        <AimOutlined aria-hidden /> {position ? 'Drag the pin, or click the map, to move it to the exact door.' : 'Pick a place from the list to drop the pin, or click the map.'}
      </Muted>
      {value?.address && <Text type="secondary">{value.address}</Text>}
    </div>
  )
}
