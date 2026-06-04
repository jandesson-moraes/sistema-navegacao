import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
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

function escalaBasica(nome: string, ordem: number) {
  const nomeLimpo = String(nome || "").trim();

  return {
    id: normalizarEscalaId(nomeLimpo || `escala_${ordem}`),
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
}: {
  nome: string;
  origem: string;
  destino: string;
  sentido: string;
  pontos?: any[];
  distanciaKm?: any;
  tempoTotalMin?: any;
}) {
  const origemLimpa = String(origem || "").trim();
  const destinoLimpo = String(destino || "").trim();
  const escalas = [escalaBasica(origemLimpa, 0), escalaBasica(destinoLimpo, 1)].filter(
    (item) => item.nome,
  );

  return {
    nome: nome || `${origemLimpa} → ${destinoLimpo}`,
    sentido,
    origem: origemLimpa,
    destino: destinoLimpo,
    portoOrigem: origemLimpa,
    portoDestino: destinoLimpo,
    escalas,
    itinerario: escalas,
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
}: {
  barcoId: string;
  nome: string;
  origem: string;
  destino: string;
  sentido: string;
  pontos?: any[];
  distanciaKm?: any;
  tempoTotalMin?: any;
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

export default function Rotas() {
  const modal = useAppModal();
  const alert = (mensagem: any) => {
    void modal.aviso("Aviso do sistema", String(mensagem));
  };

  const [barcos, setBarcos] = useState<any[]>([]);
  const [historicas, setHistoricas] = useState<any[]>([]);
  const [oficiais, setOficiais] = useState<any[]>([]);
  const [trechos, setTrechos] = useState<any[]>([]);

  const [barcoId, setBarcoId] = useState("");
  const [nome, setNome] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [sentido, setSentido] = useState("ida");
  const [salvarComoOficial, setSalvarComoOficial] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");

  const [rotaMapa, setRotaMapa] = useState<any | null>(null);
  const [indiceInicio, setIndiceInicio] = useState(0);
  const [indiceFim, setIndiceFim] = useState(0);
  const [origemTrecho, setOrigemTrecho] = useState("");
  const [destinoTrecho, setDestinoTrecho] = useState("");
  const [nomeTrecho, setNomeTrecho] = useState("");
  const [sentidoTrecho, setSentidoTrecho] = useState("ida");
  const [salvandoTrecho, setSalvandoTrecho] = useState(false);

  useEffect(() => {
    const unsubBarcos = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .sort((a: any, b: any) =>
          String(a.nome || a.id).localeCompare(String(b.nome || b.id)),
        );

      setBarcos(lista);

      if (!barcoId && lista.length > 0) {
        setBarcoId(lista[0].id);
      }
    });

    const qHistoricas = query(
      collection(db, "rotas_historicas"),
      orderBy("criadoEm", "desc"),
      limit(100),
    );

    const unsubHistoricas = onSnapshot(qHistoricas, (snapshot) => {
      setHistoricas(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });

    const unsubOficiais = onSnapshot(collection(db, "rotas_oficiais"), (snapshot) => {
      const lista = snapshot.docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .sort(
          (a: any, b: any) =>
            dataMs(b.atualizadoEm || b.criadoEm) - dataMs(a.atualizadoEm || a.criadoEm),
        );

      setOficiais(lista);
    });

    const unsubTrechos = onSnapshot(collection(db, "trechos_oficiais"), (snapshot) => {
      const lista = snapshot.docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .sort((a: any, b: any) =>
          String(a.origemNome || a.origem).localeCompare(
            String(b.origemNome || b.origem),
          ),
        );

      setTrechos(lista);
    });

    return () => {
      unsubBarcos();
      unsubHistoricas();
      unsubOficiais();
      unsubTrechos();
    };
  }, [barcoId]);

  const barcoSelecionado = useMemo(
    () => barcos.find((b) => b.id === barcoId) || null,
    [barcos, barcoId],
  );

  const historicasFiltradas = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return historicas.filter((rota) => {
      if (!texto) return true;

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
        .includes(texto);
    });
  }, [historicas, busca]);

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

  useEffect(() => {
    if (rotaMapa?.id) {
      const aindaExiste = [...historicas, ...oficiais].some(
        (rota) => rota.id === rotaMapa.id,
      );

      if (aindaExiste) return;
    }

    setRotaMapa(oficiais[0] || historicas[0] || null);
  }, [historicas, oficiais, rotaMapa?.id]);

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

  return (
    <div className="min-h-screen bg-[#0d0c2c] p-6 text-white">
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Resumo label="Históricas" valor={historicas.length} detalhe="rotas salvas" />
        <Resumo label="Oficiais" valor={oficiais.length} detalhe="rotas ativas" />
        <Resumo label="Trechos" valor={trechos.length} detalhe="reaproveitáveis" />
        <Resumo label="Barcos" valor={barcos.length} detalhe="na frota" />
      </div>

      <section className="mb-6 overflow-hidden rounded-3xl border border-white/5 bg-[#143760]/80">
        <div className="flex flex-col gap-3 border-b border-white/5 p-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-black">Editor de trecho oficial</h2>
          </div>

          {rotaMapa && (
            <div className="rounded-2xl border border-sky-400/10 bg-sky-400/10 px-4 py-3 text-xs font-bold text-sky-200">
              {rotaMapa.nome || "Rota selecionada"}
            </div>
          )}
        </div>

        <RotaMapaEditor
          rota={rotaMapa}
          indiceInicio={indiceInicio}
          indiceFim={indiceFim}
          setIndiceInicio={setIndiceInicio}
          setIndiceFim={setIndiceFim}
        />

        {rotaMapa && (
          <div className="border-t border-white/5 p-5">
            <div className="grid gap-4 xl:grid-cols-5">
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

            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Mini label="Ponto inicial" valor={indiceInicio} />
              <Mini label="Ponto final" valor={indiceFim} />
              <Mini label="Pontos no trecho" valor={pontosTrechoSelecionado.length} />
              <Mini
                label="Distância do trecho"
                valor={`${distanciaTrechoKm.toFixed(1)} km`}
              />
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.4fr]">
        <section className="rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
          <h2 className="text-lg font-black">Salvar rota atual do rastreador</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Use quando o barco terminar ou estiver fazendo uma viagem real. O sistema lê
            os pontos em rastreamento/barco/pontos.
          </p>

          <div className="mt-5 grid gap-4">
            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                Barco
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

            <label className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#0d0c2c] p-4">
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
              className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-5 py-4 text-xs font-black uppercase text-sky-300 hover:bg-sky-400/20 disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar rota atual"}
            </button>
          </div>

          {barcoSelecionado && (
            <div className="mt-5 rounded-2xl border border-white/5 bg-[#0d0c2c] p-4">
              <p className="text-[10px] font-black uppercase text-slate-500">
                Barco selecionado
              </p>
              <p className="mt-1 text-sm font-black text-white">
                {barcoSelecionado.nome || barcoSelecionado.id}
              </p>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border border-white/5 bg-[#143760]/80">
          <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
            <div>
              <h2 className="text-lg font-black">Rotas históricas</h2>
              <p className="mt-1 text-xs text-slate-500">
                Abra uma rota para editar e transformar em trecho oficial.
              </p>
            </div>
          </div>

          <div className="max-h-[calc(100vh-330px)] overflow-hidden p-4">
            {historicasFiltradas.map((rota) => (
              <div
                key={rota.id}
                className="mb-3 rounded-2xl border border-white/5 bg-[#0d0c2c]/70 p-4"
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
                      onClick={() => setRotaMapa(rota)}
                      className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-black uppercase text-sky-300 hover:bg-sky-400/20"
                    >
                      Editar trecho
                    </button>

                    <button
                      onClick={() => definirComoOficial(rota)}
                      className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20"
                    >
                      Definir rota oficial
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
                    valor={
                      rota.velocidadeMediaKmh ? `${rota.velocidadeMediaKmh} km/h` : "—"
                    }
                  />
                  <Mini
                    label="Pontos"
                    valor={rota.totalPontosSalvos || rota.pontos?.length || "—"}
                  />
                  <Mini label="Criada" valor={formatarData(rota.criadoEm)} />
                </div>
              </div>
            ))}

            {historicasFiltradas.length === 0 && (
              <div className="rounded-2xl border border-white/5 bg-[#0d0c2c] p-8 text-center text-slate-500">
                Nenhuma rota histórica encontrada.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
        <h2 className="text-lg font-black">Trechos oficiais reutilizáveis</h2>
        <p className="mt-1 text-xs text-slate-500">
          Esses trechos são a base da malha inteligente. Depois eles serão combinados
          automaticamente quando o armador cadastrar uma viagem.
        </p>

        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {trechos.map((trecho) => (
            <div
              key={trecho.id}
              className="rounded-2xl border border-emerald-400/10 bg-[#0d0c2c]/70 p-4"
            >
              <p className="text-sm font-black text-white">{trecho.nome || trecho.id}</p>
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
            </div>
          ))}

          {trechos.length === 0 && (
            <div className="rounded-2xl border border-white/5 bg-[#0d0c2c] p-6 text-slate-500">
              Nenhum trecho oficial criado ainda.
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-white/5 bg-[#143760]/80 p-5">
        <h2 className="text-lg font-black">Rotas oficiais ativas</h2>

        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {oficiais.map((rota) => (
            <div
              key={rota.id}
              className="rounded-2xl border border-sky-400/10 bg-[#0d0c2c]/70 p-4"
            >
              <p className="text-sm font-black text-white">{rota.nome || rota.id}</p>
              <p className="mt-1 text-xs text-slate-500">
                {rota.nomeBarco || rota.barcoId} • {rota.origem || "Origem"} →{" "}
                {rota.destino || "Destino"}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Mini label="Km" valor={rota.distanciaKm ? `${rota.distanciaKm}` : "—"} />
                <Mini label="Tempo" valor={tempoTexto(rota.tempoTotalMin)} />
                <Mini
                  label="Pontos"
                  valor={rota.totalPontosSalvos || rota.pontos?.length || "—"}
                />
              </div>

              <button
                onClick={() => setRotaMapa(rota)}
                className="mt-3 w-full rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-black uppercase text-sky-300 hover:bg-sky-400/20"
              >
                Editar trecho dessa rota
              </button>
            </div>
          ))}

          {oficiais.length === 0 && (
            <div className="rounded-2xl border border-white/5 bg-[#0d0c2c] p-6 text-slate-500">
              Nenhuma rota oficial definida ainda.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function extrairPontosRota(rota: any) {
  const pontos = Array.isArray(rota?.pontos) ? rota.pontos : [];

  return pontos
    .map((p: any) => ({
      latitude: Number(p.latitude ?? p.lat),
      longitude: Number(p.longitude ?? p.lng),
      velocidade: p.velocidade,
      criado_em: p.criado_em,
    }))
    .filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        p.latitude !== 0 &&
        p.longitude !== 0,
    );
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

function RotaMapaEditor({
  rota,
  indiceInicio,
  indiceFim,
  setIndiceInicio,
  setIndiceFim,
}: {
  rota: any | null;
  indiceInicio: number;
  indiceFim: number;
  setIndiceInicio: (valor: number) => void;
  setIndiceFim: (valor: number) => void;
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
          {
            featureType: "poi",
            stylers: [{ visibility: "off" }],
          },
          {
            featureType: "transit",
            stylers: [{ visibility: "off" }],
          },
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
      label: {
        text: "I",
        color: "#ffffff",
        fontWeight: "900",
      },
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
      label: {
        text: "F",
        color: "#020617",
        fontWeight: "900",
      },
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

        if (distInicio <= distFim) {
          setIndiceInicio(indexReal);
        } else {
          setIndiceFim(indexReal);
        }
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
  ]);

  if (!rota) {
    return (
      <div className="p-5">
        <div className="flex h-107.5 items-center justify-center rounded-3xl border border-dashed border-white/10 bg-[#0d0c2c] text-center text-sm text-slate-500">
          Selecione uma rota histórica para editar o trecho.
        </div>
      </div>
    );
  }

  if (pontos.length < 2) {
    return (
      <div className="p-5">
        <div className="flex h-107.5 items-center justify-center rounded-3xl border border-dashed border-amber-400/20 bg-amber-400/5 p-8 text-center text-sm text-amber-200">
          Esta rota ainda não tem pontos suficientes para edição.
        </div>
      </div>
    );
  }

  const maxIndex = Math.max(0, pontos.length - 1);

  return (
    <div className="grid gap-4 p-5 xl:grid-cols-[1fr_300px]">
      <div className="relative overflow-hidden rounded-3xl border border-sky-400/10 bg-[#0d0c2c]">
        {erroMapa ? (
          <div className="flex h-107.5 items-center justify-center p-8 text-center text-sm text-amber-200">
            {erroMapa}
          </div>
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
          O mapa usa imagem de satélite para você cortar o trecho com mais precisão.
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
              Quando salvar, este trecho entra em <b>trechos_oficiais</b> e poderá ser
              reutilizado por qualquer barco que fizer o mesmo caminho do rio.
            </p>
          </div>
        </div>
      </aside>
    </div>
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
