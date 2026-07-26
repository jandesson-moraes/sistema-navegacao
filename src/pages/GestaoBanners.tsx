import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  limit,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type TipoCampanha =
  | "promocao"
  | "escala"
  | "alteracao_horario"
  | "alteracao_rota"
  | "aviso_operacional"
  | "venda_passagem"
  | "servico"
  | "informativo";

type PublicoAlvo = "todos" | "cidade" | "comprou_barco" | "embarcacoes";
type GatilhoExibicao = "selecao_embarcacao" | "ao_abrir_app" | "imediato";
type FrequenciaExibicao = "sessao" | "dia" | "selecao" | "intervalo";
type AcaoTipo = "nenhuma" | "detalhes" | "vendas" | "itinerario" | "whatsapp" | "link";
type StatusCampanha = "rascunho" | "agendado" | "ativo" | "pausado" | "expirado";

type BannerForm = {
  titulo: string;
  subtitulo: string;
  mensagem: string;
  botaoTexto: string;
  acaoTipo: AcaoTipo;
  acaoDestino: string;
  tipo: TipoCampanha;
  publicoAlvo: PublicoAlvo;
  cidadeAlvo: string;
  barcosIdsAlvo: string[];
  gatilhoExibicao: GatilhoExibicao;
  atrasoSegundos: number;
  frequencia: FrequenciaExibicao;
  intervaloMinimoMinutos: number;
  vigenciaInicio: string;
  vigenciaFim: string;
  semDataFinal: boolean;
  diasSemana: number[];
  restringirHorario: boolean;
  horarioInicio: string;
  horarioFim: string;
  duracaoAbertoSegundos: number;
  prioridade: number;
  destaque: boolean;
  exibirComoPopup: boolean;
  ativo: boolean;
  publicado: boolean;
};

type MetricasBanner = {
  impressoes: number;
  cliques: number;
  fechamentos: number;
};

const FUSO_HORARIO = "America/Manaus";
const DIAS = [
  [0, "Dom"],
  [1, "Seg"],
  [2, "Ter"],
  [3, "Qua"],
  [4, "Qui"],
  [5, "Sex"],
  [6, "Sáb"],
] as const;

const TIPOS: Record<
  TipoCampanha,
  { label: string; tag: string; icone: string; classe: string }
> = {
  promocao: {
    label: "Promoção",
    tag: "Oferta",
    icone: "🔥",
    classe: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  },
  escala: {
    label: "Informação de escala",
    tag: "Escala",
    icone: "⚓",
    classe: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
  },
  alteracao_horario: {
    label: "Alteração de horário",
    tag: "Horário",
    icone: "⏰",
    classe: "border-orange-300/25 bg-orange-400/10 text-orange-100",
  },
  alteracao_rota: {
    label: "Alteração de rota",
    tag: "Rota",
    icone: "🧭",
    classe: "border-violet-300/25 bg-violet-400/10 text-violet-100",
  },
  aviso_operacional: {
    label: "Aviso operacional",
    tag: "Aviso",
    icone: "🔔",
    classe: "border-sky-300/25 bg-sky-400/10 text-sky-100",
  },
  venda_passagem: {
    label: "Venda de passagem",
    tag: "Passagem",
    icone: "🎟️",
    classe: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  },
  servico: {
    label: "Serviço da embarcação",
    tag: "Serviço",
    icone: "🛟",
    classe: "border-teal-300/25 bg-teal-400/10 text-teal-100",
  },
  informativo: {
    label: "Informativo geral",
    tag: "Info",
    icone: "✨",
    classe: "border-indigo-300/25 bg-indigo-400/10 text-indigo-100",
  },
};

const FORM_INICIAL: BannerForm = {
  titulo: "",
  subtitulo: "",
  mensagem: "",
  botaoTexto: "Ver agora",
  acaoTipo: "nenhuma",
  acaoDestino: "",
  tipo: "promocao",
  publicoAlvo: "embarcacoes",
  cidadeAlvo: "",
  barcosIdsAlvo: [],
  gatilhoExibicao: "selecao_embarcacao",
  atrasoSegundos: 20,
  frequencia: "dia",
  intervaloMinimoMinutos: 60,
  vigenciaInicio: valorDatetimeLocal(new Date()),
  vigenciaFim: valorDatetimeLocal(adicionarDias(new Date(), 7)),
  semDataFinal: false,
  diasSemana: [],
  restringirHorario: false,
  horarioInicio: "08:00",
  horarioFim: "22:00",
  duracaoAbertoSegundos: 0,
  prioridade: 50,
  destaque: true,
  exibirComoPopup: true,
  ativo: true,
  publicado: true,
};

function adicionarDias(data: Date, dias: number) {
  const nova = new Date(data);
  nova.setDate(nova.getDate() + dias);
  return nova;
}

function adicionarMes(data: Date) {
  const nova = new Date(data);
  nova.setMonth(nova.getMonth() + 1);
  return nova;
}

