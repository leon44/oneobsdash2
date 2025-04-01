// Token cache
let cachedObsToken = null;
let cachedForecastToken = null;
let obsTokenExpiry = null;
let forecastTokenExpiry = null;

// Function to obtain access tokens
async function getAccessToken(type = 'observations') {
    const audience = type === 'observations' 
        ? 'https://weather.api.dtn.com/observations'
        : 'https://weather.api.dtn.com/conditions';
    
    const cachedToken = type === 'observations' ? cachedObsToken : cachedForecastToken;
    const tokenExpiry = type === 'observations' ? obsTokenExpiry : forecastTokenExpiry;

    // Check if we have a valid cached token
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    // If not, request a new token
    const tokenResponse = await fetch('https://api.auth.dtn.com/v1/tokens/authorize', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            'grant_type': 'client_credentials',
            'client_id': 'Nv9sG40T9qR2uxaOABSYyt5MATtgCBwE',
            'client_secret': '4M_9P-lm78JvJJ9suV-p3b2oJatPYj5DWdp7P1hbRVM2H5epEsf6gpOWFNt2_U1X',
            'audience': audience
        })
    });
    const tokenData = await tokenResponse.json();
    console.log('Token response for', type, ':', tokenData);
    
    // Cache the token and set expiry (45 minutes to be safe, even though tokens typically last 1 hour)
    if (type === 'observations') {
        cachedObsToken = tokenData.data.access_token;
        obsTokenExpiry = Date.now() + (45 * 60 * 1000); // 45 minutes in milliseconds
        return cachedObsToken;
    } else {
        // Both APIs return token in data object
        cachedForecastToken = tokenData.data.access_token;
        forecastTokenExpiry = Date.now() + (45 * 60 * 1000);
        return cachedForecastToken;
    }
}

// Function to fetch forecast data
async function fetchForecastData(lat, lon, startTime, parameters) {
    try {
        console.log('Getting conditions token...');
        const accessToken = await getAccessToken('conditions');
        console.log('Got conditions token:', accessToken);
        
        // Calculate start and end times
        // Start time is 12 hours ago
        const start = new Date(Date.now() - 12 * 60 * 60 * 1000);
        //start.setMinutes(start.getMinutes() - start.getTimezoneOffset()); // Convert to UTC
        // End time is 24 hours into the future
        const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
        //endTime.setMinutes(endTime.getMinutes() - endTime.getTimezoneOffset()); // Convert to UTC

        // Map observation parameters to conditions parameters
        // Note: surfaceTemp is not available in conditions API
        const parameterMap = {
            // Temperature parameters
            'airTemp': 'airTemp',
            'airTempLowerBound': 'airTempLowerBound',
            'airTempUpperBound': 'airTempUpperBound',
            'relativeHumidity': 'relativeHumidity',
            // Wind parameters
            'windSpeed': 'windSpeed',
            'windSpeed2m': 'windSpeed2m',
            'windSpeedLowerBound': 'windSpeedLowerBound',
            'windSpeedUpperBound': 'windSpeedUpperBound',
            'windDirection': 'windDirection',
            // Radiation parameters
            'shortWaveRadiation': 'shortWaveRadiation',
            'globalRadiation60Min': 'globalRadiation',
            'sunshine60Min': 'sunshineDuration',
            'cloudCover': 'totalCloudCover'
        };

        const conditionsParams = parameters
            .map(p => parameterMap[p])
            .filter(p => p); // Remove undefined mappings

        // Build query parameters
        const queryParams = new URLSearchParams();
        queryParams.append('lat', lat);
        queryParams.append('lon', lon);
        queryParams.append('startTime', start.toISOString());
        queryParams.append('endTime', endTime.toISOString());
        // Add each parameter individually
        conditionsParams.forEach(param => {
            queryParams.append('parameters', param);
        });

        const url = `https://weather.api.dtn.com/v2/conditions?${queryParams}`;
        console.log('Fetching forecast data from:', url);
        console.log('Using token:', accessToken);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const data = await response.json();
        console.log('Forecast data response:', data);

        // Transform the timestamped properties into an array of forecasts
        const properties = data.features?.[0]?.properties || {};
        const forecasts = Object.entries(properties)
            .map(([timestamp, values]) => ({
                timestamp,
                ...values
            }))
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        return {
            forecasts,
            startTime: start,
            endTime: endTime
        };
    } catch (error) {
        console.error('Error fetching forecast data:', error);
        return { forecasts: [], startTime: null, endTime: null };
    }
}

