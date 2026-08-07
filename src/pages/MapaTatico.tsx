import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { APIProvider, AdvancedMarker, Map, useMap } from "@vis.gl/react-google-maps";
import BarcoIcon from "../assets/BarcoIcon.jsx";
import { db } from "../config/firebase";

const LIMITE_ONLINE_MS = 90 * 1000;
const LIMITE_SEM_SINAL_MS = 20 * 60 * 1000;

// Visão limitada para operação Amazonas + Pará.
// Evita o usuário afastar demais o mapa e cair na visão mundial.
const MAPA_LIMITES_AM_PA = {
  north: 6.5,
  south: -10.8,
  west: -75.5,
  east: -45.0,
};

const MAPA_CENTRO_OPERACIONAL = {
  lat: -2.162,
  lng: -56.095,
};

const darkNavStyle = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.text", stylers: [{ visibility: "off" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text",
    stylers: [{ visibility: "on" }],
  },
  { featureType: "water", elementType: "labels.text", stylers: [{ visibility: "on" }] },
];

type Coordenada = {
  lat: number;
  lng: number;
};

type PontoRota = Coordenada & {
  criadoEm?: any;
  criadoEmMs?: number | null;
  velocidade?: number;
};

type EscalaOperacional = {
  index: number;
  nome: string;
  cidade: string;
  coord: Coordenada | null;
  km: number | null;
  tempo: string;
  status: "passou" | "proximo" | "futuro" | "sem_coord";
};

type StatusSinal = "online" | "sem_sinal" | "alerta";

