// src/hooks/useVessel.ts
import { useState, useEffect } from "react";

export interface VesselData {
  ultima_posicao?: { latitude: number; longitude: number };
  velocidade_knots?: number;
  rumo?: number;
  status?: string;
}

export function useVessel(idBarco: string) {
  // Aqui estamos simulando os dados que virão do Firebase amanhã via Starlink
  const [vesselData, setVesselData] = useState<VesselData | null>({
    ultima_posicao: { latitude: -3.119, longitude: -60.021 }, // Coordenadas de Manaus
    velocidade_knots: 14.2,
    rumo: 90,
    status: "navegando",
  });

  const [loading, setLoading] = useState(false);

  // Amanhã, vamos substituir este código pela conexão real com o Firebase!
  useEffect(() => {
    console.log(`Rastreando barco simulado: ${idBarco}`);
  }, [idBarco]);

  return { vesselData, loading };
}
