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

const DIAS = [
  { id: 0, nome: "Dom" },
  { id: 1, nome: "Seg" },
  { id: 2, nome: "Ter" },
  { id: 3, nome: "Qua" },
  { id: 4, nome: "Qui" },
  { id: 5, nome: "Sex" },
  { id: 6, nome: "Sáb" },
];

type Coordenadas = {
  lat: number;
  lng: number;
};

type LocalOperacional = {
  chave: string;
  id: string;
  colecao: "terminais" | "portos";
  nome: string;
  cidade: string;
  uf: string;
  coordenadas: Coordenadas | null;
  tipo?: string;
  raioChegadaMetros?: number;
  endereco?: string;
  referencia?: string;
};

type EscalaFormulario = {
  id: string;
  cidade: string;
  portoChave: string;
  diaRelativo: string;
  horarioChegada: string;
  horarioSaida: string;
};

type FormProgramacao = {
  id: string;
  barcoId: string;
  gradeId: string;
  sentido: "ida" | "volta";
  origemCidade: string;
  origemPortoChave: string;
  destinoCidade: string;
  destinoPortoChave: string;
  destinoDiaRelativo: string;
  destinoHorarioChegada: string;
  escalas: EscalaFormulario[];
  diasSemana: number[];
  horarioSaida: string;
  duracaoHoras: string;
  duracaoMinutos: string;
  timezone: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  antecedenciaExibicaoMin: string;
  toleranciaSaidaMin: string;
  velocidadeMinimaViagemKmh: string;
  ativo: boolean;
};

type AlvoCadastro =
  | { tipo: "origem" }
  | { tipo: "destino" }
  | { tipo: "escala"; escalaId: string };

type FormCidade = {
  nome: string;
  uf: string;
  pais: string;
};

type FormPorto = {
  nome: string;
  cidade: string;
  uf: string;
  tipo: string;
  latitude: string;
  longitude: string;
  raioChegadaMetros: string;
  endereco: string;
  referencia: string;
  observacoes: string;
};

const FORM_CIDADE_VAZIO: FormCidade = {
  nome: "",
  uf: "",
  pais: "Brasil",
};

const FORM_PORTO_VAZIO: FormPorto = {
  nome: "",
  cidade: "",
  uf: "",
  tipo: "porto",
  latitude: "",
  longitude: "",
  raioChegadaMetros: "500",
  endereco: "",
  referencia: "",
  observacoes: "",
};

const FORM_VAZIO: FormProgramacao = {
  id: "",
  barcoId: "",
  gradeId: "",
  sentido: "ida",
  origemCidade: "",
  origemPortoChave: "",
  destinoCidade: "",
  destinoPortoChave: "",
  destinoDiaRelativo: "0",
  destinoHorarioChegada: "",
  escalas: [],
  diasSemana: [],
  horarioSaida: "08:00",
  duracaoHoras: "24",
  duracaoMinutos: "0",
  timezone: "America/Manaus",
  vigenciaInicio: "",
  vigenciaFim: "",
  antecedenciaExibicaoMin: "120",
  toleranciaSaidaMin: "90",
  velocidadeMinimaViagemKmh: "2",
  ativo: true,
};

function texto(valor: any) {
  return String(valor || "").trim();
}