function parseTimestamp(valor: any): number | null {
  if (!valor) return null;

  if (typeof valor?.toDate === "function") {
    const ms = valor.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof valor === "number") {
    return valor < 10000000000 ? valor * 1000 : valor;
  }

  const texto = String(valor).trim();
  if (!texto || texto.startsWith("sem_data")) return null;

  const n = Number(texto);
  if (Number.isFinite(n) && n > 0) {
    return n < 10000000000 ? n * 1000 : n;
  }

  const ms = new Date(texto).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatarData(valor: any) {
  const ms = parseTimestamp(valor);
  if (!ms) return "—";

  return new Date(ms).toLocaleString("pt-BR", {
    timeZone: "America/Santarem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function tempoDesde(valor: any, agora: number) {
  const ms = parseTimestamp(valor);
  if (!ms) return "—";

  const min = Math.max(0, Math.round((agora - ms) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function distanciaKm(a: Coordenada, b: Coordenada) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function tempoViagem(min: number | null) {
  if (!min || !Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}min` : `${h}h`;
}

function zoomPorDistanciaKm(km: number) {
  if (!Number.isFinite(km)) return 11;
  if (km <= 2) return 15;
  if (km <= 8) return 14;
  if (km <= 20) return 13;
  if (km <= 60) return 11;
  if (km <= 150) return 10;
  return 9;
}

function centroEntre(a: Coordenada, b: Coordenada): Coordenada {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}

function statusChegada(proximo: any, velocidade: number) {
  if (!proximo) {
    return {
      label: "Sem rota",
      detalhe: "Rota não identificada",
      classe: "border-slate-500/20 bg-slate-500/10 text-slate-300",
    };
  }

  if (!velocidade || velocidade <= 2) {
    return {
      label: "Parado",
      detalhe: "Sem previsão confiável",
      classe: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    };
  }

  if (proximo.km <= 1) {
    return {
      label: "Chegando",
      detalhe: "Muito próximo do porto",
      classe: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    };
  }

  if (proximo.km <= 5) {
    return {
      label: "Aproximação",
      detalhe: "Monitorar chegada",
      classe: "border-sky-400/20 bg-sky-100/10 text-sky-300",
    };
  }

  return {
    label: "Em rota",
    detalhe: "Previsão em andamento",
    classe: "border-slate-500/20 bg-slate-500/10 text-slate-300",
  };
}

function coordBarco(barco: any): Coordenada | null {
  const pos = barco?.ultima_posicao || barco?.ultimaPosicao || {};
  const lat = Number(pos.latitude ?? pos.lat);
  const lng = Number(pos.longitude ?? pos.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;

  return { lat, lng };
}

function coordTerminal(t: any): Coordenada | null {
  const c = t?.coordenadas || {};
  const lat = Number(c.lat ?? c.latitude);
  const lng = Number(c.lng ?? c.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;

  return { lat, lng };
}

function ultimoSinal(barco: any) {
  return (
    barco?.ultima_posicao?.visto_por_ultimo ||
    barco?.ultimoSinal ||
    barco?.ultima_atualizacao ||
    barco?.ultimaAtualizacao ||
    null
  );
}

function velocidadeKmh(barco: any) {
  const v = Number(barco?.ultima_posicao?.velocidade || 0);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

function calcularVelocidadeMediaKmh(pontos: PontoRota[], barco: any) {
  const recentes = pontos
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .slice(-8);

  let distanciaTotal = 0;
  let tempoTotalHoras = 0;

  for (let i = 1; i < recentes.length; i++) {
    const anterior = recentes[i - 1];
    const atual = recentes[i];

    if (!anterior.criadoEmMs || !atual.criadoEmMs) continue;

    const diffHoras = (atual.criadoEmMs - anterior.criadoEmMs) / 3600000;
    const distancia = distanciaKm(anterior, atual);

    if (diffHoras > 0 && diffHoras < 1 && distancia > 0 && distancia < 30) {
      distanciaTotal += distancia;
      tempoTotalHoras += diffHoras;
    }
  }

  if (distanciaTotal > 0 && tempoTotalHoras > 0) {
    const media = distanciaTotal / tempoTotalHoras;
    if (media > 0 && media < 120) {
      return {
        valor: media,
        fonte: "média GPS",
      };
    }
  }

  const velocidades = recentes
    .map((p) => Number(p.velocidade || 0))
    .filter((v) => Number.isFinite(v) && v > 1 && v < 120);

  if (velocidades.length > 0) {
    const media =
      velocidades.reduce((soma, valor) => soma + valor, 0) / velocidades.length;

    return {
      valor: media,
      fonte: "média enviada",
    };
  }

  const instantanea = velocidadeKmh(barco);
  return {
    valor: instantanea,
    fonte: instantanea > 0 ? "instantânea" : "sem velocidade",
  };
}

function velocidadeOperacionalKmh(
  barco: any,
  velocidadeMedia: { valor: number; fonte: string },
) {
  const media = Number(velocidadeMedia?.valor || 0);
  const instantanea = velocidadeKmh(barco);
  const tipo = String(barco?.tipo || "").toLowerCase();

  if (Number.isFinite(media) && media > 2) {
    return { valor: media, fonte: velocidadeMedia.fonte || "média GPS" };
  }

  if (Number.isFinite(instantanea) && instantanea > 2) {
    return { valor: instantanea, fonte: "instantânea" };
  }

  // Quando o barco está parado, atracado ou mandando velocidade muito baixa,
  // usamos uma referência operacional só para não deixar ETA em branco.
  if (tipo.includes("lancha")) {
    return { valor: 45, fonte: "referência lancha" };
  }

  return { valor: 20, fonte: "referência rota" };
}

function satelites(barco: any) {
  const s = Number(barco?.ultima_posicao?.satelites || 0);
  return Number.isFinite(s) ? s : 0;
}

function direcaoGraus(barco: any) {
  const d = Number(barco?.ultima_posicao?.direcao || 0);
  return Number.isFinite(d) ? d : 0;
}

function deveEspelhar(barco: any) {
  const d = direcaoGraus(barco);
  return d >= 0 && d <= 180;
}

function statusBarco(barco: any, agora: number): StatusSinal {
  const statusServidor = String(barco?.operacao?.status || "").toLowerCase();

  if (
    statusServidor === "online" ||
    statusServidor === "sem_sinal" ||
    statusServidor === "alerta"
  ) {
    return statusServidor as StatusSinal;
  }

  const pos = coordBarco(barco);
  const ms = parseTimestamp(ultimoSinal(barco));

  if (!pos || !ms) return "alerta";

  const diff = Math.abs(agora - ms);
  if (diff <= LIMITE_ONLINE_MS) return "online";
  if (diff <= LIMITE_SEM_SINAL_MS) return "sem_sinal";
  return "alerta";
}

function statusConfig(status: StatusSinal) {
  if (status === "online") {
    return {
      label: "Online",
      dot: "bg-emerald-400",
      badge: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
      markerOpacity: 1,
      ordem: 0,
    };
  }

  if (status === "sem_sinal") {
    return {
      label: "Sem sinal",
      dot: "bg-slate-400",
      badge: "border-slate-500/20 bg-slate-500/10 text-slate-300",
      markerOpacity: 0.55,
      ordem: 1,
    };
  }

  return {
    label: "Alerta",
    dot: "bg-red-400",
    badge: "border-red-400/20 bg-red-400/10 text-red-300",
    markerOpacity: 0.5,
    ordem: 2,
  };
}

function normalizarPorto(valor: any) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/⚓/g, "")
    .replace(/_/g, " ")
    .replace(/^PORTO\s+(DE|DA|DO|DOS|DAS)?\s*/gi, "")
    .replace(/^TERMINAL\s+(DE|DA|DO|DOS|DAS)?\s*/gi, "")
    .replace(/\s*-\s*[A-Z]{2}$/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function nomesSaoParecidos(a: any, b: any) {
  const na = normalizarPorto(a);
  const nb = normalizarPorto(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function nomesDaRota(barco: any) {
  const nomes: string[] = [];

  const addRota = (rota: any) => {
    if (!rota) return;
    [rota.portoOrigem, rota.porto_origem, rota.origem].forEach((n) => {
      if (n) nomes.push(String(n));
    });

    const escalas = Array.isArray(rota.escalas) ? rota.escalas : [];
    escalas.forEach((e: any) => {
      if (typeof e === "string") nomes.push(e);
      else if (e?.porto) nomes.push(e.porto);
      else if (e?.nome) nomes.push(e.nome);
      else if (e?.cidade) nomes.push(e.cidade);
    });
  };

  addRota(barco?.rotaIda);
  addRota(barco?.rotaVolta);

  return Array.from(new Set(nomes.filter(Boolean)));
}

function montarEscalaOperacional(
  barco: any,
  terminais: any[],
  velocidadeMedia: { valor: number; fonte: string },
  proximo: any,
): EscalaOperacional[] {
  const origem = coordBarco(barco);
  const velocidadeOperacional = velocidadeOperacionalKmh(barco, velocidadeMedia);
  const velocidade = velocidadeOperacional.valor;
  const nomes = nomesDaRota(barco);

  const base = nomes.map((nome, index) => {
    const terminal = terminalPorNome(nome, terminais);
    const coord = coordTerminal(terminal);

    const km = origem && coord ? distanciaKm(origem, coord) : null;
    const tempo =
      km !== null && velocidade > 2 ? tempoViagem((km / velocidade) * 60) : "—";

    return {
      index,
      nome: terminal?.nome || nome,
      cidade: terminal?.cidade || "",
      coord,
      km,
      tempo,
      status: coord ? "futuro" : "sem_coord",
    } as EscalaOperacional;
  });

  if (!base.length) return [];

  const indiceProximo = base.findIndex((item) => {
    if (!proximo) return false;

    return (
      (proximo.id &&
        item.coord &&
        terminalPorNome(item.nome, terminais)?.id === proximo.id) ||
      nomesSaoParecidos(item.nome, proximo.nome) ||
      nomesSaoParecidos(item.cidade, proximo.cidade)
    );
  });

  const indiceAtivo =
    indiceProximo >= 0
      ? indiceProximo
      : (base
          .filter((item) => item.km !== null)
          .sort((a, b) => Number(a.km) - Number(b.km))[0]?.index ?? 0);

  return base.map((item) => {
    if (!item.coord) return { ...item, status: "sem_coord" };
    if (item.index < indiceAtivo) return { ...item, status: "passou" };
    if (item.index === indiceAtivo) return { ...item, status: "proximo" };
    return { ...item, status: "futuro" };
  });
}

function terminalPorNome(nome: string, terminais: any[]) {
  return terminais.find((t) => {
    return (
      nomesSaoParecidos(t.nome, nome) ||
      nomesSaoParecidos(t.cidade, nome) ||
      nomesSaoParecidos(`${t.nome || ""} ${t.cidade || ""}`, nome)
    );
  });
}

function proximoPortoServidor(
  barco: any,
  terminais: any[],
  velocidadeMedia: { valor: number; fonte: string },
) {
  const operacao = barco?.operacao;
  if (!operacao) return null;

  const origem = coordBarco(barco);
  const coordServidor = operacao.proximoPortoCoordenadas;
  const coordDireta =
    coordServidor &&
    Number.isFinite(Number(coordServidor.latitude)) &&
    Number.isFinite(Number(coordServidor.longitude))
      ? {
          lat: Number(coordServidor.latitude),
          lng: Number(coordServidor.longitude),
        }
      : null;

  const terminal =
    terminais.find((t) => t.id === operacao.proximoPortoId) ||
    terminais.find((t) => nomesSaoParecidos(t.nome, operacao.proximoPortoNome)) ||
    terminais.find((t) => nomesSaoParecidos(t.cidade, operacao.proximoPortoCidade));

  const coord = coordDireta || coordTerminal(terminal);
  if (!coord) return null;

  const kmServidor = Number(operacao.distanciaKm);
  const km =
    Number.isFinite(kmServidor) && kmServidor >= 0
      ? kmServidor
      : origem
        ? distanciaKm(origem, coord)
        : 0;

  const velocidadeBase = Number(operacao.velocidadeBaseKmh);
  const velocidadeOperacional = velocidadeOperacionalKmh(barco, velocidadeMedia);
  const velocidadeUsada =
    Number.isFinite(velocidadeBase) && velocidadeBase > 0
      ? velocidadeBase
      : velocidadeOperacional.valor;

  const previsaoMinutos = Number(operacao.previsaoMinutos);
  const tempo =
    operacao.previsaoTexto && operacao.previsaoTexto !== "—"
      ? String(operacao.previsaoTexto)
      : Number.isFinite(previsaoMinutos) && previsaoMinutos > 0
        ? tempoViagem(previsaoMinutos)
        : velocidadeUsada > 0
          ? tempoViagem((km / velocidadeUsada) * 60)
          : "—";

  return {
    id: operacao.proximoPortoId || terminal?.id || "",
    nome: operacao.proximoPortoNome || terminal?.nome || "Próximo porto",
    cidade: operacao.proximoPortoCidade || terminal?.cidade || "",
    coord,
    km,
    tempo,
    velocidadeUsada,
    fonteVelocidade: operacao.fonteVelocidade || velocidadeOperacional.fonte,
  };
}

function rastreadorDoBarco(barco: any, rastreadores: any[]) {
  return (
    rastreadores.find(
      (r) =>
        r.barcoId === barco?.id ||
        r.barcoIdAdmin === barco?.id ||
        r.embarcacaoNome === barco?.id ||
        r.embarcacaoNome === barco?.nome,
    ) || null
  );
}

function suavizar(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function useCoordenadaSuave(destino: Coordenada | null) {
  const [atual, setAtual] = useState<Coordenada | null>(destino);
  const ultimaRef = useRef<Coordenada | null>(destino);
  const frameRef = useRef<number | null>(null);
  const primeiraRef = useRef(true);

  useEffect(() => {
    if (!destino) {
      setAtual(null);
      ultimaRef.current = null;
      return;
    }

    const inicio = ultimaRef.current;

    if (!inicio || primeiraRef.current) {
      primeiraRef.current = false;
      ultimaRef.current = destino;
      setAtual(destino);
      return;
    }

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

    const dist = distanciaKm(inicio, destino);

    if (dist === 0 || dist > 10) {
      ultimaRef.current = destino;
      setAtual(destino);
      return;
    }

    const metros = dist * 1000;
    const duracao = Math.min(5000, Math.max(1200, metros * 8));
    const tempoInicio = Date.now();

    const animar = () => {
      const progresso = Math.min((Date.now() - tempoInicio) / duracao, 1);
      const t = suavizar(progresso);

      const nova = {
        lat: inicio.lat + (destino.lat - inicio.lat) * t,
        lng: inicio.lng + (destino.lng - inicio.lng) * t,
      };

      setAtual(nova);

      if (progresso < 1) {
        frameRef.current = requestAnimationFrame(animar);
      } else {
        ultimaRef.current = destino;
        setAtual(destino);
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(animar);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [destino?.lat, destino?.lng]);

  return atual;
}

function RadarPulse({ rgb = "6, 182, 212", size = 92 }: { rgb?: string; size?: number }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 z-0"
      style={{
        width: size,
        height: size,
        marginLeft: -(size / 2),
        marginTop: -(size / 2),
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute inset-0 rounded-full border"
          style={{
            borderColor: `rgba(${rgb}, 0.75)`,
            background: `rgba(${rgb}, 0.08)`,
            animation: "cmb-radar 2.8s linear infinite",
            animationDelay: `${i * 0.45}s`,
          }}
        />
      ))}
    </div>
  );
}

function PortoMarker({
  terminal,
  ativo,
  onClick,
}: {
  terminal: any;
  ativo: boolean;
  onClick: () => void;
}) {
  const coord = coordTerminal(terminal);
  if (!coord) return null;

  return (
    <>
      <AdvancedMarker position={coord} onClick={onClick} zIndex={ativo ? 35 : 4}>
        <div className="relative flex cursor-pointer flex-col items-center overflow-visible">
          <div
            className={[
              "mb-1 max-w-47.5 rounded-lg border px-3 py-1 text-center shadow-xl",
              ativo
                ? "border-white/80 bg-amber-400 text-slate-950"
                : "border-amber-400/30 bg-slate-950/90 text-amber-200",
            ].join(" ")}
          >
            <div className="truncate text-[10px] font-black uppercase tracking-wide">
              {String(terminal.nome || "PORTO").toUpperCase()}
            </div>
            {terminal.cidade && (
              <div className="truncate text-[9px] font-bold opacity-80">
                {String(terminal.cidade).toUpperCase()}
              </div>
            )}
          </div>

          <div className="relative flex flex-col items-center">
            {ativo && <RadarPulse rgb="251, 191, 36" size={84} />}
            {ativo && (
              <span className="absolute -inset-3 rounded-full border border-amber-300/40 bg-amber-400/15" />
            )}

            <div
              className={[
                "relative flex items-center justify-center rounded-full border-2 shadow-lg",
                ativo
                  ? "h-11 w-11 border-white bg-amber-400 text-slate-950 shadow-amber-400/50"
                  : "h-9 w-9 border-amber-400 bg-slate-950/95 text-amber-300 shadow-amber-400/25",
              ].join(" ")}
            >
              <span className={ativo ? "text-xl" : "text-lg"}>⚓</span>
            </div>

            <div
              className={[
                "mt-1 rounded-full border",
                ativo
                  ? "h-2.5 w-2.5 border-amber-400 bg-white"
                  : "h-2 w-2 border-slate-950 bg-amber-400",
              ].join(" ")}
            />
          </div>
        </div>
      </AdvancedMarker>
    </>
  );
}

function BarcoMarker({
  barco,
  ativo,
  status,
  onClick,
}: {
  barco: any;
  ativo: boolean;
  status: StatusSinal;
  onClick: () => void;
}) {
  const destino = coordBarco(barco);
  const coord = useCoordenadaSuave(destino);

  if (!coord) return null;

  const cfg = statusConfig(status);

  return (
    <>
      <AdvancedMarker position={coord} onClick={onClick} zIndex={ativo ? 40 : 12}>
        <div className="flex cursor-pointer flex-col items-center overflow-visible">
          <div
            className={[
              "mb-1 max-w-42.5 rounded-lg border px-2.5 py-1 text-center shadow-xl",
              ativo
                ? "border-sky-300/60 bg-slate-950/95 text-white"
                : "border-slate-700/80 bg-slate-950/85 text-slate-200",
            ].join(" ")}
          >
            <div className="truncate text-[10px] font-black uppercase tracking-wide">
              {barco.nome || barco.id}
            </div>
            {ativo && (
              <div className="truncate text-[9px] font-bold text-slate-500">
                {barco.id}
              </div>
            )}
          </div>

          <div
            className={[
              "relative flex items-center justify-center rounded-full transition",
              ativo ? "h-10 w-10" : "h-8 w-8",
            ].join(" ")}
            style={{ opacity: cfg.markerOpacity }}
          >
            {ativo && status === "online" && <RadarPulse rgb="6, 182, 212" size={96} />}
            <div className="relative z-10 flex items-center justify-center">
              <BarcoIcon tamanho={ativo ? 34 : 27} espelhar={deveEspelhar(barco)} />
            </div>

            {status !== "online" && (
              <span className="absolute -right-1 -top-1 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-[10px] font-black text-red-500 shadow">
                !
              </span>
            )}
          </div>
        </div>
      </AdvancedMarker>
    </>
  );
}

function PolylineLayer({
  path,
  color = "#38bdf8",
  weight = 3,
  opacity = 1,
}: {
  path: Coordenada[];
  color?: string;
  weight?: number;
  opacity?: number;
}) {
  const map = useMap();
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (!polylineRef.current) {
      polylineRef.current = new window.google.maps.Polyline({
        map,
        strokeColor: color,
        strokeWeight: weight,
        strokeOpacity: opacity,
        clickable: false,
        geodesic: true,
      });
    }

    polylineRef.current.setOptions({
      strokeColor: color,
      strokeWeight: weight,
      strokeOpacity: opacity,
    });

    polylineRef.current.setPath(path.map((p) => ({ lat: p.lat, lng: p.lng })));

    return () => {
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
    };
  }, [map, JSON.stringify(path), color, weight, opacity]);

  return null;
}

function BotaoMapa({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-lg backdrop-blur transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-950"
    >
      {children}
    </button>
  );
}

function Stat({
  label,
  valor,
  sub,
}: {
  label: string;
  valor: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-base font-black text-slate-900">{valor}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function MapaTatico() {
  const [barcos, setBarcos] = useState<any[]>([]);
  const [operacoes, setOperacoes] = useState<Record<string, any>>({});
  const [rastreadores, setRastreadores] = useState<any[]>([]);
  const [terminais, setTerminais] = useState<any[]>([]);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [portoSelecionadoId, setPortoSelecionadoId] = useState<string | null>(null);
  const [rotaAoVivo, setRotaAoVivo] = useState<PontoRota[]>([]);
  const [agora, setAgora] = useState(Date.now());
  const [zoom, setZoom] = useState(11);
  const [center, setCenter] = useState<Coordenada>(MAPA_CENTRO_OPERACIONAL);
  const [mostrarPainel, setMostrarPainel] = useState(true);
  const [abaFooter, setAbaFooter] = useState<"resumo" | "escala" | "tecnico">("resumo");
  const [buscaFrota, setBuscaFrota] = useState("");
  const [filtroFrota, setFiltroFrota] = useState<
    "todos" | "online" | "sem_sinal" | "alerta"
  >("todos");

  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubBarcos = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setBarcos(lista);
    });

    const unsubRastreadores = onSnapshot(collection(db, "rastreadores"), (snapshot) => {
      setRastreadores(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });

    const unsubTerminais = onSnapshot(collection(db, "terminais"), (snapshot) => {
      setTerminais(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });

    const unsubOperacoes = onSnapshot(collection(db, "operacao_barcos"), (snapshot) => {
      const mapa: Record<string, any> = {};
      snapshot.docs.forEach((doc) => {
        mapa[doc.id] = { id: doc.id, ...doc.data() };
      });
      setOperacoes(mapa);
    });

    return () => {
      unsubBarcos();
      unsubRastreadores();
      unsubTerminais();
      unsubOperacoes();
    };
  }, []);

  const barcosComOperacao = useMemo(() => {
    return barcos.map((barco) => ({
      ...barco,
      operacao: operacoes[barco.id] || barco.operacao || null,
    }));
  }, [barcos, operacoes]);

  const barcoSelecionado = useMemo(
    () => barcosComOperacao.find((b) => b.id === selecionadoId) || null,
    [barcosComOperacao, selecionadoId],
  );

  const portoSelecionado = useMemo(
    () => terminais.find((t) => t.id === portoSelecionadoId) || null,
    [terminais, portoSelecionadoId],
  );

  useEffect(() => {
    if (!barcoSelecionado?.id) {
      setRotaAoVivo([]);
      return;
    }

    const pontosRef = collection(
      db,
      "rastreamento",
      String(barcoSelecionado.id),
      "pontos",
    );
    const q = query(pontosRef, orderBy("criado_em", "desc"), limit(500));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const pontos = snapshot.docs
          .map((docSnap) => {
            const d = docSnap.data();
            const lat = Number(d.latitude ?? d.lat);
            const lng = Number(d.longitude ?? d.lng);
            const criadoEm = d.criado_em || d.criadoEm || d.timestamp || null;
            const criadoEmMs = parseTimestamp(criadoEm);
            const velocidade = Number(d.velocidade || 0);

            return {
              lat,
              lng,
              criadoEm,
              criadoEmMs,
              velocidade: Number.isFinite(velocidade) ? Math.max(0, velocidade) : 0,
            };
          })
          .filter(
            (p) =>
              Number.isFinite(p.lat) &&
              Number.isFinite(p.lng) &&
              p.lat !== 0 &&
              p.lng !== 0,
          )
          .reverse();

        setRotaAoVivo(pontos);
      },
      () => setRotaAoVivo([]),
    );

    return () => unsub();
  }, [barcoSelecionado?.id]);

  const barcosOrdenados = useMemo(() => {
    const texto = buscaFrota.trim().toLowerCase();

    return [...barcosComOperacao]
      .filter((barco) => {
        const status = statusBarco(barco, agora);

        if (filtroFrota !== "todos" && status !== filtroFrota) {
          return false;
        }

        if (!texto) return true;

        return [barco.id, barco.nome, barco.nomeNormalizado, barco.ownerId, barco.status]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(texto);
      })
      .sort((a, b) => {
        const sa = statusConfig(statusBarco(a, agora)).ordem;
        const sb = statusConfig(statusBarco(b, agora)).ordem;
        if (sa !== sb) return sa - sb;
        return String(a.nome || a.id).localeCompare(String(b.nome || b.id), "pt-BR");
      });
  }, [barcosComOperacao, agora, buscaFrota, filtroFrota]);

  const resumo = useMemo(() => {
    return barcosComOperacao.reduce(
      (acc, b) => {
        const s = statusBarco(b, agora);
        acc.total += 1;
        if (s === "online") acc.online += 1;
        if (s === "sem_sinal") acc.semSinal += 1;
        if (s === "alerta") acc.alerta += 1;
        return acc;
      },
      { total: 0, online: 0, semSinal: 0, alerta: 0 },
    );
  }, [barcosComOperacao, agora]);

  const statusSelecionado = barcoSelecionado
    ? statusBarco(barcoSelecionado, agora)
    : null;
  const rastreadorSelecionado = barcoSelecionado
    ? rastreadorDoBarco(barcoSelecionado, rastreadores)
    : null;
  const velocidadeMedia = useMemo(
    () => calcularVelocidadeMediaKmh(rotaAoVivo, barcoSelecionado),
    [rotaAoVivo, barcoSelecionado?.id, barcoSelecionado?.ultima_posicao?.velocidade],
  );
  const proximo = barcoSelecionado
    ? proximoPortoServidor(barcoSelecionado, terminais, velocidadeMedia) ||
      proximoPorto(barcoSelecionado, terminais, velocidadeMedia)
    : null;
  const escalaOperacional = barcoSelecionado
    ? montarEscalaOperacional(barcoSelecionado, terminais, velocidadeMedia, proximo)
    : [];
  const estadoChegada = statusChegada(proximo, velocidadeMedia.valor);
  const coordSelecionado = coordBarco(barcoSelecionado);
  const rotaAoVivoLinha = rotaAoVivo.map((p) => ({ lat: p.lat, lng: p.lng }));

  const centralizarBarco = (barco: any) => {
    const c = coordBarco(barco);
    if (!c) return;

    const estimativaPorto =
      proximoPortoServidor(barco, terminais, {
        valor: velocidadeKmh(barco),
        fonte: "instantânea",
      }) ||
      proximoPorto(barco, terminais, {
        valor: velocidadeKmh(barco),
        fonte: "instantânea",
      });

    setCenter(c);
    setZoom(14);
    setSelecionadoId(barco.id);
    setPortoSelecionadoId(estimativaPorto?.id || null);
    setMostrarPainel(true);
    setAbaFooter("resumo");
  };

  const centralizarPorto = (terminal: any) => {
    const c = coordTerminal(terminal);
    if (!c) return;
    setCenter(c);
    setZoom(14);
    setPortoSelecionadoId(terminal.id);
  };

  const ajustarVisao = () => {
    const c = coordSelecionado || coordTerminal(portoSelecionado) || center;
    setCenter(c);
    setZoom(coordSelecionado || portoSelecionado ? 14 : 11);
  };

  const centralizarTrecho = () => {
    setAbaFooter("escala");
    setMostrarPainel(true);

    if (!coordSelecionado || !proximo?.coord) {
      ajustarVisao();
      return;
    }

    setCenter(centroEntre(coordSelecionado, proximo.coord));
    setZoom(zoomPorDistanciaKm(proximo.km));
    setPortoSelecionadoId(proximo.id);
  };

  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0d0c2c] p-4">
      <style>{`
        @keyframes cmb-radar {
          0% { transform: scale(0.15); opacity: .9; }
          100% { transform: scale(1.15); opacity: 0; }
        }

        .cmb-scroll-clean {
          scrollbar-width: thin;
          scrollbar-color: rgba(56, 189, 248, 0.35) rgba(15, 23, 42, 0.35);
        }

        .cmb-scroll-clean::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .cmb-scroll-clean::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.35);
          border-radius: 999px;
        }

        .cmb-scroll-clean::-webkit-scrollbar-thumb {
          background: rgba(56, 189, 248, 0.35);
          border-radius: 999px;
        }

        .cmb-scroll-hidden {
          scrollbar-width: none;
        }

        .cmb-scroll-hidden::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <main className="relative min-w-0 flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="absolute left-5 top-5 z-30 flex flex-col gap-3">
            <BotaoMapa onClick={() => setZoom((z) => Math.min(19, z + 1))}>+</BotaoMapa>
            <BotaoMapa onClick={() => setZoom((z) => Math.max(6, z - 1))}>−</BotaoMapa>
            <BotaoMapa onClick={ajustarVisao}>⌖</BotaoMapa>
            <BotaoMapa onClick={() => setMostrarPainel((v) => !v)}>i</BotaoMapa>
          </div>

          {!googleKey && (
            <div className="absolute inset-x-5 top-5 z-50 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-100">
              Configure VITE_GOOGLE_MAPS_API_KEY.
            </div>
          )}

          <APIProvider apiKey={googleKey}>
            <Map
              center={center}
              zoom={zoom}
              mapId="CENTRAL_NAV_PRO_MAPAVIEW"
              disableDefaultUI
              clickableIcons={false}
              gestureHandling="greedy"
              mapTypeId="satellite"
              minZoom={6}
              maxZoom={18}
              restriction={{
                latLngBounds: MAPA_LIMITES_AM_PA,
                strictBounds: false,
              }}
              styles={darkNavStyle}
              className="h-full w-full"
              onZoomChanged={(ev: any) => {
                const novoZoom = ev?.detail?.zoom;
                if (typeof novoZoom === "number") setZoom(novoZoom);
              }}
              onCenterChanged={(ev: any) => {
                const c = ev?.detail?.center;
                if (c?.lat && c?.lng) setCenter({ lat: c.lat, lng: c.lng });
              }}
            >
              {terminais.map((terminal) => (
                <PortoMarker
                  key={terminal.id}
                  terminal={terminal}
                  ativo={portoSelecionadoId === terminal.id}
                  onClick={() => centralizarPorto(terminal)}
                />
              ))}

              {barcosOrdenados.map((barco) => {
                const status = statusBarco(barco, agora);
                return (
                  <BarcoMarker
                    key={barco.id}
                    barco={barco}
                    ativo={selecionadoId === barco.id}
                    status={status}
                    onClick={() => centralizarBarco(barco)}
                  />
                );
              })}

              {rotaAoVivoLinha.length > 1 && (
                <>
                  <PolylineLayer
                    path={rotaAoVivoLinha}
                    color="rgba(6, 182, 212, 0.25)"
                    weight={9}
                    opacity={0.45}
                  />
                  <PolylineLayer
                    path={rotaAoVivoLinha}
                    color="#38bdf8"
                    weight={3}
                    opacity={1}
                  />
                </>
              )}
            </Map>
          </APIProvider>
        </main>

        <aside className="flex w-90 shrink-0 flex-col overflow-hidden rounded-3xl  bg-[#0d0c2c] shadow-sm">
          <div className=" p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
              Monitoramento
            </p>

            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <div className="rounded-xl bg-[#0d0c2c] p-2.5">
                <p className="text-[8px] font-black uppercase text-slate-600">Total</p>
                <p className="mt-1 text-lg font-black text-slate-400">{resumo.total}</p>
              </div>
              <div className="rounded-xlbg-[#0d0c2c] p-2.5">
                <p className="text-[8px] font-black uppercase text-emerald-700">On</p>
                <p className="mt-1 text-lg font-black text-emerald-700">
                  {resumo.online}
                </p>
              </div>
              <div className="rounded-xl  bg-[#0d0c2c] p-2.5">
                <p className="text-[8px] font-black uppercase text-slate-600">Sinal</p>
                <p className="mt-1 text-xl font-black text-slate-400">
                  {resumo.semSinal}
                </p>
              </div>
              <div className="rounded-xl bg-[#0d0c2c] p-2.5">
                <p className="text-[8px] font-black uppercase text-red-700">Alert</p>
                <p className="mt-1 text-xl font-black text-red-700">{resumo.alerta}</p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className=" px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                  Frota
                </p>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-black uppercase text-slate-500">
                  {barcosOrdenados.length}/{barcos.length}
                </span>
              </div>

              <input
                value={buscaFrota}
                onChange={(e) => setBuscaFrota(e.target.value)}
                placeholder="Buscar barco..."
                className="mt-3 w-full rounded-xl   bg-blue-950 px-3 py-2 text-xs font-bold text-slate-300 outline-none placeholder:text-slate-300 focus:border-blue-200"
              />

              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[
                  { id: "todos", label: "Todos" },
                  { id: "online", label: "On" },
                  { id: "sem_sinal", label: "Sinal" },
                  { id: "alerta", label: "Alert" },
                ].map((filtro) => (
                  <button
                    key={filtro.id}
                    onClick={() =>
                      setFiltroFrota(
                        filtro.id as "todos" | "online" | "sem_sinal" | "alerta",
                      )
                    }
                    className={[
                      "rounded-lg border px-2 py-1.5 text-[9px] font-black uppercase transition",
                      filtroFrota === filtro.id
                        ? "border-blue-200 bg-blue-50 text-blue-400"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {filtro.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cmb-scroll-clean min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
              {" "}
              {barcosOrdenados.map((barco) => {
                const s = statusBarco(barco, agora);
                const cfg = statusConfig(s);
                const ativo = selecionadoId === barco.id;

                return (
                  <button
                    key={barco.id}
                    onClick={() => centralizarBarco(barco)}
                    className={[
                      "w-full rounded-xl border px-3 py-2.5 text-left transition",
                      ativo
                        ? "bg-blue-900 hover:border-slate-200"
                        : "bg-blue-995 hover:border-slate-200",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-black text-slate-300">
                          {barco.nome || barco.id}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-300">
                          {barco.id}
                        </p>
                      </div>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} />
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                      <span>{velocidadeKmh(barco).toFixed(1)} km/h</span>
                      <span>{satelites(barco)} sat.</span>
                      <span>{tempoDesde(ultimoSinal(barco), agora)}</span>
                    </div>
                  </button>
                );
              })}
              {barcosOrdenados.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                  Nenhum barco encontrado.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer className="mt-4 h-75 shrink-0 overflow-hidden rounded-3xl  shadow-sm">
        {mostrarPainel && barcoSelecionado && statusSelecionado ? (
          <div className="flex h-full flex-col">
            <div className="flex h-14 shrink-0 items-center justify-between  px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-400">
                  Operação do barco
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h2 className="truncate text-lg font-black text-slate-300">
                    {barcoSelecionado.nome || barcoSelecionado.id}
                  </h2>
                  <span
                    className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${statusConfig(statusSelecionado).badge}`}
                  >
                    {statusConfig(statusSelecionado).label}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${estadoChegada.classe}`}
                  >
                    {estadoChegada.label}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {[
                  { id: "resumo", label: "Resumo" },
                  { id: "escala", label: "Escala" },
                  { id: "tecnico", label: "Técnico" },
                ].map((aba) => (
                  <button
                    key={aba.id}
                    onClick={() =>
                      setAbaFooter(aba.id as "resumo" | "escala" | "tecnico")
                    }
                    className={[
                      "rounded-xl border px-4 py-2 text-[10px] font-black uppercase transition",
                      abaFooter === aba.id
                        ? "bg-blue-50 text-blue-950"
                        : "bg-slate-50 text-slate-500 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {aba.label}
                  </button>
                ))}
                <button
                  onClick={() => setMostrarPainel(false)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-100"
                >
                  Ocultar
                </button>
              </div>
            </div>

            <div className="h-61 overflow-hidden">
              {abaFooter === "resumo" && (
                <div className="grid h-full grid-cols-[0.95fr_1.45fr_210px] gap-0 overflow-hidden">
                  <div className=" p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      Próximo porto
                    </p>

                    {proximo ? (
                      <>
                        <h3 className="mt-1 truncate text-lg font-black text-slate-300">
                          {proximo.nome}
                        </h3>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {proximo.cidade || "Cidade não informada"}
                        </p>

                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-600">
                              Distância
                            </p>
                            <p className="mt-1 text-lg font-black text-blue-950">
                              {proximo.km.toFixed(1)} km
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-600">
                              Chegada
                            </p>
                            <p className="mt-1 text-lg font-black text-emerald-700">
                              {proximo.tempo}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-600">
                              Base
                            </p>
                            <p className="mt-1 text-lg font-black text-slate-500">
                              {proximo.velocidadeUsada.toFixed(1)}
                            </p>
                          </div>
                        </div>

                        <p className="mt-3 text-[11px] text-slate-500">
                          ETA do servidor • {proximo.fonteVelocidade}
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">
                        Rota não identificada.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-4">
                    <Stat
                      label="Velocidade"
                      valor={velocidadeKmh(barcoSelecionado).toFixed(1)}
                      sub="km/h agora"
                    />
                    <Stat
                      label="Média"
                      valor={velocidadeMedia.valor.toFixed(1)}
                      sub={velocidadeMedia.fonte}
                    />
                    <Stat
                      label="Satélites"
                      valor={satelites(barcoSelecionado)}
                      sub="GPS"
                    />
                    <Stat
                      label="Último sinal"
                      valor={tempoDesde(ultimoSinal(barcoSelecionado), agora)}
                      sub={formatarData(ultimoSinal(barcoSelecionado))}
                    />
                    <Stat
                      label="Direção"
                      valor={`${direcaoGraus(barcoSelecionado).toFixed(0)}°`}
                      sub="curso"
                    />
                    <Stat label="Pontos" valor={rotaAoVivo.length} sub="rota ao vivo" />
                  </div>

                  <div className=" p-4">
                    <div className="space-y-2">
                      <button
                        onClick={centralizarTrecho}
                        className="w-full rounded-xl border border-sky-400/20 bg-sky-50 px-3 py-2.5 text-[10px] font-black uppercase text-blue-950 hover:bg-sky-300"
                      >
                        Ver trecho
                      </button>
                      <button
                        onClick={ajustarVisao}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-100"
                      >
                        Centralizar
                      </button>
                      <button
                        onClick={() => setAbaFooter("tecnico")}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-100"
                      >
                        Detalhes
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {abaFooter === "escala" && (
                <div className="h-full overflow-x-auto overflow-y-hidden px-4 py-3">
                  {escalaOperacional.length === 0 ? (
                    <div className="rounded-2xl border border-amber-400/15 bg-amber-50 p-4 text-sm text-amber-100">
                      Nenhuma escala encontrada no documento deste barco.
                    </div>
                  ) : (
                    <div className="flex min-w-max items-start gap-0 pb-1">
                      {escalaOperacional.map((item, index) => {
                        const statusVisual =
                          item.status === "passou"
                            ? {
                                bola: "bg-emerald-400 border-emerald-200 text-slate-950",
                                texto: "text-emerald-700",
                                label: "Passou",
                                linha: "bg-emerald-400/60",
                              }
                            : item.status === "proximo"
                              ? {
                                  bola: "bg-sky-400 border-white text-slate-950",
                                  texto: "text-blue-300",
                                  label: "Próximo",
                                  linha: "bg-slate-700",
                                }
                              : item.status === "sem_coord"
                                ? {
                                    bola: "bg-red-400/20 border-red-400/40 text-red-200",
                                    texto: "text-red-700",
                                    label: "Sem GPS",
                                    linha: "bg-slate-700",
                                  }
                                : {
                                    bola: "bg-slate-100 border-slate-600 text-slate-500",
                                    texto: "text-slate-600",
                                    label: "Sequência",
                                    linha: "bg-slate-700",
                                  };

                        return (
                          <div key={`${item.nome}-${index}`} className="flex items-start">
                            {index > 0 && (
                              <div className={`mt-5 h-0.5 w-8 ${statusVisual.linha}`} />
                            )}

                            <div className="w-29.5">
                              <div className="flex flex-col items-center text-center">
                                <div
                                  className={[
                                    "flex h-10 w-10 items-center justify-center rounded-xl border text-xs font-black shadow-lg",
                                    statusVisual.bola,
                                  ].join(" ")}
                                >
                                  {item.status === "passou"
                                    ? "✓"
                                    : item.status === "proximo"
                                      ? "⌁"
                                      : item.index + 1}
                                </div>

                                <p
                                  className={`mt-2 max-w-28 truncate text-[11px] font-black uppercase ${statusVisual.texto}`}
                                >
                                  {item.nome}
                                </p>
                                <p className="mt-0.5 max-w-27 truncate text-[9px] font-bold text-slate-500">
                                  {item.cidade || "—"}
                                </p>

                                <div className="mt-2 grid w-full grid-cols-2 gap-1.5">
                                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                                    <p className="text-[7px] font-black uppercase text-slate-600">
                                      Dist.
                                    </p>
                                    <p className="mt-0.5 text-[10px] font-black text-slate-900">
                                      {item.km !== null
                                        ? `${item.km.toFixed(1)} km`
                                        : "—"}
                                    </p>
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                                    <p className="text-[7px] font-black uppercase text-slate-600">
                                      Tempo
                                    </p>
                                    <p className="mt-0.5 text-[10px] font-black text-emerald-700">
                                      {item.tempo}
                                    </p>
                                  </div>
                                </div>

                                <span className="mt-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[8px] font-black uppercase text-slate-500">
                                  {statusVisual.label}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {abaFooter === "tecnico" && (
                <div className="grid h-full grid-cols-3 gap-3 overflow-hidden p-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Rastreador
                    </p>
                    {rastreadorSelecionado ? (
                      <div className="mt-3 space-y-2 text-sm">
                        <p className="flex justify-between gap-3">
                          <span className="text-slate-500">Placa</span>
                          <b className="truncate text-slate-900">
                            {rastreadorSelecionado.nomeNaRede ||
                              rastreadorSelecionado.deviceId}
                          </b>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="text-slate-500">Wi-Fi</span>
                          <b className="truncate text-slate-900">
                            {rastreadorSelecionado.wifiNome || "—"}
                          </b>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="text-slate-500">RSSI</span>
                          <b className="text-slate-900">
                            {rastreadorSelecionado.rssi ?? "—"} dBm
                          </b>
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">Não vinculado.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Coordenadas
                    </p>
                    {coordSelecionado ? (
                      <div className="mt-3 space-y-2 font-mono text-sm">
                        <p className="flex justify-between">
                          <span className="text-slate-500">LAT</span>
                          <b className="text-blue-950">
                            {coordSelecionado.lat.toFixed(6)}
                          </b>
                        </p>
                        <p className="flex justify-between">
                          <span className="text-slate-500">LNG</span>
                          <b className="text-blue-950">
                            {coordSelecionado.lng.toFixed(6)}
                          </b>
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-red-700">GPS inválido.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Cálculo
                    </p>
                    <div className="mt-3 space-y-2 text-sm">
                      <p className="flex justify-between gap-3">
                        <span className="text-slate-500">Velocidade base</span>
                        <b className="text-slate-900">
                          {proximo ? proximo.velocidadeUsada.toFixed(1) : "—"} km/h
                        </b>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span className="text-slate-500">Fonte</span>
                        <b className="truncate text-slate-900">
                          {proximo?.fonteVelocidade || velocidadeMedia.fonte}
                        </b>
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Se o barco estiver parado ou com velocidade muito baixa, o sistema
                        usa uma referência operacional para não deixar o tempo em branco.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                Selecione uma embarcação
              </p>
              <p className="mt-2 text-sm text-slate-600">
                As informações operacionais aparecerão neste rodapé fixo.
              </p>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}

function proximoPorto(
  barco: any,
  terminais: any[],
  velocidadeMedia: { valor: number; fonte: string },
): {
  id: any;
  nome: any;
  cidade: any;
  coord: Coordenada;
  km: number;
  tempo: string;
  velocidadeUsada: number;
  fonteVelocidade: any;
} | null {
  const origem = coordBarco(barco);
  if (!origem || !Array.isArray(terminais) || terminais.length === 0) return null;

  const velocidadeOperacional = velocidadeOperacionalKmh(barco, velocidadeMedia);
  const velocidadeUsada = velocidadeOperacional.valor;

  const nomesRota = nomesDaRota(barco);
  const terminaisDaRota =
    nomesRota.length > 0
      ? nomesRota.map((nome) => terminalPorNome(nome, terminais)).filter(Boolean)
      : [];

  const candidatosBase = terminaisDaRota.length > 0 ? terminaisDaRota : terminais;

  const candidatos = candidatosBase
    .map((terminal: any) => {
      const coord = coordTerminal(terminal);
      if (!coord) return null;

      const km = distanciaKm(origem, coord);

      return {
        id: terminal.id || terminal.nome || "",
        nome: terminal.nome || "Próximo porto",
        cidade: terminal.cidade || "",
        coord,
        km,
        tempo: velocidadeUsada > 0 ? tempoViagem((km / velocidadeUsada) * 60) : "—",
        velocidadeUsada,
        fonteVelocidade: velocidadeOperacional.fonte,
      };
    })
    .filter(Boolean) as {
    id: any;
    nome: any;
    cidade: any;
    coord: Coordenada;
    km: number;
    tempo: string;
    velocidadeUsada: number;
    fonteVelocidade: any;
  }[];

  if (candidatos.length === 0) return null;

  return candidatos.sort((a, b) => a.km - b.km)[0];
}
