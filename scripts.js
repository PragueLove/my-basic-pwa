// --- DOM Elements ---
const mapElement = document.getElementById('map');
const statusElement = document.getElementById('status');
const durationElement = document.getElementById('duration');
const distanceElement = document.getElementById('distance');
const paceElement = document.getElementById('pace');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const resetButton = document.getElementById('resetButton');

// 初始化 Supabase
const SUPABASE_URL = "https://your-project-url.supabase.co";
const SUPABASE_KEY = "your-anon-key";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- App State ---
let map = null;
let polyline = null;
let watchId = null;
let isTracking = false;
let startTime = null;
let positions = []; // Array to store {lat, lng, timestamp}
let totalDistance = 0; // in kilometers
let durationInterval = null;

// --- Leaflet Map Initialization ---
function initializeMap() {
    // Initial coordinates (e.g., center of a city, or user's first known location)
    const initialCoords = [51.505, -0.09]; // London coordinates
    map = L.map(mapElement).setView(initialCoords, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    polyline = L.polyline([], { color: 'blue' }).addTo(map);

    // Try to get initial user location to center map
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 16);
        }, err => {
            console.warn(`Could not get initial position: ${err.message}`);
        });
    }
}

// --- Tracking Logic ---
function startTracking() {
    if (!('geolocation' in navigator)) {
        alert('Geolocation is not supported by your browser.');
        return;
    }

    isTracking = true;
    startTime = Date.now();
    positions = [];
    totalDistance = 0;

    updateUIState();
    statusElement.textContent = 'Tracking...';
    startDurationTimer();

    const options = {
        enableHighAccuracy: true,
        timeout: 10000, // 10 seconds
        maximumAge: 0 // Don't use cached position
    };

    watchId = navigator.geolocation.watchPosition(
        handlePositionUpdate,
        handleGeolocationError,
        options
    );
}

function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    isTracking = false;
    updateUIState();
    stopDurationTimer();
    statusElement.textContent = 'Paused';
}

function resetTracking() {
    stopTracking();
    startTime = null;
    positions = [];
    totalDistance = 0;
    polyline.setLatLngs([]); // Clear the line on the map
    durationElement.textContent = '00:00:00';
    distanceElement.textContent = '0.00';
    paceElement.textContent = '--:--';
    statusElement.textContent = 'Idle';
    updateUIState(); // Enable start, disable others if needed
}

function handlePositionUpdate(position) {
    const { latitude, longitude, accuracy } = position.coords;
    const timestamp = position.timestamp;

    // Optional: Filter out inaccurate points
    // if (accuracy > 50) {
    //     console.log(`Skipping inaccurate point (accuracy: ${accuracy}m)`);
    //     return;
    // }

    const newPoint = { lat: latitude, lng: longitude, timestamp: timestamp };
    positions.push(newPoint);

    // Update map polyline
    const latLng = [latitude, longitude];
    polyline.addLatLng(latLng);

    // Center map on the new position (optional, can be annoying)
     map.setView(latLng, map.getZoom()); // Adjust zoom level as needed

    // Calculate distance from the previous point
    if (positions.length > 1) {
        const prevPoint = positions[positions.length - 2];
        totalDistance += calculateDistance(
            prevPoint.lat, prevPoint.lng,
            newPoint.lat, newPoint.lng
        );
    }

    // Update UI metrics
    distanceElement.textContent = totalDistance.toFixed(2);
    updatePace();
}

function handleGeolocationError(error) {
    console.error('Geolocation error:', error);
    stopTracking(); // Stop if there's an error
    statusElement.textContent = `Error: ${error.message}`;
    alert(`Geolocation Error: ${error.message}`);
}

// --- UI Updates & Timers ---
function updateUIState() {
    startButton.disabled = isTracking;
    stopButton.disabled = !isTracking;
    resetButton.disabled = positions.length === 0 && !isTracking;
}

function startDurationTimer() {
    if (durationInterval) clearInterval(durationInterval); // Clear existing timer

    durationInterval = setInterval(() => {
        if (!startTime) return;
        const elapsedMs = Date.now() - startTime;
        durationElement.textContent = formatDuration(elapsedMs);
        updatePace(); // Pace depends on duration
    }, 1000);
}

function stopDurationTimer() {
    clearInterval(durationInterval);
    durationInterval = null;
}

function updatePace() {
    if (totalDistance > 0 && startTime) {
        const elapsedMs = Date.now() - startTime;
        const msPerKm = elapsedMs / totalDistance;
        paceElement.textContent = formatPace(msPerKm);
    } else {
        paceElement.textContent = '--:--';
    }
}


// --- Helper Functions ---

// Calculate distance between two lat/lng points using Haversine formula (in kilometers)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in km
    return distance;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// Format duration from milliseconds to HH:MM:SS
function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Format pace from milliseconds per km to MM:SS min/km
function formatPace(msPerKm) {
    if (!isFinite(msPerKm) || msPerKm <= 0) {
        return '--:--';
    }
    const totalSecondsPerKm = Math.floor(msPerKm / 1000);
    const minutes = Math.floor(totalSecondsPerKm / 60);
    const seconds = totalSecondsPerKm % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}


// --- Initialization ---
window.addEventListener('load', () => {
    initializeMap();
    updateUIState(); // Set initial button states

    // Add event listeners
    startButton.addEventListener('click', startTracking);
    stopButton.addEventListener('click', stopTracking);
    resetButton.addEventListener('click', resetTracking);

    // --- PWA Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(error => {
                console.log('ServiceWorker registration failed: ', error);
            });
    } else {
        console.log('Service Worker not supported by this browser.');
    }
});
