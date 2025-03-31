// Token cache
let cachedToken = null;
let tokenExpiry = null;

// Function to obtain access token
async function getAccessToken() {
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
            'audience': 'https://weather.api.dtn.com/observations'
        })
    });
    const tokenData = await tokenResponse.json();
    
    // Cache the token and set expiry (45 minutes to be safe, even though tokens typically last 1 hour)
    cachedToken = tokenData.data.access_token;
    tokenExpiry = Date.now() + (45 * 60 * 1000); // 45 minutes in milliseconds
    
    return cachedToken;
}

// Function to fetch observations for a station
async function fetchStationObservations(stationCode, parameters) {
    try {
        if (stationCode === 'N/A') {
            return { observations: [], tags: {} };
        }

        const accessToken = await getAccessToken();
        const endTime = new Date().toISOString();
        const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        const queryParams = new URLSearchParams({
            stationCode,
            parameters: parameters.join(','),
            startTime,
            endTime,
            showTags: true
        });

        const response = await fetch(`https://obs.api.dtn.com/v2/observations?${queryParams}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const data = await response.json();
        console.log('Observations:', data);

        if (!data.features || data.features.length === 0) {
            return { observations: [], tags: {} };
        }

        const feature = data.features[0];
        const observations = feature.properties || {};
        const tags = feature.tags || {};
        
        // Convert the time-based properties into an array of observations
        const observationArray = Object.entries(observations)
            .filter(([key]) => !isNaN(new Date(key).getTime()) && key !== 'tags')
            .sort((a, b) => new Date(b[0]) - new Date(a[0]))
            .map(([timestamp, values]) => ({
                timestamp,
                ...values
            }));

        return { observations: observationArray, tags };
    } catch (error) {
        console.error('Error fetching station observations:', error);
        return { observations: [], tags: {} };
    }
}

// Helper function to format relative time
function formatRelativeTime(timestamp) {
    if (!timestamp) return 'N/A';
    
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now - date;
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
                { value: 'airTemp', text: 'Show Temperature' },
                { value: 'surfaceTemp', text: 'Show RST' },
                { value: 'shortWaveRadiation', text: 'Show Radiation' },
                { value: 'precipAcc60Min', text: 'Show Precip' },
                { value: 'relativeHumidity', text: 'Show Humidity' },
                { value: 'name', text: 'Show Names' },
                { value: 'windSpeed', text: 'Show Wind Speed' }
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
                parameters: 'airTemp,windSpeed,windSpeed2m,windDirection,relativeHumidity,surfaceTemp,shortWaveRadiation,globalRadiation60Min,precipAcc60Min'
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
                        } else {
                            value = latestObs[displayMode];
                            if (value !== undefined) {
                                displayValue = displayMode === 'airTemp' ? `${value}°C` : 
                                             displayMode === 'surfaceTemp' ? `${value}°C` :
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
                        <p>Station Code: ${feature.tags?.stationCode || 'N/A'}</p>
                        <p>Observed ${lastObsTime}</p>
                        ${latestValues ? `<p>Latest Observations:<br>${latestValues}</p>` : ''}
                        ${tags ? `<p>Additional Info:<br>${tags}</p>` : ''}
                        <button onclick="window.showObservations('${feature.tags?.stationCode || 'N/A'}', 'airTemp,windSpeed,windDirection,relativeHumidity,surfaceTemp,shortWaveRadiation,globalRadiation60Min,precipAcc60Min');" style="padding: 5px 10px; cursor: pointer;">View Observations</button>
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
window.showObservations = async function(stationCode, paramString) {
    const parameters = paramString.split(',');
    const modal = document.getElementById('obsModal');
    const modalContent = document.getElementById('modalObsContent');
    document.getElementById('modalStationName').textContent = 'Loading...';
    
    // Show loading state
    modalContent.innerHTML = '<p>Loading observations...</p>';
    modal.style.display = 'block';
    
    try {
        const result = await fetchStationObservations(stationCode, parameters);
        
        // Update modal title with station name
        document.getElementById('modalStationName').textContent = result.tags?.name || 'Weather Station';
        
        if (result.observations && result.observations.length > 0) {
            // Display tags first (excluding 'name' tag)
            let tagsHtml = '<div class="station-tags">';
            if (result.tags) {
                Object.entries(result.tags)
                    .filter(([key]) => key !== 'name')
                    .forEach(([key, value]) => {
                        tagsHtml += `<div class="tag"><strong>${key}:</strong> ${value}</div>`;
                    });
            }
            tagsHtml += '</div>';
            
            // Determine which parameters have data
            const availableParams = parameters.filter(param => 
                result.observations.some(obs => obs[param] !== undefined)
            );

            // Create a mapping of parameter names to display names
            const paramDisplayNames = {
                'airTemp': 'Temperature (°C)',
                'surfaceTemp': 'RST (°C)',
                'shortWaveRadiation': 'Radiation (W/m²)',
                'globalRadiation60Min': 'Radiation (J/cm²)',
                'precipAcc60Min': 'Precipitation (mm)',
                'windSpeed': 'Wind Speed (m/s)',
                'windDirection': 'Wind Direction (°)',
                'relativeHumidity': 'Humidity (%)'
            };

            // Create table header only for available parameters
            let tableHtml = '<table class="obs-table"><thead><tr><th>Time (UTC)</th>';
            availableParams.forEach(param => {
                tableHtml += `<th>${paramDisplayNames[param] || param}</th>`;
            });
            tableHtml += '</tr></thead><tbody>';
            
            // Add table rows
            result.observations.forEach(obs => {
                tableHtml += `<tr><td>${formatRelativeTime(obs.timestamp)}</td>`;
                availableParams.forEach(param => {
                    const value = obs[param];
                    let displayValue = '-';
                    if (value !== undefined) {
                        // Special handling for radiation values
                        if (param === 'shortWaveRadiation' || param === 'globalRadiation60Min') {
                            displayValue = value.toFixed(1);
                        } else if (['airTemp', 'surfaceTemp', 'windSpeed'].includes(param)) {
                            displayValue = value.toFixed(1);
                        } else {
                            displayValue = value;
                        }
                    }
                    tableHtml += `<td>${displayValue}</td>`;
                });
                tableHtml += '</tr>';
            });
            
            tableHtml += '</tbody></table>';
            modalContent.innerHTML = tagsHtml + tableHtml;
        } else {
            modalContent.innerHTML = '<p>No observations found for the selected parameters.</p>';
        }
    } catch (error) {
        console.error('Error fetching station observations:', error);
        modalContent.innerHTML = '<p>Error loading observations. Please try again later.</p>';
    }
};