// Function to fetch observations for a station
async function fetchStationObservations(stationCode, parameters) {
    try {
        console.log('Fetching observations for station:', stationCode);
        if (stationCode === 'N/A') {
            return { observations: [], tags: {} };
        }

        const accessToken = await getAccessToken('observations');
        const endTime = new Date().toISOString();
        const startTime = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
        
        const queryParams = new URLSearchParams({
            stationCode,
            parameters: parameters.join(','),
            startTime,
            endTime,
            showTags: true
        });

        console.log('Fetching observations with params:', queryParams.toString());
        const response = await fetch(`https://obs.api.dtn.com/v2/observations?${queryParams}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response from observations API:', errorText);
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const data = await response.json();
        console.log('Raw observation response:', JSON.stringify(data, null, 2));

        if (!data.features || data.features.length === 0) {
            return { observations: [], tags: {} };
        }

        const feature = data.features[0];
        const properties = feature.properties || {};
        const tags = feature.tags || {};
        
        // Convert the time-based properties into an array of observations
        const observationArray = Object.entries(properties)
            .filter(([key]) => !isNaN(new Date(key).getTime()) && key !== 'tags')
            .sort((a, b) => new Date(b[0]) - new Date(a[0]))
            .map(([timestamp, values]) => ({
                timestamp,
                ...values
            }));

        return {
            ...data, // Include the full GeoJSON response
            observations: observationArray,
            tags
        };
    } catch (error) {
        console.error('Error fetching station observations:', error.message);
        console.error('Full error:', error);
        return { observations: [], tags: {} };
    }
}

// Helper function to format relative time
function formatRelativeTime(timestamp) {
    if (!timestamp) return 'N/A';
    
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now - date;
    
    // If it's a future timestamp, just show the timestamp
    if (diffMs < 0) {
        return date.toISOString();
    }
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    
    // For anything over 60 minutes, show full UTC timestamp
    return date.toISOString();
}

// Global variables for filters
let timePicker;

document.addEventListener('DOMContentLoaded', () => {
    // Modal close functionality
    const modal = document.getElementById('obsModal');
    const closeBtn = document.querySelector('.close');

    closeBtn.onclick = function() {
        modal.style.display = 'none';
    }

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    }

    // Create a custom icon for weather stations
    const stationIcon = L.icon({
        iconUrl: 'lib/leaflet/marker-icon-2x.png',
        shadowUrl: 'lib/leaflet/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });
    // Initialize map with a temporary view (will be updated with geolocation)
    const map = L.map('map', {
        minZoom: 7,  // Prevent zooming out further than level 7
        zoom: 11  // Default zoom level when location is found
    }).setView([51.25, 0.25], 11); // Temporary view

    // Add tile layer immediately
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: ' OpenStreetMap'
    }).addTo(map);

    // Add title control
    const TitleControl = L.Control.extend({
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-control title-control');
            container.innerHTML = `
                <div style="font-size: 16px; font-weight: bold; white-space: nowrap;">OneObs Dash V2</div>
                <div style="font-size: 12px; color: #666; white-space: nowrap;">Vibe coded by Claude 3.5 & Leon</div>
            `;
            return container;
        }
    });

    new TitleControl({ position: 'topleft' }).addTo(map);

    // Try to get user's location
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            // Success callback
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                map.setView([lat, lng], map.getZoom());
                fetchStationData(); // Refresh stations for new location
            },
            // Error callback
            () => {
                // Fallback to default location if geolocation fails
                fetchStationData();
            }
        );
    } else {
        // Fallback for browsers without geolocation
        fetchStationData();
    }

    // Set up dynamic bounds with 9 degree size
    const boundSize = 4.5; // Half of 9 degrees

    function updateMaxBounds() {
        const center = map.getCenter();
        const southWest = L.latLng(
            Math.max(-90, center.lat - boundSize),
            Math.max(-180, center.lng - boundSize)
        );
        const northEast = L.latLng(
            Math.min(90, center.lat + boundSize),
            Math.min(180, center.lng + boundSize)
        );
        const bounds = L.latLngBounds(southWest, northEast);
        map.setMaxBounds(bounds);
    }

    // Set bounds initially and every time the user pans
    updateMaxBounds();
    map.on('moveend', updateMaxBounds);

    // Keep references to filter elements
    let stationTypeFilter = null;
    let displayModeFilter = null;

    // Create a custom control for the station type filter
    const StationFilterControl = L.Control.extend({
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control filter-control');
            const select = L.DomUtil.create('select', '', container);
            select.id = 'station-type-filter';

            const options = [
                { value: 'all', text: 'All Stations' },
                { value: 'wmo', text: 'WMO Stations' }
            ];

            options.forEach(opt => {
                const option = L.DomUtil.create('option', '', select);
                option.value = opt.value;
                option.textContent = opt.text;
            });

            // Store reference to the select element
            stationTypeFilter = select;

            // Prevent map zoom when scrolling the select
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);

            // Add change event listener to update the map
            select.addEventListener('change', (e) => {
                console.log('Filter changed to:', e.target.value);
                fetchStationData();
            });

            return container;
        }
    });

    // Create a custom control for time picker
    const TimePickerControl = L.Control.extend({
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control time-picker-control');
            
            // Add datetime picker for UTC time
            const timeInput = L.DomUtil.create('input', '', container);
            timeInput.type = 'datetime-local';
            timeInput.id = 'time-picker';
            // Set min date to 1990 UTC
            timeInput.min = '1990-01-01T00:00';
            // Set max date and default to current UTC time
            const now = new Date();
            const utcString = now.toISOString();
            const maxTime = utcString.slice(0, 16);
            timeInput.max = maxTime;
            timeInput.value = maxTime;
            

            
            // Prevent future dates (in case of manual entry)
            timeInput.addEventListener('input', () => {
                const selectedTime = new Date(timeInput.value + 'Z');
                const currentTime = new Date();
                if (selectedTime > currentTime) {
                    timeInput.value = maxTime;
                }
            });

            // Store reference to the time picker
            timePicker = timeInput;
            
            return container;
        }
    });

    // Create a custom control for display mode
    const DisplayModeControl = L.Control.extend({
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control display-control');
            const select = L.DomUtil.create('select', '', container);
            select.id = 'display-mode-filter';

            const options = [
                { value: 'visibility', text: 'Show Visibility' },
                { value: 'wmoWeatherCode', text: 'Show Weather Code' },
                { value: 'airTemp', text: 'Show Temperature' },
                { value: 'surfaceTemp', text: 'Show RST' },
                { value: 'shortWaveRadiation', text: 'Show Radiation' },
                { value: 'precipAcc60Min', text: 'Show Precip' },
                { value: 'relativeHumidity', text: 'Show Humidity' },
                { value: 'name', text: 'Show Names' },
                { value: 'windSpeed', text: 'Show Wind Speed' },
                { value: 'windGust', text: 'Show Wind Gust' }
            ];

            options.forEach(opt => {
                const option = L.DomUtil.create('option', '', select);
                option.value = opt.value;
                option.textContent = opt.text;
                if (opt.value === 'airTemp') {
                    option.selected = true;
                }
            });

            // Store reference to the select element
            displayModeFilter = select;

            // Prevent map zoom when scrolling the select
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);

            // Add change event listener to update the map
            select.addEventListener('change', () => fetchStationData());

            return container;
        }
    });

    // Add the controls to the map
    new StationFilterControl({ position: 'topright' }).addTo(map);
    new TimePickerControl({ position: 'topright' }).addTo(map);
    new DisplayModeControl({ position: 'topright' }).addTo(map);

    // Function to fetch weather station data
    async function fetchStationData() {
        try {
            const accessToken = await getAccessToken();
            const bounds = map.getBounds();
            const filterValue = stationTypeFilter ? stationTypeFilter.value : 'all';
            console.log('Current filter value:', filterValue, 'from select:', stationTypeFilter);
            
            // Calculate time range based on time picker (already in UTC)
            const selectedTime = new Date(timePicker.value + 'Z'); // Add Z to indicate UTC
            // Add 60 seconds to selected time for endTime
            const endTime = new Date(selectedTime.getTime() + 60000).toISOString();
            // Start time is 90 minutes before selected time
            const startTime = new Date(selectedTime.getTime() - 90 * 60 * 1000).toISOString();
            
            // Build base query parameters
            const params = {
                by: 'boundingBox',
                minLat: bounds.getSouth(),
                maxLat: bounds.getNorth(),
                minLon: bounds.getWest(),
                maxLon: bounds.getEast(),
                startTime,
                endTime,
                showTags: true,
                showLatest: true,
                interval: '1h',
                parameters: 'airTemp,windSpeed,windSpeed2m,windDirection,relativeHumidity,surfaceTemp,shortWaveRadiation,globalRadiation60Min,precipAcc60Min,visibility,wmoWeatherCode,windGust,windGust2m'
            };

            // Add obsTypes parameter only for WMO stations
            console.log('Checking filter value for WMO:', filterValue === 'wmo');
            if (filterValue === 'wmo') {
                params.obsTypes = 'SYNOP,METAR';
                console.log('Added obsTypes parameter');
            }

            const queryParams = new URLSearchParams(params);

            const url = `https://obs.api.dtn.com/v2/observations?${queryParams}`;
            console.log('Final URL parameters:', Object.fromEntries(queryParams.entries()));
            console.log('Fetching from URL:', url);
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            const data = await response.json();
            
            // Clear existing markers
            map.eachLayer((layer) => {
                if (layer instanceof L.Marker) {
                    map.removeLayer(layer);
                }
            });

            // Add new markers
            data.features.forEach(feature => {
                const coords = feature.geometry.coordinates;
                const props = feature.properties;
                
                // Get timestamps that are actual observations (not tags or metadata)
                const timestamps = Object.keys(props)
                    .filter(key => key !== 'tags' && !isNaN(new Date(key).getTime()))
                    .sort();
                const lastObsTimestamp = timestamps[timestamps.length - 1];
                const latestObs = props[lastObsTimestamp] || {};

                // Get display mode and create appropriate marker
                const displayMode = displayModeFilter ? displayModeFilter.value : 'name';
                let marker;

                // Create a div icon with the appropriate value
                let value;
                let displayValue;
                
                if (displayMode === 'name') {
                    value = feature.tags?.name;
                    displayValue = value || 'Unnamed Station';
                } else {
                    if (displayMode === 'shortWaveRadiation') {
                        // Try shortWaveRadiation first, fall back to globalRadiation60Min
                        value = latestObs.shortWaveRadiation;
                        if (value === undefined) {
                            value = latestObs.globalRadiation60Min;
                            displayValue = value !== undefined ? `${value}J/cm²` : undefined;
                        } else {
                            displayValue = `${value}W/m²`;
                        }
                    } else {
                        if (displayMode === 'windSpeed') {
                            // Try windSpeed first, fall back to windSpeed2m
                            value = latestObs.windSpeed;
                            if (value === undefined) {
                                value = latestObs.windSpeed2m;
                            }
                            displayValue = value !== undefined ? `${value}m/s` : undefined;
                        } else if (displayMode === 'windGust') {
                            // Try windGust first, fall back to windGust2m
                            value = latestObs.windGust;
                            if (value === undefined) {
                                value = latestObs.windGust2m;
                            }
                            displayValue = value !== undefined ? `${value}m/s` : undefined;
                        } else {
                            value = latestObs[displayMode];
                            if (value !== undefined) {
                                displayValue = displayMode === 'airTemp' ? `${value}°C` : 
                                             displayMode === 'surfaceTemp' ? `${value}°C` :
                                             displayMode === 'visibility' ? `${value}km` :
                                             displayMode === 'precipAcc60Min' ? `${value}mm` : value;
                            }
                        }
                    }
                }

                let divIcon;
                if (value !== undefined) {
                    // Station has the value - show full pin with value
                    divIcon = L.divIcon({
                        className: 'value-marker',
                        html: `
                            <div style="position: relative; width: 100%; height: 100%;">
                                <div style="
                                    position: absolute;
                                    bottom: 20px;
                                    left: 50%;
                                    transform: translateX(-50%);
                                    background: white;
                                    padding: 4px 8px;
                                    border-radius: 8px;
                                    border: 2px solid #2b6cb0;
                                    font-size: 12px;
                                    font-weight: bold;
                                    white-space: nowrap;
                                    text-align: center;
                                    min-width: 24px;
                                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                    color: #2b6cb0;">
                                    ${displayValue}
                                </div>
                                <div style="
                                    position: absolute;
                                    bottom: 0;
                                    left: 50%;
                                    transform: translateX(-50%);
                                    width: 2px;
                                    height: 20px;
                                    background: #2b6cb0;">
                                </div>
                                <div style="
                                    position: absolute;
                                    bottom: 0;
                                    left: 50%;
                                    transform: translate(-50%, 50%);
                                    width: 8px;
                                    height: 8px;
                                    background: #2b6cb0;
                                    border-radius: 50%;">
                                </div>
                            </div>
                        `,
                        iconSize: [40, 40],
                    });
                } else {
                    // Station doesn't have the value - show small dot
                    divIcon = L.divIcon({
                        className: 'value-marker',
                        html: `
                            <div style="
                                width: 8px;
                                height: 8px;
                                background: #2b6cb0;
                                border-radius: 50%;
                            "></div>
                        `,
                        iconSize: [8, 8],
                        iconAnchor: [4, 4]
                    });
                }

                marker = L.marker([coords[1], coords[0]], { icon: divIcon });

                marker.addTo(map);
                const popup = L.popup();

                // Create popup content with button
                // Format the last observation timestamp and get latest values
                const lastObsTime = formatRelativeTime(lastObsTimestamp);
                
                // Get all tags except 'name' and 'stationCode' which we show separately
                const tags = Object.entries(feature.tags || {})
                    .filter(([key]) => !['name', 'stationCode'].includes(key))
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('<br>');
                
                // Format latest observations
                const latestValues = [
                    latestObs.airTemp !== undefined ? `Temperature: ${latestObs.airTemp}°C` : null,
                    latestObs.windSpeed !== undefined ? `Wind: ${latestObs.windSpeed} m/s` : null,
                    latestObs.windDirection !== undefined ? `Direction: ${latestObs.windDirection}°` : null,
                    latestObs.relativeHumidity !== undefined ? `Humidity: ${latestObs.relativeHumidity}%` : null
                ].filter(Boolean).join('<br>');
                
                const popupContent = `
                    <div>
                        <h3>${feature.tags?.name || 'Weather Station'}</h3>
                        <p>${feature.tags?.stationCode || 'N/A'}</p>
                        ${latestValues ? `<p>Observed ${lastObsTime}:<br>${latestValues}</p>` : ''}
                        ${tags ? `<p>Additional Info:<br>${tags}</p>` : ''}
                        <button onclick="window.showObservations('${feature.tags?.stationCode || 'N/A'}', '${currentGroup}');" style="padding: 5px 10px; cursor: pointer;">View Data</button>
                    </div>
                `;

                popup.setContent(popupContent);
                marker.bindPopup(popup);
            });
        } catch (error) {
            console.error('Error fetching observations:', error);
        }
    }


    // Update stations when map moves
    map.on('moveend', fetchStationData);

    // Initial fetch
    fetchStationData();
});