function valorDatetimeLocal(data: Date) {
  const pad = (valor: number) => String(valor).padStart(2, "0");
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T${pad(data.getHours())}:${pad(data.getMinutes())}`;
}

function isoOuVazio(valor: string) {
  if (!valor) return "";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "" : data.toISOString();
}

function datetimeLocalDeQualquer(valor: any) {
  if (!valor) return "";
  const data = typeof valor?.toDate === "function" ? valor.toDate() : new Date(valor);
  return Number.isNaN(data.getTime()) ? "" : valorDatetimeLocal(data);
}

function dataMs(valor: any) {
  if (!valor) return 0;
  if (typeof valor?.toDate === "function") return valor.toDate().getTime();
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? 0 : data.getTime();
}

function formatarData(valor: any) {
  if (!valor) return "Sem limite";
  const data = typeof valor?.toDate === "function" ? valor.toDate() : new Date(valor);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", {
    timeZone: FUSO_HORARIO,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusDaCampanha(banner: any, agora = Date.now()): StatusCampanha {
  if (banner.publicado === false) return "rascunho";
  if (banner.ativo === false) return "pausado";

  const inicio = dataMs(banner.vigenciaInicioIso || banner.vigenciaInicio);
  const fim = dataMs(banner.vigenciaFimIso || banner.vigenciaFim);

  if (inicio && agora < inicio) return "agendado";
  if (fim && agora > fim) return "expirado";
  return "ativo";
}

const STATUS_INFO: Record<StatusCampanha, { label: string; classe: string }> = {
  rascunho: { label: "Rascunho", classe: "border-slate-300/25 bg-slate-400/10 text-slate-200" },
  agendado: { label: "Agendado", classe: "border-violet-300/25 bg-violet-400/10 text-violet-100" },
  ativo: { label: "Ativo", classe: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" },
  pausado: { label: "Pausado", classe: "border-amber-300/25 bg-amber-400/10 text-amber-100" },
  expirado: { label: "Expirado", classe: "border-rose-300/25 bg-rose-400/10 text-rose-100" },
};

function normalizarCidade(valor: string) {
  return String(valor || "").trim();
}

function barcosDoBanner(banner: any) {
  const ids = Array.isArray(banner.barcosIdsAlvo)
    ? banner.barcosIdsAlvo
    : [banner.barcoIdAlvo || banner.barcoId].filter(Boolean);
  return ids.map(String);
}

function nomePublico(banner: any) {
  const publico = banner.publicoAlvo || banner.publico || "todos";
  if (publico === "cidade") return banner.cidadeAlvo || "Cidade";
  if (publico === "comprou_barco") return banner.barcoNomeAlvo || "Comprou passagem";
  if (publico === "embarcacoes") {
    const nomes = Array.isArray(banner.barcosNomesAlvo) ? banner.barcosNomesAlvo : [];
    if (nomes.length === 0) return "Todas as embarcações";
    if (nomes.length === 1) return nomes[0];
    return `${nomes.length} embarcações`;
  }
  return "Todos os usuários";
}

function labelFrequencia(valor: string) {
  if (valor === "sessao") return "Uma vez por sessão";
  if (valor === "selecao") return "Uma vez por seleção";
  if (valor === "intervalo") return "Com intervalo mínimo";
  return "Uma vez por dia";
}

export default function GestaoBanners() {
  const modal = useAppModal();
  const [banners, setBanners] = useState<any[]>([]);
  const [barcos, setBarcos] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [metricas, setMetricas] = useState<Record<string, MetricasBanner>>({});
  const [form, setForm] = useState<BannerForm>({ ...FORM_INICIAL });
  const [imagemFile, setImagemFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imagemAtualUrl, setImagemAtualUrl] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | StatusCampanha>("todos");
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const q = query(collection(db, "banners_promocionais"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      setBanners(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a: any, b: any) => dataMs(b.createdAt) - dataMs(a.createdAt)),
      );
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      setBarcos(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item: any) => item.visivelNoApp !== false)
          .sort((a: any, b: any) =>
            String(a.nome || a.id).localeCompare(String(b.nome || b.id), "pt-BR"),
          ),
      );
    });
  }, []);

  useEffect(() => {
    return onSnapshot(
      collection(db, "usuarios"),
      (snapshot) => setUsuarios(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      () => setUsuarios([]),
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      query(
        collection(db, "banner_metricas_eventos"),
        orderBy("criadoEm", "desc"),
        limit(5000),
      ),
      (snapshot) => {
        const total: Record<string, MetricasBanner> = {};
        snapshot.docs.forEach((item) => {
          const dado = item.data();
          const bannerId = String(dado.bannerId || "");
          if (!bannerId) return;
          total[bannerId] ||= { impressoes: 0, cliques: 0, fechamentos: 0 };
          if (dado.tipo === "impressao") total[bannerId].impressoes += 1;
          if (dado.tipo === "clique") total[bannerId].cliques += 1;
          if (dado.tipo === "fechamento") total[bannerId].fechamentos += 1;
        });
        setMetricas(total);
      },
      () => setMetricas({}),
    );
  }, []);

  const cidades = useMemo(() => {
    const lista = usuarios
      .map((usuario) =>
        normalizarCidade(
          usuario.cidadeResidenciaCompleta ||
            (usuario.cidadeResidencia && usuario.estadoResidencia
              ? `${usuario.cidadeResidencia} - ${usuario.estadoResidencia}`
              : usuario.cidade || usuario.cidadeUsuario || ""),
        ),
      )
      .filter(Boolean);
    return Array.from(new Set(lista)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [usuarios]);

  const bannersFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    return banners.filter((banner) => {
      const status = statusDaCampanha(banner, agora);
      if (filtro !== "todos" && status !== filtro) return false;
      if (!texto) return true;
      return [
        banner.titulo,
        banner.subtitulo,
        banner.mensagem,
        banner.cidadeAlvo,
        banner.barcoNomeAlvo,
        ...(banner.barcosNomesAlvo || []),
        banner.tipo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [agora, banners, busca, filtro]);

  const resumo = useMemo(() => {
    const contagem = { total: banners.length, ativo: 0, agendado: 0, pausado: 0, expirado: 0 };
    banners.forEach((banner) => {
      const status = statusDaCampanha(banner, agora);
      if (status === "ativo") contagem.ativo += 1;
      if (status === "agendado") contagem.agendado += 1;
      if (status === "pausado" || status === "rascunho") contagem.pausado += 1;
      if (status === "expirado") contagem.expirado += 1;
    });
    return contagem;
  }, [agora, banners]);

  const atualizarForm = <K extends keyof BannerForm>(campo: K, valor: BannerForm[K]) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  const alternarBarco = (barcoId: string) => {
    setForm((atual) => ({
      ...atual,
      barcosIdsAlvo: atual.barcosIdsAlvo.includes(barcoId)
        ? atual.barcosIdsAlvo.filter((id) => id !== barcoId)
        : [...atual.barcosIdsAlvo, barcoId],
    }));
  };

  const aplicarPeriodo = (tipo: "dia" | "semana" | "quinze" | "mes" | "personalizado") => {
    if (tipo === "personalizado") return;
    const inicio = form.vigenciaInicio ? new Date(form.vigenciaInicio) : new Date();
    const fim = tipo === "mes" ? adicionarMes(inicio) : adicionarDias(inicio, tipo === "dia" ? 1 : tipo === "semana" ? 7 : 15);
    atualizarForm("vigenciaFim", valorDatetimeLocal(fim));
    atualizarForm("semDataFinal", false);
  };

  const handleFileChange = (evento: React.ChangeEvent<HTMLInputElement>) => {
    const file = evento.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      void modal.aviso("Arquivo inválido", "Selecione uma imagem para o banner.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      void modal.aviso("Imagem muito grande", "Use uma imagem de até 8 MB.");
      return;
    }
    setImagemFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const validar = async () => {
    if (!auth.currentUser) {
      await modal.erro("Acesso negado", "Faça login novamente para continuar.");
      return false;
    }
    if (!form.titulo.trim() || !form.mensagem.trim()) {
      await modal.aviso("Conteúdo incompleto", "Informe o título e a mensagem da campanha.");
      return false;
    }
    if (form.publicoAlvo === "cidade" && !form.cidadeAlvo.trim()) {
      await modal.aviso("Cidade obrigatória", "Selecione a cidade do público-alvo.");
      return false;
    }
    if (
      (form.publicoAlvo === "comprou_barco" ||
        (form.publicoAlvo === "embarcacoes" && form.gatilhoExibicao !== "selecao_embarcacao")) &&
      form.barcosIdsAlvo.length === 0
    ) {
      await modal.aviso("Selecione a embarcação", "Marque pelo menos uma embarcação.");
      return false;
    }
    if (![0, 3, 5, 10, 20, 30, 40].includes(form.atrasoSegundos)) {
      await modal.aviso("Atraso inválido", "Escolha 3, 5, 10, 20, 30, 40 segundos ou desative a abertura automática.");
      return false;
    }
    const inicio = new Date(form.vigenciaInicio);
    if (Number.isNaN(inicio.getTime())) {
      await modal.aviso("Início obrigatório", "Informe a data e a hora de início.");
      return false;
    }
    if (!form.semDataFinal) {
      const fim = new Date(form.vigenciaFim);
      if (Number.isNaN(fim.getTime())) {
        await modal.aviso("Fim obrigatório", "Informe a data e a hora final.");
        return false;
      }
      if (fim.getTime() <= inicio.getTime()) {
        await modal.aviso("Período inválido", "A data final deve ser posterior à data inicial.");
        return false;
      }
    }
    if (form.restringirHorario && form.horarioInicio === form.horarioFim) {
      await modal.aviso("Faixa inválida", "Os horários inicial e final precisam ser diferentes.");
      return false;
    }
    if (form.acaoTipo === "link" && !/^https?:\/\//i.test(form.acaoDestino.trim())) {
      await modal.aviso("Link inválido", "Informe um endereço iniciado por http:// ou https://.");
      return false;
    }
    if (form.acaoTipo === "whatsapp" && !form.acaoDestino.replace(/\D/g, "")) {
      await modal.aviso("WhatsApp obrigatório", "Informe o número usado pelo botão.");
      return false;
    }
    return true;
  };

  const salvarBanner = async (publicarAgora: boolean) => {
    const valido = await validar();
    if (!valido) return;
    setCarregando(true);

    try {
      let downloadURL = imagemAtualUrl;
      if (imagemFile) {
        const nomeSeguro = imagemFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storageRef = ref(storage, `banners/${Date.now()}_${nomeSeguro}`);
        downloadURL = await getDownloadURL((await uploadBytes(storageRef, imagemFile)).ref);
      }

      const selecionados = barcos.filter((barco) => form.barcosIdsAlvo.includes(barco.id));
      const primeiro = selecionados[0];
      const publicado = publicarAgora;
      const ativo = publicarAgora ? form.ativo : false;
      const vigenciaInicioIso = isoOuVazio(form.vigenciaInicio);
      const vigenciaFimIso = form.semDataFinal ? "" : isoOuVazio(form.vigenciaFim);

      const dados = {
        schemaVersao: 2,
        titulo: form.titulo.trim(),
        subtitulo: form.subtitulo.trim(),
        mensagem: form.mensagem.trim(),
        botaoTexto: form.botaoTexto.trim() || "Ver agora",
        imageUrl: downloadURL,
        imagemUrl: downloadURL,
        tipo: form.tipo,
        publicoAlvo: form.publicoAlvo,
        cidadeAlvo: form.publicoAlvo === "cidade" ? form.cidadeAlvo.trim() : "",
        cidadeAlvoNormalizada: form.publicoAlvo === "cidade" ? form.cidadeAlvo.trim().toLowerCase() : "",
        barcosIdsAlvo: form.barcosIdsAlvo,
        barcosNomesAlvo: selecionados.map((barco) => String(barco.nome || barco.id)),
        barcoIdAlvo: primeiro?.id || "",
        barcoNomeAlvo: String(primeiro?.nome || primeiro?.id || ""),
        barcoId: primeiro?.id || "",
        barcoNome: String(primeiro?.nome || primeiro?.id || ""),
        gatilhoExibicao: form.gatilhoExibicao,
        momentoExibicao:
          form.gatilhoExibicao === "imediato"
            ? "agora"
            : form.gatilhoExibicao === "ao_abrir_app"
              ? "ao_abrir_app"
              : "apos_tempo",
        atrasoSegundos: form.atrasoSegundos,
        tempoDepoisSegundos: form.atrasoSegundos,
        abrirAutomaticamente: form.atrasoSegundos > 0 || form.gatilhoExibicao !== "selecao_embarcacao",
        frequencia: form.frequencia,
        mostrarUmaVez: form.frequencia === "sessao",
        intervaloMinimoMinutos: form.intervaloMinimoMinutos,
        vigenciaInicioIso,
        vigenciaFimIso,
        semDataFinal: form.semDataFinal,
        diasSemana: form.diasSemana,
        restringirHorario: form.restringirHorario,
        horarioInicio: form.restringirHorario ? form.horarioInicio : "",
        horarioFim: form.restringirHorario ? form.horarioFim : "",
        fusoHorario: FUSO_HORARIO,
        duracaoAbertoSegundos: form.duracaoAbertoSegundos,
        acaoTipo: form.acaoTipo,
        acaoDestino: form.acaoDestino.trim(),
        linkDestino: form.acaoTipo === "link" ? form.acaoDestino.trim() : "",
        prioridade: Math.max(0, Math.min(100, Number(form.prioridade) || 0)),
        ativo,
        publicado,
        destaque: form.destaque,
        exibirComoPopup: form.exibirComoPopup,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: auth.currentUser?.email || "",
        exibicaoMobile: {
          formato: "modal_responsivo",
          popup: form.exibirComoPopup,
          destaque: form.destaque,
          gatilhoExibicao: form.gatilhoExibicao,
          atrasoSegundos: form.atrasoSegundos,
          duracaoAbertoSegundos: form.duracaoAbertoSegundos,
          frequencia: form.frequencia,
        },
      };

      if (editandoId) {
        await updateDoc(doc(db, "banners_promocionais", editandoId), dados);
      } else {
        await addDoc(collection(db, "banners_promocionais"), {
          ...dados,
          createdAt: serverTimestamp(),
          criadoPor: auth.currentUser.email || "",
        });
      }

      setForm({ ...FORM_INICIAL, vigenciaInicio: valorDatetimeLocal(new Date()), vigenciaFim: valorDatetimeLocal(adicionarDias(new Date(), 7)) });
      setImagemFile(null);
      setPreviewUrl(null);
      setImagemAtualUrl("");
      setEditandoId(null);

      await modal.sucesso(
        publicarAgora ? "Campanha publicada" : "Rascunho salvo",
        publicarAgora
          ? "A campanha seguirá o direcionamento, a vigência e a frequência configurados."
          : "A campanha foi salva sem aparecer no aplicativo.",
      );
    } catch (error: any) {
      await modal.erro("Falha ao salvar", error?.message || "Não foi possível salvar a campanha.");
    } finally {
      setCarregando(false);
    }
  };

  const editarBanner = (banner: any) => {
    setEditandoId(banner.id);
    setImagemFile(null);
    setImagemAtualUrl(banner.imageUrl || banner.imagemUrl || "");
    setPreviewUrl(banner.imageUrl || banner.imagemUrl || null);
    setForm({
      titulo: banner.titulo || "",
      subtitulo: banner.subtitulo || "",
      mensagem: banner.mensagem || "",
      botaoTexto: banner.botaoTexto || "Ver agora",
      acaoTipo: banner.acaoTipo || (banner.linkDestino ? "link" : "nenhuma"),
      acaoDestino: banner.acaoDestino || banner.linkDestino || "",
      tipo: Object.prototype.hasOwnProperty.call(TIPOS, banner.tipo)
        ? banner.tipo
        : "informativo",
      publicoAlvo:
        banner.publicoAlvo === "cidade" || banner.publicoAlvo === "comprou_barco" || banner.publicoAlvo === "embarcacoes"
          ? banner.publicoAlvo
          : "todos",
      cidadeAlvo: banner.cidadeAlvo || "",
      barcosIdsAlvo: barcosDoBanner(banner),
      gatilhoExibicao:
        banner.gatilhoExibicao ||
        (banner.momentoExibicao === "agora"
          ? "imediato"
          : banner.momentoExibicao === "ao_abrir_app"
            ? "ao_abrir_app"
            : "selecao_embarcacao"),
      atrasoSegundos: [0, 3, 5, 10, 20, 30, 40].includes(Number(banner.atrasoSegundos ?? banner.tempoDepoisSegundos))
        ? Number(banner.atrasoSegundos ?? banner.tempoDepoisSegundos)
        : 20,
      frequencia: banner.frequencia || (banner.mostrarUmaVez !== false ? "sessao" : "dia"),
      intervaloMinimoMinutos: Number(banner.intervaloMinimoMinutos || 60),
      vigenciaInicio: datetimeLocalDeQualquer(banner.vigenciaInicioIso || banner.vigenciaInicio) || valorDatetimeLocal(new Date()),
      vigenciaFim: datetimeLocalDeQualquer(banner.vigenciaFimIso || banner.vigenciaFim) || valorDatetimeLocal(adicionarDias(new Date(), 7)),
      semDataFinal: banner.semDataFinal === true || !banner.vigenciaFimIso,
      diasSemana: Array.isArray(banner.diasSemana) ? banner.diasSemana.map(Number) : [],
      restringirHorario: banner.restringirHorario === true,
      horarioInicio: banner.horarioInicio || "08:00",
      horarioFim: banner.horarioFim || "22:00",
      duracaoAbertoSegundos: Number(banner.duracaoAbertoSegundos || 0),
      prioridade: Number(banner.prioridade ?? 50),
      destaque: banner.destaque !== false,
      exibirComoPopup: banner.exibirComoPopup !== false,
      ativo: banner.ativo !== false,
      publicado: banner.publicado !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelarEdicao = () => {
    setEditandoId(null);
    setForm({ ...FORM_INICIAL, vigenciaInicio: valorDatetimeLocal(new Date()), vigenciaFim: valorDatetimeLocal(adicionarDias(new Date(), 7)) });
    setImagemFile(null);
    setImagemAtualUrl("");
    setPreviewUrl(null);
  };

  const mostrarAgora = async (banner: any) => {
    try {
      await updateDoc(doc(db, "banners_promocionais", banner.id), {
        ativo: true,
        publicado: true,
        disparoAgoraId: String(Date.now()),
        forcarExibicaoAteIso: new Date(Date.now() + 10 * 60_000).toISOString(),
        atualizadoEm: serverTimestamp(),
      });
      await modal.sucesso("Disparo liberado", "A campanha poderá aparecer imediatamente durante os próximos 10 minutos.");
    } catch (error: any) {
      await modal.erro("Erro ao disparar", error?.message || "Não foi possível disparar a campanha.");
    }
  };

  const alternarStatus = async (banner: any) => {
    await updateDoc(doc(db, "banners_promocionais", banner.id), {
      ativo: banner.ativo === false,
      publicado: true,
      atualizadoEm: serverTimestamp(),
    });
  };

  const deletarBanner = async (banner: any) => {
    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Remover campanha?",
      mensagem: `Remover “${banner.titulo || "esta campanha"}”?`,
      confirmarTexto: "Remover",
      cancelarTexto: "Cancelar",
    });
    if (confirmou) await deleteDoc(doc(db, "banners_promocionais", banner.id));
  };

  const tipoInfo = TIPOS[form.tipo];

  return (
    <div className="cmb-page min-h-screen bg-[#0d0c2c] p-3 text-white sm:p-5 lg:p-6">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300 sm:text-xs">Central de campanhas</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Banners por embarcação</h1>
          <p className="mt-1 max-w-3xl text-sm text-sky-100/60">
            Organize promoções, escalas e avisos com direcionamento, vigência, frequência e visualização adaptada ao celular.
          </p>
        </div>
        <input
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar campanha ou embarcação..."
          className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-base font-semibold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60 xl:w-[380px]"
        />
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniResumo label="Campanhas" valor={resumo.total} />
        <MiniResumo label="Ativas" valor={resumo.ativo} />
        <MiniResumo label="Agendadas" valor={resumo.agendado} />
        <MiniResumo label="Pausadas" valor={resumo.pausado} />
        <MiniResumo label="Expiradas" valor={resumo.expirado} />
      </div>

      <main className="grid min-w-0 gap-5 2xl:grid-cols-[500px_minmax(0,1fr)]">
        <section className="min-w-0 rounded-[26px] border border-[#1d426b] bg-[#0f2240] p-3 shadow-sm sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">{editandoId ? "Editar campanha" : "Nova campanha"}</h2>
              <p className="mt-1 text-xs text-sky-100/55">Preencha por etapas. Os campos foram organizados para uso no celular.</p>
            </div>
            {editandoId && (
              <button onClick={cancelarEdicao} className="rounded-xl border border-white/15 px-3 py-2 text-[10px] font-black uppercase">Cancelar</button>
            )}
          </div>

          <div className="mb-4 rounded-[28px] border border-[#7ba6d4]/25 bg-[#071a31] p-3">
            <div className="mx-auto w-full max-w-[270px] overflow-hidden rounded-[30px] border-[6px] border-[#020617] bg-[#020617] shadow-2xl">
              <div className="relative aspect-[9/16] overflow-hidden rounded-[23px] bg-gradient-to-br from-[#123760] to-[#071a31]">
                {previewUrl ? (
                  <img src={previewUrl} alt="Prévia" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-8 text-center text-sm font-bold text-sky-100/45">A imagem é opcional para avisos e escalas.</div>
                )}
                <div className="absolute inset-x-3 bottom-3 rounded-3xl border border-white/15 bg-[#020617]/85 p-4 backdrop-blur-md">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${tipoInfo.classe}`}>{tipoInfo.icone} {tipoInfo.tag}</span>
                    <span className="rounded-full border border-sky-300/25 bg-sky-400/10 px-2 py-1 text-[8px] font-black uppercase text-sky-100">{form.atrasoSegundos ? `${form.atrasoSegundos}s` : "Manual"}</span>
                  </div>
                  <h3 className="line-clamp-2 text-base font-black">{form.titulo || "Título da campanha"}</h3>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-sky-100/70">{form.mensagem || "Mensagem que será exibida ao passageiro."}</p>
                  {form.acaoTipo !== "nenhuma" && <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-center text-[10px] font-black uppercase text-[#0f2240]">{form.botaoTexto || "Ver agora"}</div>}
                </div>
              </div>
            </div>
          </div>

          <details open className="cmb-section">
            <summary>1. Conteúdo do banner</summary>
            <div className="grid gap-3 pt-4">
              <label className="cmb-field">
                <span>Imagem da campanha</span>
                <input type="file" accept="image/*" onChange={handleFileChange} className="block w-full text-xs file:mr-3 file:rounded-xl file:border-0 file:bg-sky-400/15 file:px-3 file:py-2 file:font-black file:text-sky-100" />
              </label>
              <Select label="Tipo" value={form.tipo} onChange={(valor) => atualizarForm("tipo", valor as TipoCampanha)} options={Object.entries(TIPOS).map(([id, info]) => [id, info.label])} />
              <Campo label="Título" value={form.titulo} onChange={(valor) => atualizarForm("titulo", valor)} placeholder="Ex.: Escala especial em Itacoatiara" />
              <Campo label="Subtítulo" value={form.subtitulo} onChange={(valor) => atualizarForm("subtitulo", valor)} placeholder="Informação complementar" />
              <label className="cmb-field">
                <span>Mensagem</span>
                <textarea rows={4} value={form.mensagem} onChange={(evento) => atualizarForm("mensagem", evento.target.value)} placeholder="Escreva a informação para o passageiro..." />
              </label>
            </div>
          </details>

          <details open className="cmb-section">
            <summary>2. Direcionamento</summary>
            <div className="grid gap-3 pt-4">
              <Select label="Público" value={form.publicoAlvo} onChange={(valor) => atualizarForm("publicoAlvo", valor as PublicoAlvo)} options={[
                ["embarcacoes", "Ao selecionar uma ou mais embarcações"],
                ["todos", "Todos os usuários"],
                ["cidade", "Usuários de uma cidade"],
                ["comprou_barco", "Quem comprou passagem da embarcação"],
              ]} />

              {form.publicoAlvo === "cidade" && (
                <Select label="Cidade" value={form.cidadeAlvo} onChange={(valor) => atualizarForm("cidadeAlvo", valor)} options={[["", "Selecione..."], ...cidades.map((cidade) => [cidade, cidade])]} />
              )}

              {(form.publicoAlvo === "embarcacoes" || form.publicoAlvo === "comprou_barco") && (
                <div className="cmb-field">
                  <span>Embarcações {form.publicoAlvo === "embarcacoes" ? "(nenhuma marcada = todas)" : ""}</span>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-[#071a31] p-2">
                    {barcos.map((barco) => (
                      <label key={barco.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 active:bg-white/10">
                        <input type="checkbox" checked={form.barcosIdsAlvo.includes(barco.id)} onChange={() => alternarBarco(barco.id)} className="h-5 w-5" />
                        <span className="min-w-0 truncate text-sm font-bold">{barco.nome || barco.id}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Select label="Momento de exibição" value={form.gatilhoExibicao} onChange={(valor) => atualizarForm("gatilhoExibicao", valor as GatilhoExibicao)} options={[
                ["selecao_embarcacao", "Após selecionar a embarcação"],
                ["ao_abrir_app", "Ao abrir o aplicativo"],
                ["imediato", "Disparo imediato"],
              ]} />

              {form.gatilhoExibicao === "selecao_embarcacao" && (
                <Select label="Atraso para aparecer" value={String(form.atrasoSegundos)} onChange={(valor) => atualizarForm("atrasoSegundos", Number(valor))} options={[
                  ["0", "Não abrir automaticamente"],
                  ["3", "3 segundos"],
                  ["5", "5 segundos"],
                  ["10", "10 segundos"],
                  ["20", "20 segundos"],
                  ["30", "30 segundos"],
                  ["40", "40 segundos"],
                ]} />
              )}
            </div>
          </details>

          <details open className="cmb-section">
            <summary>3. Vigência e horários</summary>
            <div className="grid gap-3 pt-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <AtalhoPeriodo label="1 dia" onClick={() => aplicarPeriodo("dia")} />
                <AtalhoPeriodo label="1 semana" onClick={() => aplicarPeriodo("semana")} />
                <AtalhoPeriodo label="15 dias" onClick={() => aplicarPeriodo("quinze")} />
                <AtalhoPeriodo label="1 mês" onClick={() => aplicarPeriodo("mes")} />
                <AtalhoPeriodo label="Personalizado" onClick={() => aplicarPeriodo("personalizado")} />
              </div>
              <Campo label="Início" type="datetime-local" value={form.vigenciaInicio} onChange={(valor) => atualizarForm("vigenciaInicio", valor)} />
              <Toggle label="Sem data final" checked={form.semDataFinal} onChange={(valor) => atualizarForm("semDataFinal", valor)} />
              {!form.semDataFinal && <Campo label="Fim" type="datetime-local" value={form.vigenciaFim} onChange={(valor) => atualizarForm("vigenciaFim", valor)} />}
              <div className="cmb-field">
                <span>Dias da semana (nenhum marcado = todos)</span>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {DIAS.map(([dia, label]) => (
                    <button key={dia} type="button" onClick={() => atualizarForm("diasSemana", form.diasSemana.includes(dia) ? form.diasSemana.filter((item) => item !== dia) : [...form.diasSemana, dia])} className={`min-h-11 rounded-xl border text-xs font-black ${form.diasSemana.includes(dia) ? "border-sky-300 bg-sky-400/20 text-white" : "border-white/10 bg-white/[0.03] text-sky-100/60"}`}>{label}</button>
                  ))}
                </div>
              </div>
              <Toggle label="Restringir por faixa de horário" checked={form.restringirHorario} onChange={(valor) => atualizarForm("restringirHorario", valor)} />
              {form.restringirHorario && (
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Das" type="time" value={form.horarioInicio} onChange={(valor) => atualizarForm("horarioInicio", valor)} />
                  <Campo label="Até" type="time" value={form.horarioFim} onChange={(valor) => atualizarForm("horarioFim", valor)} />
                </div>
              )}
              <p className="rounded-xl border border-sky-300/15 bg-sky-400/5 p-3 text-xs text-sky-100/60">Fuso operacional: <strong>{FUSO_HORARIO}</strong>.</p>
            </div>
          </details>

          <details className="cmb-section">
            <summary>4. Frequência, ação e prioridade</summary>
            <div className="grid gap-3 pt-4">
              <Select label="Frequência" value={form.frequencia} onChange={(valor) => atualizarForm("frequencia", valor as FrequenciaExibicao)} options={[
                ["sessao", "Uma vez por sessão"],
                ["dia", "Uma vez por dia"],
                ["selecao", "Uma vez por seleção"],
                ["intervalo", "Sempre, com intervalo mínimo"],
              ]} />
              {form.frequencia === "intervalo" && <Campo label="Intervalo mínimo em minutos" type="number" value={String(form.intervaloMinimoMinutos)} onChange={(valor) => atualizarForm("intervaloMinimoMinutos", Number(valor))} />}
              <Select label="Tempo aberto na tela" value={String(form.duracaoAbertoSegundos)} onChange={(valor) => atualizarForm("duracaoAbertoSegundos", Number(valor))} options={[
                ["0", "Até o passageiro fechar"],
                ["5", "Fechar após 5 segundos"],
                ["10", "Fechar após 10 segundos"],
                ["15", "Fechar após 15 segundos"],
              ]} />
              <Select label="Ação do botão" value={form.acaoTipo} onChange={(valor) => atualizarForm("acaoTipo", valor as AcaoTipo)} options={[
                ["nenhuma", "Sem botão de ação"],
                ["detalhes", "Abrir detalhes da embarcação"],
                ["itinerario", "Abrir itinerário"],
                ["vendas", "Abrir venda de passagem"],
                ["whatsapp", "Abrir WhatsApp"],
                ["link", "Abrir link externo"],
              ]} />
              {form.acaoTipo !== "nenhuma" && <Campo label="Texto do botão" value={form.botaoTexto} onChange={(valor) => atualizarForm("botaoTexto", valor)} placeholder="Ver agora" />}
              {(form.acaoTipo === "link" || form.acaoTipo === "whatsapp") && <Campo label={form.acaoTipo === "link" ? "Link completo" : "Número do WhatsApp"} value={form.acaoDestino} onChange={(valor) => atualizarForm("acaoDestino", valor)} placeholder={form.acaoTipo === "link" ? "https://..." : "5592991903278"} />}
              <Campo label="Prioridade (0 a 100)" type="number" value={String(form.prioridade)} onChange={(valor) => atualizarForm("prioridade", Number(valor))} />
              <div className="grid gap-2 sm:grid-cols-3">
                <Toggle label="Ativa" checked={form.ativo} onChange={(valor) => atualizarForm("ativo", valor)} />
                <Toggle label="Popup" checked={form.exibirComoPopup} onChange={(valor) => atualizarForm("exibirComoPopup", valor)} />
                <Toggle label="Destaque" checked={form.destaque} onChange={(valor) => atualizarForm("destaque", valor)} />
              </div>
            </div>
          </details>

          <div className="sticky bottom-[78px] z-20 -mx-3 mt-4 grid grid-cols-2 gap-2 border-t border-white/10 bg-[#0f2240]/95 p-3 backdrop-blur sm:-mx-5 sm:p-5 md:bottom-0">
            <button disabled={carregando} onClick={() => void salvarBanner(false)} className="min-h-12 rounded-2xl border border-white/15 bg-white/5 px-3 text-xs font-black uppercase disabled:opacity-50">Salvar rascunho</button>
            <button disabled={carregando} onClick={() => void salvarBanner(true)} className="min-h-12 rounded-2xl border border-sky-300/30 bg-[#2b5b91] px-3 text-xs font-black uppercase shadow-lg disabled:opacity-50">{carregando ? "Salvando..." : editandoId ? "Atualizar" : "Publicar"}</button>
          </div>
        </section>

        <section className="min-w-0 rounded-[26px] border border-[#1d426b] bg-[#0f2240] p-3 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black">Campanhas cadastradas</h2>
              <p className="mt-1 text-xs text-sky-100/55">Status e métricas atualizados automaticamente.</p>
            </div>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
              {(["todos", "ativo", "agendado", "pausado", "expirado", "rascunho"] as const).map((id) => (
                <button key={id} onClick={() => setFiltro(id)} className={`shrink-0 rounded-xl border px-3 py-2 text-[10px] font-black uppercase ${filtro === id ? "border-sky-300/35 bg-sky-400/15 text-white" : "border-white/10 bg-white/[0.03] text-sky-100/60"}`}>{id === "todos" ? "Todos" : STATUS_INFO[id].label}</button>
              ))}
            </div>
          </div>

          {bannersFiltrados.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center text-sm text-sky-100/55">Nenhuma campanha encontrada.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {bannersFiltrados.map((banner) => {
                const tipo = TIPOS[banner.tipo as TipoCampanha] || TIPOS.informativo;
                const status = statusDaCampanha(banner, agora);
                const statusInfo = STATUS_INFO[status];
                const dadosMetricas = metricas[banner.id] || { impressoes: 0, cliques: 0, fechamentos: 0 };
                const taxaClique = dadosMetricas.impressoes > 0 ? ((dadosMetricas.cliques / dadosMetricas.impressoes) * 100).toFixed(1) : "0,0";

                return (
                  <article key={banner.id} className="overflow-hidden rounded-[26px] border border-white/10 bg-[#143760]">
                    <div className="relative aspect-[9/11] overflow-hidden bg-[#071a31]">
                      {banner.imageUrl || banner.imagemUrl ? <img src={banner.imageUrl || banner.imagemUrl} alt={banner.titulo} className={`h-full w-full object-cover ${status === "pausado" || status === "expirado" ? "grayscale opacity-50" : ""}`} /> : <div className="flex h-full items-center justify-center text-5xl opacity-30">📣</div>}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-[#020617]/20" />
                      <div className="absolute left-3 top-3 flex max-w-[80%] flex-wrap gap-2">
                        <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${tipo.classe}`}>{tipo.icone} {tipo.tag}</span>
                        <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${statusInfo.classe}`}>{statusInfo.label}</span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 p-4">
                        <p className="mb-1 text-[10px] font-black uppercase text-sky-200/70">{nomePublico(banner)}</p>
                        <h3 className="line-clamp-2 text-base font-black">{banner.titulo}</h3>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-sky-100/65">{banner.mensagem}</p>
                      </div>
                    </div>

                    <div className="space-y-3 p-3">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <Info label="Vigência" valor={`${formatarData(banner.vigenciaInicioIso)} — ${formatarData(banner.vigenciaFimIso)}`} />
                        <Info label="Exibição" valor={`${banner.atrasoSegundos ?? banner.tempoDepoisSegundos ?? 0}s • ${labelFrequencia(banner.frequencia || "sessao")}`} />
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <Mini label="Vistas" valor={dadosMetricas.impressoes} />
                        <Mini label="Cliques" valor={dadosMetricas.cliques} />
                        <Mini label="Fechou" valor={dadosMetricas.fechamentos} />
                        <Mini label="CTR" valor={`${taxaClique}%`} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <AcaoCard label="Disparar" onClick={() => void mostrarAgora(banner)} />
                        <AcaoCard label="Editar" onClick={() => editarBanner(banner)} />
                        <AcaoCard label={banner.ativo === false ? "Ativar" : "Pausar"} onClick={() => void alternarStatus(banner)} />
                        <AcaoCard label="Remover" perigo onClick={() => void deletarBanner(banner)} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Campo({ label, value, onChange, placeholder = "", type = "text" }: { label: string; value: string; onChange: (valor: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="cmb-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(evento) => onChange(evento.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (valor: string) => void; options: string[][] }) {
  return (
    <label className="cmb-field">
      <span>{label}</span>
      <select value={value} onChange={(evento) => onChange(evento.target.value)}>
        {options.map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (valor: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <span className="text-xs font-black uppercase text-sky-100/75">{label}</span>
      <input type="checkbox" checked={checked} onChange={(evento) => onChange(evento.target.checked)} className="h-5 w-5" />
    </label>
  );
}

function AtalhoPeriodo({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-11 rounded-xl border border-sky-300/20 bg-sky-400/10 px-2 text-[10px] font-black uppercase text-sky-100 active:bg-sky-400/25">{label}</button>;
}

function MiniResumo({ label, valor }: { label: string; valor: number }) {
  return <div className="rounded-2xl border border-white/10 bg-[#0f2240] p-3"><p className="text-[9px] font-black uppercase tracking-wide text-sky-100/45">{label}</p><p className="mt-1 text-2xl font-black">{valor}</p></div>;
}

function Mini({ label, valor }: { label: string; valor: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-[#071a31] p-2 text-center"><p className="text-[8px] font-black uppercase text-sky-100/40">{label}</p><p className="mt-1 truncate text-xs font-black">{valor}</p></div>;
}

function Info({ label, valor }: { label: string; valor: string }) {
  return <div className="rounded-xl border border-white/10 bg-[#071a31] p-2"><p className="text-[8px] font-black uppercase text-sky-100/40">{label}</p><p className="mt-1 line-clamp-2 text-[10px] font-bold text-sky-100/75">{valor}</p></div>;
}

function AcaoCard({ label, onClick, perigo = false }: { label: string; onClick: () => void; perigo?: boolean }) {
  return <button onClick={onClick} className={`min-h-11 rounded-xl border px-2 text-[10px] font-black uppercase ${perigo ? "border-red-300/20 bg-red-500/10 text-red-100" : "border-sky-300/20 bg-sky-400/10 text-sky-100"}`}>{label}</button>;
}
