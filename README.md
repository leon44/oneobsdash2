# OneObs Dash V2

A modern web application for visualizing weather station data using Leaflet maps. Built with JavaScript and the DTN API.

## Features

- Interactive map interface with weather station markers
- Real-time weather observations including temperature, wind, radiation, and precipitation
- UTC time-based historical data viewing
- Dynamic 9-degree view bounds
- Geolocation support for automatic map centering
- Mobile-responsive design

## Local Development

1. Clone the repository
2. Open `index.html` in a web browser
3. Allow location access for automatic map centering (optional)

## Deployment

The application can be deployed using Docker:

1. Build the Docker image:
```bash
docker build -t oneobs-dash .
```

2. Run the container:
```bash
docker run -p 8080:80 oneobs-dash
```

3. Access the application at `http://localhost:8080`

Alternatively, you can deploy to any static web hosting service:

1. Copy all files to your web server:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `lib/` directory

2. Configure your web server to serve the files (nginx configuration provided in `nginx.conf`)

## Technologies

- Leaflet.js for mapping
- DTN API for weather data
- Pure JavaScript/HTML/CSS
- OpenStreetMap tiles
- Docker for containerization
- Nginx for web serving

## Environment Variables

The following environment variables are required for API access:
- `DTN_OBS_TOKEN`: Access token for observations API
- `DTN_FORECAST_TOKEN`: Access token for forecast API

## Credits

Vibe coded by Claude 3.5 & Leon