// Global function to show observations in modal
// Helper function to generate random colors for chart lines
function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Parameter groups configuration
const parameterGroups = {
    'General': {
        observations: ['visibility', 'wmoWeatherCode'],
        conditions: ['visibility', 'wmoWeatherCode'],
        units: {
            'visibility': 'km',
            'wmoWeatherCode': ''
        }
    },
    'Temperature': {
        observations: ['airTemp', 'surfaceTemp', 'relativeHumidity'],
        conditions: ['airTemp', 'airTempLowerBound', 'airTempUpperBound', 'relativeHumidity'],
        units: {
            'airTemp': '°C',
            'airTempLowerBound': '°C',
            'airTempUpperBound': '°C',
            'surfaceTemp': '°C',
            'relativeHumidity': '%'
        }
    },
    'Wind': {
        observations: ['windSpeed', 'windSpeed2m', 'windDirection', 'windGust', 'windGust2m'],
        conditions: ['windSpeed', 'windSpeedLowerBound', 'windSpeedUpperBound', 'windDirection', 'windSpeed2m', 'windGust', 'windGust2m'],
        units: {
            'windSpeed': 'm/s',
            'windSpeed2m': 'm/s',
            'windDirection': '°',
            'windSpeedLowerBound': 'm/s',
            'windSpeedUpperBound': 'm/s',
            'windGust': 'm/s',
            'windGust2m': 'm/s'
        }
    },
    'Radiation': {
        observations: ['shortWaveRadiation', 'globalRadiation60Min', 'sunshine60Min', 'cloudCover'],
        conditions: ['shortWaveRadiation', 'globalRadiation', 'sunshineDuration', 'totalCloudCover'],
        units: {
            'shortWaveRadiation': 'W/m²',
            'globalRadiation60Min': 'J/cm²',
            'globalRadiation': 'J/cm²',
            'sunshine60Min': 'min',
            'sunshineDuration': 'min',
            'cloudCover': '%',
            'totalCloudCover': '%'
        }
    }
};

