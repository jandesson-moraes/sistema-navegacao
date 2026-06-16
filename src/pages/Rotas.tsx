import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

const URL_SALVAR_ROTA =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/salvarRotaAtualBarco";

const URL_DEFINIR_OFICIAL =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/definirRotaHistoricaComoOficial";

const URL_SALVAR_TRECHO =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/salvarTrechoOficialDaRota";

type PontoGps = {
  latitude: number;
  longitude: number;
  velocidade?: any;
  criado_em?: any;
};

type PortoInteligente = {
  id: string;
  nome: string;
  cidade?: string;
  uf?: string;
  latitude: number;
  longitude: number;
  raioMetros?: number;
  ativo?: boolean;
  aliases?: string[];
};

type PortoDetectado = {
  portoId: string;
  nome: string;
  cidade: string;
  uf?: string;
  ordem: number;
  indiceInicio: number;
  indiceFim: number;
  indiceCentral: number;
  totalPontos: number;
  menorDistanciaMetros: number;
  latitude: number;
  longitude: number;
};

type TrechoSugerido = {
  id: string;
  nome: string;
  origemPortoId: string;
  destinoPortoId: string;
  origemNome: string;
  destinoNome: string;
  sentido: string;
  indiceInicio: number;
  indiceFim: number;
  pontos: PontoGps[];
  distanciaKm: number;
  tempoTotalMin: number;
  totalPontosSalvos: number;
};

