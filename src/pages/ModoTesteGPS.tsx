import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type PontoTeste = {
  nome: string;
  cidade: string;
  latitude: string;
  longitude: string;
};

const PONTOS_INICIAIS: PontoTeste[] = [
  { nome: "TESTE_CASA", cidade: "Origem", latitude: "", longitude: "" },
  { nome: "TESTE_PONTO_2", cidade: "Escala 1", latitude: "", longitude: "" },
  { nome: "TESTE_PONTO_3", cidade: "Escala 2", latitude: "", longitude: "" },
  { nome: "TESTE_DESTINO", cidade: "Destino", latitude: "", longitude: "" },
];

function normalizarId(valor: string) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function corrigirCoordenada(valor: any, maximo: number) {
  if (valor === null || valor === undefined || valor === "") return null;

  let n = Number(String(valor).replace(",", "."));

  if (!Number.isFinite(n)) return null;

  // Corrige coordenada digitada sem ponto decimal.
  // Exemplo: -5611092 vira -56.11092.
  while (Math.abs(n) > maximo && Math.abs(n) > 1) {
    n = n / 10;
  }

  return Number.isFinite(n) ? n : null;
}

function numeroLatitude(valor: any) {
  const n = corrigirCoordenada(valor, 90);
  return n !== null && n >= -90 && n <= 90 ? n : null;
}

function numeroLongitude(valor: any) {
  const n = corrigirCoordenada(valor, 180);
  return n !== null && n >= -180 && n <= 180 ? n : null;
}

function extrairCoordenadasTerminal(dados: any) {
  const c = dados?.coordenadas || dados?.coordenada || {};

  let lat = numeroLatitude(c.lat ?? c.latitude ?? dados?.lat ?? dados?.latitude);
  let lng = numeroLongitude(c.lng ?? c.longitude ?? dados?.lng ?? dados?.longitude);

  // Recupera o caso que apareceu no seu Firebase:
  // coordenadas.lng recebeu latitude e coordenadas.longitude recebeu longitude sem ponto.
  if (lat === null && numeroLatitude(c.lng) !== null) {
    lat = numeroLatitude(c.lng);
  }

  if (lng === null && numeroLongitude(c.longitude) !== null) {
    lng = numeroLongitude(c.longitude);
  }

  return { lat, lng };
}

function formatarCoord(valor: number | null) {
  if (valor === null || !Number.isFinite(valor)) return "";
  return String(Number(valor.toFixed(7)));
}