// Global variables
let currentChart = null;
let currentGroup = 'Temperature'; // Default group
let currentStationLat = null;
let currentStationLon = null;
let currentStationEarliestTime = null;

// Get all available parameters from all groups
const getAllParameters = () => {
    const obsParams = new Set();
    const condParams = new Set();
    
    Object.values(parameterGroups).forEach(group => {
        group.observations.forEach(param => obsParams.add(param));
        group.conditions.forEach(param => condParams.add(param));
    });
    
    return {
        observations: Array.from(obsParams),
        conditions: Array.from(condParams)
    };
};

window.showObservations = async function(stationCode, paramString) {
    // Get the current group's parameters for display
    const group = parameterGroups[paramString || currentGroup];
    if (!group) {
        throw new Error('Invalid parameter group');
    }
    
    // Get all parameters for fetching data
    const allParams = getAllParameters();
    // Get display parameters from the current group
    const displayObsParams = group.observations || [];
    const displayCondParams = group.conditions || [];
    const modal = document.getElementById('obsModal');
    const modalContent = document.getElementById('modalObsContent');
    const modalChartContent = document.getElementById('modalChartContent');
    const tableViewBtn = document.getElementById('tableViewBtn');
    const chartViewBtn = document.getElementById('chartViewBtn');
    document.getElementById('modalStationName').textContent = 'Loading...';
    
    // Show loading state and clear previous content
    modalContent.innerHTML = '<p>Loading observations...</p>';
    document.getElementById('metadata-section')?.remove(); // Remove any existing metadata section
    modal.style.display = 'block';
    
    try {
        if (!stationCode || stationCode === 'N/A') {
            throw new Error('Invalid station code');
        }

        // Validate parameters
        if (!allParams.observations.length && !allParams.conditions.length) {
            throw new Error('No parameters specified');
        }

        console.log('Fetching observations for station:', stationCode);
        console.log('Observation parameters:', allParams.observations);
        console.log('Forecast parameters:', allParams.conditions);
        
        // Fetch all observations
        const result = await fetchStationObservations(stationCode, allParams.observations);
        
        if (!result) {
            throw new Error('No result returned from fetchStationObservations');
        }
        
        // Initialize modal content with a container for metadata
        const modalTitle = document.getElementById('modalStationName');
        const modalHeader = modalTitle.parentElement;
        modalHeader.insertAdjacentHTML('afterend', `
            <div id="metadata-section">
                <div id="metadata-container"></div>
                <div class="group-selector" style="margin: 15px 0;">
                    <label for="parameterGroup"><strong>Parameter Group:</strong></label>
                    <select id="parameterGroup" style="margin-left: 10px; padding: 5px;">
                        ${Object.keys(parameterGroups).map(group => 
                            `<option value="${group}" ${group === currentGroup ? 'selected' : ''}>${group}</option>`
                        ).join('')}
                    </select>
                </div>
                <hr class="metadata-separator" style="margin: 15px 0;">
            </div>
        `);

        // Get station coordinates and fetch forecast if available
        let forecastData = { forecasts: [] };
        
        // Get station coordinates for forecast
        currentStationLat = result.features?.[0]?.geometry?.coordinates?.[1];
        currentStationLon = result.features?.[0]?.geometry?.coordinates?.[0];
        currentStationEarliestTime = result.observations[0]?.timestamp;
        
        if (currentStationLat && currentStationLon && allParams.conditions.length > 0) {
            try {
                if (currentStationEarliestTime) {
                    forecastData = await fetchForecastData(currentStationLat, currentStationLon, currentStationEarliestTime, allParams.conditions);
                }
            } catch (error) {
                console.warn('Error fetching forecast data:', error);
            }
        }
        
        // Get coordinates from the GeoJSON feature
        const coordinates = result.features?.[0]?.geometry?.coordinates;
        console.log('Coordinates from GeoJSON:', coordinates);
        
        if (coordinates && coordinates.length >= 2) {
            const [longitude, latitude] = coordinates; // GeoJSON uses [longitude, latitude] order
            console.log('Found station coordinates:', latitude, longitude);
            
            // Get the earliest observation time as the start time for forecast
            const observationTimes = result.observations
                .filter(obs => obs && obs.timestamp)
                .map(obs => new Date(obs.timestamp));
            
            if (observationTimes.length > 0) {
                const earliestTime = new Date(Math.min(...observationTimes));
                console.log('Using start time for forecast:', earliestTime);
                
                try {
                    // Use the current group if paramString is not provided
                    const group = parameterGroups[paramString || currentGroup];
                    if (!group) {
                        console.warn('Invalid parameter group:', paramString || currentGroup);
                        return;
                    }
                    
                    // Fetch forecast data with conditions parameters
                    forecastData = await fetchForecastData(
                        latitude,
                        longitude,
                        earliestTime,
                        group.conditions || []
                    );
                    console.log('Received forecast data:', forecastData);
                } catch (error) {
                    console.error('Error fetching forecast data:', error);
                }
            } else {
                console.warn('No valid observation times found for forecast');
            }
        }
        
        if (result.observations && result.observations.length > 0) {
            // Get coordinates from the GeoJSON feature
            const coordinates = result.features?.[0]?.geometry?.coordinates;
            const [longitude, latitude] = coordinates || [null, null];

            // Create metadata section
            const metadata = [
                ...((latitude && longitude) ? [['Location', `${latitude.toFixed(4)}°N, ${longitude.toFixed(4)}°E`]] : []),
                ...Object.entries(result.tags || {}).filter(([key]) => key !== 'name')
            ];
            
            // First update the station name and metadata
            document.getElementById('modalStationName').textContent = result.tags?.name || 'Weather Station';
            
            let metadataHtml = '<div class="station-metadata">';
            metadata.forEach(([key, value]) => {
                metadataHtml += `<div class="metadata-item"><strong>${key}:</strong> ${value}</div>`;
            });
            metadataHtml += '</div>';
            document.getElementById('metadata-container').innerHTML = metadataHtml;
            
            // Add event listener for group selection
            const groupSelect = document.getElementById('parameterGroup');
            groupSelect.addEventListener('change', async (event) => {
                currentGroup = event.target.value;
                const newGroup = parameterGroups[currentGroup];
                
                // Refetch forecast data if we have station coordinates
                if (currentStationLat && currentStationLon && currentStationEarliestTime) {
                    try {
                        forecastData = await fetchForecastData(currentStationLat, currentStationLon, currentStationEarliestTime, allParams.conditions);
                    } catch (error) {
                        console.warn('Error fetching forecast data:', error);
                    }
                }
                
                updateDisplay(result, forecastData, currentGroup, newGroup.observations, newGroup.conditions);
            });

            // Initial display with current group
            updateDisplay(result, forecastData, currentGroup, displayObsParams, displayCondParams);
        }
    } catch (error) {
        console.error('Error:', error);
        modalContent.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    }
};

