import { useState, useEffect } from "react";

export function useLocation() {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocalização não suportada pelo navegador.");
      return;
    }

    // "watchPosition" monitora o movimento em tempo real
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        setError(err.message);
      },
      { enableHighAccuracy: true }, // Força o uso do GPS de alta precisão
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return { position, error };
}