function numero(valor: any, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function normalizarBusca(valor: any) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extrairUf(cidade: string, ufInformada: any) {
  const uf = texto(ufInformada).toUpperCase();
  if (uf) return uf;
  const match = texto(cidade).match(/\s-\s([A-Za-z]{2})$/);
  return match?.[1]?.toUpperCase() || "";
}

function cidadeSemUf(valor: any) {
  return texto(valor).replace(/\s-\s[A-Za-z]{2}$/, "").trim();
}

function cidadeCompleta(cidade: any, uf: any) {
  const nome = cidadeSemUf(cidade);
  const sigla = extrairUf(texto(cidade), uf);
  if (!nome) return "";
  return sigla ? `${nome} - ${sigla}` : nome;
}

function coordenadasDoDocumento(dados: any): Coordenadas | null {
  const lat = numero(
    dados?.coordenadas?.lat ??
      dados?.coordenadas?.latitude ??
      dados?.latitude ??
      dados?.lat,
    Number.NaN,
  );
  const lng = numero(
    dados?.coordenadas?.lng ??
      dados?.coordenadas?.longitude ??
      dados?.longitude ??
      dados?.lng ??
      dados?.lon,
    Number.NaN,
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function normalizarLocal(
  id: string,
  dados: any,
  colecao: "terminais" | "portos",
): LocalOperacional | null {
  const nome = texto(
    dados?.nome || dados?.porto || dados?.terminal || dados?.local || id,
  );
  const cidade = cidadeCompleta(
    dados?.cidade || dados?.municipio || dados?.localidade,
    dados?.uf || dados?.estado || dados?.siglaUf,
  );

  if (!nome) return null;

  return {
    chave: `${colecao}:${id}`,
    id,
    colecao,
    nome,
    cidade,
    uf: extrairUf(cidade, dados?.uf || dados?.estado || dados?.siglaUf),
    coordenadas: coordenadasDoDocumento(dados),
    tipo: texto(dados?.tipo || dados?.categoria || colecao.slice(0, -1)),
    raioChegadaMetros: Math.max(50, numero(dados?.raioChegadaMetros ?? dados?.raioChegada ?? dados?.raioMetros, 500)),
    endereco: texto(dados?.endereco),
    referencia: texto(dados?.referencia || dados?.pontoReferencia),
  };
}

function normalizarCidadeDocumento(id: string, dados: any) {
  return cidadeCompleta(
    dados?.nome || dados?.cidade || dados?.municipio || id,
    dados?.uf || dados?.estado || dados?.sigla,
  );
}

function diasNormalizados(valor: any): number[] {
  const lista = Array.isArray(valor) ? valor : [];
  return Array.from(
    new Set(
      lista
        .map((item) => {
          if (typeof item === "number") return item;
          if (typeof item === "object" && item?.ativo !== false) {
            return Number(item.id ?? item.dia);
          }
          return Number(item);
        })
        .filter(
          (item): item is number =>
            typeof item === "number" &&
            Number.isInteger(item) &&
            item >= 0 &&
            item <= 6,
        ),
    ),
  ).sort((a, b) => a - b);
}

function horario(valor: any, padrao = "08:00") {
  const h = texto(valor);
  return /^\d{2}:\d{2}$/.test(h) ? h : padrao;
}

function formatarDias(dias: number[]) {
  if (!dias.length) return "Nenhum dia";
  return dias
    .map((dia) => DIAS.find((item) => item.id === dia)?.nome || String(dia))
    .join(", ");
}

function duracaoTexto(minutos: any) {
  const total = numero(minutos, 0);
  if (total <= 0) return "—";
  const dias = Math.floor(total / 1440);
  const horas = Math.floor((total % 1440) / 60);
  const min = Math.round(total % 60);
  const partes: string[] = [];
  if (dias) partes.push(`${dias}d`);
  if (horas) partes.push(`${horas}h`);
  if (min) partes.push(`${min}min`);
  return partes.join(" ") || "0min";
}

function idSeguro(valor: string) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function distanciaMetros(a: Coordenadas, b: Coordenadas) {
  const raioTerra = 6371000;
  const rad = (valor: number) => (valor * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * raioTerra * Math.asin(Math.sqrt(h));
}

function escalaVazia(): EscalaFormulario {
  return {
    id: `escala_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    cidade: "",
    portoChave: "",
    diaRelativo: "0",
    horarioChegada: "",
    horarioSaida: "",
  };
}

function nomeLocal(local: LocalOperacional | undefined | null) {
  if (!local) return "Porto não selecionado";
  return local.cidade ? `${local.nome} — ${local.cidade}` : local.nome;
}

function criarPontoItinerario({
  local,
  cidade,
  ordem,
  tipo,
  diaRelativo = "0",
  horarioChegada = "",
  horarioSaida = "",
}: {
  local: LocalOperacional;
  cidade: string;
  ordem: number;
  tipo: "origem" | "escala" | "destino";
  diaRelativo?: string;
  horarioChegada?: string;
  horarioSaida?: string;
}) {
  return {
    id: local.id,
    portoId: local.id,
    terminalId: local.id,
    portoColecao: local.colecao,
    ordem,
    tipo,
    nome: local.nome,
    porto: local.nome,
    local: local.nome,
    cidade,
    cidadeId: idSeguro(cidade),
    uf: local.uf,
    coordenadas: local.coordenadas,
    latitude: local.coordenadas?.lat ?? null,
    longitude: local.coordenadas?.lng ?? null,
    raioChegadaMetros: local.raioChegadaMetros ?? 500,
    tipoLocal: local.tipo || local.colecao.slice(0, -1),
    endereco: local.endereco || "",
    referencia: local.referencia || "",
    diaRelativo: String(Math.max(0, numero(diaRelativo, 0))),
    dias_apos_saida: Math.max(0, numero(diaRelativo, 0)),
    horario: horarioChegada || horarioSaida || "",
    horarioChegada: horarioChegada || "",
    horarioSaida: horarioSaida || "",
    ativo: true,
  };
}

export default function ProgramacaoViagens() {
  const [embarcacoes, setEmbarcacoes] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [programacoes, setProgramacoes] = useState<any[]>([]);
  const [locaisPortos, setLocaisPortos] = useState<LocalOperacional[]>([]);
  const [locaisTerminais, setLocaisTerminais] = useState<LocalOperacional[]>([]);
  const [cidadesCadastradas, setCidadesCadastradas] = useState<string[]>([]);
  const [barcoId, setBarcoId] = useState("");
  const [form, setForm] = useState<FormProgramacao>({ ...FORM_VAZIO });
  const [salvando, setSalvando] = useState(false);
  const [modalCidadeAberto, setModalCidadeAberto] = useState(false);
  const [modalPortoAberto, setModalPortoAberto] = useState(false);
  const [alvoCadastro, setAlvoCadastro] = useState<AlvoCadastro>({ tipo: "origem" });
  const [formCidade, setFormCidade] = useState<FormCidade>({ ...FORM_CIDADE_VAZIO });
  const [formPorto, setFormPorto] = useState<FormPorto>({ ...FORM_PORTO_VAZIO });
  const [salvandoCadastro, setSalvandoCadastro] = useState(false);
  const [retornarPortoAposCidade, setRetornarPortoAposCidade] = useState(false);
  const [filtroAtivas, setFiltroAtivas] = useState<"todas" | "ativas" | "inativas">(
    "todas",
  );

  useEffect(() => {
    const unsubEmbarcacoes = onSnapshot(collection(db, "embarcacoes"), (snap) => {
      const lista = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item: any) => item.ativo !== false)
        .sort((a: any, b: any) => texto(a.nome).localeCompare(texto(b.nome)));
      setEmbarcacoes(lista);
      setBarcoId((atual) => atual || lista[0]?.id || "");
    });

    const unsubGrades = onSnapshot(collection(db, "grades_viagens"), (snap) => {
      setGrades(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    });

    const unsubProgramacoes = onSnapshot(
      collection(db, "programacoes_viagem"),
      (snap) => {
        setProgramacoes(
          snap.docs.map((item) => ({ id: item.id, ...item.data() })),
        );
      },
    );

    const unsubTerminais = onSnapshot(collection(db, "terminais"), (snap) => {
      setLocaisTerminais(
        snap.docs
          .map((item) => normalizarLocal(item.id, item.data(), "terminais"))
          .filter(Boolean) as LocalOperacional[],
      );
    });

    const unsubPortos = onSnapshot(collection(db, "portos"), (snap) => {
      setLocaisPortos(
        snap.docs
          .map((item) => normalizarLocal(item.id, item.data(), "portos"))
          .filter(Boolean) as LocalOperacional[],
      );
    });

    const unsubCidades = onSnapshot(collection(db, "cidades"), (snap) => {
      setCidadesCadastradas(
        snap.docs
          .map((item) => normalizarCidadeDocumento(item.id, item.data()))
          .filter(Boolean),
      );
    });

    return () => {
      unsubEmbarcacoes();
      unsubGrades();
      unsubProgramacoes();
      unsubTerminais();
      unsubPortos();
      unsubCidades();
    };
  }, []);

  useEffect(() => {
    setForm({ ...FORM_VAZIO, barcoId });
  }, [barcoId]);

  const locaisOperacionais = useMemo(() => {
    const mapa = new Map<string, LocalOperacional>();

    [...locaisTerminais, ...locaisPortos].forEach((local) => {
      const chaveUnica = `${normalizarBusca(local.nome)}|${normalizarBusca(local.cidade)}`;
      const existente = mapa.get(chaveUnica);

      if (!existente) {
        mapa.set(chaveUnica, local);
        return;
      }

      const atualTemCoordenada = Boolean(local.coordenadas);
      const existenteTemCoordenada = Boolean(existente.coordenadas);
      const preferirAtual =
        (!existenteTemCoordenada && atualTemCoordenada) ||
        (local.colecao === "portos" && existente.colecao !== "portos");

      if (preferirAtual) mapa.set(chaveUnica, local);
    });

    return Array.from(mapa.values()).sort((a, b) => {
      const cidade = a.cidade.localeCompare(b.cidade);
      return cidade !== 0 ? cidade : a.nome.localeCompare(b.nome);
    });
  }, [locaisPortos, locaisTerminais]);

  const localPorChave = useMemo(
    () => new Map(locaisOperacionais.map((local) => [local.chave, local])),
    [locaisOperacionais],
  );

  const cidadesDisponiveis = useMemo(() => {
    const mapa = new Map<string, string>();

    [...cidadesCadastradas, ...locaisOperacionais.map((local) => local.cidade)]
      .filter(Boolean)
      .forEach((cidade) => mapa.set(normalizarBusca(cidade), cidade));

    return Array.from(mapa.values()).sort((a, b) => a.localeCompare(b));
  }, [cidadesCadastradas, locaisOperacionais]);

  const barcoSelecionado = useMemo(
    () => embarcacoes.find((item) => item.id === barcoId),
    [barcoId, embarcacoes],
  );

  const gradesDoBarco = useMemo(
    () =>
      grades
        .filter((grade) => {
          const idGrade = texto(grade.id).toUpperCase();
          const idBarco = texto(grade.barcoId || grade.embarcacaoId).toUpperCase();
          return (
            idBarco === barcoId.toUpperCase() ||
            idGrade.startsWith(`${barcoId.toUpperCase()}_`)
          );
        })
        .sort((a, b) => texto(a.sentido).localeCompare(texto(b.sentido))),
    [barcoId, grades],
  );

  const programacoesDoBarco = useMemo(() => {
    return programacoes
      .filter((item) => texto(item.barcoId) === barcoId)
      .filter((item) => {
        if (filtroAtivas === "ativas") return item.ativo !== false;
        if (filtroAtivas === "inativas") return item.ativo === false;
        return true;
      })
      .sort((a, b) => {
        const sentido = texto(a.sentido).localeCompare(texto(b.sentido));
        if (sentido !== 0) return sentido;
        return horario(a.horarioSaida).localeCompare(horario(b.horarioSaida));
      });
  }, [barcoId, filtroAtivas, programacoes]);

  const locaisDaCidade = (cidade: string) => {
    const normalizada = normalizarBusca(cidade);
    return locaisOperacionais.filter(
      (local) => normalizarBusca(local.cidade) === normalizada,
    );
  };

  const encontrarLocalPorDados = (dados: any): LocalOperacional | null => {
    const ids = [
      dados?.portoId,
      dados?.terminalId,
      dados?.id,
      dados?.origemPortoId,
      dados?.destinoPortoId,
    ]
      .map(texto)
      .filter(Boolean);

    const nomes = [
      dados?.nome,
      dados?.porto,
      dados?.local,
      dados?.origemPortoNome,
      dados?.destinoPortoNome,
      dados?.origem,
      dados?.destino,
    ]
      .map(normalizarBusca)
      .filter(Boolean);

    const cidade = normalizarBusca(
      dados?.cidade || dados?.origemCidade || dados?.destinoCidade,
    );

    return (
      locaisOperacionais.find((local) => ids.includes(local.id)) ||
      locaisOperacionais.find(
        (local) =>
          nomes.includes(normalizarBusca(local.nome)) &&
          (!cidade || normalizarBusca(local.cidade) === cidade),
      ) ||
      locaisOperacionais.find((local) => nomes.includes(normalizarBusca(local.nome))) ||
      null
    );
  };

  const escalaParaFormulario = (
    item: any,
    index: number,
  ): EscalaFormulario => {
    const local = encontrarLocalPorDados(item);
    return {
      id: texto(item?.id) || `escala_${Date.now()}_${index}`,
      cidade: cidadeCompleta(
        item?.cidade || local?.cidade,
        item?.uf || local?.uf,
      ),
      portoChave: local?.chave || "",
      diaRelativo: String(
        Math.max(0, numero(item?.diaRelativo ?? item?.dias_apos_saida, 0)),
      ),
      horarioChegada: horario(
        item?.horarioChegada || item?.horario,
        "",
      ),
      horarioSaida: horario(item?.horarioSaida, ""),
    };
  };

  const escolherGrade = (gradeId: string) => {
    if (!gradeId) {
      setForm((atual) => ({ ...atual, gradeId: "" }));
      return;
    }

    const grade = gradesDoBarco.find((item) => item.id === gradeId);
    const itinerario = Array.isArray(grade?.itinerario)
      ? grade.itinerario
      : Array.isArray(grade?.escalas)
        ? grade.escalas
        : [];

    const origemDados = itinerario[0] || {
      portoId: grade?.origemPortoId,
      nome: grade?.portoOrigem || grade?.origem,
      cidade: grade?.origemCidade || grade?.origem,
    };
    const destinoDados = itinerario[itinerario.length - 1] || {
      portoId: grade?.destinoPortoId,
      nome: grade?.portoDestino || grade?.destino,
      cidade: grade?.destinoCidade || grade?.destino,
    };

    const localOrigem = encontrarLocalPorDados(origemDados);
    const localDestino = encontrarLocalPorDados(destinoDados);
    const escalasIntermediarias = itinerario.length > 2 ? itinerario.slice(1, -1) : [];

    setForm((atual) => ({
      ...atual,
      gradeId,
      sentido: texto(grade?.sentido).toLowerCase() === "volta" ? "volta" : "ida",
      origemCidade: cidadeCompleta(
        origemDados?.cidade || grade?.origemCidade || localOrigem?.cidade || grade?.origem,
        origemDados?.uf || localOrigem?.uf,
      ),
      origemPortoChave: localOrigem?.chave || "",
      destinoCidade: cidadeCompleta(
        destinoDados?.cidade || grade?.destinoCidade || localDestino?.cidade || grade?.destino,
        destinoDados?.uf || localDestino?.uf,
      ),
      destinoPortoChave: localDestino?.chave || "",
      destinoDiaRelativo: String(
        Math.max(0, numero(destinoDados?.diaRelativo ?? destinoDados?.dias_apos_saida, 0)),
      ),
      destinoHorarioChegada: horario(
        destinoDados?.horarioChegada || destinoDados?.horario,
        "",
      ),
      escalas: escalasIntermediarias.map(escalaParaFormulario),
      diasSemana: diasNormalizados(grade?.diasSemana || grade?.dias_da_semana),
      horarioSaida: horario(grade?.horarioSaida || grade?.horario_saida),
      duracaoHoras: String(Math.floor(numero(grade?.tempoTotalMin, 24 * 60) / 60)),
      duracaoMinutos: String(numero(grade?.tempoTotalMin, 0) % 60),
    }));
  };

  const alternarDia = (dia: number) => {
    setForm((atual) => ({
      ...atual,
      diasSemana: atual.diasSemana.includes(dia)
        ? atual.diasSemana.filter((item) => item !== dia)
        : [...atual.diasSemana, dia].sort((a, b) => a - b),
    }));
  };

  const selecionarCidadeOrigem = (cidade: string) => {
    setForm((atual) => ({
      ...atual,
      origemCidade: cidade,
      origemPortoChave: locaisDaCidade(cidade).some(
        (local) => local.chave === atual.origemPortoChave,
      )
        ? atual.origemPortoChave
        : "",
    }));
  };

  const selecionarCidadeDestino = (cidade: string) => {
    setForm((atual) => ({
      ...atual,
      destinoCidade: cidade,
      destinoPortoChave: locaisDaCidade(cidade).some(
        (local) => local.chave === atual.destinoPortoChave,
      )
        ? atual.destinoPortoChave
        : "",
    }));
  };

  const adicionarEscala = () => {
    setForm((atual) => ({
      ...atual,
      escalas: [...atual.escalas, escalaVazia()],
    }));
  };

  const atualizarEscala = (
    id: string,
    campo: keyof EscalaFormulario,
    valor: string,
  ) => {
    setForm((atual) => ({
      ...atual,
      escalas: atual.escalas.map((escala) => {
        if (escala.id !== id) return escala;
        if (campo === "cidade") {
          const portoAindaValido = locaisDaCidade(valor).some(
            (local) => local.chave === escala.portoChave,
          );
          return {
            ...escala,
            cidade: valor,
            portoChave: portoAindaValido ? escala.portoChave : "",
          };
        }
        return { ...escala, [campo]: valor };
      }),
    }));
  };

  const removerEscala = (id: string) => {
    setForm((atual) => ({
      ...atual,
      escalas: atual.escalas.filter((escala) => escala.id !== id),
    }));
  };

  const moverEscala = (index: number, direcao: -1 | 1) => {
    setForm((atual) => {
      const destino = index + direcao;
      if (destino < 0 || destino >= atual.escalas.length) return atual;
      const escalas = [...atual.escalas];
      [escalas[index], escalas[destino]] = [escalas[destino], escalas[index]];
      return { ...atual, escalas };
    });
  };

  const aplicarCidadeNoAlvo = (cidade: string) => {
    if (alvoCadastro.tipo === "origem") {
      selecionarCidadeOrigem(cidade);
      return;
    }
    if (alvoCadastro.tipo === "destino") {
      selecionarCidadeDestino(cidade);
      return;
    }
    atualizarEscala(alvoCadastro.escalaId, "cidade", cidade);
  };

  const aplicarPortoNoAlvo = (cidade: string, portoChave: string) => {
    aplicarCidadeNoAlvo(cidade);
    if (alvoCadastro.tipo === "origem") {
      setForm((atual) => ({ ...atual, origemCidade: cidade, origemPortoChave: portoChave }));
      return;
    }
    if (alvoCadastro.tipo === "destino") {
      setForm((atual) => ({ ...atual, destinoCidade: cidade, destinoPortoChave: portoChave }));
      return;
    }
    setForm((atual) => ({
      ...atual,
      escalas: atual.escalas.map((escala) =>
        escala.id === alvoCadastro.escalaId
          ? { ...escala, cidade, portoChave }
          : escala,
      ),
    }));
  };

  const abrirCadastroCidade = (alvo: AlvoCadastro) => {
    setRetornarPortoAposCidade(false);
    setAlvoCadastro(alvo);
    setFormCidade({ ...FORM_CIDADE_VAZIO });
    setModalCidadeAberto(true);
  };

  const abrirCadastroPorto = (alvo: AlvoCadastro, cidadeAtual: string) => {
    setAlvoCadastro(alvo);
    setFormPorto({
      ...FORM_PORTO_VAZIO,
      cidade: cidadeAtual,
      uf: extrairUf(cidadeAtual, ""),
    });
    setModalPortoAberto(true);
  };

  const concluirCadastroCidade = (cidade: string) => {
    if (retornarPortoAposCidade) {
      setFormPorto((atual) => ({
        ...atual,
        cidade,
        uf: extrairUf(cidade, atual.uf),
      }));
      setRetornarPortoAposCidade(false);
      setModalCidadeAberto(false);
      setModalPortoAberto(true);
      return;
    }
    aplicarCidadeNoAlvo(cidade);
    setModalCidadeAberto(false);
  };

  const salvarNovaCidade = async () => {
    const nome = cidadeSemUf(formCidade.nome);
    const uf = texto(formCidade.uf).toUpperCase();
    if (!nome) return alert("Informe o nome da cidade.");
    if (!/^[A-Z]{2}$/.test(uf)) return alert("Informe a UF com duas letras.");

    const completa = cidadeCompleta(nome, uf);
    const existente = cidadesDisponiveis.find(
      (cidade) => normalizarBusca(cidade) === normalizarBusca(completa),
    );
    if (existente) {
      concluirCadastroCidade(existente);
      return alert("Essa cidade já estava cadastrada e foi selecionada.");
    }

    const id = idSeguro(`${nome}_${uf}`);
    try {
      setSalvandoCadastro(true);
      await setDoc(
        doc(db, "cidades", id),
        {
          id,
          nome,
          cidade: nome,
          municipio: nome,
          uf,
          estado: uf,
          pais: texto(formCidade.pais) || "Brasil",
          ativo: true,
          origemCadastro: "programacao_viagens",
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );
      setCidadesCadastradas((atuais) =>
        Array.from(new Set([...atuais, completa])).sort((a, b) => a.localeCompare(b)),
      );
      concluirCadastroCidade(completa);
      alert("Cidade cadastrada e selecionada.");
    } catch (error: any) {
      alert(error?.message || "Não foi possível cadastrar a cidade.");
    } finally {
      setSalvandoCadastro(false);
    }
  };

  const salvarNovoPorto = async () => {
    const nome = texto(formPorto.nome);
    const cidade = cidadeCompleta(formPorto.cidade, formPorto.uf);
    const uf = extrairUf(cidade, formPorto.uf);
    const latitude = numero(formPorto.latitude, Number.NaN);
    const longitude = numero(formPorto.longitude, Number.NaN);
    const raioChegadaMetros = Math.max(50, numero(formPorto.raioChegadaMetros, 500));

    if (!nome) return alert("Informe o nome do porto.");
    if (!cidade) return alert("Selecione ou informe a cidade do porto.");
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return alert("Informe uma latitude válida.");
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return alert("Informe uma longitude válida.");
    }

    const coordenadas = { lat: latitude, lng: longitude };
    const mesmoNome = locaisOperacionais.find(
      (local) =>
        normalizarBusca(local.cidade) === normalizarBusca(cidade) &&
        normalizarBusca(local.nome) === normalizarBusca(nome),
    );
    if (mesmoNome) {
      aplicarPortoNoAlvo(cidade, mesmoNome.chave);
      setModalPortoAberto(false);
      return alert("Esse porto já estava cadastrado e foi selecionado.");
    }

    const muitoProximo = locaisOperacionais.find(
      (local) =>
        Boolean(local.coordenadas) &&
        normalizarBusca(local.cidade) === normalizarBusca(cidade) &&
        distanciaMetros(local.coordenadas as Coordenadas, coordenadas) <= 80,
    );
    if (muitoProximo) {
      const usarExistente = window.confirm(
        `Existe um porto muito próximo: ${muitoProximo.nome}.\n\nOK: usar o porto existente.\nCancelar: cadastrar mesmo assim.`,
      );
      if (usarExistente) {
        aplicarPortoNoAlvo(cidade, muitoProximo.chave);
        setModalPortoAberto(false);
        return;
      }
    }

    const baseId = idSeguro(`${cidade}_${nome}`);
    const id = locaisPortos.some((local) => local.id === baseId)
      ? `${baseId}_${Date.now()}`
      : baseId;
    const chave = `portos:${id}`;
    const novoLocal: LocalOperacional = {
      chave,
      id,
      colecao: "portos",
      nome,
      cidade,
      uf,
      coordenadas,
      tipo: formPorto.tipo,
      raioChegadaMetros,
      endereco: texto(formPorto.endereco),
      referencia: texto(formPorto.referencia),
    };

    try {
      setSalvandoCadastro(true);
      await setDoc(
        doc(db, "portos", id),
        {
          id,
          nome,
          porto: nome,
          local: nome,
          cidade,
          municipio: cidadeSemUf(cidade),
          uf,
          estado: uf,
          tipo: formPorto.tipo,
          categoria: formPorto.tipo,
          coordenadas,
          latitude,
          longitude,
          lat: latitude,
          lng: longitude,
          raioChegadaMetros,
          raioChegada: raioChegadaMetros,
          endereco: texto(formPorto.endereco),
          referencia: texto(formPorto.referencia),
          pontoReferencia: texto(formPorto.referencia),
          observacoes: texto(formPorto.observacoes),
          ativo: true,
          origemCadastro: "programacao_viagens",
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );
      setLocaisPortos((atuais) => [...atuais.filter((local) => local.id !== id), novoLocal]);
      aplicarPortoNoAlvo(cidade, chave);
      setModalPortoAberto(false);
      alert("Porto cadastrado e selecionado.");
    } catch (error: any) {
      alert(error?.message || "Não foi possível cadastrar o porto.");
    } finally {
      setSalvandoCadastro(false);
    }
  };

  const limparFormulario = () => {
    setForm({ ...FORM_VAZIO, barcoId });
  };

  const salvar = async () => {
    if (!barcoId) return alert("Selecione uma embarcação.");
    if (!form.origemCidade) return alert("Selecione a cidade de origem.");
    if (!form.origemPortoChave) return alert("Selecione o porto de origem.");
    if (!form.destinoCidade) return alert("Selecione a cidade de destino.");
    if (!form.destinoPortoChave) return alert("Selecione o porto de destino.");
    if (!form.diasSemana.length) return alert("Selecione pelo menos um dia.");
    if (!/^\d{2}:\d{2}$/.test(form.horarioSaida)) {
      return alert("Informe um horário de saída válido.");
    }

    const origemLocal = localPorChave.get(form.origemPortoChave);
    const destinoLocal = localPorChave.get(form.destinoPortoChave);

    if (!origemLocal || !destinoLocal) {
      return alert("Um dos portos selecionados não está mais disponível.");
    }
    if (origemLocal.chave === destinoLocal.chave) {
      return alert("Origem e destino não podem usar o mesmo porto.");
    }

    for (let index = 0; index < form.escalas.length; index += 1) {
      const escala = form.escalas[index];
      const local = localPorChave.get(escala.portoChave);
      if (!escala.cidade || !local) {
        return alert(`Preencha a cidade e o porto da escala ${index + 1}.`);
      }
    }

    const escalasResolvidas = form.escalas.map((escala, index) =>
      criarPontoItinerario({
        local: localPorChave.get(escala.portoChave) as LocalOperacional,
        cidade: escala.cidade,
        ordem: index + 1,
        tipo: "escala",
        diaRelativo: escala.diaRelativo,
        horarioChegada: escala.horarioChegada,
        horarioSaida: escala.horarioSaida,
      }),
    );

    const itinerario = [
      criarPontoItinerario({
        local: origemLocal,
        cidade: form.origemCidade,
        ordem: 0,
        tipo: "origem",
        diaRelativo: "0",
        horarioSaida: form.horarioSaida,
      }),
      ...escalasResolvidas,
      criarPontoItinerario({
        local: destinoLocal,
        cidade: form.destinoCidade,
        ordem: escalasResolvidas.length + 1,
        tipo: "destino",
        diaRelativo: String(
          Math.max(
            numero(form.destinoDiaRelativo, 0),
            0,
            ...form.escalas.map((escala) => numero(escala.diaRelativo, 0)),
          ),
        ),
        horarioChegada: form.destinoHorarioChegada,
      }),
    ];

    const duracaoPrevistaMinutos = Math.max(
      30,
      numero(form.duracaoHoras, 0) * 60 + numero(form.duracaoMinutos, 0),
    );
    const id =
      form.id ||
      idSeguro(
        `${barcoId}_${form.sentido}_${form.diasSemana.join("-")}_${form.horarioSaida}_${Date.now()}`,
      );
    const gradeId =
      form.gradeId ||
      idSeguro(
        `${barcoId}_${form.sentido}_${origemLocal.id}_${destinoLocal.id}`,
      );
    const nomeRota = `${form.origemCidade} (${origemLocal.nome}) → ${form.destinoCidade} (${destinoLocal.nome})`;

    try {
      setSalvando(true);
      await setDoc(
        doc(db, "programacoes_viagem", id),
        {
          id,
          barcoId,
          barcoNome: texto(barcoSelecionado?.nome || barcoId),
          gradeId,
          sentido: form.sentido,
          diasSemana: form.diasSemana,
          horarioSaida: form.horarioSaida,
          duracaoPrevistaMinutos,
          timezone: form.timezone,
          vigenciaInicio: form.vigenciaInicio || null,
          vigenciaFim: form.vigenciaFim || null,
          antecedenciaExibicaoMin: Math.max(
            0,
            numero(form.antecedenciaExibicaoMin, 120),
          ),
          toleranciaSaidaMin: Math.max(
            0,
            numero(form.toleranciaSaidaMin, 90),
          ),
          velocidadeMinimaViagemKmh: Math.max(
            0.5,
            numero(form.velocidadeMinimaViagemKmh, 2),
          ),
          origem: form.origemCidade,
          destino: form.destinoCidade,
          origemCidade: form.origemCidade,
          destinoCidade: form.destinoCidade,
          origemPortoId: origemLocal.id,
          destinoPortoId: destinoLocal.id,
          origemPortoColecao: origemLocal.colecao,
          destinoPortoColecao: destinoLocal.colecao,
          origemPortoNome: origemLocal.nome,
          destinoPortoNome: destinoLocal.nome,
          portoOrigem: origemLocal.nome,
          portoDestino: destinoLocal.nome,
          origemCoordenadas: origemLocal.coordenadas,
          destinoCoordenadas: destinoLocal.coordenadas,
          escalas: itinerario,
          itinerario,
          nome: nomeRota,
          ativo: form.ativo,
          atualizadoEm: serverTimestamp(),
          ...(form.id ? {} : { criadoEm: serverTimestamp() }),
        },
        { merge: true },
      );
      limparFormulario();
      alert("Programação e itinerário salvos com sucesso.");
    } catch (error: any) {
      alert(error?.message || "Não foi possível salvar a programação.");
    } finally {
      setSalvando(false);
    }
  };

  const editar = (item: any) => {
    const total = numero(item.duracaoPrevistaMinutos, 24 * 60);
    const itinerario = Array.isArray(item.itinerario)
      ? item.itinerario
      : Array.isArray(item.escalas)
        ? item.escalas
        : [];
    const origemDados = itinerario[0] || item;
    const destinoDados = itinerario[itinerario.length - 1] || item;
    const origemLocal = encontrarLocalPorDados({
      ...origemDados,
      portoId: item.origemPortoId || origemDados?.portoId,
      nome: item.origemPortoNome || origemDados?.nome,
    });
    const destinoLocal = encontrarLocalPorDados({
      ...destinoDados,
      portoId: item.destinoPortoId || destinoDados?.portoId,
      nome: item.destinoPortoNome || destinoDados?.nome,
    });

    setForm({
      id: item.id,
      barcoId: item.barcoId,
      gradeId: item.gradeId || "",
      sentido: texto(item.sentido).toLowerCase() === "volta" ? "volta" : "ida",
      origemCidade: cidadeCompleta(
        item.origemCidade || origemDados?.cidade || item.origem,
        origemDados?.uf,
      ),
      origemPortoChave: origemLocal?.chave || "",
      destinoCidade: cidadeCompleta(
        item.destinoCidade || destinoDados?.cidade || item.destino,
        destinoDados?.uf,
      ),
      destinoPortoChave: destinoLocal?.chave || "",
      destinoDiaRelativo: String(
        Math.max(0, numero(destinoDados?.diaRelativo ?? destinoDados?.dias_apos_saida, 0)),
      ),
      destinoHorarioChegada: horario(
        destinoDados?.horarioChegada || destinoDados?.horario,
        "",
      ),
      escalas:
        itinerario.length > 2
          ? itinerario.slice(1, -1).map(escalaParaFormulario)
          : [],
      diasSemana: diasNormalizados(item.diasSemana),
      horarioSaida: horario(item.horarioSaida),
      duracaoHoras: String(Math.floor(total / 60)),
      duracaoMinutos: String(total % 60),
      timezone: texto(item.timezone) || "America/Manaus",
      vigenciaInicio: texto(item.vigenciaInicio),
      vigenciaFim: texto(item.vigenciaFim),
      antecedenciaExibicaoMin: String(
        numero(item.antecedenciaExibicaoMin, 120),
      ),
      toleranciaSaidaMin: String(numero(item.toleranciaSaidaMin, 90)),
      velocidadeMinimaViagemKmh: String(
        numero(item.velocidadeMinimaViagemKmh, 2),
      ),
      ativo: item.ativo !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const duplicar = async (item: any) => {
    const id = `${item.id}_copia_${Date.now()}`;
    await setDoc(doc(db, "programacoes_viagem", id), {
      ...item,
      id,
      ativo: true,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });
  };

  const alternarAtiva = async (item: any) => {
    await setDoc(
      doc(db, "programacoes_viagem", item.id),
      { ativo: item.ativo === false, atualizadoEm: serverTimestamp() },
      { merge: true },
    );
  };

  const excluir = async (item: any) => {
    if (
      !window.confirm(
        `Excluir a saída ${formatarDias(diasNormalizados(item.diasSemana))} às ${item.horarioSaida}?`,
      )
    ) {
      return;
    }
    await deleteDoc(doc(db, "programacoes_viagem", item.id));
  };

  const importarGradesAtuais = async () => {
    if (!gradesDoBarco.length) {
      return alert("A embarcação não possui grades cadastradas.");
    }

    let criadas = 0;
    for (const grade of gradesDoBarco) {
      const dias = diasNormalizados(grade.diasSemana || grade.dias_da_semana);
      if (!dias.length) continue;

      const hora = horario(grade.horarioSaida || grade.horario_saida);
      const jaExiste = programacoes.some(
        (item) =>
          item.barcoId === barcoId &&
          item.gradeId === grade.id &&
          horario(item.horarioSaida) === hora &&
          JSON.stringify(diasNormalizados(item.diasSemana)) === JSON.stringify(dias),
      );
      if (jaExiste) continue;

      const itinerarioOriginal = Array.isArray(grade.itinerario)
        ? grade.itinerario
        : Array.isArray(grade.escalas)
          ? grade.escalas
          : [];
      const itinerario = itinerarioOriginal.map((ponto: any, index: number) => {
        const local = encontrarLocalPorDados(ponto);
        if (!local) return { ...ponto, ordem: index, ativo: ponto?.ativo !== false };
        return criarPontoItinerario({
          local,
          cidade: cidadeCompleta(ponto?.cidade || local.cidade, ponto?.uf || local.uf),
          ordem: index,
          tipo:
            index === 0
              ? "origem"
              : index === itinerarioOriginal.length - 1
                ? "destino"
                : "escala",
          diaRelativo: String(ponto?.diaRelativo ?? ponto?.dias_apos_saida ?? 0),
          horarioChegada: horario(ponto?.horarioChegada || ponto?.horario, ""),
          horarioSaida: horario(ponto?.horarioSaida, ""),
        });
      });
      const origemPonto = itinerario[0] || {};
      const destinoPonto = itinerario[itinerario.length - 1] || {};

      const id = idSeguro(
        `${barcoId}_${grade.sentido || "ida"}_${dias.join("-")}_${hora}_${Date.now()}_${criadas}`,
      );
      await setDoc(doc(db, "programacoes_viagem", id), {
        id,
        barcoId,
        barcoNome: texto(barcoSelecionado?.nome || barcoId),
        gradeId: grade.id,
        sentido:
          texto(grade.sentido).toLowerCase() === "volta" ? "volta" : "ida",
        diasSemana: dias,
        horarioSaida: hora,
        duracaoPrevistaMinutos: Math.max(
          30,
          numero(grade.tempoTotalMin, 24 * 60),
        ),
        timezone: texto(grade.timezone) || "America/Manaus",
        vigenciaInicio: null,
        vigenciaFim: null,
        antecedenciaExibicaoMin: 120,
        toleranciaSaidaMin: 90,
        velocidadeMinimaViagemKmh: 2,
        origem: texto(grade.origemCidade || grade.origem),
        destino: texto(grade.destinoCidade || grade.destino),
        origemCidade: texto(origemPonto.cidade || grade.origemCidade || grade.origem),
        destinoCidade: texto(destinoPonto.cidade || grade.destinoCidade || grade.destino),
        origemPortoId: texto(origemPonto.portoId || grade.origemPortoId),
        destinoPortoId: texto(destinoPonto.portoId || grade.destinoPortoId),
        origemPortoNome: texto(origemPonto.nome || grade.portoOrigem || grade.origem),
        destinoPortoNome: texto(destinoPonto.nome || grade.portoDestino || grade.destino),
        portoOrigem: texto(origemPonto.nome || grade.portoOrigem || grade.origem),
        portoDestino: texto(destinoPonto.nome || grade.portoDestino || grade.destino),
        escalas: itinerario,
        itinerario,
        nome: texto(grade.nome),
        ativo: true,
        origemDados: "grade_importada",
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });
      criadas += 1;
    }

    alert(
      criadas > 0
        ? `${criadas} programação(ões) importada(s).`
        : "As grades atuais já foram importadas ou não possuem dias configurados.",
    );
  };

  const origemSelecionada = localPorChave.get(form.origemPortoChave);
  const destinoSelecionado = localPorChave.get(form.destinoPortoChave);

  return (
    <div className="min-h-screen text-white">
      <section className="mb-6 rounded-3xl border border-sky-400/10 bg-[#143760]/80 p-6 shadow-2xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">
              Agenda operacional
            </p>
            <h1 className="mt-2 text-2xl font-black">Programação de viagens</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Cadastre a cidade, o porto de origem, todas as escalas e o porto de destino. Cada saída pode ter dias, horários e vigência próprios.
            </p>
          </div>

          <label className="min-w-[280px] text-xs font-bold text-slate-400">
            Embarcação
            <select
              value={barcoId}
              onChange={(event) => setBarcoId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0c2c] px-4 py-3 text-sm font-bold text-white outline-none"
            >
              {embarcacoes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome || item.id}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-[1.05fr_1.15fr]">
        <section className="rounded-3xl border border-white/5 bg-[#143760]/80 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                {form.id ? "Editando saída" : "Nova saída"}
              </p>
              <h2 className="mt-2 text-xl font-black">
                {barcoSelecionado?.nome || barcoId || "Selecione um barco"}
              </h2>
            </div>
            {form.id && (
              <button
                onClick={limparFormulario}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300"
              >
                Cancelar edição
              </button>
            )}
          </div>

          <div className="mt-6 grid gap-5">
            <Campo label="Rota/grade de referência — opcional">
              <select
                value={form.gradeId}
                onChange={(event) => escolherGrade(event.target.value)}
                className="campo"
              >
                <option value="">Montar itinerário manualmente</option>
                {gradesDoBarco.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {(grade.sentido || "ida").toUpperCase()} — {grade.origem || grade.portoOrigem || "Origem"} → {grade.destino || grade.portoDestino || "Destino"}
                  </option>
                ))}
              </select>
            </Campo>

            <div className="rounded-3xl border border-sky-400/10 bg-[#0d0c2c]/70 p-4">
              <div className="mb-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-300">
                  Itinerário completo
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Primeiro selecione a cidade. Depois escolha o porto ou terminal cadastrado naquela cidade.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-400/10 bg-emerald-400/5 p-4">
                  <p className="text-xs font-black uppercase text-emerald-300">Origem</p>
                  <SelectCidade
                    label="Cidade de origem"
                    value={form.origemCidade}
                    cidades={cidadesDisponiveis}
                    onChange={selecionarCidadeOrigem}
                    onCadastrar={() => abrirCadastroCidade({ tipo: "origem" })}
                  />
                  <SelectPorto
                    label="Porto/terminal de origem"
                    value={form.origemPortoChave}
                    locais={locaisDaCidade(form.origemCidade)}
                    onChange={(valor) =>
                      setForm((atual) => ({ ...atual, origemPortoChave: valor }))
                    }
                    onCadastrar={() =>
                      abrirCadastroPorto({ tipo: "origem" }, form.origemCidade)
                    }
                  />
                  {origemSelecionada && (
                    <ResumoLocal local={origemSelecionada} />
                  )}
                </div>

                <div className="rounded-2xl border border-fuchsia-400/10 bg-fuchsia-400/5 p-4">
                  <p className="text-xs font-black uppercase text-fuchsia-300">Destino final</p>
                  <SelectCidade
                    label="Cidade de destino"
                    value={form.destinoCidade}
                    cidades={cidadesDisponiveis}
                    onChange={selecionarCidadeDestino}
                    onCadastrar={() => abrirCadastroCidade({ tipo: "destino" })}
                  />
                  <SelectPorto
                    label="Porto/terminal de destino"
                    value={form.destinoPortoChave}
                    locais={locaisDaCidade(form.destinoCidade)}
                    onChange={(valor) =>
                      setForm((atual) => ({ ...atual, destinoPortoChave: valor }))
                    }
                    onCadastrar={() =>
                      abrirCadastroPorto({ tipo: "destino" }, form.destinoCidade)
                    }
                  />
                  {destinoSelecionado && (
                    <ResumoLocal local={destinoSelecionado} />
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Input
                      label="Dia de chegada"
                      type="number"
                      value={form.destinoDiaRelativo}
                      onChange={(valor) =>
                        setForm((atual) => ({ ...atual, destinoDiaRelativo: valor }))
                      }
                    />
                    <Input
                      label="Horário de chegada"
                      type="time"
                      value={form.destinoHorarioChegada}
                      onChange={(valor) =>
                        setForm((atual) => ({ ...atual, destinoHorarioChegada: valor }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-400/10 bg-amber-400/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-amber-300">
                      Escalas intermediárias
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Organize os portos na ordem em que a embarcação passará.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={adicionarEscala}
                    className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-200"
                  >
                    + Adicionar escala
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  {form.escalas.map((escala, index) => {
                    const local = localPorChave.get(escala.portoChave);
                    return (
                      <article
                        key={escala.id}
                        className="rounded-2xl border border-white/10 bg-slate-950/25 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black">Escala {index + 1}</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => moverEscala(index, -1)}
                              className="mini-acao disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={index === form.escalas.length - 1}
                              onClick={() => moverEscala(index, 1)}
                              className="mini-acao disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removerEscala(escala.id)}
                              className="rounded-lg border border-red-400/20 bg-red-400/10 px-2 py-1 text-xs font-black text-red-300"
                            >
                              Remover
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <SelectCidade
                            label="Cidade da escala"
                            value={escala.cidade}
                            cidades={cidadesDisponiveis}
                            onChange={(valor) =>
                              atualizarEscala(escala.id, "cidade", valor)
                            }
                            onCadastrar={() =>
                              abrirCadastroCidade({ tipo: "escala", escalaId: escala.id })
                            }
                          />
                          <SelectPorto
                            label="Porto/terminal"
                            value={escala.portoChave}
                            locais={locaisDaCidade(escala.cidade)}
                            onChange={(valor) =>
                              atualizarEscala(escala.id, "portoChave", valor)
                            }
                            onCadastrar={() =>
                              abrirCadastroPorto(
                                { tipo: "escala", escalaId: escala.id },
                                escala.cidade,
                              )
                            }
                          />
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-3">
                          <Input
                            label="Dia após saída"
                            type="number"
                            value={escala.diaRelativo}
                            onChange={(valor) =>
                              atualizarEscala(escala.id, "diaRelativo", valor)
                            }
                          />
                          <Input
                            label="Chegada"
                            type="time"
                            value={escala.horarioChegada}
                            onChange={(valor) =>
                              atualizarEscala(escala.id, "horarioChegada", valor)
                            }
                          />
                          <Input
                            label="Nova saída"
                            type="time"
                            value={escala.horarioSaida}
                            onChange={(valor) =>
                              atualizarEscala(escala.id, "horarioSaida", valor)
                            }
                          />
                        </div>

                        {local && <ResumoLocal local={local} />}
                      </article>
                    );
                  })}

                  {form.escalas.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-500">
                      Viagem direta, sem escalas intermediárias.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-bold text-slate-400">Dias da semana</p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {DIAS.map((dia) => {
                  const ativo = form.diasSemana.includes(dia.id);
                  return (
                    <button
                      type="button"
                      key={dia.id}
                      onClick={() => alternarDia(dia.id)}
                      className={`rounded-xl border px-2 py-3 text-xs font-black transition ${
                        ativo
                          ? "border-sky-400/60 bg-sky-400/20 text-sky-200"
                          : "border-white/10 bg-[#0d0c2c] text-slate-500"
                      }`}
                    >
                      {dia.nome}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Para dois horários no mesmo dia, salve uma saída e depois cadastre outra com horário diferente.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Horário da saída"
                type="time"
                value={form.horarioSaida}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, horarioSaida: valor }))
                }
              />
              <Campo label="Sentido">
                <select
                  value={form.sentido}
                  onChange={(event) =>
                    setForm((a) => ({
                      ...a,
                      sentido: event.target.value === "volta" ? "volta" : "ida",
                    }))
                  }
                  className="campo"
                >
                  <option value="ida">Ida</option>
                  <option value="volta">Volta</option>
                </select>
              </Campo>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Duração — horas"
                type="number"
                value={form.duracaoHoras}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, duracaoHoras: valor }))
                }
              />
              <Input
                label="Minutos adicionais"
                type="number"
                value={form.duracaoMinutos}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, duracaoMinutos: valor }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Vigência inicial"
                type="date"
                value={form.vigenciaInicio}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, vigenciaInicio: valor }))
                }
              />
              <Input
                label="Vigência final"
                type="date"
                value={form.vigenciaFim}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, vigenciaFim: valor }))
                }
              />
            </div>

            <Campo label="Fuso horário">
              <select
                value={form.timezone}
                onChange={(event) =>
                  setForm((a) => ({ ...a, timezone: event.target.value }))
                }
                className="campo"
              >
                <option value="America/Manaus">Amazonas — UTC-4</option>
                <option value="America/Santarem">Pará — UTC-3</option>
                <option value="America/Belem">Belém — UTC-3</option>
              </select>
            </Campo>

            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Mostrar antes (min)"
                type="number"
                value={form.antecedenciaExibicaoMin}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, antecedenciaExibicaoMin: valor }))
                }
              />
              <Input
                label="Tolerância saída (min)"
                type="number"
                value={form.toleranciaSaidaMin}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, toleranciaSaidaMin: valor }))
                }
              />
              <Input
                label="Velocidade mínima"
                type="number"
                value={form.velocidadeMinimaViagemKmh}
                onChange={(valor) =>
                  setForm((a) => ({ ...a, velocidadeMinimaViagemKmh: valor }))
                }
              />
            </div>

            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#0d0c2c] px-4 py-4">
              <span>
                <span className="block text-sm font-black">Saída ativa</span>
                <span className="mt-1 block text-xs text-slate-500">
                  Desative para suspender sem apagar.
                </span>
              </span>
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(event) =>
                  setForm((a) => ({ ...a, ativo: event.target.checked }))
                }
                className="h-5 w-5"
              />
            </label>

            <button
              onClick={salvar}
              disabled={salvando}
              className="rounded-2xl bg-sky-500 px-5 py-4 text-sm font-black uppercase text-slate-950 shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              {salvando
                ? "Salvando..."
                : form.id
                  ? "Atualizar saída"
                  : "Adicionar saída"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-white/5 bg-[#143760]/80 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Agenda cadastrada
              </p>
              <h2 className="mt-2 text-xl font-black">
                {programacoesDoBarco.length} saída(s)
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={filtroAtivas}
                onChange={(event) =>
                  setFiltroAtivas(event.target.value as typeof filtroAtivas)
                }
                className="rounded-xl border border-white/10 bg-[#0d0c2c] px-3 py-2 text-xs font-bold text-white"
              >
                <option value="todas">Todas</option>
                <option value="ativas">Ativas</option>
                <option value="inativas">Inativas</option>
              </select>
              <button
                onClick={importarGradesAtuais}
                className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-300"
              >
                Importar grades atuais
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {programacoesDoBarco.map((item) => {
              const itinerario = Array.isArray(item.itinerario)
                ? item.itinerario
                : Array.isArray(item.escalas)
                  ? item.escalas
                  : [];
              return (
                <article
                  key={item.id}
                  className={`rounded-2xl border p-4 ${
                    item.ativo === false
                      ? "border-white/5 bg-slate-950/30 opacity-65"
                      : "border-sky-400/10 bg-[#0d0c2c]/80"
                  }`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-sky-400/10 px-3 py-1 text-[10px] font-black uppercase text-sky-300">
                          {texto(item.sentido) || "ida"}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${
                            item.ativo === false
                              ? "bg-slate-700 text-slate-300"
                              : "bg-emerald-400/10 text-emerald-300"
                          }`}
                        >
                          {item.ativo === false ? "Suspensa" : "Ativa"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-lg font-black">
                        {formatarDias(diasNormalizados(item.diasSemana))} às {horario(item.horarioSaida)}
                      </h3>
                      <p className="mt-1 text-sm font-bold text-slate-300">
                        {item.origemCidade || item.origem || "Origem"} → {item.destinoCidade || item.destino || "Destino"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.origemPortoNome || item.portoOrigem || "Porto de origem"} → {item.destinoPortoNome || item.portoDestino || "Porto de destino"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                        <span className="rounded-lg bg-white/5 px-2 py-1">
                          Duração: {duracaoTexto(item.duracaoPrevistaMinutos)}
                        </span>
                        <span className="rounded-lg bg-white/5 px-2 py-1">
                          Escalas: {Math.max(0, itinerario.length - 2)}
                        </span>
                        <span className="rounded-lg bg-white/5 px-2 py-1">
                          Fuso: {item.timezone || "America/Manaus"}
                        </span>
                        {(item.vigenciaInicio || item.vigenciaFim) && (
                          <span className="rounded-lg bg-white/5 px-2 py-1">
                            Vigência: {item.vigenciaInicio || "agora"} até {item.vigenciaFim || "sem fim"}
                          </span>
                        )}
                      </div>
                      {itinerario.length > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-1 text-[10px] font-bold text-sky-200/70">
                          {itinerario.map((ponto: any, index: number) => (
                            <React.Fragment key={`${ponto.portoId || ponto.id || index}_${index}`}>
                              {index > 0 && <span>→</span>}
                              <span className="rounded-md bg-sky-400/5 px-2 py-1">
                                {ponto.nome || ponto.porto || ponto.cidade || "Porto"}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => editar(item)} className="acao">
                        Editar
                      </button>
                      <button onClick={() => duplicar(item)} className="acao">
                        Duplicar
                      </button>
                      <button onClick={() => alternarAtiva(item)} className="acao">
                        {item.ativo === false ? "Ativar" : "Suspender"}
                      </button>
                      <button
                        onClick={() => excluir(item)}
                        className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-black text-red-300"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {programacoesDoBarco.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 p-10 text-center">
                <p className="text-sm font-bold text-slate-400">
                  Nenhuma saída cadastrada para esta embarcação.
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  Importe as grades atuais ou adicione a primeira saída completa.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {modalCidadeAberto && (
        <ModalCadastro titulo="Cadastrar nova cidade" onFechar={() => setModalCidadeAberto(false)}>
          <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
            <Input
              label="Nome da cidade"
              value={formCidade.nome}
              onChange={(valor) => setFormCidade((atual) => ({ ...atual, nome: valor }))}
            />
            <Input
              label="UF"
              value={formCidade.uf}
              onChange={(valor) =>
                setFormCidade((atual) => ({ ...atual, uf: valor.toUpperCase().slice(0, 2) }))
              }
            />
          </div>
          <Input
            label="País"
            value={formCidade.pais}
            onChange={(valor) => setFormCidade((atual) => ({ ...atual, pais: valor }))}
          />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setModalCidadeAberto(false)} className="mini-acao">Cancelar</button>
            <button type="button" onClick={salvarNovaCidade} disabled={salvandoCadastro} className="acao disabled:opacity-50">
              {salvandoCadastro ? "Salvando..." : "Salvar cidade"}
            </button>
          </div>
        </ModalCadastro>
      )}

      {modalPortoAberto && (
        <ModalCadastro titulo="Cadastrar novo porto ou terminal" onFechar={() => setModalPortoAberto(false)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nome do porto"
              value={formPorto.nome}
              onChange={(valor) => setFormPorto((atual) => ({ ...atual, nome: valor }))}
            />
            <Campo label="Tipo">
              <select
                className="campo"
                value={formPorto.tipo}
                onChange={(event) => setFormPorto((atual) => ({ ...atual, tipo: event.target.value }))}
              >
                <option value="porto">Porto</option>
                <option value="terminal_hidroviario">Terminal hidroviário</option>
                <option value="balsa">Balsa</option>
                <option value="rampa">Rampa</option>
                <option value="comunidade">Comunidade</option>
                <option value="flutuante">Flutuante</option>
                <option value="ponto_embarque">Ponto de embarque</option>
                <option value="outro">Outro</option>
              </select>
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
            <SelectCidade
              label="Cidade"
              value={formPorto.cidade}
              cidades={cidadesDisponiveis}
              onChange={(valor) =>
                setFormPorto((atual) => ({ ...atual, cidade: valor, uf: extrairUf(valor, atual.uf) }))
              }
              onCadastrar={() => {
                setRetornarPortoAposCidade(true);
                setFormCidade({ ...FORM_CIDADE_VAZIO });
                setModalPortoAberto(false);
                setModalCidadeAberto(true);
              }}
            />
            <Input
              label="UF"
              value={formPorto.uf}
              onChange={(valor) =>
                setFormPorto((atual) => ({ ...atual, uf: valor.toUpperCase().slice(0, 2) }))
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Latitude" value={formPorto.latitude} onChange={(valor) => setFormPorto((atual) => ({ ...atual, latitude: valor }))} />
            <Input label="Longitude" value={formPorto.longitude} onChange={(valor) => setFormPorto((atual) => ({ ...atual, longitude: valor }))} />
          </div>
          <Input
            label="Raio de chegada em metros"
            type="number"
            value={formPorto.raioChegadaMetros}
            onChange={(valor) => setFormPorto((atual) => ({ ...atual, raioChegadaMetros: valor }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Endereço" value={formPorto.endereco} onChange={(valor) => setFormPorto((atual) => ({ ...atual, endereco: valor }))} />
            <Input label="Referência" value={formPorto.referencia} onChange={(valor) => setFormPorto((atual) => ({ ...atual, referencia: valor }))} />
          </div>
          <label className="text-xs font-bold text-slate-400">
            Observações
            <textarea
              className="campo min-h-24 resize-y"
              value={formPorto.observacoes}
              onChange={(event) => setFormPorto((atual) => ({ ...atual, observacoes: event.target.value }))}
            />
          </label>
          <p className="rounded-xl border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-[11px] leading-5 text-amber-100/70">
            As coordenadas e o raio permitem reconhecer chegada, saída, escala concluída e próximo porto.
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setModalPortoAberto(false)} className="mini-acao">Cancelar</button>
            <button type="button" onClick={salvarNovoPorto} disabled={salvandoCadastro} className="acao disabled:opacity-50">
              {salvandoCadastro ? "Salvando..." : "Salvar porto"}
            </button>
          </div>
        </ModalCadastro>
      )}

      <style>{`
        .campo {
          margin-top: 0.5rem;
          width: 100%;
          border-radius: 1rem;
          border: 1px solid rgba(255,255,255,0.1);
          background: #0d0c2c;
          padding: 0.75rem 1rem;
          color: white;
          font-size: 0.875rem;
          font-weight: 700;
          outline: none;
        }
        .acao {
          border-radius: 0.75rem;
          border: 1px solid rgba(56,189,248,0.2);
          background: rgba(56,189,248,0.1);
          padding: 0.5rem 0.75rem;
          color: #7dd3fc;
          font-size: 0.75rem;
          font-weight: 900;
        }
        .mini-acao {
          border-radius: 0.5rem;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.05);
          padding: 0.25rem 0.55rem;
          color: #cbd5e1;
          font-size: 0.75rem;
          font-weight: 900;
        }
      `}</style>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs font-bold text-slate-400">
      {label}
      {children}
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  type?: string;
}) {
  return (
    <label className="text-xs font-bold text-slate-400">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="campo"
      />
    </label>
  );
}

function SelectCidade({
  label,
  value,
  cidades,
  onChange,
  onCadastrar,
}: {
  label: string;
  value: string;
  cidades: string[];
  onChange: (valor: string) => void;
  onCadastrar?: () => void;
}) {
  return (
    <Campo label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="campo"
      >
        <option value="">Selecione a cidade</option>
        {cidades.map((cidade) => (
          <option key={cidade} value={cidade}>
            {cidade}
          </option>
        ))}
      </select>
      {onCadastrar && (
        <button type="button" onClick={onCadastrar} className="mt-2 text-[11px] font-black text-sky-300 hover:text-sky-200">
          + Cadastrar nova cidade
        </button>
      )}
    </Campo>
  );
}

function SelectPorto({
  label,
  value,
  locais,
  onChange,
  onCadastrar,
}: {
  label: string;
  value: string;
  locais: LocalOperacional[];
  onChange: (valor: string) => void;
  onCadastrar?: () => void;
}) {
  return (
    <Campo label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="campo"
        disabled={locais.length === 0}
      >
        <option value="">
          {locais.length > 0
            ? "Selecione o porto/terminal"
            : "Cadastre um porto nessa cidade"}
        </option>
        {locais.map((local) => (
          <option key={local.chave} value={local.chave}>
            {local.nome}
            {local.coordenadas ? "" : " — sem coordenadas"}
          </option>
        ))}
      </select>
      {onCadastrar && (
        <button type="button" onClick={onCadastrar} className="mt-2 text-[11px] font-black text-emerald-300 hover:text-emerald-200">
          + Cadastrar novo porto
        </button>
      )}
    </Campo>
  );
}

function ModalCadastro({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-sky-400/15 bg-[#101f3d] p-5 shadow-2xl sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-300">Cadastro operacional</p>
            <h3 className="mt-1 text-xl font-black text-white">{titulo}</h3>
          </div>
          <button type="button" onClick={onFechar} className="mini-acao">Fechar</button>
        </div>
        <div className="grid gap-4">{children}</div>
      </div>
    </div>
  );
}

function ResumoLocal({ local }: { local: LocalOperacional }) {
  return (
    <div className="mt-3 rounded-xl border border-white/5 bg-slate-950/25 px-3 py-2 text-[10px] text-slate-500">
      <span className="font-black text-slate-300">{nomeLocal(local)}</span>
      <span className="ml-2">
        {local.coordenadas
          ? `${local.coordenadas.lat.toFixed(5)}, ${local.coordenadas.lng.toFixed(5)}`
          : "sem coordenadas cadastradas"}
      </span>
      {local.raioChegadaMetros && (
        <span className="ml-2">Raio: {local.raioChegadaMetros} m</span>
      )}
    </div>
  );
}