// Function to update the display based on selected group
function updateDisplay(result, forecastData, group, displayObsParams, displayCondParams) {
    const modalContent = document.getElementById('modalObsContent');
    const modalChartContent = document.getElementById('modalChartContent');
    
    if (!result.observations || result.observations.length === 0) {
        modalContent.innerHTML = '<p>No observations available</p>';
        return;
    }

    // Get parameters for the selected group
    const groupConfig = parameterGroups[group];
    
    // Get available observation parameters from display parameters
    const availableObsParams = displayObsParams.filter(param => 
        result.observations.some(obs => obs[param] !== undefined)
    );

    // Get available condition parameters from display parameters
    const availableCondParams = displayCondParams.filter(param => 
        forecastData.forecasts?.some(f => f[param] !== undefined)
    );

    if (availableObsParams.length === 0 && availableCondParams.length === 0) {
        modalContent.innerHTML = '<p>No data available for the selected parameter group</p>';
        return;
    };

    // Create a mapping of parameter names to display names
    const paramDisplayNames = {};
    Object.entries(parameterGroups).forEach(([group, config]) => {
        (config.observations || []).forEach(param => {
            paramDisplayNames[param] = `obs ${param} ${config.units[param]}`;
        });
        (config.conditions || []).forEach(param => {
            paramDisplayNames[param] = `fx ${param} ${config.units[param]}`;
        });
    });

    // Combine observations and forecasts
    const allData = [
        ...result.observations.map(obs => ({ ...obs, type: 'observation' })),
        ...(forecastData.forecasts || []).map(forecast => ({ ...forecast, type: 'forecast' }))
    ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));



    // Create table HTML
    modalContent.innerHTML = generateTableHtml(availableObsParams, availableCondParams, result, forecastData);

    // Setup chart data
    window.currentChartData = setupChartData(result, forecastData, availableObsParams, availableCondParams);

    // If chart view is active, update the chart
    if (chartViewBtn?.classList.contains('active')) {
        // Destroy previous chart if it exists
        if (currentChart) {
            currentChart.destroy();
        }

        // Create new chart
        const ctx = document.getElementById('obsChart').getContext('2d');
        currentChart = new Chart(ctx, {
            type: 'line',
            data: window.currentChartData,
            options: chartOptions
        });
    }
}