function pontoValido(ponto: PontoTeste) {
  const lat = numeroLatitude(ponto.latitude);
  const lng = numeroLongitude(ponto.longitude);

  return ponto.nome.trim() && lat !== null && lng !== null;
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

function formatarTempo(minutos: number) {
  if (!Number.isFinite(minutos) || minutos <= 0) return "—";
  if (minutos < 60) return `${Math.round(minutos)} min`;

  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);

  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export default function ModoTesteGPS() {
  const modal = useAppModal();
  const alert = (mensagem: any) => {
    void modal.aviso("Aviso do sistema", String(mensagem));
  };

  const [barcoId, setBarcoId] = useState("CARRO_TESTE");
  const [nomeBarco, setNomeBarco] = useState("Carro Teste GPS");
  const [raioChegadaMetros, setRaioChegadaMetros] = useState("150");
  const [velocidadeMediaKmh, setVelocidadeMediaKmh] = useState("35");
  const [pontos, setPontos] = useState<PontoTeste[]>(PONTOS_INICIAIS);
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [carregouExistente, setCarregouExistente] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "terminais"), (snapshot) => {
      const pontosTeste = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((dados: any) => dados.modoTeste === true || dados.tipo === "teste_gps")
        .map((dados: any) => {
          const coordenadas = extrairCoordenadasTerminal(dados);

          return {
            nome: String(dados.nome || dados.porto || dados.id || ""),
            cidade: String(dados.cidade || "Teste GPS"),
            latitude: formatarCoord(coordenadas.lat),
            longitude: formatarCoord(coordenadas.lng),
          };
        })
        .filter((ponto) => ponto.nome)
        .sort((a, b) => a.nome.localeCompare(b.nome));

      if (pontosTeste.length > 0 && !carregouExistente) {
        setPontos(pontosTeste);
        setCarregouExistente(true);
      }
    });

    return () => unsubscribe();
  }, [carregouExistente]);

  const pontosValidos = useMemo(
    () => pontos.filter((ponto) => pontoValido(ponto)),
    [pontos],
  );

  const distanciaTotalKm = useMemo(() => {
    if (pontosValidos.length < 2) return 0;

    let total = 0;

    for (let i = 1; i < pontosValidos.length; i += 1) {
      const anterior = pontosValidos[i - 1];
      const atual = pontosValidos[i];

      total += calcularDistanciaKm(
        numeroLatitude(anterior.latitude) || 0,
        numeroLongitude(anterior.longitude) || 0,
        numeroLatitude(atual.latitude) || 0,
        numeroLongitude(atual.longitude) || 0,
      );
    }

    return total;
  }, [pontosValidos]);

  const tempoEstimadoMin = useMemo(() => {
    const velocidade = Number(velocidadeMediaKmh);

    if (!Number.isFinite(velocidade) || velocidade <= 0) return 0;

    return (distanciaTotalKm / velocidade) * 60;
  }, [distanciaTotalKm, velocidadeMediaKmh]);

  const atualizarPonto = (index: number, campo: keyof PontoTeste, valor: string) => {
    setPontos((atuais) =>
      atuais.map((ponto, i) =>
        i === index
          ? {
              ...ponto,
              [campo]: valor,
            }
          : ponto,
      ),
    );
  };

  const removerPonto = async (index: number) => {
    const ponto = pontos[index];

    if (index === 0 || index === pontos.length - 1) {
      await modal.aviso(
        "Ponto fixo",
        "Origem e destino são pontos fixos da rota de teste e não podem ser removidos.",
      );
      return;
    }

    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Remover ponto?",
      mensagem: `Remover ${ponto.nome || "este ponto"} da rota de teste?\n\nEle também será removido dos terminais de teste no Firebase.`,
      confirmarTexto: "Remover",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    try {
      if (ponto.nome.trim()) {
        await deleteDoc(doc(db, "terminais", normalizarId(ponto.nome)));
      }

      setPontos((atuais) => atuais.filter((_, i) => i !== index));
    } catch (error: any) {
      await modal.erro(
        "Erro ao remover ponto",
        error?.message || "Não foi possível remover o ponto de teste.",
      );
    }
  };

  const usarLocalizacaoAtual = (index: number) => {
    if (!navigator.geolocation) {
      alert("Seu navegador não permitiu pegar a localização.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        atualizarPonto(index, "latitude", String(posicao.coords.latitude));
        atualizarPonto(index, "longitude", String(posicao.coords.longitude));
      },
      () => {
        alert("Não foi possível pegar sua localização atual.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      },
    );
  };

  const montarEscalas = (lista: PontoTeste[]) => {
    return lista.map((ponto, index) => {
      const id = normalizarId(ponto.nome);
      const lat = numeroLatitude(ponto.latitude) || 0;
      const lng = numeroLongitude(ponto.longitude) || 0;

      return {
        id,
        ordem: index + 1,
        nome: ponto.nome.trim(),
        porto: ponto.nome.trim(),
        cidade: ponto.cidade.trim() || ponto.nome.trim(),
        local: ponto.nome.trim(),
        latitude: lat,
        longitude: lng,
        coordenadas: {
          lat,
          lng,
          latitude: lat,
          longitude: lng,
        },
        modoTeste: true,
      };
    });
  };

  const criarAmbienteTeste = async () => {
    try {
      const idBarco = normalizarId(barcoId).toUpperCase();

      if (!idBarco) {
        alert("Informe o ID do teste.");
        return;
      }

      if (pontosValidos.length < 2) {
        alert("Informe pelo menos origem e destino com latitude/longitude.");
        return;
      }

      setSalvando(true);

      const raio = Number(raioChegadaMetros) || 150;
      const velocidade = Number(velocidadeMediaKmh) || 35;
      const escalasIda = montarEscalas(pontosValidos);
      const escalasVolta = [...escalasIda].reverse().map((ponto, index) => ({
        ...ponto,
        ordem: index + 1,
      }));

      await Promise.all(
        escalasIda.map((ponto) =>
          setDoc(
            doc(db, "terminais", ponto.id),
            {
              id: ponto.id,
              nome: ponto.nome,
              porto: ponto.nome,
              cidade: ponto.cidade,
              coordenadas: ponto.coordenadas,
              modoTeste: true,
              tipo: "teste_gps",
              atualizadoEm: serverTimestamp(),
              criadoEm: serverTimestamp(),
            },
            { merge: true },
          ),
        ),
      );

      await setDoc(
        doc(db, "embarcacoes", idBarco),
        {
          id: idBarco,
          nome: nomeBarco || idBarco,
          tipo: "teste_gps",
          modoTeste: true,
          ativo: true,
          status: "teste",
          sentido: "ida",
          velocidadeMediaTesteKmh: velocidade,
          raioChegadaMetros: raio,
          rotaIda: {
            portoOrigem: escalasIda[0]?.nome || "",
            origem: escalasIda[0]?.nome || "",
            destino: escalasIda[escalasIda.length - 1]?.nome || "",
            escalas: escalasIda,
            itinerario: escalasIda,
          },
          rotaVolta: {
            portoOrigem: escalasVolta[0]?.nome || "",
            origem: escalasVolta[0]?.nome || "",
            destino: escalasVolta[escalasVolta.length - 1]?.nome || "",
            escalas: escalasVolta,
            itinerario: escalasVolta,
          },
          atualizadoEm: serverTimestamp(),
          criadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      await setDoc(
        doc(db, "grades_viagens", `${idBarco}_ida`),
        {
          barcoId: idBarco,
          nomeBarco: nomeBarco || idBarco,
          sentido: "ida",
          modoTeste: true,
          raioChegadaMetros: raio,
          velocidadeMediaTesteKmh: velocidade,
          origem: escalasIda[0]?.nome || "",
          destino: escalasIda[escalasIda.length - 1]?.nome || "",
          portoOrigem: escalasIda[0]?.nome || "",
          escalas: escalasIda,
          itinerario: escalasIda,
          ativa: true,
          atualizadoEm: serverTimestamp(),
          criadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      await setDoc(
        doc(db, "grades_viagens", `${idBarco}_volta`),
        {
          barcoId: idBarco,
          nomeBarco: nomeBarco || idBarco,
          sentido: "volta",
          modoTeste: true,
          raioChegadaMetros: raio,
          velocidadeMediaTesteKmh: velocidade,
          origem: escalasVolta[0]?.nome || "",
          destino: escalasVolta[escalasVolta.length - 1]?.nome || "",
          portoOrigem: escalasVolta[0]?.nome || "",
          escalas: escalasVolta,
          itinerario: escalasVolta,
          ativa: true,
          atualizadoEm: serverTimestamp(),
          criadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      await modal.sucesso(
        "Modo Teste GPS salvo",
        `Modo Teste GPS criado para ${idBarco}.\nConfigure o rastreador com barcoId=${idBarco}.`,
      );
    } catch (error: any) {
      alert(error?.message || "Erro ao criar ambiente de teste.");
    } finally {
      setSalvando(false);
    }
  };

  const apagarAmbienteTeste = async () => {
    try {
      const idBarco = normalizarId(barcoId).toUpperCase();

      if (!idBarco) {
        alert("Informe o ID do teste.");
        return;
      }

      const confirmou = await modal.confirmar({
        tipo: "warning",
        titulo: "Apagar ambiente de teste?",
        mensagem: "Apagar embarcação, terminais e grades de teste?",
        confirmarTexto: "Apagar",
        cancelarTexto: "Cancelar",
      });

      if (!confirmou) return;

      setApagando(true);

      await Promise.all([
        deleteDoc(doc(db, "embarcacoes", idBarco)),
        deleteDoc(doc(db, "grades_viagens", `${idBarco}_ida`)),
        deleteDoc(doc(db, "grades_viagens", `${idBarco}_volta`)),
        ...pontos.map((ponto) =>
          ponto.nome.trim()
            ? deleteDoc(doc(db, "terminais", normalizarId(ponto.nome)))
            : Promise.resolve(),
        ),
      ]);

      await modal.sucesso(
        "Ambiente apagado",
        "Ambiente de teste apagado. Os pontos de rastreamento não são apagados por segurança.",
      );
    } catch (error: any) {
      alert(error?.message || "Erro ao apagar ambiente de teste.");
    } finally {
      setApagando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0c2c] p-4 text-slate-900 xl:p-5">
      <section className="mb-5 overflow-hidden rounded-[22px] bg-[#363636] shadow-sm">
        <div className="flex flex-col gap-4  bg-[#0d0c2c] from-[#0f2240] to-[#17345e] px-5 py-5 text-white xl:flex-row xl:items-center xl:justify-between xl:px-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Modo Teste GPS</h1>
            <p className="mt-1 text-sm text-blue-100/90">
              Configure o trajeto de teste e valide o rastreador antes da instalação
              final.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 xl:w-[600px]">
            <Mini label="Pontos" valor={pontosValidos.length} destaque="azul" compacto />
            <Mini
              label="Distância"
              valor={`${distanciaTotalKm.toFixed(1)} km`}
              destaque="verde"
              compacto
            />
            <Mini
              label="Tempo"
              valor={formatarTempo(tempoEstimadoMin)}
              destaque="ambar"
              compacto
            />
            <Mini label="Status" valor="modoTeste=true" destaque="slate" compacto />
          </div>
        </div>

        <div className="grid gap-3 bg-[#0d0c2c] p-4 md:grid-cols-2 xl:grid-cols-4 xl:px-5 xl:py-4">
          <Input
            label="ID do teste no rastreador"
            value={barcoId}
            onChange={setBarcoId}
          />
          <Input label="Nome exibido" value={nomeBarco} onChange={setNomeBarco} />
          <Input
            label="Raio de chegada (m)"
            value={raioChegadaMetros}
            onChange={setRaioChegadaMetros}
          />
          <Input
            label="Velocidade média teste (km/h)"
            value={velocidadeMediaKmh}
            onChange={setVelocidadeMediaKmh}
          />
        </div>
      </section>

      <section className="rounded-[22px] bg-gradient-to-br from-[#0f2240] to-[#13345d] p-4 shadow-sm xl:p-4">
        <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end">
          <button
            onClick={() =>
              setPontos((atuais) => {
                const quantidadeEscalas = Math.max(1, atuais.length - 1);

                const novoPonto = {
                  nome: `TESTE_PONTO_${quantidadeEscalas}`,
                  cidade: `Escala ${quantidadeEscalas}`,
                  latitude: "",
                  longitude: "",
                };

                if (atuais.length < 2) {
                  return [...atuais, novoPonto];
                }

                return [
                  ...atuais.slice(0, atuais.length - 1),
                  novoPonto,
                  atuais[atuais.length - 1],
                ];
              })
            }
            className="rounded-xl border border-[#8fb2da]/40 bg-[#3d6ca3] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-[#0d0c2c]/45"
          >
            Adicionar ponto
          </button>
        </div>

        <div className="grid gap-2">
          {pontos.map((ponto, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-2xl   bg-[#2b5b91]/35 p-2.5 shadow-sm xl:grid-cols-[58px_1fr_1fr_1fr_1fr_132px]"
            >
              <div className="rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] px-2 py-2 text-center">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-sky-100/60">
                  {index === 0
                    ? "Origem"
                    : index === pontos.length - 1
                      ? "Destino"
                      : "Ordem"}
                </p>
                <p className="mt-1 text-base font-black text-white">{index + 1}</p>
              </div>

              <Input
                label="Nome"
                value={ponto.nome}
                onChange={(valor) => atualizarPonto(index, "nome", valor)}
                compacto
              />
              <Input
                label="Cidade/Tipo"
                value={ponto.cidade}
                onChange={(valor) => atualizarPonto(index, "cidade", valor)}
                compacto
              />
              <Input
                label="Latitude"
                value={ponto.latitude}
                onChange={(valor) => atualizarPonto(index, "latitude", valor)}
                compacto
              />
              <Input
                label="Longitude"
                value={ponto.longitude}
                onChange={(valor) => atualizarPonto(index, "longitude", valor)}
                compacto
              />

              <div className="flex place-items-center mt-2.5 gap-1">
                <button
                  onClick={() => usarLocalizacaoAtual(index)}
                  className="w-full rounded-xl border border-emerald-300/35 bg-emerald-500/10 px-2.5 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-emerald-200 transition hover:bg-emerald-500/20"
                >
                  Localização
                </button>

                {pontos.length > 2 && index !== 0 && index !== pontos.length - 1 && (
                  <button
                    onClick={() => removerPonto(index)}
                    className="rounded-xl border border-red-300/35 bg-red-500/10 px-2.5 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-red-200 transition hover:bg-red-500/20"
                  >
                    X
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 xl:flex-row">
          <button
            onClick={criarAmbienteTeste}
            disabled={salvando}
            className="rounded-xl border border-emerald-300 bg-[#dff4e7] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-800 transition hover:bg-emerald-200 disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Salvar / atualizar teste"}
          </button>

          <button
            onClick={apagarAmbienteTeste}
            disabled={apagando}
            className="rounded-xl border border-red-300 bg-[#f8e1e1] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] text-red-800 transition hover:bg-red-200 disabled:opacity-60"
          >
            {apagando ? "Apagando..." : "Apagar ambiente de teste"}
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-[20px] border border-[#7ba6d4]/25 bg-[#0f2240] p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-sm font-black text-white">Fluxo de teste</h2>
            <p className="mt-1 text-xs text-sky-100/55">
              Siga esta ordem para validar a rota antes de transformar em rota oficial.
            </p>
          </div>

          <div className="rounded-2xl border border-sky-300/25 bg-sky-300/10 px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-sky-100/55">
              Identificação do rastreador
            </p>
            <p className="mt-1 text-sm font-black text-white">
              {normalizarId(barcoId).toUpperCase()}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/50">
              Preparação
            </p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-sky-100/75">
              <p>1. Crie a origem, as escalas e o destino.</p>
              <p>2. Salve ou atualize o ambiente de teste.</p>
              <p>3. Configure o rastreador usando a identificação mostrada acima.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/50">
              Validação
            </p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-sky-100/75">
              <p>4. Faça o percurso de ida e depois o retorno.</p>
              <p>5. Confira se o sistema reconhece origem, escalas e destino.</p>
              <p>6. Depois salve a rota em Rotas como oficial.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  compacto = false,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  compacto?: boolean;
}) {
  return (
    <label>
      <p className="mb-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-sky-100/60">
        {label}
      </p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] px-3 ${
          compacto ? "py-2 text-[12px]" : "py-2.5 text-sm"
        } font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 focus:bg-[#1d426b]`}
      />
    </label>
  );
}

function Mini({
  label,
  valor,
  destaque = "slate",
  compacto = false,
}: {
  label: string;
  valor: any;
  destaque?: "azul" | "verde" | "ambar" | "slate";
  compacto?: boolean;
}) {
  const estilos = {
    azul: "border-sky-300/25 bg-sky-300/10 text-sky-100",
    verde: "border-emerald-300/25 bg-emerald-500/10 text-emerald-100",
    ambar: "border-amber-300/25 bg-amber-500/10 text-amber-100",
    slate: "border-[#7ba6d4]/25 bg-[#143760] text-sky-100",
  };

  return (
    <div
      className={`rounded-2xl border shadow-sm ${compacto ? "p-3" : "p-4"} ${estilos[destaque]}`}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-100/60">
        {label}
      </p>
      <p
        className={`truncate font-black text-white ${compacto ? "mt-0.5 text-[13px]" : "mt-1 text-sm"}`}
      >
        {valor}
      </p>
    </div>
  );
}