function formatarData(valor: any) {
  try {
    const data =
      typeof valor?.toDate === "function"
        ? valor.toDate()
        : valor
          ? new Date(valor)
          : null;

    if (!data || Number.isNaN(data.getTime())) return "—";

    return data.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function tempoTexto(minutos: any) {
  const m = Number(minutos);
  if (!Number.isFinite(m) || m <= 0) return "—";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r > 0 ? `${h}h ${r}min` : `${h}h`;
}

function dataMs(valor: any) {
  try {
    const data = typeof valor?.toDate === "function" ? valor.toDate() : new Date(valor);
    return Number.isNaN(data.getTime()) ? 0 : data.getTime();
  } catch {
    return 0;
  }
}

function calcularDistanciaKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calcularDistanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number) {
  return calcularDistanciaKm(lat1, lon1, lat2, lon2) * 1000;
}

function calcularDistanciaPontos(pontos: { latitude: number; longitude: number }[]) {
  let total = 0;

  for (let i = 1; i < pontos.length; i += 1) {
    total += calcularDistanciaKm(
      pontos[i - 1].latitude,
      pontos[i - 1].longitude,
      pontos[i].latitude,
      pontos[i].longitude,
    );
  }

  return total;
}

function normalizarEscalaId(valor: string) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function corrigirBarcoId(valor: any) {
  return String(valor || "")
    .trim()
    .replace(/_GPS$/i, "")
    .toUpperCase();
}

function numeroSeguro(valor: any, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function textoSeguro(valor: any) {
  return String(valor || "").trim();
}

function escalaBasica(nome: string, ordem: number, portoId?: string) {
  const nomeLimpo = String(nome || "").trim();

  return {
    id: portoId || normalizarEscalaId(nomeLimpo || `escala_${ordem}`),
    portoId: portoId || normalizarEscalaId(nomeLimpo || `escala_${ordem}`),
    ordem,
    nome: nomeLimpo,
    porto: nomeLimpo,
    cidade: nomeLimpo,
    local: nomeLimpo,
    horario: "",
    diaRelativo: "0",
    ativo: true,
  };
}

function montarRotaParaApp({
  nome,
  origem,
  destino,
  sentido,
  pontos,
  distanciaKm,
  tempoTotalMin,
  escalas,
}: {
  nome: string;
  origem: string;
  destino: string;
  sentido: string;
  pontos?: any[];
  distanciaKm?: any;
  tempoTotalMin?: any;
  escalas?: any[];
}) {
  const origemLimpa = String(origem || "").trim();
  const destinoLimpo = String(destino || "").trim();
  const escalasParaApp =
    Array.isArray(escalas) && escalas.length > 0
      ? escalas.map((item, index) => ({
          ...item,
          ordem: Number.isFinite(Number(item.ordem)) ? Number(item.ordem) : index,
          ativo: item.ativo !== false,
        }))
      : [escalaBasica(origemLimpa, 0), escalaBasica(destinoLimpo, 1)].filter(
          (item) => item.nome,
        );

  return {
    nome: nome || `${origemLimpa} → ${destinoLimpo}`,
    sentido,
    origem: origemLimpa,
    destino: destinoLimpo,
    portoOrigem: origemLimpa,
    portoDestino: destinoLimpo,
    escalas: escalasParaApp,
    itinerario: escalasParaApp,
    pontos: Array.isArray(pontos) ? pontos : [],
    distanciaKm: Number(distanciaKm) || 0,
    tempoTotalMin: Number(tempoTotalMin) || 0,
    ativo: true,
    atualizadoEm: serverTimestamp(),
  };
}

async function sincronizarRotaNoBarco({
  barcoId,
  nome,
  origem,
  destino,
  sentido,
  pontos,
  distanciaKm,
  tempoTotalMin,
  escalas,
}: {
  barcoId: string;
  nome: string;
  origem: string;
  destino: string;
  sentido: string;
  pontos?: any[];
  distanciaKm?: any;
  tempoTotalMin?: any;
  escalas?: any[];
}) {
  const idBarco = corrigirBarcoId(barcoId);

  if (!idBarco) return;

  const chaveRota = sentido === "volta" ? "rotaVolta" : "rotaIda";
  const rotaParaApp = montarRotaParaApp({
    nome,
    origem,
    destino,
    sentido,
    pontos,
    distanciaKm,
    tempoTotalMin,
    escalas,
  });

  await setDoc(
    doc(db, "embarcacoes", idBarco),
    {
      [chaveRota]: rotaParaApp,
      rotaAtualizadaEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    },
    { merge: true },
  );
}

function extrairPontosRota(rota: any) {
  const pontos = Array.isArray(rota?.pontos) ? rota.pontos : [];

  return pontos
    .map((p: any) => ({
      latitude: Number(p.latitude ?? p.lat),
      longitude: Number(p.longitude ?? p.lng),
      velocidade: p.velocidade,
      criado_em: p.criado_em || p.criadoEm || p.timestamp,
    }))
    .filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        p.latitude !== 0 &&
        p.longitude !== 0,
    );
}

function normalizarPorto(porto: any): PortoInteligente | null {
  const latitude = Number(porto.latitude ?? porto.lat);
  const longitude = Number(porto.longitude ?? porto.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    ...porto,
    id: porto.id,
    nome: textoSeguro(porto.nome || porto.cidade || porto.id),
    cidade: textoSeguro(porto.cidade || porto.nome || porto.id),
    uf: textoSeguro(porto.uf),
    latitude,
    longitude,
    raioMetros: numeroSeguro(porto.raioMetros, 800),
    ativo: porto.ativo !== false,
  };
}

function encontrarPortoMaisProximo(ponto: PontoGps, portos: PortoInteligente[]) {
  let melhor: { porto: PortoInteligente; distanciaMetros: number } | null = null;

  for (const porto of portos) {
    if (porto.ativo === false) continue;

    const distanciaMetros = calcularDistanciaMetros(
      ponto.latitude,
      ponto.longitude,
      porto.latitude,
      porto.longitude,
    );

    const raio = Number(porto.raioMetros || 800);

    if (distanciaMetros <= raio) {
      if (!melhor || distanciaMetros < melhor.distanciaMetros) {
        melhor = { porto, distanciaMetros };
      }
    }
  }

  return melhor;
}

function detectarPortosNaRota(pontos: PontoGps[], portos: PortoInteligente[]) {
  const detectados: PortoDetectado[] = [];

  pontos.forEach((ponto, index) => {
    const encontrado = encontrarPortoMaisProximo(ponto, portos);

    if (!encontrado) return;

    const ultimo = detectados[detectados.length - 1];
    const distanciaDoUltimo = ultimo ? index - ultimo.indiceFim : 999999;

    // Se o barco continuou próximo do mesmo porto, apenas expande a janela.
    if (ultimo?.portoId === encontrado.porto.id && distanciaDoUltimo <= 20) {
      ultimo.indiceFim = index;
      ultimo.indiceCentral = Math.round((ultimo.indiceInicio + ultimo.indiceFim) / 2);
      ultimo.totalPontos += 1;
      ultimo.menorDistanciaMetros = Math.min(
        ultimo.menorDistanciaMetros,
        encontrado.distanciaMetros,
      );
      return;
    }

    // Evita detectar o mesmo porto de novo logo depois por oscilação de GPS.
    const jaDetectadoRecente = [...detectados]
      .reverse()
      .slice(0, 3)
      .some(
        (item) =>
          item.portoId === encontrado.porto.id && Math.abs(index - item.indiceFim) <= 60,
      );

    if (jaDetectadoRecente) return;

    detectados.push({
      portoId: encontrado.porto.id,
      nome: encontrado.porto.nome,
      cidade: encontrado.porto.cidade || encontrado.porto.nome,
      uf: encontrado.porto.uf,
      ordem: detectados.length,
      indiceInicio: index,
      indiceFim: index,
      indiceCentral: index,
      totalPontos: 1,
      menorDistanciaMetros: encontrado.distanciaMetros,
      latitude: encontrado.porto.latitude,
      longitude: encontrado.porto.longitude,
    });
  });

  return detectados.map((item, index) => ({ ...item, ordem: index }));
}

function calcularTempoEntrePontosMin(pontoInicial?: PontoGps, pontoFinal?: PontoGps) {
  const inicio = dataMs(pontoInicial?.criado_em);
  const fim = dataMs(pontoFinal?.criado_em);

  if (!inicio || !fim || fim <= inicio) return 0;
  return Math.round((fim - inicio) / 60000);
}

function montarTrechosAutomaticos(
  portosDetectados: PortoDetectado[],
  pontos: PontoGps[],
  sentido: string,
) {
  const trechos: TrechoSugerido[] = [];

  for (let i = 1; i < portosDetectados.length; i += 1) {
    const origem = portosDetectados[i - 1];
    const destino = portosDetectados[i];
    const indiceInicio = Math.min(origem.indiceCentral, destino.indiceCentral);
    const indiceFim = Math.max(origem.indiceCentral, destino.indiceCentral);
    const pontosTrecho = pontos.slice(indiceInicio, indiceFim + 1);
    const idBase = `${origem.nome}_${destino.nome}_${sentido}`;

    trechos.push({
      id: normalizarEscalaId(idBase),
      nome: `${origem.nome} → ${destino.nome}`,
      origemPortoId: origem.portoId,
      destinoPortoId: destino.portoId,
      origemNome: origem.nome,
      destinoNome: destino.nome,
      sentido,
      indiceInicio,
      indiceFim,
      pontos: pontosTrecho,
      distanciaKm: Number(calcularDistanciaPontos(pontosTrecho).toFixed(2)),
      tempoTotalMin: calcularTempoEntrePontosMin(
        pontosTrecho[0],
        pontosTrecho[pontosTrecho.length - 1],
      ),
      totalPontosSalvos: pontosTrecho.length,
    });
  }

  return trechos;
}

function calcularBoundsPontos(pontos: { latitude: number; longitude: number }[]) {
  const latitudes = pontos.map((p) => p.latitude);
  const longitudes = pontos.map((p) => p.longitude);

  return {
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
    minLng: Math.min(...longitudes),
    maxLng: Math.max(...longitudes),
  };
}

function converterPontoSvg(ponto: { latitude: number; longitude: number }, bounds: any) {
  const largura = 1000;
  const altura = 360;
  const padding = 42;
  const latRange = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  const lngRange = Math.max(bounds.maxLng - bounds.minLng, 0.0001);

  return {
    x: padding + ((ponto.longitude - bounds.minLng) / lngRange) * (largura - padding * 2),
    y: padding + ((bounds.maxLat - ponto.latitude) / latRange) * (altura - padding * 2),
  };
}

function montarPathSvg(pontos: { latitude: number; longitude: number }[], bounds: any) {
  return pontos
    .map((p, index) => {
      const { x, y } = converterPontoSvg(p, bounds);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function carregarGoogleMapsApi(apiKey: string) {
  if (typeof window === "undefined") return Promise.reject();

  const w = window as any;

  if (w.google?.maps) {
    return Promise.resolve(w.google.maps);
  }

  if (w.__googleMapsPromise) {
    return w.__googleMapsPromise;
  }

  w.__googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(w.google.maps);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return w.__googleMapsPromise;
}

function pontoGoogle(ponto: { latitude: number; longitude: number }) {
  return {
    lat: ponto.latitude,
    lng: ponto.longitude,
  };
}

function criarBoundsGoogle(pontos: { latitude: number; longitude: number }[]) {
  const w = window as any;
  const bounds = new w.google.maps.LatLngBounds();

  pontos.forEach((ponto) => {
    bounds.extend(pontoGoogle(ponto));
  });

  return bounds;
}

function criarPortoVazio() {
  return {
    id: "",
    nome: "",
    cidade: "",
    uf: "AM",
    latitude: "",
    longitude: "",
    raioMetros: "800",
    aliases: "",
    ativo: true,
  };
}

function criarRotaEditavelVazia() {
  return {
    id: "",
    colecao: "rotas_oficiais",
    nome: "",
    origem: "",
    destino: "",
    sentido: "ida",
    status: "publicada",
    ativo: true,
  };
}

function criarTrechoEditavelVazio() {
  return {
    id: "",
    nome: "",
    origemNome: "",
    destinoNome: "",
    sentido: "ida",
    tempoTotalMin: "",
    distanciaKm: "",
    ativo: true,
  };
}

export default function Rotas() {
  const modal = useAppModal();
  const alert = (mensagem: any) => {
    void modal.aviso("Aviso do sistema", String(mensagem));
  };

  const confirmar = (mensagem: string) => {
    if (typeof window === "undefined") return false;
    return window.confirm(mensagem);
  };

  const [barcos, setBarcos] = useState<any[]>([]);
  const [historicas, setHistoricas] = useState<any[]>([]);
  const [oficiais, setOficiais] = useState<any[]>([]);
  const [rotasInteligentes, setRotasInteligentes] = useState<any[]>([]);
  const [trechos, setTrechos] = useState<any[]>([]);
  const [portos, setPortos] = useState<PortoInteligente[]>([]);

  const [barcoId, setBarcoId] = useState("");
  const [nome, setNome] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [sentido, setSentido] = useState("ida");
  const [salvarComoOficial, setSalvarComoOficial] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState("inteligencia");

  const [rotaMapa, setRotaMapa] = useState<any | null>(null);
  const [indiceInicio, setIndiceInicio] = useState(0);
  const [indiceFim, setIndiceFim] = useState(0);
  const [origemTrecho, setOrigemTrecho] = useState("");
  const [destinoTrecho, setDestinoTrecho] = useState("");
  const [nomeTrecho, setNomeTrecho] = useState("");
  const [sentidoTrecho, setSentidoTrecho] = useState("ida");
  const [salvandoTrecho, setSalvandoTrecho] = useState(false);

  const [portosDetectados, setPortosDetectados] = useState<PortoDetectado[]>([]);
  const [trechosSugeridos, setTrechosSugeridos] = useState<TrechoSugerido[]>([]);
  const [salvandoInteligente, setSalvandoInteligente] = useState(false);

  const [portoForm, setPortoForm] = useState<any>(criarPortoVazio());
  const [salvandoPorto, setSalvandoPorto] = useState(false);
  const [rotaEditando, setRotaEditando] = useState<any | null>(null);
  const [trechoEditando, setTrechoEditando] = useState<any | null>(null);

  useEffect(() => {
    const unsubBarcos = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs
        .map((documento) => ({ ...documento.data(), id: documento.id }))
        .sort((a: any, b: any) =>
          String(a.nome || a.id).localeCompare(String(b.nome || b.id)),
        );

      setBarcos(lista);
      setBarcoId((atual) => atual || lista[0]?.id || "");
    });

    const qHistoricas = query(
      collection(db, "rotas_historicas"),
      orderBy("criadoEm", "desc"),
      limit(150),
    );

    const unsubHistoricas = onSnapshot(qHistoricas, (snapshot) => {
      setHistoricas(
        snapshot.docs.map((documento) => ({ id: documento.id, ...documento.data() })),
      );
    });

    const unsubOficiais = onSnapshot(collection(db, "rotas_oficiais"), (snapshot) => {
      const lista = snapshot.docs
        .map((documento) => ({ ...documento.data(), id: documento.id }))
        .filter((item: any) => item.ativo !== false)
        .sort(
          (a: any, b: any) =>
            dataMs(b.atualizadoEm || b.criadoEm) - dataMs(a.atualizadoEm || a.criadoEm),
        );

      setOficiais(lista);
    });

    const unsubRotasInteligentes = onSnapshot(
      collection(db, "rotas_inteligentes"),
      (snapshot) => {
        const lista = snapshot.docs
          .map((documento) => ({ ...documento.data(), id: documento.id }))
          .filter((item: any) => item.ativo !== false)
          .sort(
            (a: any, b: any) =>
              dataMs(b.atualizadoEm || b.criadoEm) - dataMs(a.atualizadoEm || a.criadoEm),
          );

        setRotasInteligentes(lista);
      },
    );

    const unsubTrechos = onSnapshot(collection(db, "trechos_oficiais"), (snapshot) => {
      const lista = snapshot.docs
        .map((documento) => ({ ...documento.data(), id: documento.id }))
        .filter((item: any) => item.ativo !== false)
        .sort((a: any, b: any) =>
          String(a.origemNome || a.origem).localeCompare(
            String(b.origemNome || b.origem),
          ),
        );

      setTrechos(lista);
    });

    const unsubPortos = onSnapshot(collection(db, "portos"), (snapshot) => {
      const lista = snapshot.docs
        .map((documento) => normalizarPorto({ id: documento.id, ...documento.data() }))
        .filter(Boolean) as PortoInteligente[];

      setPortos(lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome))));
    });

    return () => {
      unsubBarcos();
      unsubHistoricas();
      unsubOficiais();
      unsubRotasInteligentes();
      unsubTrechos();
      unsubPortos();
    };
  }, []);

  const barcoSelecionado = useMemo(
    () => barcos.find((b) => b.id === barcoId) || null,
    [barcos, barcoId],
  );

  const textoBusca = busca.trim().toLowerCase();

  const historicasFiltradas = useMemo(() => {
    return historicas.filter((rota) => {
      if (!textoBusca) return true;

      return [
        rota.nome,
        rota.nomeBarco,
        rota.barcoId,
        rota.origem,
        rota.destino,
        rota.sentido,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(textoBusca);
    });
  }, [historicas, textoBusca]);

  const oficiaisFiltradas = useMemo(() => {
    return oficiais.filter((rota) => {
      if (!textoBusca) return true;

      return [
        rota.nome,
        rota.nomeBarco,
        rota.barcoId,
        rota.origem,
        rota.destino,
        rota.sentido,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(textoBusca);
    });
  }, [oficiais, textoBusca]);

  const trechosFiltrados = useMemo(() => {
    return trechos.filter((trecho) => {
      if (!textoBusca) return true;

      return [
        trecho.nome,
        trecho.origemNome,
        trecho.destinoNome,
        trecho.origem,
        trecho.destino,
        trecho.sentido,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(textoBusca);
    });
  }, [trechos, textoBusca]);

  const rotasInteligentesFiltradas = useMemo(() => {
    return rotasInteligentes.filter((rota) => {
      if (!textoBusca) return true;

      return [rota.nome, rota.origem, rota.destino, rota.sentido, rota.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(textoBusca);
    });
  }, [rotasInteligentes, textoBusca]);

  const pontosRotaMapa = useMemo(() => extrairPontosRota(rotaMapa), [rotaMapa]);

  const pontosTrechoSelecionado = useMemo(() => {
    if (pontosRotaMapa.length < 2) return [];

    const inicio = Math.min(indiceInicio, indiceFim);
    const fim = Math.max(indiceInicio, indiceFim);

    return pontosRotaMapa.slice(inicio, fim + 1);
  }, [pontosRotaMapa, indiceInicio, indiceFim]);

  const distanciaTrechoKm = useMemo(
    () => calcularDistanciaPontos(pontosTrechoSelecionado),
    [pontosTrechoSelecionado],
  );

  const rotaDetectadaResumo = useMemo(() => {
    if (portosDetectados.length < 2) return null;

    const origemDetectada = portosDetectados[0];
    const destinoDetectado = portosDetectados[portosDetectados.length - 1];

    return {
      origem: origemDetectada.nome,
      destino: destinoDetectado.nome,
      nome: `${origemDetectada.nome} → ${destinoDetectado.nome}`,
      escalas: portosDetectados.map((porto, index) => ({
        id: porto.portoId,
        portoId: porto.portoId,
        ordem: index,
        nome: porto.nome,
        cidade: porto.cidade,
        local: porto.nome,
        ativo: true,
      })),
      distanciaTotalKm: Number(
        trechosSugeridos
          .reduce((total, trecho) => total + Number(trecho.distanciaKm || 0), 0)
          .toFixed(2),
      ),
      tempoTotalMin: trechosSugeridos.reduce(
        (total, trecho) => total + Number(trecho.tempoTotalMin || 0),
        0,
      ),
    };
  }, [portosDetectados, trechosSugeridos]);

  useEffect(() => {
    if (rotaMapa?.id) {
      const aindaExiste = [...historicas, ...oficiais, ...rotasInteligentes].some(
        (rota) => rota.id === rotaMapa.id,
      );

      if (aindaExiste) return;
    }

    setRotaMapa(oficiais[0] || historicas[0] || null);
  }, [historicas, oficiais, rotasInteligentes, rotaMapa?.id]);

  useEffect(() => {
    const pontos = extrairPontosRota(rotaMapa);
    const fim = Math.max(0, pontos.length - 1);

    setIndiceInicio(0);
    setIndiceFim(fim);
    setOrigemTrecho(rotaMapa?.origem || "");
    setDestinoTrecho(rotaMapa?.destino || "");
    setNomeTrecho(
      rotaMapa?.origem && rotaMapa?.destino
        ? `${rotaMapa.origem} → ${rotaMapa.destino}`
        : rotaMapa?.nome || "",
    );
    setSentidoTrecho(rotaMapa?.sentido || "ida");
    setPortosDetectados([]);
    setTrechosSugeridos([]);
  }, [rotaMapa?.id]);

  const salvarRotaAtual = async () => {
    try {
      if (!barcoId) {
        alert("Selecione um barco.");
        return;
      }

      setSalvando(true);

      const usuario = getAuth().currentUser;
      if (!usuario) {
        alert("Faça login novamente.");
        return;
      }

      const idToken = await usuario.getIdToken();

      const resposta = await fetch(URL_SALVAR_ROTA, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          barcoId: corrigirBarcoId(barcoId),
          nome: nome.trim(),
          origem: origem.trim(),
          destino: destino.trim(),
          sentido,
          salvarComoOficial,
        }),
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok || dados.erro) {
        throw new Error(dados.erro || dados.detalhe || "Erro ao salvar rota.");
      }

      await sincronizarRotaNoBarco({
        barcoId: corrigirBarcoId(barcoId),
        nome: nome.trim(),
        origem: origem.trim(),
        destino: destino.trim(),
        sentido,
        pontos: dados.pontos || dados.rota?.pontos || [],
        distanciaKm: dados.distanciaKm,
        tempoTotalMin: dados.tempoTotalMin,
      });

      alert(
        `Rota salva com sucesso. Pontos: ${dados.pontosSalvos}. Distância: ${dados.distanciaKm} km.\n\nA rota também foi sincronizada no cadastro da embarcação para aparecer no app do passageiro.`,
      );
      setNome("");
    } catch (error: any) {
      alert(error?.message || "Erro ao salvar rota.");
    } finally {
      setSalvando(false);
    }
  };

  const definirComoOficial = async (rota: any) => {
    try {
      const usuario = getAuth().currentUser;
      if (!usuario) {
        alert("Faça login novamente.");
        return;
      }

      const idToken = await usuario.getIdToken();

      const resposta = await fetch(URL_DEFINIR_OFICIAL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          rotaHistoricaId: rota.id,
        }),
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok || dados.erro) {
        throw new Error(dados.erro || dados.detalhe || "Erro ao definir rota oficial.");
      }

      await sincronizarRotaNoBarco({
        barcoId: corrigirBarcoId(rota.barcoId),
        nome: rota.nome || dados.nome || "",
        origem: rota.origem || "",
        destino: rota.destino || "",
        sentido: rota.sentido || "ida",
        pontos: rota.pontos || [],
        distanciaKm: rota.distanciaKm,
        tempoTotalMin: rota.tempoTotalMin,
      });

      alert("Rota definida como oficial e sincronizada no cadastro da embarcação.");
    } catch (error: any) {
      alert(error?.message || "Erro ao definir oficial.");
    }
  };

  const salvarTrechoOficial = async () => {
    try {
      if (!rotaMapa?.id) {
        alert("Selecione uma rota.");
        return;
      }

      if (!origemTrecho.trim() || !destinoTrecho.trim()) {
        alert("Informe origem e destino do trecho.");
        return;
      }

      if (pontosTrechoSelecionado.length < 2) {
        alert("Selecione um trecho com pelo menos dois pontos.");
        return;
      }

      setSalvandoTrecho(true);

      const usuario = getAuth().currentUser;
      if (!usuario) {
        alert("Faça login novamente.");
        return;
      }

      const idToken = await usuario.getIdToken();

      const colecaoOrigem =
        rotaMapa.tipo === "oficial" || rotaMapa.oficial === true
          ? "rotas_oficiais"
          : "rotas_historicas";

      const resposta = await fetch(URL_SALVAR_TRECHO, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          rotaId: rotaMapa.id,
          colecaoOrigem,
          origem: origemTrecho.trim(),
          destino: destinoTrecho.trim(),
          nome: nomeTrecho.trim(),
          sentido: sentidoTrecho,
          indiceInicio,
          indiceFim,
          ativo: true,
        }),
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok || dados.erro) {
        throw new Error(dados.erro || dados.detalhe || "Erro ao salvar trecho.");
      }

      alert(
        `Trecho oficial salvo. ID: ${dados.trechoId}. Distância: ${dados.distanciaKm} km.`,
      );
    } catch (error: any) {
      alert(error?.message || "Erro ao salvar trecho oficial.");
    } finally {
      setSalvandoTrecho(false);
    }
  };

  const salvarPorto = async () => {
    try {
      if (!portoForm.nome.trim()) {
        alert("Informe o nome do porto.");
        return;
      }

      const latitude = Number(portoForm.latitude);
      const longitude = Number(portoForm.longitude);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        alert("Informe latitude e longitude válidas para o porto.");
        return;
      }

      setSalvandoPorto(true);

      const usuario = getAuth().currentUser;
      const id = portoForm.id || normalizarEscalaId(portoForm.nome);

      await setDoc(
        doc(db, "portos", id),
        {
          nome: portoForm.nome.trim(),
          cidade: portoForm.cidade.trim() || portoForm.nome.trim(),
          uf: portoForm.uf.trim().toUpperCase(),
          latitude,
          longitude,
          raioMetros: Number(portoForm.raioMetros) || 800,
          aliases: String(portoForm.aliases || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          ativo: portoForm.ativo !== false,
          atualizadoEm: serverTimestamp(),
          atualizadoPor: usuario?.uid || null,
          ...(portoForm.id
            ? {}
            : { criadoEm: serverTimestamp(), criadoPor: usuario?.uid || null }),
        },
        { merge: true },
      );

      alert("Porto salvo com sucesso.");
      setPortoForm(criarPortoVazio());
    } catch (error: any) {
      alert(error?.message || "Erro ao salvar porto.");
    } finally {
      setSalvandoPorto(false);
    }
  };

  const editarPorto = (porto: PortoInteligente) => {
    setPortoForm({
      id: porto.id,
      nome: porto.nome || "",
      cidade: porto.cidade || "",
      uf: porto.uf || "AM",
      latitude: String(porto.latitude || ""),
      longitude: String(porto.longitude || ""),
      raioMetros: String(porto.raioMetros || 800),
      aliases: Array.isArray(porto.aliases) ? porto.aliases.join(", ") : "",
      ativo: porto.ativo !== false,
    });
    setAba("portos");
  };

  const excluirPorto = async (porto: PortoInteligente) => {
    if (!confirmar(`Deseja desativar o porto "${porto.nome}"?`)) return;

    await setDoc(
      doc(db, "portos", porto.id),
      {
        ativo: false,
        excluidoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const usarPontoSelecionadoComoPorto = (tipo: "inicio" | "fim") => {
    const ponto =
      tipo === "inicio" ? pontosRotaMapa[indiceInicio] : pontosRotaMapa[indiceFim];

    if (!ponto) {
      alert("Selecione uma rota com pontos no mapa primeiro.");
      return;
    }

    setPortoForm((atual: any) => ({
      ...atual,
      latitude: String(ponto.latitude),
      longitude: String(ponto.longitude),
    }));
    setAba("portos");
  };

  const reconhecerPortosAutomaticamente = () => {
    if (!rotaMapa?.id) {
      alert("Selecione uma rota histórica ou oficial para analisar.");
      return;
    }

    if (pontosRotaMapa.length < 2) {
      alert("A rota selecionada não possui pontos suficientes.");
      return;
    }

    if (portos.length === 0) {
      alert(
        "Cadastre pelo menos um porto com latitude e longitude antes de reconhecer a rota.",
      );
      setAba("portos");
      return;
    }

    const detectados = detectarPortosNaRota(pontosRotaMapa, portos);

    if (detectados.length < 2) {
      alert(
        "Não foi possível reconhecer origem e destino. Aumente o raio dos portos ou cadastre melhor os pontos de atracação.",
      );
      setPortosDetectados(detectados);
      setTrechosSugeridos([]);
      return;
    }

    const trechosAuto = montarTrechosAutomaticos(
      detectados,
      pontosRotaMapa,
      rotaMapa?.sentido || sentidoTrecho || "ida",
    );

    setPortosDetectados(detectados);
    setTrechosSugeridos(trechosAuto);
    setOrigem(detectados[0].nome);
    setDestino(detectados[detectados.length - 1].nome);
    setNome(`${detectados[0].nome} → ${detectados[detectados.length - 1].nome}`);
    setOrigemTrecho(detectados[0].nome);
    setDestinoTrecho(detectados[detectados.length - 1].nome);
    setNomeTrecho(`${detectados[0].nome} → ${detectados[detectados.length - 1].nome}`);
    setAba("inteligencia");
  };

  const salvarRotaInteligente = async () => {
    try {
      if (!rotaDetectadaResumo || portosDetectados.length < 2) {
        alert("Reconheça os portos da rota antes de salvar a rota inteligente.");
        return;
      }

      setSalvandoInteligente(true);

      const usuario = getAuth().currentUser;
      const origemDetectada = portosDetectados[0];
      const destinoDetectado = portosDetectados[portosDetectados.length - 1];
      const sentidoFinal = rotaMapa?.sentido || sentidoTrecho || sentido || "ida";
      const rotaId = normalizarEscalaId(
        `${origemDetectada.nome}_${destinoDetectado.nome}_${sentidoFinal}`,
      );
      const trechosIds: string[] = [];

      for (const trecho of trechosSugeridos) {
        const trechoId = normalizarEscalaId(
          `${trecho.origemNome}_${trecho.destinoNome}_${sentidoFinal}`,
        );
        trechosIds.push(trechoId);

        await setDoc(
          doc(db, "trechos_oficiais", trechoId),
          {
            ...trecho,
            id: trechoId,
            sentido: sentidoFinal,
            ativo: true,
            origem: trecho.origemNome,
            destino: trecho.destinoNome,
            origemNome: trecho.origemNome,
            destinoNome: trecho.destinoNome,
            atualizadoEm: serverTimestamp(),
            atualizadoPor: usuario?.uid || null,
            criadoEm: serverTimestamp(),
            criadoPor: usuario?.uid || null,
          },
          { merge: true },
        );
      }

      const payloadRota = {
        id: rotaId,
        nome: rotaDetectadaResumo.nome,
        origem: origemDetectada.nome,
        destino: destinoDetectado.nome,
        origemPortoId: origemDetectada.portoId,
        destinoPortoId: destinoDetectado.portoId,
        sentido: sentidoFinal,
        escalas: rotaDetectadaResumo.escalas,
        itinerario: rotaDetectadaResumo.escalas,
        trechosIds,
        distanciaTotalKm: rotaDetectadaResumo.distanciaTotalKm,
        distanciaKm: rotaDetectadaResumo.distanciaTotalKm,
        tempoTotalMin: rotaDetectadaResumo.tempoTotalMin,
        totalPontos: pontosRotaMapa.length,
        rotaOrigemId: rotaMapa?.id || null,
        barcoId: rotaMapa?.barcoId || barcoId || null,
        nomeBarco: rotaMapa?.nomeBarco || barcoSelecionado?.nome || "",
        status: "publicada",
        ativo: true,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: usuario?.uid || null,
        criadoEm: serverTimestamp(),
        criadoPor: usuario?.uid || null,
      };

      await setDoc(doc(db, "rotas_inteligentes", rotaId), payloadRota, { merge: true });

      if (barcoId || rotaMapa?.barcoId) {
        await sincronizarRotaNoBarco({
          barcoId: rotaMapa?.barcoId || barcoId,
          nome: payloadRota.nome,
          origem: payloadRota.origem,
          destino: payloadRota.destino,
          sentido: payloadRota.sentido,
          pontos: pontosRotaMapa,
          distanciaKm: payloadRota.distanciaKm,
          tempoTotalMin: payloadRota.tempoTotalMin,
          escalas: payloadRota.escalas,
        });
      }

      alert(
        `Rota inteligente criada com sucesso.\n\nOrigem: ${payloadRota.origem}\nDestino: ${payloadRota.destino}\nTrechos criados/atualizados: ${trechosIds.length}`,
      );
    } catch (error: any) {
      alert(error?.message || "Erro ao salvar rota inteligente.");
    } finally {
      setSalvandoInteligente(false);
    }
  };

  const abrirEdicaoRota = (rota: any, colecao: string) => {
    setRotaEditando({
      ...criarRotaEditavelVazia(),
      ...rota,
      colecao,
      id: rota.id,
      nome: rota.nome || "",
      origem: rota.origem || "",
      destino: rota.destino || "",
      sentido: rota.sentido || "ida",
      status: rota.status || (colecao === "rotas_inteligentes" ? "publicada" : "oficial"),
      ativo: rota.ativo !== false,
    });
  };

  const salvarEdicaoRota = async () => {
    try {
      if (!rotaEditando?.id || !rotaEditando?.colecao) return;

      await setDoc(
        doc(db, rotaEditando.colecao, rotaEditando.id),
        {
          nome: textoSeguro(rotaEditando.nome),
          origem: textoSeguro(rotaEditando.origem),
          destino: textoSeguro(rotaEditando.destino),
          sentido: rotaEditando.sentido || "ida",
          status: rotaEditando.status || "publicada",
          ativo: rotaEditando.ativo !== false,
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Rota atualizada com sucesso.");
      setRotaEditando(null);
    } catch (error: any) {
      alert(error?.message || "Erro ao editar rota.");
    }
  };

  const excluirRota = async (rota: any, colecao: string) => {
    const nomeRota = rota.nome || rota.id;

    if (!confirmar(`Deseja excluir/desativar a rota "${nomeRota}"?`)) return;

    try {
      if (colecao === "rotas_historicas") {
        await deleteDoc(doc(db, colecao, rota.id));
        alert("Rota histórica excluída.");
        return;
      }

      await setDoc(
        doc(db, colecao, rota.id),
        {
          ativo: false,
          status: "excluida",
          excluidoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Rota desativada com sucesso.");
    } catch (error: any) {
      alert(error?.message || "Erro ao excluir rota.");
    }
  };

  const abrirEdicaoTrecho = (trecho: any) => {
    setTrechoEditando({
      ...criarTrechoEditavelVazio(),
      ...trecho,
      id: trecho.id,
      nome: trecho.nome || "",
      origemNome: trecho.origemNome || trecho.origem || "",
      destinoNome: trecho.destinoNome || trecho.destino || "",
      sentido: trecho.sentido || "ida",
      distanciaKm: String(trecho.distanciaKm || ""),
      tempoTotalMin: String(trecho.tempoTotalMin || ""),
      ativo: trecho.ativo !== false,
    });
  };

  const salvarEdicaoTrecho = async () => {
    try {
      if (!trechoEditando?.id) return;

      await setDoc(
        doc(db, "trechos_oficiais", trechoEditando.id),
        {
          nome: textoSeguro(trechoEditando.nome),
          origem: textoSeguro(trechoEditando.origemNome),
          destino: textoSeguro(trechoEditando.destinoNome),
          origemNome: textoSeguro(trechoEditando.origemNome),
          destinoNome: textoSeguro(trechoEditando.destinoNome),
          sentido: trechoEditando.sentido || "ida",
          distanciaKm: Number(trechoEditando.distanciaKm) || 0,
          tempoTotalMin: Number(trechoEditando.tempoTotalMin) || 0,
          ativo: trechoEditando.ativo !== false,
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Trecho atualizado com sucesso.");
      setTrechoEditando(null);
    } catch (error: any) {
      alert(error?.message || "Erro ao editar trecho.");
    }
  };

  const excluirTrecho = async (trecho: any) => {
    if (!confirmar(`Deseja desativar o trecho "${trecho.nome || trecho.id}"?`)) return;

    await setDoc(
      doc(db, "trechos_oficiais", trecho.id),
      {
        ativo: false,
        excluidoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const duplicarRotaInteligente = async (rota: any) => {
    try {
      const novoId = `${rota.id}_copia_${Date.now()}`;

      await setDoc(doc(db, "rotas_inteligentes", novoId), {
        ...rota,
        id: novoId,
        nome: `${rota.nome || rota.id} - cópia`,
        status: "rascunho",
        ativo: true,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });

      alert("Rota duplicada como rascunho.");
    } catch (error: any) {
      alert(error?.message || "Erro ao duplicar rota.");
    }
  };

  const vincularRotaAoBarco = async (rota: any) => {
    try {
      if (!barcoId) {
        alert("Selecione um barco para vincular a rota.");
        return;
      }

      await sincronizarRotaNoBarco({
        barcoId,
        nome: rota.nome || "",
        origem: rota.origem || "",
        destino: rota.destino || "",
        sentido: rota.sentido || "ida",
        pontos: rota.pontos || [],
        distanciaKm: rota.distanciaKm || rota.distanciaTotalKm,
        tempoTotalMin: rota.tempoTotalMin,
        escalas: rota.escalas || rota.itinerario || [],
      });

      await setDoc(
        doc(db, "embarcacoes", corrigirBarcoId(barcoId)),
        {
          [`${rota.sentido === "volta" ? "rotaVoltaId" : "rotaIdaId"}`]: rota.id,
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Rota vinculada ao barco selecionado.");
    } catch (error: any) {
      alert(error?.message || "Erro ao vincular rota ao barco.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0c2c] p-6 text-white">
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-6">
        <Resumo label="Históricas" valor={historicas.length} detalhe="rastros GPS" />
        <Resumo
          label="Inteligentes"
          valor={rotasInteligentes.length}
          detalhe="rotas montadas"
        />
        <Resumo label="Oficiais" valor={oficiais.length} detalhe="rotas antigas" />
        <Resumo label="Trechos" valor={trechos.length} detalhe="reaproveitáveis" />
        <Resumo label="Portos" valor={portos.length} detalhe="pontos reconhecidos" />
        <Resumo label="Barcos" valor={barcos.length} detalhe="na frota" />
      </div>

      <section className="mb-6 rounded-3xl border border-sky-400/10 bg-[#143760]/80 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-black">Rotas inteligentes</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Cadastre os portos uma vez, abra uma rota histórica do GPS e clique em
              reconhecer. O sistema detecta origem, destino, escalas e cria trechos
              oficiais reutilizáveis.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:w-[520px]">
            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Barco ativo
              </p>
              <select
                value={barcoId}
                onChange={(e) => setBarcoId(e.target.value)}
                className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
              >
                {barcos.map((barco) => (
                  <option key={barco.id} value={barco.id}>
                    {barco.nome || barco.id}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Buscar
              </p>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Manaus, Santarém, barco..."
                className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
              />
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <AbaBotao ativa={aba === "inteligencia"} onClick={() => setAba("inteligencia")}>
            Inteligência
          </AbaBotao>
          <AbaBotao ativa={aba === "portos"} onClick={() => setAba("portos")}>
            Portos
          </AbaBotao>
          <AbaBotao ativa={aba === "historicas"} onClick={() => setAba("historicas")}>
            Históricas
          </AbaBotao>
          <AbaBotao ativa={aba === "rotas"} onClick={() => setAba("rotas")}>
            Rotas inteligentes
          </AbaBotao>
          <AbaBotao ativa={aba === "trechos"} onClick={() => setAba("trechos")}>
            Trechos
          </AbaBotao>
          <AbaBotao ativa={aba === "salvar"} onClick={() => setAba("salvar")}>
            Salvar rota atual
          </AbaBotao>
        </div>
      </section>

      {aba === "inteligencia" && (
        <section className="mb-6 overflow-hidden rounded-3xl border border-white/5 bg-[#143760]/80">
          <div className="flex flex-col gap-3 border-b border-white/5 p-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-black">Reconhecimento automático da rota</h2>
              <p className="mt-1 text-xs text-slate-500">
                Selecione uma rota histórica, cadastre os portos e deixe o sistema montar
                a rota automaticamente.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={reconhecerPortosAutomaticamente}
                className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs font-black uppercase text-amber-300 hover:bg-amber-400/20"
              >
                Reconhecer portos automaticamente
              </button>
              <button
                onClick={salvarRotaInteligente}
                disabled={salvandoInteligente || !rotaDetectadaResumo}
                className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
              >
                {salvandoInteligente ? "Salvando..." : "Salvar rota inteligente"}
              </button>
            </div>
          </div>

          <RotaMapaEditor
            rota={rotaMapa}
            indiceInicio={indiceInicio}
            indiceFim={indiceFim}
            setIndiceInicio={setIndiceInicio}
            setIndiceFim={setIndiceFim}
            portosDetectados={portosDetectados}
          />

          <div className="border-t border-white/5 p-5">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
              <div className="rounded-3xl border border-sky-400/10 bg-[#0d0c2c]/80 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      Rota detectada
                    </p>
                    <h3 className="mt-2 text-xl font-black text-white">
                      {rotaDetectadaResumo?.nome || "Nenhuma rota reconhecida ainda"}
                    </h3>
                  </div>
                  <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[10px] font-black uppercase text-sky-300">
                    {portosDetectados.length} portos
                  </span>
                </div>

                {portosDetectados.length > 0 ? (
                  <div className="mt-5 grid gap-3">
                    {portosDetectados.map((porto, index) => (
                      <div
                        key={`${porto.portoId}-${index}`}
                        className="flex items-center gap-3 rounded-2xl border border-white/5 bg-slate-900/80 p-3"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-400/10 text-xs font-black text-emerald-300">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-white">
                            {porto.nome}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Ponto {porto.indiceCentral} • menor distância{" "}
                            {Math.round(porto.menorDistanciaMetros)}m
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-900/60 p-6 text-center text-sm text-slate-500">
                    Abra uma rota histórica e clique em reconhecer para encontrar origem,
                    escalas e destino.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-amber-400/10 bg-[#0d0c2c]/80 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Trechos sugeridos
                </p>
                <h3 className="mt-2 text-xl font-black text-white">
                  {trechosSugeridos.length} trecho(s)
                </h3>

                <div className="mt-5 grid gap-3">
                  {trechosSugeridos.map((trecho) => (
                    <div
                      key={trecho.id}
                      className="rounded-2xl border border-white/5 bg-slate-900/80 p-4"
                    >
                      <p className="text-sm font-black text-white">{trecho.nome}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <Mini label="Km" valor={trecho.distanciaKm} />
                        <Mini label="Tempo" valor={tempoTexto(trecho.tempoTotalMin)} />
                        <Mini label="Pontos" valor={trecho.totalPontosSalvos} />
                      </div>
                    </div>
                  ))}

                  {trechosSugeridos.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/60 p-6 text-center text-sm text-slate-500">
                      Os trechos aparecerão aqui depois que a rota reconhecer pelo menos
                      dois portos.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {aba === "portos" && (
        <section className="mb-6 grid gap-6 xl:grid-cols-[0.95fr_1.4fr]">
          <div className="rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
            <h2 className="text-lg font-black">Cadastro de porto inteligente</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              O raio define a área onde o GPS será reconhecido como porto. Para rios, use
              entre 500m e 1500m.
            </p>

            <div className="mt-5 grid gap-4">
              <Input
                label="Nome do porto"
                value={portoForm.nome}
                onChange={(valor) => setPortoForm((a: any) => ({ ...a, nome: valor }))}
                placeholder="Porto de Manaus"
              />
              <Input
                label="Cidade"
                value={portoForm.cidade}
                onChange={(valor) => setPortoForm((a: any) => ({ ...a, cidade: valor }))}
                placeholder="Manaus"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="UF"
                  value={portoForm.uf}
                  onChange={(valor) => setPortoForm((a: any) => ({ ...a, uf: valor }))}
                  placeholder="AM"
                />
                <Input
                  label="Raio em metros"
                  value={portoForm.raioMetros}
                  onChange={(valor) =>
                    setPortoForm((a: any) => ({ ...a, raioMetros: valor }))
                  }
                  placeholder="800"
                />
              </div>
              <Input
                label="Latitude"
                value={portoForm.latitude}
                onChange={(valor) =>
                  setPortoForm((a: any) => ({ ...a, latitude: valor }))
                }
                placeholder="-3.1386"
              />
              <Input
                label="Longitude"
                value={portoForm.longitude}
                onChange={(valor) =>
                  setPortoForm((a: any) => ({ ...a, longitude: valor }))
                }
                placeholder="-60.0234"
              />
              <Input
                label="Apelidos separados por vírgula"
                value={portoForm.aliases}
                onChange={(valor) => setPortoForm((a: any) => ({ ...a, aliases: valor }))}
                placeholder="Manaus, Terminal Manaus"
              />

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => usarPontoSelecionadoComoPorto("inicio")}
                  className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-[10px] font-black uppercase text-sky-300 hover:bg-sky-400/20"
                >
                  Usar início selecionado
                </button>
                <button
                  onClick={() => usarPontoSelecionadoComoPorto("fim")}
                  className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-[10px] font-black uppercase text-sky-300 hover:bg-sky-400/20"
                >
                  Usar fim selecionado
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={salvarPorto}
                  disabled={salvandoPorto}
                  className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-60"
                >
                  {salvandoPorto
                    ? "Salvando..."
                    : portoForm.id
                      ? "Atualizar porto"
                      : "Salvar porto"}
                </button>
                <button
                  onClick={() => setPortoForm(criarPortoVazio())}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-xs font-black uppercase text-slate-300 hover:bg-white/10"
                >
                  Limpar
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
            <h2 className="text-lg font-black">Portos cadastrados</h2>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {portos.map((porto) => (
                <div
                  key={porto.id}
                  className="rounded-2xl border border-white/5 bg-[#0d0c2c]/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">
                        {porto.nome}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {porto.cidade} {porto.uf ? `• ${porto.uf}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-300">
                      {porto.raioMetros || 800}m
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Mini label="Lat" valor={porto.latitude.toFixed(5)} />
                    <Mini label="Lng" valor={porto.longitude.toFixed(5)} />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => editarPorto(porto)}
                      className="flex-1 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[10px] font-black uppercase text-sky-300 hover:bg-sky-400/20"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => excluirPorto(porto)}
                      className="flex-1 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-400/20"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))}

              {portos.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#0d0c2c] p-8 text-center text-slate-500">
                  Nenhum porto cadastrado ainda.
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {aba === "salvar" && (
        <section className="mb-6 rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
          <h2 className="text-lg font-black">Salvar rota atual do rastreador</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Use quando o barco terminar ou estiver fazendo uma viagem real. O sistema lê
            os pontos em rastreamento/barco/pontos.
          </p>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <Input
              label="Nome da rota"
              value={nome}
              onChange={setNome}
              placeholder="Manaus → Santarém"
            />
            <Input
              label="Origem"
              value={origem}
              onChange={setOrigem}
              placeholder="Manaus"
            />
            <Input
              label="Destino"
              value={destino}
              onChange={setDestino}
              placeholder="Santarém"
            />

            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Sentido
              </p>
              <select
                value={sentido}
                onChange={(e) => setSentido(e.target.value)}
                className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
              >
                <option value="ida">Ida</option>
                <option value="volta">Volta</option>
              </select>
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#0d0c2c] p-4 xl:col-span-2">
              <div>
                <p className="text-xs font-black uppercase text-slate-400">
                  Salvar também como rota oficial
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  Para usar direto no app e previsões.
                </p>
              </div>
              <input
                type="checkbox"
                checked={salvarComoOficial}
                onChange={(e) => setSalvarComoOficial(e.target.checked)}
                className="h-5 w-5"
              />
            </label>

            <button
              onClick={salvarRotaAtual}
              disabled={salvando}
              className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-5 py-4 text-xs font-black uppercase text-sky-300 hover:bg-sky-400/20 disabled:opacity-60 xl:col-span-2"
            >
              {salvando ? "Salvando..." : "Salvar rota atual"}
            </button>
          </div>
        </section>
      )}

      {aba === "historicas" && (
        <section className="overflow-hidden rounded-3xl border border-white/5 bg-[#143760]/80">
          <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
            <div>
              <h2 className="text-lg font-black">Rotas históricas do GPS</h2>
              <p className="mt-1 text-xs text-slate-500">
                Abra uma rota para reconhecer portos, editar trecho ou transformar em
                oficial.
              </p>
            </div>
          </div>

          <div className="max-h-[calc(100vh-300px)] overflow-y-auto p-4">
            {historicasFiltradas.map((rota) => (
              <RotaHistoricaCard
                key={rota.id}
                rota={rota}
                selecionada={rotaMapa?.id === rota.id}
                onSelecionar={() => {
                  setRotaMapa(rota);
                  setAba("inteligencia");
                }}
                onDefinirOficial={() => definirComoOficial(rota)}
                onExcluir={() => excluirRota(rota, "rotas_historicas")}
              />
            ))}

            {historicasFiltradas.length === 0 && (
              <div className="rounded-2xl border border-white/5 bg-[#0d0c2c] p-8 text-center text-slate-500">
                Nenhuma rota histórica encontrada.
              </div>
            )}
          </div>
        </section>
      )}

      {aba === "rotas" && (
        <section className="rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
          <h2 className="text-lg font-black">Rotas inteligentes publicadas</h2>
          <p className="mt-1 text-xs text-slate-500">
            Rotas criadas a partir de portos e trechos oficiais.
          </p>

          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {rotasInteligentesFiltradas.map((rota) => (
              <div
                key={rota.id}
                className="rounded-2xl border border-sky-400/10 bg-[#0d0c2c]/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">
                      {rota.nome || rota.id}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {rota.origem || "Origem"} → {rota.destino || "Destino"} •{" "}
                      {rota.sentido || "ida"}
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-300">
                    {rota.status || "publicada"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Mini
                    label="Km"
                    valor={rota.distanciaTotalKm || rota.distanciaKm || "—"}
                  />
                  <Mini label="Tempo" valor={tempoTexto(rota.tempoTotalMin)} />
                  <Mini label="Trechos" valor={rota.trechosIds?.length || "—"} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => vincularRotaAoBarco(rota)}
                    className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-300 hover:bg-emerald-400/20"
                  >
                    Vincular
                  </button>
                  <button
                    onClick={() => abrirEdicaoRota(rota, "rotas_inteligentes")}
                    className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[10px] font-black uppercase text-sky-300 hover:bg-sky-400/20"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => duplicarRotaInteligente(rota)}
                    className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] font-black uppercase text-amber-300 hover:bg-amber-400/20"
                  >
                    Duplicar
                  </button>
                  <button
                    onClick={() => excluirRota(rota, "rotas_inteligentes")}
                    className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-400/20"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}

            {rotasInteligentesFiltradas.length === 0 && (
              <div className="rounded-2xl border border-white/5 bg-[#0d0c2c] p-6 text-slate-500">
                Nenhuma rota inteligente criada ainda.
              </div>
            )}
          </div>
        </section>
      )}

      {aba === "trechos" && (
        <section className="rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
          <h2 className="text-lg font-black">Trechos oficiais reutilizáveis</h2>
          <p className="mt-1 text-xs text-slate-500">
            Esses trechos são a base da malha inteligente.
          </p>

          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {trechosFiltrados.map((trecho) => (
              <div
                key={trecho.id}
                className="rounded-2xl border border-emerald-400/10 bg-[#0d0c2c]/70 p-4"
              >
                <p className="text-sm font-black text-white">
                  {trecho.nome || trecho.id}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {trecho.origemNome || trecho.origem} →{" "}
                  {trecho.destinoNome || trecho.destino} • {trecho.sentido || "ida"}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Mini
                    label="Km"
                    valor={trecho.distanciaKm ? `${trecho.distanciaKm}` : "—"}
                  />
                  <Mini label="Tempo" valor={tempoTexto(trecho.tempoTotalMin)} />
                  <Mini
                    label="Pontos"
                    valor={trecho.totalPontosSalvos || trecho.pontos?.length || "—"}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => abrirEdicaoTrecho(trecho)}
                    className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[10px] font-black uppercase text-sky-300 hover:bg-sky-400/20"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => excluirTrecho(trecho)}
                    className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-400/20"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}

            {trechosFiltrados.length === 0 && (
              <div className="rounded-2xl border border-white/5 bg-[#0d0c2c] p-6 text-slate-500">
                Nenhum trecho oficial criado ainda.
              </div>
            )}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-black">Editor manual de trecho oficial</h2>
            <p className="mt-1 text-xs text-slate-500">
              Use quando precisar cortar um pedaço específico da rota no mapa.
            </p>
          </div>
          {rotaMapa && (
            <div className="rounded-2xl border border-sky-400/10 bg-sky-400/10 px-4 py-3 text-xs font-bold text-sky-200">
              {rotaMapa.nome || "Rota selecionada"}
            </div>
          )}
        </div>

        {rotaMapa && (
          <div className="mt-5 grid gap-4 xl:grid-cols-5">
            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Origem do trecho
              </p>
              <input
                value={origemTrecho}
                onChange={(e) => setOrigemTrecho(e.target.value)}
                placeholder="Manaus"
                className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
              />
            </label>
            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Destino do trecho
              </p>
              <input
                value={destinoTrecho}
                onChange={(e) => setDestinoTrecho(e.target.value)}
                placeholder="Juruti"
                className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
              />
            </label>
            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Nome do trecho
              </p>
              <input
                value={nomeTrecho}
                onChange={(e) => setNomeTrecho(e.target.value)}
                placeholder="Manaus → Juruti"
                className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
              />
            </label>
            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Sentido
              </p>
              <select
                value={sentidoTrecho}
                onChange={(e) => setSentidoTrecho(e.target.value)}
                className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
              >
                <option value="ida">Ida</option>
                <option value="volta">Volta</option>
              </select>
            </label>
            <button
              onClick={salvarTrechoOficial}
              disabled={salvandoTrecho}
              className="self-end rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-60"
            >
              {salvandoTrecho ? "Salvando..." : "Salvar trecho oficial"}
            </button>
          </div>
        )}

        {rotaMapa && (
          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Mini label="Ponto inicial" valor={indiceInicio} />
            <Mini label="Ponto final" valor={indiceFim} />
            <Mini label="Pontos no trecho" valor={pontosTrechoSelecionado.length} />
            <Mini
              label="Distância do trecho"
              valor={`${distanciaTrechoKm.toFixed(1)} km`}
            />
          </div>
        )}
      </section>

      {rotaEditando && (
        <ModalCard titulo="Editar rota" onFechar={() => setRotaEditando(null)}>
          <div className="grid gap-4">
            <Input
              label="Nome"
              value={rotaEditando.nome}
              onChange={(valor) => setRotaEditando((a: any) => ({ ...a, nome: valor }))}
              placeholder="Manaus → Santarém"
            />
            <Input
              label="Origem"
              value={rotaEditando.origem}
              onChange={(valor) => setRotaEditando((a: any) => ({ ...a, origem: valor }))}
              placeholder="Manaus"
            />
            <Input
              label="Destino"
              value={rotaEditando.destino}
              onChange={(valor) =>
                setRotaEditando((a: any) => ({ ...a, destino: valor }))
              }
              placeholder="Santarém"
            />
            <div className="grid grid-cols-2 gap-3">
              <label>
                <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                  Sentido
                </p>
                <select
                  value={rotaEditando.sentido}
                  onChange={(e) =>
                    setRotaEditando((a: any) => ({ ...a, sentido: e.target.value }))
                  }
                  className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
                >
                  <option value="ida">Ida</option>
                  <option value="volta">Volta</option>
                </select>
              </label>
              <Input
                label="Status"
                value={rotaEditando.status}
                onChange={(valor) =>
                  setRotaEditando((a: any) => ({ ...a, status: valor }))
                }
                placeholder="publicada"
              />
            </div>
            <button
              onClick={salvarEdicaoRota}
              className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20"
            >
              Salvar alteração
            </button>
          </div>
        </ModalCard>
      )}

      {trechoEditando && (
        <ModalCard titulo="Editar trecho" onFechar={() => setTrechoEditando(null)}>
          <div className="grid gap-4">
            <Input
              label="Nome"
              value={trechoEditando.nome}
              onChange={(valor) => setTrechoEditando((a: any) => ({ ...a, nome: valor }))}
              placeholder="Manaus → Parintins"
            />
            <Input
              label="Origem"
              value={trechoEditando.origemNome}
              onChange={(valor) =>
                setTrechoEditando((a: any) => ({ ...a, origemNome: valor }))
              }
              placeholder="Manaus"
            />
            <Input
              label="Destino"
              value={trechoEditando.destinoNome}
              onChange={(valor) =>
                setTrechoEditando((a: any) => ({ ...a, destinoNome: valor }))
              }
              placeholder="Parintins"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Distância km"
                value={trechoEditando.distanciaKm}
                onChange={(valor) =>
                  setTrechoEditando((a: any) => ({ ...a, distanciaKm: valor }))
                }
                placeholder="370"
              />
              <Input
                label="Tempo min"
                value={trechoEditando.tempoTotalMin}
                onChange={(valor) =>
                  setTrechoEditando((a: any) => ({ ...a, tempoTotalMin: valor }))
                }
                placeholder="720"
              />
            </div>
            <button
              onClick={salvarEdicaoTrecho}
              className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20"
            >
              Salvar alteração
            </button>
          </div>
        </ModalCard>
      )}
    </div>
  );
}

function RotaHistoricaCard({
  rota,
  selecionada,
  onSelecionar,
  onDefinirOficial,
  onExcluir,
}: {
  rota: any;
  selecionada: boolean;
  onSelecionar: () => void;
  onDefinirOficial: () => any;
  onExcluir: () => any;
}) {
  return (
    <div
      className={`mb-3 rounded-2xl border p-4 ${selecionada ? "border-sky-400/40 bg-sky-400/10" : "border-white/5 bg-[#0d0c2c]/70"}`}
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-black text-white">
              {rota.nome || "Rota sem nome"}
            </h3>
            {rota.oficial && (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-300">
                oficial
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {rota.nomeBarco || rota.barcoId} • {rota.origem || "Origem"} →{" "}
            {rota.destino || "Destino"} • {rota.sentido || "ida"}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            onClick={onSelecionar}
            className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-black uppercase text-sky-300 hover:bg-sky-400/20"
          >
            Reconhecer
          </button>
          <button
            onClick={onDefinirOficial}
            className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20"
          >
            Definir oficial
          </button>
          <button
            onClick={onExcluir}
            className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs font-black uppercase text-red-300 hover:bg-red-400/20"
          >
            Excluir
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Mini
          label="Distância"
          valor={rota.distanciaKm ? `${rota.distanciaKm} km` : "—"}
        />
        <Mini label="Tempo real" valor={tempoTexto(rota.tempoTotalMin)} />
        <Mini
          label="Vel. média"
          valor={rota.velocidadeMediaKmh ? `${rota.velocidadeMediaKmh} km/h` : "—"}
        />
        <Mini
          label="Pontos"
          valor={rota.totalPontosSalvos || rota.pontos?.length || "—"}
        />
        <Mini label="Criada" valor={formatarData(rota.criadoEm)} />
      </div>
    </div>
  );
}

function RotaMapaEditor({
  rota,
  indiceInicio,
  indiceFim,
  setIndiceInicio,
  setIndiceFim,
  portosDetectados,
}: {
  rota: any | null;
  indiceInicio: number;
  indiceFim: number;
  setIndiceInicio: (valor: number) => void;
  setIndiceFim: (valor: number) => void;
  portosDetectados?: PortoDetectado[];
}) {
  const pontos = useMemo(() => extrairPontosRota(rota), [rota]);
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const overlaysRef = React.useRef<any[]>([]);
  const [mapsCarregado, setMapsCarregado] = useState(false);
  const [erroMapa, setErroMapa] = useState("");

  const GOOGLE_MAPS_KEY =
    (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
    (import.meta as any).env?.VITE_GOOGLE_MAPS_KEY ||
    "";

  const inicio = Math.min(indiceInicio, indiceFim);
  const fim = Math.max(indiceInicio, indiceFim);
  const pontosTrecho = pontos.slice(inicio, fim + 1);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) {
      setErroMapa(
        "Configure VITE_GOOGLE_MAPS_API_KEY no arquivo .env do Sistema de Navegação.",
      );
      return;
    }

    carregarGoogleMapsApi(GOOGLE_MAPS_KEY)
      .then(() => setMapsCarregado(true))
      .catch(() => {
        setErroMapa("Não foi possível carregar o Google Maps.");
      });
  }, [GOOGLE_MAPS_KEY]);

  useEffect(() => {
    const w = window as any;

    if (!mapsCarregado || !mapDivRef.current || pontos.length < 2) return;

    if (!mapRef.current) {
      mapRef.current = new w.google.maps.Map(mapDivRef.current, {
        mapTypeId: "hybrid",
        disableDefaultUI: true,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        mapTypeControl: true,
        gestureHandling: "greedy",
        backgroundColor: "#020617",
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
      });
    }

    const bounds = criarBoundsGoogle(pontos);
    mapRef.current.fitBounds(bounds, 70);
  }, [mapsCarregado, rota?.id, pontos.length]);

  useEffect(() => {
    const w = window as any;

    if (!mapsCarregado || !mapRef.current || pontos.length < 2) return;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    const caminhoCompleto = pontos.map(pontoGoogle);
    const caminhoTrecho = pontosTrecho.map(pontoGoogle);

    const linhaCompletaHalo = new w.google.maps.Polyline({
      path: caminhoCompleto,
      geodesic: true,
      strokeColor: "#020617",
      strokeOpacity: 0.75,
      strokeWeight: 11,
      zIndex: 10,
    });
    const linhaCompleta = new w.google.maps.Polyline({
      path: caminhoCompleto,
      geodesic: true,
      strokeColor: "#38bdf8",
      strokeOpacity: 0.88,
      strokeWeight: 4,
      zIndex: 11,
    });

    linhaCompletaHalo.setMap(mapRef.current);
    linhaCompleta.setMap(mapRef.current);
    overlaysRef.current.push(linhaCompletaHalo, linhaCompleta);

    if (caminhoTrecho.length > 1) {
      const linhaTrechoHalo = new w.google.maps.Polyline({
        path: caminhoTrecho,
        geodesic: true,
        strokeColor: "#111827",
        strokeOpacity: 0.85,
        strokeWeight: 14,
        zIndex: 20,
      });
      const linhaTrecho = new w.google.maps.Polyline({
        path: caminhoTrecho,
        geodesic: true,
        strokeColor: "#fbbf24",
        strokeOpacity: 1,
        strokeWeight: 5,
        zIndex: 21,
      });
      linhaTrechoHalo.setMap(mapRef.current);
      linhaTrecho.setMap(mapRef.current);
      overlaysRef.current.push(linhaTrechoHalo, linhaTrecho);
    }

    const pontoInicio = pontos[inicio];
    const pontoFim = pontos[fim];

    const markerInicio = new w.google.maps.Marker({
      position: pontoGoogle(pontoInicio),
      map: mapRef.current,
      title: "Início do trecho",
      zIndex: 40,
      label: { text: "I", color: "#ffffff", fontWeight: "900" },
      icon: {
        path: w.google.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: "#10b981",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
    });

    const markerFim = new w.google.maps.Marker({
      position: pontoGoogle(pontoFim),
      map: mapRef.current,
      title: "Fim do trecho",
      zIndex: 41,
      label: { text: "F", color: "#020617", fontWeight: "900" },
      icon: {
        path: w.google.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: "#fbbf24",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
    });

    overlaysRef.current.push(markerInicio, markerFim);

    (portosDetectados || []).forEach((porto, index) => {
      const markerPorto = new w.google.maps.Marker({
        position: { lat: porto.latitude, lng: porto.longitude },
        map: mapRef.current,
        title: porto.nome,
        zIndex: 50,
        label: { text: String(index + 1), color: "#ffffff", fontWeight: "900" },
        icon: {
          path: w.google.maps.SymbolPath.CIRCLE,
          scale: 15,
          fillColor: "#7c3aed",
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
      overlaysRef.current.push(markerPorto);
    });

    const pontosParaClique =
      pontos.length <= 160
        ? pontos
        : pontos.filter((_, index) => {
            const passo = Math.ceil(pontos.length / 160);
            return index % passo === 0 || index === 0 || index === pontos.length - 1;
          });

    pontosParaClique.forEach((ponto) => {
      const indexReal = pontos.indexOf(ponto);
      const markerPonto = new w.google.maps.Marker({
        position: pontoGoogle(ponto),
        map: mapRef.current,
        title: `Ponto ${indexReal}`,
        zIndex: 30,
        icon: {
          path: w.google.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: "#ffffff",
          fillOpacity: 0.8,
          strokeColor: "#0f172a",
          strokeWeight: 1,
        },
      });

      markerPonto.addListener("click", () => {
        const distInicio = Math.abs(indexReal - indiceInicio);
        const distFim = Math.abs(indexReal - indiceFim);
        if (distInicio <= distFim) setIndiceInicio(indexReal);
        else setIndiceFim(indexReal);
      });

      overlaysRef.current.push(markerPonto);
    });

    return () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [
    mapsCarregado,
    pontos,
    pontosTrecho,
    inicio,
    fim,
    indiceInicio,
    indiceFim,
    setIndiceInicio,
    setIndiceFim,
    portosDetectados,
  ]);

  if (!rota) {
    return (
      <div className="p-5">
        <div className="flex h-[430px] items-center justify-center rounded-3xl border border-dashed border-white/10 bg-[#0d0c2c] text-center text-sm text-slate-500">
          Selecione uma rota histórica para editar ou reconhecer automaticamente.
        </div>
      </div>
    );
  }

  if (pontos.length < 2) {
    return (
      <div className="p-5">
        <div className="flex h-[430px] items-center justify-center rounded-3xl border border-dashed border-amber-400/20 bg-amber-400/5 p-8 text-center text-sm text-amber-200">
          Esta rota ainda não tem pontos suficientes para edição.
        </div>
      </div>
    );
  }

  const maxIndex = Math.max(0, pontos.length - 1);

  return (
    <div className="grid gap-4 p-5 xl:grid-cols-[1fr_300px]">
      <div className="relative h-[430px] overflow-hidden rounded-3xl border border-sky-400/10 bg-[#0d0c2c]">
        {erroMapa ? (
          <MapaFallback pontos={pontos} pontosTrecho={pontosTrecho} erro={erroMapa} />
        ) : (
          <div ref={mapDivRef} className="h-full w-full" />
        )}
      </div>

      <aside className="rounded-3xl border border-white/5 bg-[#0d0c2c] p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          Ajuste fino
        </p>
        <h3 className="mt-2 text-xl font-black text-white">
          {rota.origem || "Origem"} → {rota.destino || "Destino"}
        </h3>
        <p className="mt-2 text-xs text-slate-500">
          Clique nos pontos do mapa ou ajuste os controles para cortar o trecho.
        </p>

        <div className="mt-5 grid gap-5">
          <label>
            <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase text-slate-500">
              <span>Início</span>
              <span>{indiceInicio}</span>
            </div>
            <input
              type="range"
              min={0}
              max={maxIndex}
              value={indiceInicio}
              onChange={(e) => setIndiceInicio(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label>
            <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase text-slate-500">
              <span>Fim</span>
              <span>{indiceFim}</span>
            </div>
            <input
              type="range"
              min={0}
              max={maxIndex}
              value={indiceFim}
              onChange={(e) => setIndiceFim(Number(e.target.value))}
              className="w-full"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setIndiceInicio(0);
                setIndiceFim(maxIndex);
              }}
              className="rounded-xl border border-slate-600/30 bg-slate-900 px-3 py-2 text-[10px] font-black uppercase text-slate-300 hover:bg-slate-800"
            >
              Rota inteira
            </button>
            <button
              onClick={() => {
                const meio = Math.floor(maxIndex / 2);
                setIndiceInicio(0);
                setIndiceFim(meio);
              }}
              className="rounded-xl border border-slate-600/30 bg-slate-900 px-3 py-2 text-[10px] font-black uppercase text-slate-300 hover:bg-slate-800"
            >
              Primeira metade
            </button>
          </div>

          <div className="rounded-2xl border border-emerald-400/10 bg-emerald-400/5 p-4">
            <p className="text-xs leading-5 text-slate-400">
              Portos reconhecidos aparecem em roxo no mapa. O trecho selecionado aparece
              em amarelo.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function MapaFallback({
  pontos,
  pontosTrecho,
  erro,
}: {
  pontos: PontoGps[];
  pontosTrecho: PontoGps[];
  erro: string;
}) {
  if (pontos.length < 2) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-amber-200">
        {erro}
      </div>
    );
  }

  const bounds = calcularBoundsPontos(pontos);
  const pathCompleto = montarPathSvg(pontos, bounds);
  const pathTrecho = montarPathSvg(pontosTrecho, bounds);

  return (
    <div className="relative h-full w-full p-4">
      <div className="absolute left-4 right-4 top-4 z-10 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs font-bold text-amber-200">
        {erro}
      </div>
      <svg viewBox="0 0 1000 360" className="h-full w-full rounded-2xl bg-slate-950">
        <path
          d={pathCompleto}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="4"
          opacity="0.85"
        />
        {pontosTrecho.length > 1 && (
          <path d={pathTrecho} fill="none" stroke="#fbbf24" strokeWidth="7" opacity="1" />
        )}
      </svg>
    </div>
  );
}

function ModalCard({
  titulo,
  children,
  onFechar,
}: {
  titulo: string;
  children: React.ReactNode;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#143760] p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-white">{titulo}</h2>
          <button
            onClick={onFechar}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-slate-300 hover:bg-white/10"
          >
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AbaBotao({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border px-4 py-2 text-xs font-black uppercase transition ${
        ativa
          ? "border-sky-400/40 bg-sky-400/20 text-sky-200"
          : "border-white/5 bg-[#0d0c2c]/70 text-slate-400 hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

function Resumo({
  label,
  valor,
  detalhe,
}: {
  label: string;
  valor: number;
  detalhe: string;
}) {
  return (
    <div className="rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
      <p className="text-2xl font-black text-white">{valor}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xs text-slate-600">{detalhe}</p>
    </div>
  );
}

function Mini({ label, valor }: { label: string; valor: any }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/80 p-3">
      <p className="text-[9px] font-black uppercase text-slate-600">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-slate-200">{valor}</p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder: string;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-slate-500">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/5 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
      />
    </label>
  );
}