// Add styles
const addStyles = () => {
    const styleTag = document.createElement('style');
    styleTag.textContent = `
        #modalChartContent {
            height: 400px;
            width: 100%;
            padding: 10px;
        }

        .station-metadata {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin: 15px 0 10px;
        }
        .metadata-item {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 8px 12px;
        }
        .obs-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        .obs-table th,
        .obs-table td {
            padding: 8px;
            text-align: right;
            border: 1px solid #ddd;
        }
        .obs-table th:first-child,
        .obs-table td:first-child {
            text-align: left;
        }
        .obs-table thead tr:first-child th {
            background-color: #f5f5f5;
            position: sticky;
            top: 0;
            z-index: 2;
            border-bottom: none;
        }
        .obs-table thead tr:last-child th {
            background-color: #f5f5f5;
            position: sticky;
            top: 37px;
            z-index: 2;
        }
        .obs-table thead tr:first-child th[rowspan="2"] {
            z-index: 3;
        }
        .obs-table td.observation {
            background-color: #fff;
        }
        .obs-table td.forecast {
            background-color: #f0f8ff;
        }
        .obs-table .obs-header {
            background-color: #e3f2fd;
            font-weight: bold;
        }

        .obs-table .forecast-header {
            background-color: #fff3e0;
            font-weight: bold;
        }

        .obs-table thead tr:nth-child(2) th,
        .obs-table thead tr:nth-child(3) th {
            background-color: #f5f5f5;
        }
        .obs-table-container {
            max-height: 500px;
            overflow-y: auto;
            margin-top: 10px;
        }
        }
        .forecast {
            background-color: #fff3e0;
        }
        .metadata-separator {
            margin: 15px 0;
            border: 0;
            border-top: 1px solid #dee2e6;
        }
    `;
    document.head.appendChild(styleTag);
};

