// Loads Google Maps JS API dynamically.
// The API key lives in Firebase Secret Manager — it is never in the built source.
// The /api/maps-loader hosting rewrite proxies to the Cloud Function.

let _promise = null;

export function loadGoogleMaps() {
  if (window.google?.maps?.places) return Promise.resolve();
  if (_promise) return _promise;

  _promise = fetch("/api/maps-loader")
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
