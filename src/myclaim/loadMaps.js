// Loads Google Maps JS API dynamically.
// The API key lives in Firebase Secret Manager — it is never in the built source.
// In production, the App Engine proxy (VITE_BACKEND_URL base) serves /api/maps-loader.
const _PROXY_BASE = import.meta.env.VITE_BACKEND_URL
  ? import.meta.env.VITE_BACKEND_URL.replace(/\/api\/backend$/, "")
  : "";
const _MAPS_URL = `${_PROXY_BASE}/api/maps-loader`;

let _promise = null;

export function loadGoogleMaps() {
  if (window.google?.maps?.places) return Promise.resolve();
  if (_promise) return _promise;

  _promise = fetch(_MAPS_URL)
    .then((r) => {
      if (!r.ok) throw new Error("Maps loader returned " + r.status);
      return r.json();
    })
    .then(
      ({ src }) =>
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = src;
          script.async = true;
          script.defer = true;
          script.onload = resolve;
          script.onerror = () => reject(new Error("Failed to load Google Maps"));
          document.head.appendChild(script);
        })
    )
    .catch((err) => {
      _promise = null; // allow retry on next call
      return Promise.reject(err);
    });

  return _promise;
}