document.addEventListener('DOMContentLoaded', addStyles);

const paramDisplayNames = {
    visibility: 'Visibility (km)',
    wmoWeatherCode: 'WMO Weather Code',
    airTemp: 'Air Temperature (°C)',
    surfaceTemp: 'Surface Temperature (°C)',
    relativeHumidity: 'Relative Humidity (%)',
    windSpeed: 'Wind Speed (m/s)',
    windSpeed2m: 'Wind Speed at 2m (m/s)',
    windGust: 'Wind Gust (m/s)',
    windGust2m: 'Wind Gust at 2m (m/s)',
    windSpeedLowerBound: 'Wind Speed Lower Bound (m/s)',
    windSpeedUpperBound: 'Wind Speed Upper Bound (m/s)',
    windDirection: 'Wind Direction (°)',
    shortWaveRadiation: 'Short Wave Radiation (W/m²)',
    globalRadiation60Min: 'Global Radiation (J/cm²)',
    globalRadiation: 'Global Radiation (J/cm²)',
    sunshine60Min: 'Sunshine Duration (min)',
    sunshineDuration: 'Sunshine Duration (min)',
    cloudCover: 'Cloud Cover (%)',
    totalCloudCover: 'Total Cloud Cover (%)'
};

const generateTableHtml = (obsParams, forecastParams, result, forecastData) => {
    let tableHtml = '<table class="obs-table"><thead>';
    
    // First row: Main column group headers
    tableHtml += '<tr>';
    tableHtml += '<th rowspan="3">Time (UTC)</th>';
    
    // Only show Observations header if there are observation parameters with data
    const hasObsData = obsParams.some(param => 
        result.observations.some(obs => obs[param] !== undefined)
    );
    if (hasObsData) {
        tableHtml += '<th colspan="' + obsParams.length + '" class="obs-header">Observations</th>';
    }
    
    // Only show Forecast header if there are forecast parameters with data
    const hasForecastData = forecastParams.some(param => 
        forecastData.forecasts?.some(f => f[param] !== undefined)
    );
    if (hasForecastData) {
        tableHtml += '<th colspan="' + forecastParams.length + '" class="forecast-header">Forecast</th>';
    }
    
    tableHtml += '</tr>';

    // Second row: parameter names
    tableHtml += '<tr>';
    
    // Only add observation parameter names if there's data
    if (hasObsData) {
        obsParams.forEach(param => {
            const displayName = paramDisplayNames[param]?.split(' (')[0] || param;
            tableHtml += `<th>${displayName}</th>`;
        });
    }
    
    // Only add forecast parameter names if there's data
    if (hasForecastData) {
        forecastParams.forEach(param => {
            const displayName = paramDisplayNames[param]?.split(' (')[0] || param;
            tableHtml += `<th>${displayName}</th>`;
        });
    }
    tableHtml += '</tr>';

    // Third row: units
    tableHtml += '<tr>';
    
    // Only add observation units if there's data
    if (hasObsData) {
        obsParams.forEach(param => {
            const unit = paramDisplayNames[param]?.match(/\((.*?)\)/)?.[1] || '';
            tableHtml += `<th>${unit}</th>`;
        });
    }
    
    // Only add forecast units if there's data
    if (hasForecastData) {
        forecastParams.forEach(param => {
            const unit = paramDisplayNames[param]?.match(/\((.*?)\)/)?.[1] || '';
            tableHtml += `<th>${unit}</th>`;
        });
    }
    tableHtml += '</tr></thead><tbody>';
    
    // Get all unique timestamps
    const allTimestamps = [
        ...new Set([
            ...result.observations.map(obs => obs.timestamp),
            ...(forecastData.forecasts || []).map(f => f.timestamp)
        ])
    ].sort();

    // Generate rows for each timestamp
    allTimestamps.forEach(timestamp => {
        const obs = result.observations.find(o => o.timestamp === timestamp);
        const forecast = forecastData.forecasts?.find(f => f.timestamp === timestamp);
        
        // Check if this row has any data for the current view
        const rowHasObsData = obsParams.some(param => obs?.[param] !== undefined && obs?.[param] !== null);
        const rowHasForecastData = forecastParams.some(param => forecast?.[param] !== undefined && forecast?.[param] !== null);
        
        // Skip row if it has no data for the current view
        if ((!rowHasObsData || !hasObsData) && (!rowHasForecastData || !hasForecastData)) {
            return;
        }
        
        tableHtml += `<tr><td>${formatRelativeTime(timestamp)}</td>`;
        
        // Add observation values if we have any observation data
        if (hasObsData) {
            obsParams.forEach(param => {
                const obsValue = obs?.[param];
                let obsDisplayValue = '-';
                if (obsValue !== undefined && obsValue !== null) {
                    if (param === 'shortWaveRadiation' || param === 'globalRadiation60Min') {
                        obsDisplayValue = obsValue.toFixed(1);
                    } else if (['airTemp', 'surfaceTemp', 'windSpeed'].includes(param)) {
                        obsDisplayValue = obsValue.toFixed(1);
                    } else {
                        obsDisplayValue = obsValue;
                    }
                }
                tableHtml += `<td class="observation">${obsDisplayValue}</td>`;
            });
        }
        
        // Add forecast values if we have any forecast data
        if (hasForecastData) {
            forecastParams.forEach(param => {
                const forecastValue = forecast?.[param];
                let forecastDisplayValue = '-';
                if (forecastValue !== undefined && forecastValue !== null) {
                    if (param === 'shortWaveRadiation' || param === 'globalRadiation') {
                        forecastDisplayValue = forecastValue.toFixed(1);
                    } else if (['airTemp', 'windSpeed'].includes(param)) {
                        forecastDisplayValue = forecastValue.toFixed(1);
                    } else {
                        forecastDisplayValue = forecastValue;
                    }
                }
                tableHtml += `<td class="forecast">${forecastDisplayValue}</td>`;
            });
        }
        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table>';
    return `<div class="obs-table-container">${tableHtml}</div>`;
};

const setupChartData = (result, forecastData, obsParams, forecastParams) => {
    const chartData = {
        labels: [
            ...result.observations.map(obs => new Date(obs.timestamp)),
            ...(forecastData.forecasts || []).map(f => new Date(f.timestamp))
        ],
        datasets: []
    };

    // Add observation datasets
    obsParams.forEach(param => {
        const color = getRandomColor();
        chartData.datasets.push({
            label: `${paramDisplayNames[param] || param} (Observed)`,
            data: result.observations.map(obs => obs[param]),
            borderColor: color,
            fill: false,

        });
    });

    // Add forecast datasets
    if (forecastData.forecasts && forecastData.forecasts.length > 0) {
        forecastParams.forEach(param => {
            const color = getRandomColor();
            chartData.datasets.push({
                label: `${paramDisplayNames[param] || param} (Forecast)`,
                data: Array(result.observations.length).fill(null).concat(
                    forecastData.forecasts.map(f => f[param])
                ),
                borderColor: color,
                borderDash: [5, 5],
                fill: false,
    
            });
        });
    }

    return chartData;
};

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
        x: {
            type: 'time',
            time: {
                unit: 'hour',
                displayFormats: {
                    hour: 'MMM d, HH:mm'
                }
            },
            title: {
                display: true,
                text: 'Time (UTC)'
            }
        },
        y: {
            beginAtZero: false
        }
    },
    plugins: {
        legend: {
            position: 'top'
        }
    },
    elements: {
        point: {
            radius: 3,
            hitRadius: 10,
            hoverRadius: 5
        },
        line: {
            tension: 0.4
        }
    }
};

const createChart = (chartData) => {
    // Destroy existing chart if it exists
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    // Clear the canvas
    const canvas = document.getElementById('obsChart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set canvas size
    canvas.style.height = '400px';
    canvas.style.width = '100%';

    // Create new chart
    currentChart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: chartOptions
    });

    return currentChart;
};

// Global variables for UI elements
let tableViewBtn;
let chartViewBtn;
let modalContent;
let modalChartContent;

// Setup view toggle handlers
const setupViewToggles = () => {
    // Initialize UI elements
    tableViewBtn = document.getElementById('tableViewBtn');
    chartViewBtn = document.getElementById('chartViewBtn');
    modalContent = document.getElementById('modalObsContent');
    modalChartContent = document.getElementById('modalChartContent');

    tableViewBtn.onclick = () => {
        tableViewBtn.classList.add('active');
        chartViewBtn.classList.remove('active');
        modalContent.style.display = 'block';
        modalChartContent.style.display = 'none';
    };

    chartViewBtn.onclick = () => {
        chartViewBtn.classList.add('active');
        tableViewBtn.classList.remove('active');
        modalContent.style.display = 'none';
        modalChartContent.style.display = 'block';
        if (window.currentChartData) {
            createChart(window.currentChartData);
        }
    };

    // Show table view by default
    tableViewBtn.classList.add('active');
    chartViewBtn.classList.remove('active');
    modalContent.style.display = 'block';
    modalChartContent.style.display = 'none';
};

// Add close handlers
const setupCloseHandlers = () => {
    const closeBtn = document.getElementsByClassName('close')[0];
    const modal = document.getElementById('obsModal');
    
    closeBtn.onclick = () => {
        modal.style.display = 'none';
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }
    };

    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
            if (currentChart) {
                currentChart.destroy();
                currentChart = null;
            }
        }
    };
};

// Initialize the application
const init = async () => {
    try {
        // Wait for DOM to be fully loaded
        await new Promise(resolve => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', resolve);
            } else {
                resolve();
            }
        });

        // Initialize UI
        setupViewToggles();
        setupCloseHandlers();

        // Initialize map controls and fetch initial data
        await fetchStationData();
    } catch (error) {
        console.error('Error initializing application:', error);
    }
};

// Start the application
init();
