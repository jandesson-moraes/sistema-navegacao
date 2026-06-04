import React, { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type StatusProspeccao =
  | "novo"
  | "contato_porto"
  | "responsavel_identificado"
  | "contato_feito"
  | "demonstracao_enviada"
  | "interessado"
  | "aguardando_decisao"
  | "aguardando_retorno"
  | "reuniao_marcada"
  | "proposta_enviada"
  | "fechado"
  | "perdido";

type InteresseProspeccao = "baixo" | "medio" | "alto";
type PrioridadeProspeccao = "baixa" | "media" | "alta" | "urgente";

type ProdutoInteresse =
  | "gps"
  | "passagens"
  | "sistema_completo"
  | "implantacao_vip"
  | "outro";

type PortoResumo = {
  id: string;
  nome: string;
  cidade: string;
  estado: string;
};

type Prospecto = {
  id: string;
  embarcacaoNome: string;
  responsavelNome: string;
  telefone: string;
  email: string;
  cidade: string;
  estado: string;

  portoAtualId: string;
  portoAtualNome: string;
  portoDestinoId: string;
  portoDestinoNome: string;
  escalasPortos: string[];

  rotaPrincipal: string;
  destinoAtual: string;
  chegadaDiaSemana: string;
  saidaDiaSemana: string;
  proximaChegadaDiaSemana: string;
  responsavelPresente: boolean;
  prioridade: PrioridadeProspeccao;
  tipoEmbarcacao: string;
  origemContato: string;
  status: StatusProspeccao;
  interesse: InteresseProspeccao;
  produtoInteresse: ProdutoInteresse;
  proximaAcao: string;
  dataRetorno: string;
  observacao: string;
  convertidoCliente: boolean;
  clienteFinanceiroId?: string;
  criadoPorUid: string;
  criadoPorNome: string;
  criadoPorEmail: string;
  criadoEmISO: string;
  atualizadoPorUid?: string;
  atualizadoPorNome?: string;
  atualizadoPorEmail?: string;
  atualizadoEmISO?: string;
  criadoEm?: any;
  atualizadoEm?: any;
};

const STATUS: Record<StatusProspeccao, { label: string; classe: string }> = {
  novo: {
    label: "Novo",
    classe: "border-sky-300/25 bg-sky-400/10 text-sky-100",
  },
  contato_porto: {
    label: "Contato no porto",
    classe: "border-blue-300/25 bg-blue-400/10 text-blue-200",
  },
  responsavel_identificado: {
    label: "Responsável identificado",
    classe: "border-indigo-300/25 bg-indigo-400/10 text-indigo-200",
  },
  contato_feito: {
    label: "Contato feito",
    classe: "border-blue-300/25 bg-blue-400/10 text-blue-200",
  },
  demonstracao_enviada: {
    label: "Demonstração enviada",
    classe: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200",
  },
  interessado: {
    label: "Interessado",
    classe: "border-emerald-300/25 bg-emerald-400/10 text-emerald-300",
  },
  aguardando_decisao: {
    label: "Aguardando decisão",
    classe: "border-orange-300/25 bg-orange-400/10 text-orange-300",
  },
  aguardando_retorno: {
    label: "Aguardando retorno",
    classe: "border-amber-300/25 bg-amber-400/10 text-amber-300",
  },
  reuniao_marcada: {
    label: "Reunião marcada",
    classe: "border-purple-300/25 bg-purple-400/10 text-purple-200",
  },
  proposta_enviada: {
    label: "Proposta enviada",
    classe: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200",
  },
  fechado: {
    label: "Fechado",
    classe: "border-emerald-300/25 bg-emerald-400/10 text-emerald-300",
  },
  perdido: {
    label: "Perdido",
    classe: "border-red-300/25 bg-red-400/10 text-red-300",
  },
};

const STATUS_OPCOES: { id: StatusProspeccao; label: string }[] = [
  { id: "novo", label: "Novo" },
  { id: "contato_porto", label: "Contato no porto" },
  { id: "responsavel_identificado", label: "Responsável identificado" },
  { id: "contato_feito", label: "Contato feito" },
  { id: "demonstracao_enviada", label: "Demonstração enviada" },
  { id: "interessado", label: "Interessado" },
  { id: "aguardando_decisao", label: "Aguardando decisão" },
  { id: "aguardando_retorno", label: "Aguardando retorno" },
  { id: "reuniao_marcada", label: "Reunião marcada" },
  { id: "proposta_enviada", label: "Proposta enviada" },
  { id: "fechado", label: "Fechado" },
  { id: "perdido", label: "Perdido" },
];

const PRODUTOS: { id: ProdutoInteresse; label: string }[] = [
  { id: "gps", label: "GPS profissional" },
  { id: "passagens", label: "Venda de passagens" },
  { id: "sistema_completo", label: "Sistema completo" },
  { id: "implantacao_vip", label: "Implantação VIP" },
  { id: "outro", label: "Outro" },
];

const DIAS_SEMANA = [
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
  "domingo",
];

const ESTADOS = [
  { uf: "AM", nome: "Amazonas" },
  { uf: "PA", nome: "Pará" },
  { uf: "AP", nome: "Amapá" },
  { uf: "RO", nome: "Rondônia" },
  { uf: "RR", nome: "Roraima" },
  { uf: "AC", nome: "Acre" },
  { uf: "TO", nome: "Tocantins" },
  { uf: "MA", nome: "Maranhão" },
];

const CIDADES_POR_ESTADO: Record<string, string[]> = {
  AM: [
    "Manaus",
    "Parintins",
    "Itacoatiara",
    "Manacapuru",
    "Coari",
    "Tefé",
    "Tabatinga",
    "Maués",
    "Autazes",
    "Iranduba",
    "Novo Airão",
    "Careiro",
  ],
  PA: [
    "Juruti",
    "Santarém",
    "Belém",
    "Óbidos",
    "Oriximiná",
    "Monte Alegre",
    "Alenquer",
    "Prainha",
    "Almeirim",
    "Altamira",
    "Itaituba",
    "Breves",
  ],
  AP: ["Macapá", "Santana", "Laranjal do Jari"],
  RO: ["Porto Velho", "Guajará-Mirim"],
  RR: ["Boa Vista", "Caracaraí"],
  AC: ["Rio Branco", "Cruzeiro do Sul"],
  TO: ["Palmas", "Tocantinópolis"],
  MA: ["São Luís", "Imperatriz"],
};

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function diaSemanaHoje() {
  const indice = new Date().getDay();
  const mapa = [
    "domingo",
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
  ];

  return mapa[indice];
}

function usuarioAtualAuditoria() {
  const user = getAuth().currentUser;

  return {
    uid: user?.uid || "sem_uid",
    nome: user?.displayName || user?.email || "Usuário não identificado",
    email: user?.email || "sem_email",
  };
}

function slugId(valor: string) {
  const base = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

  return base || `PROSPECTO_${Date.now()}`;
}

function formatarData(valor: any) {
  try {
    const data =
      typeof valor?.toDate === "function"
        ? valor.toDate()
        : valor
          ? new Date(`${valor}`.includes("T") ? valor : `${valor}T12:00:00`)
          : null;

    if (!data || Number.isNaN(data.getTime())) return "—";

    return data.toLocaleDateString("pt-BR", {
      timeZone: "America/Santarem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function etiquetaDiaSaida(dia: string) {
  if (!dia) return "";

  const hoje = diaSemanaHoje();
  const indiceHoje = DIAS_SEMANA.indexOf(hoje);
  const indiceSaida = DIAS_SEMANA.indexOf(dia);

  if (indiceSaida === -1 || indiceHoje === -1) return dia;
  if (indiceSaida === indiceHoje) return "Sai hoje";

  const amanha = (indiceHoje + 1) % DIAS_SEMANA.length;
  if (indiceSaida === amanha) return "Sai amanhã";

  return `Sai ${dia}`;
}

function classePrioridade(prioridade: PrioridadeProspeccao) {
  if (prioridade === "urgente") {
    return "border-red-300/25 bg-red-400/10 text-red-300";
  }

  if (prioridade === "alta") {
    return "border-amber-300/25 bg-amber-400/10 text-amber-300";
  }

  if (prioridade === "media") {
    return "border-sky-300/25 bg-sky-400/10 text-sky-100";
  }

  return "border-slate-300/15 bg-slate-400/10 text-slate-300";
}

function normalizarTelefone(telefone: string) {
  return telefone.replace(/\D/g, "");
}

function formatarTelefoneBR(valor: string) {
  const numeros = normalizarTelefone(valor).slice(0, 11);

  if (numeros.length <= 2) return numeros;
  if (numeros.length <= 6) {
    return `(${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
  }
  if (numeros.length <= 10) {
    return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 6)}-${numeros.slice(6)}`;
  }

  return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
}

function linkWhatsApp(telefone: string, mensagem: string) {
  const numero = normalizarTelefone(telefone);
  if (!numero) return "";
  const numeroComPais = numero.startsWith("55") ? numero : `55${numero}`;

  return `https://wa.me/${numeroComPais}?text=${encodeURIComponent(mensagem)}`;
}

function novoProspecto(): Prospecto {
  const usuario = usuarioAtualAuditoria();
  const hoje = hojeISO();

  return {
    id: "",
    embarcacaoNome: "",
    responsavelNome: "",
    telefone: "",
    email: "",
    cidade: "Manaus",
    estado: "AM",
    portoAtualId: "",
    portoAtualNome: "",
    portoDestinoId: "",
    portoDestinoNome: "",
    escalasPortos: [],
    rotaPrincipal: "",
    destinoAtual: "",
    chegadaDiaSemana: "",
    saidaDiaSemana: "",
    proximaChegadaDiaSemana: "",
    responsavelPresente: false,
    prioridade: "media",
    tipoEmbarcacao: "",
    origemContato: "Porto de Manaus",
    status: "novo",
    interesse: "medio",
    produtoInteresse: "gps",
    proximaAcao: "",
    dataRetorno: hoje,
    observacao: "",
    convertidoCliente: false,
    criadoPorUid: usuario.uid,
    criadoPorNome: usuario.nome,
    criadoPorEmail: usuario.email,
    criadoEmISO: new Date().toISOString(),
  };
}

function separarCidadeEstado(valor: string) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return { cidade: "", estado: "" };
  }

  const partes = texto.split(" - ").map((item) => item.trim());

  if (partes.length >= 2) {
    return {
      cidade: partes[0],
      estado: partes[1].toUpperCase(),
    };
  }

  return {
    cidade: texto,
    estado: "",
  };
}

function cidadeCompleta(cidade: string, estado: string) {
  if (!cidade && !estado) return "";
  if (cidade && estado) return `${cidade} - ${estado}`;
  return cidade || estado;
}

function nomePortoExibicao(porto: PortoResumo) {
  const local = cidadeCompleta(porto.cidade, porto.estado);
  return [porto.nome, local].filter(Boolean).join(" • ");
}

export default function Prospecao() {
  const modal = useAppModal();

  const [prospectos, setProspectos] = useState<Prospecto[]>([]);
  const [portos, setPortos] = useState<PortoResumo[]>([]);
  const [form, setForm] = useState<Prospecto>(novoProspecto());
  const [selecionadoId, setSelecionadoId] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusProspeccao>("todos");
  const [portoEscalaSelecionado, setPortoEscalaSelecionado] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const qProspectos = query(
      collection(db, "prospeccao_embarcacoes"),
      orderBy("atualizadoEmISO", "desc"),
    );

    const unsub = onSnapshot(
      qProspectos,
      (snapshot) => {
        const lista = snapshot.docs.map((docSnap) => ({
          ...novoProspecto(),
          ...docSnap.data(),
          id: docSnap.id,
        })) as Prospecto[];

        setProspectos(lista);
      },
      (error) => {
        console.error("Erro ao carregar prospecção:", error);
        void modal.erro(
          "Erro ao carregar prospecção",
          "Não foi possível ler a coleção prospeccao_embarcacoes.",
        );
      },
    );

    return () => unsub();
  }, [modal]);

  useEffect(() => {
    const qPortos = query(collection(db, "terminais"), orderBy("nome", "asc"));

    const unsub = onSnapshot(
      qPortos,
      (snapshot) => {
        const lista = snapshot.docs.map((docSnap) => {
          const dados = docSnap.data() as any;
          const local = separarCidadeEstado(dados.cidade || "");

          return {
            id: docSnap.id,
            nome: dados.nome || dados.nomeTerminal || dados.portoNome || docSnap.id,
            cidade: local.cidade,
            estado: dados.estado || dados.uf || local.estado,
          } as PortoResumo;
        });

        setPortos(lista);
      },
      (error) => {
        console.error("Erro ao carregar portos:", error);
      },
    );

    return () => unsub();
  }, []);

  const cidadesDisponiveis = useMemo(() => {
    const cidadesPadrao = CIDADES_POR_ESTADO[form.estado] || [];
    const cidadesPortos = portos
      .filter((porto) => !form.estado || !porto.estado || porto.estado === form.estado)
      .map((porto) => porto.cidade)
      .filter(Boolean);

    return Array.from(new Set([...cidadesPadrao, ...cidadesPortos])).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
  }, [form.estado, portos]);

  const resumo = useMemo(() => {
    const hoje = diaSemanaHoje();

    return {
      total: prospectos.length,
      interessados: prospectos.filter((item) =>
        [
          "responsavel_identificado",
          "demonstracao_enviada",
          "interessado",
          "aguardando_decisao",
          "reuniao_marcada",
          "proposta_enviada",
        ].includes(item.status),
      ).length,
      saindoAgora: prospectos.filter(
        (item) =>
          item.saidaDiaSemana &&
          [
            hoje,
            DIAS_SEMANA[(DIAS_SEMANA.indexOf(hoje) + 1) % DIAS_SEMANA.length],
          ].includes(item.saidaDiaSemana) &&
          !["fechado", "perdido"].includes(item.status),
      ).length,
      retornosHoje: prospectos.filter(
        (item) =>
          item.dataRetorno &&
          item.dataRetorno <= hojeISO() &&
          !["fechado", "perdido"].includes(item.status),
      ).length,
      fechados: prospectos.filter((item) => item.status === "fechado").length,
    };
  }, [prospectos]);

  const prospectosFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return prospectos.filter((item) => {
      if (filtroStatus !== "todos" && item.status !== filtroStatus) return false;

      if (!texto) return true;

      return [
        item.embarcacaoNome,
        item.responsavelNome,
        item.telefone,
        item.cidade,
        item.estado,
        item.portoAtualNome,
        item.portoDestinoNome,
        item.rotaPrincipal,
        item.destinoAtual,
        item.tipoEmbarcacao,
        item.origemContato,
        item.observacao,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [prospectos, busca, filtroStatus]);

  const selecionar = (prospecto: Prospecto) => {
    setSelecionadoId(prospecto.id);
    setForm(prospecto);
  };

  const novoCadastro = () => {
    setSelecionadoId("__novo__");
    setForm(novoProspecto());
  };

  const alterarForm = (campo: keyof Prospecto, valor: any) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  const aplicarPortoAtual = (portoId: string) => {
    const porto = portos.find((item) => item.id === portoId);

    setForm((atual) => ({
      ...atual,
      portoAtualId: porto?.id || "",
      portoAtualNome: porto?.nome || "",
      cidade: porto?.cidade || atual.cidade,
      estado: porto?.estado || atual.estado,
    }));
  };

  const aplicarPortoDestino = (portoId: string) => {
    const porto = portos.find((item) => item.id === portoId);

    setForm((atual) => ({
      ...atual,
      portoDestinoId: porto?.id || "",
      portoDestinoNome: porto?.nome || "",
      destinoAtual: porto?.cidade || atual.destinoAtual,
    }));
  };

  const adicionarEscala = () => {
    const porto = portos.find((item) => item.id === portoEscalaSelecionado);
    if (!porto) return;

    const nome = nomePortoExibicao(porto);

    setForm((atual) => ({
      ...atual,
      escalasPortos: Array.from(new Set([...(atual.escalasPortos || []), nome])),
    }));

    setPortoEscalaSelecionado("");
  };

  const removerEscala = (nome: string) => {
    setForm((atual) => ({
      ...atual,
      escalasPortos: (atual.escalasPortos || []).filter((item) => item !== nome),
    }));
  };

  const salvarProspecto = async () => {
    try {
      if (!form.embarcacaoNome.trim() && !form.responsavelNome.trim()) {
        await modal.aviso(
          "Dados obrigatórios",
          "Informe pelo menos o nome da embarcação ou do responsável.",
        );
        return;
      }

      setSalvando(true);

      const usuario = usuarioAtualAuditoria();
      const id =
        form.id ||
        slugId(
          `${form.embarcacaoNome || form.responsavelNome}_${form.telefone}_${Date.now()}`,
        );

      const payload: Prospecto = {
        ...form,
        id,
        embarcacaoNome: form.embarcacaoNome.trim(),
        responsavelNome: form.responsavelNome.trim(),
        telefone: formatarTelefoneBR(form.telefone),
        email: form.email.trim().toLowerCase(),
        cidade: form.cidade.trim(),
        estado: form.estado.trim().toUpperCase(),
        rotaPrincipal: form.rotaPrincipal.trim(),
        destinoAtual: form.destinoAtual.trim(),
        tipoEmbarcacao: form.tipoEmbarcacao.trim(),
        origemContato: form.origemContato.trim(),
        proximaAcao: form.proximaAcao.trim(),
        observacao: form.observacao.trim(),
        escalasPortos: Array.isArray(form.escalasPortos) ? form.escalasPortos : [],
        atualizadoPorUid: usuario.uid,
        atualizadoPorNome: usuario.nome,
        atualizadoPorEmail: usuario.email,
        atualizadoEmISO: new Date().toISOString(),
      };

      if (!form.id) {
        payload.criadoPorUid = usuario.uid;
        payload.criadoPorNome = usuario.nome;
        payload.criadoPorEmail = usuario.email;
        payload.criadoEmISO = new Date().toISOString();
      }

      await setDoc(
        doc(db, "prospeccao_embarcacoes", id),
        {
          ...payload,
          atualizadoEm: serverTimestamp(),
          criadoEm: form.id ? form.criadoEm || serverTimestamp() : serverTimestamp(),
          auditoriaUltimaAlteracao: {
            acao: form.id ? "prospecto_atualizado" : "prospecto_criado",
            uid: usuario.uid,
            nome: usuario.nome,
            email: usuario.email,
            dataISO: new Date().toISOString(),
          },
        },
        { merge: true },
      );

      setSelecionadoId(id);
      setForm(payload);

      await modal.sucesso("Prospecção salva", "O contato foi salvo com sucesso.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar",
        error?.message || "Não foi possível salvar a prospecção.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const converterEmCliente = async () => {
    if (!form.id) {
      await modal.aviso("Salve primeiro", "Salve a prospecção antes de converter.");
      return;
    }

    const confirmar = await modal.confirmar({
      tipo: "info",
      titulo: "Converter em cliente?",
      mensagem:
        "Vamos marcar essa prospecção como fechada. Depois você pode aproveitar os dados para cadastrar o cliente completo no Financeiro > Clientes GPS.",
      confirmarTexto: "Converter",
      cancelarTexto: "Cancelar",
    });

    if (!confirmar) return;

    alterarForm("status", "fechado");
    alterarForm("convertidoCliente", true);

    const usuario = usuarioAtualAuditoria();

    await setDoc(
      doc(db, "prospeccao_embarcacoes", form.id),
      {
        status: "fechado",
        convertidoCliente: true,
        atualizadoPorUid: usuario.uid,
        atualizadoPorNome: usuario.nome,
        atualizadoPorEmail: usuario.email,
        atualizadoEmISO: new Date().toISOString(),
        atualizadoEm: serverTimestamp(),
        auditoriaUltimaAlteracao: {
          acao: "prospecto_convertido_cliente",
          uid: usuario.uid,
          nome: usuario.nome,
          email: usuario.email,
          dataISO: new Date().toISOString(),
        },
      },
      { merge: true },
    );

    await modal.sucesso(
      "Prospecção convertida",
      "Agora cadastre o cliente completo na área Financeiro > Clientes GPS.",
    );
  };

  const abrirWhatsApp = () => {
    const mensagem = [
      `Olá${form.responsavelNome ? `, ${form.responsavelNome}` : ""}!`,
      "",
      "Sou o Jandesson, do Cadê o Meu Barco.",
      "",
      "Nós temos um sistema para embarcações com rastreamento GPS, acompanhamento pelo passageiro, previsão de chegada e notificações.",
      "",
      form.embarcacaoNome
        ? `Gostaria de te mostrar uma demonstração rápida para a embarcação ${form.embarcacaoNome}.`
        : "Gostaria de te mostrar uma demonstração rápida para sua embarcação.",
    ].join("\n");

    const url = linkWhatsApp(form.telefone, mensagem);

    if (!url) {
      void modal.aviso("Telefone vazio", "Informe o WhatsApp antes de abrir a conversa.");
      return;
    }

    window.open(url, "_blank");
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-74px)] flex-col overflow-hidden bg-[#0d0c2c] p-4 text-white">
      <header className="mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">
            Comercial
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
            Prospecção de embarcações
          </h1>
          <p className="mt-1 text-xs text-sky-100/50">
            Use portos cadastrados, dias da semana, escalas e prioridade para vender
            rápido no porto.
          </p>
        </div>

        <button
          onClick={novoCadastro}
          className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20"
        >
          Nova prospecção
        </button>
      </header>

      <section className="mb-3 grid shrink-0 gap-2 md:grid-cols-2 xl:grid-cols-5">
        <CardResumo label="Oportunidades" valor={resumo.total} sub="Contatos salvos" />
        <CardResumo
          label="Interessados"
          valor={resumo.interessados}
          sub="Com chance real"
        />
        <CardResumo
          label="Saindo"
          valor={resumo.saindoAgora}
          sub="Hoje ou amanhã"
          alerta={resumo.saindoAgora > 0}
        />
        <CardResumo
          label="Retornos"
          valor={resumo.retornosHoje}
          sub="Hoje ou atrasados"
          alerta={resumo.retornosHoje > 0}
        />
        <CardResumo label="Fechados" valor={resumo.fechados} sub="Convertidos" positivo />
      </section>

      <main className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[360px_minmax(0,1fr)_340px]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black">Oportunidades</h2>
              <span className="rounded-full border border-[#7ba6d4]/20 bg-[#143760] px-2.5 py-1 text-[9px] font-black uppercase text-sky-100/55">
                {prospectosFiltrados.length}
              </span>
            </div>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar barco, responsável, cidade..."
              className="mt-3 h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
            />

            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as any)}
              className="mt-2 h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none focus:border-sky-300/60"
            >
              <option value="todos">Todos os status</option>
              {STATUS_OPCOES.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2.5 scrollbar-none">
            {prospectosFiltrados.map((item) => {
              const ativo = item.id === selecionadoId;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selecionar(item)}
                  className={[
                    "mb-2 w-full rounded-xl border p-3 text-left transition",
                    ativo
                      ? "border-sky-300/45 bg-[#2b5b91]/45"
                      : "border-[#7ba6d4]/15 bg-[#143760] hover:border-sky-300/30 hover:bg-[#17345e]",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">
                        {item.embarcacaoNome || item.responsavelNome || "Sem nome"}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-sky-100/50">
                        {item.cidade || "Cidade não informada"} / {item.estado || "—"}
                      </p>
                    </div>

                    <span
                      className={[
                        "shrink-0 rounded-full border px-2 py-1 text-[8px] font-black uppercase",
                        STATUS[item.status]?.classe || STATUS.novo.classe,
                      ].join(" ")}
                    >
                      {STATUS[item.status]?.label || "Novo"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.telefone && <Tag>{item.telefone}</Tag>}
                    {item.portoAtualNome && <Tag>{item.portoAtualNome}</Tag>}
                    {item.portoDestinoNome && <Tag>Destino {item.portoDestinoNome}</Tag>}
                    {item.saidaDiaSemana && (
                      <Tag>{etiquetaDiaSaida(item.saidaDiaSemana)}</Tag>
                    )}
                    <span
                      className={[
                        "rounded-full border px-2 py-0.5 text-[9px] font-black uppercase",
                        classePrioridade(item.prioridade),
                      ].join(" ")}
                    >
                      {item.prioridade}
                    </span>
                    {item.dataRetorno && (
                      <Tag>Retorno {formatarData(item.dataRetorno)}</Tag>
                    )}
                  </div>
                </button>
              );
            })}

            {prospectosFiltrados.length === 0 && (
              <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sm text-sky-100/50">
                Nenhuma oportunidade encontrada.
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <h2 className="text-base font-black">Cadastro da oportunidade</h2>
            <p className="mt-1 text-xs text-sky-100/45">
              Campos rápidos para abordagem no porto e acompanhamento pelo WhatsApp.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
            <div className="grid gap-3 xl:grid-cols-2">
              <Campo
                label="Nome da embarcação"
                value={form.embarcacaoNome}
                onChange={(valor) => alterarForm("embarcacaoNome", valor)}
              />

              <Campo
                label="Responsável"
                value={form.responsavelNome}
                onChange={(valor) => alterarForm("responsavelNome", valor)}
              />

              <Campo
                label="WhatsApp"
                value={form.telefone}
                onChange={(valor) => alterarForm("telefone", formatarTelefoneBR(valor))}
              />

              <Campo
                label="E-mail"
                value={form.email}
                onChange={(valor) => alterarForm("email", valor)}
              />

              <SelectCampo
                label="Estado"
                value={form.estado}
                onChange={(valor) => {
                  alterarForm("estado", valor);
                  alterarForm("cidade", CIDADES_POR_ESTADO[valor]?.[0] || "");
                }}
                options={ESTADOS.map((item) => [item.uf, `${item.uf} - ${item.nome}`])}
              />

              <SelectCampo
                label="Cidade"
                value={form.cidade}
                onChange={(valor) => alterarForm("cidade", valor)}
                options={cidadesDisponiveis.map((cidade) => [cidade, cidade])}
              />

              <label>
                <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                  Porto atual / onde está
                </p>
                <select
                  value={form.portoAtualId}
                  onChange={(e) => aplicarPortoAtual(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                >
                  <option value="">Selecione um porto</option>
                  {portos.map((porto) => (
                    <option key={porto.id} value={porto.id}>
                      {nomePortoExibicao(porto)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                  Destino / próximo porto
                </p>
                <select
                  value={form.portoDestinoId}
                  onChange={(e) => aplicarPortoDestino(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                >
                  <option value="">Selecione um porto</option>
                  {portos.map((porto) => (
                    <option key={porto.id} value={porto.id}>
                      {nomePortoExibicao(porto)}
                    </option>
                  ))}
                </select>
              </label>

              <Campo
                label="Rota principal"
                value={form.rotaPrincipal}
                onChange={(valor) => alterarForm("rotaPrincipal", valor)}
              />

              <Campo
                label="Destino / rota manual"
                value={form.destinoAtual}
                onChange={(valor) => alterarForm("destinoAtual", valor)}
              />

              <SelectCampo
                label="Chega em Manaus"
                value={form.chegadaDiaSemana}
                onChange={(valor) => alterarForm("chegadaDiaSemana", valor)}
                options={[["", "Não informado"], ...DIAS_SEMANA.map((dia) => [dia, dia])]}
              />

              <SelectCampo
                label="Sai de Manaus"
                value={form.saidaDiaSemana}
                onChange={(valor) => alterarForm("saidaDiaSemana", valor)}
                options={[["", "Não informado"], ...DIAS_SEMANA.map((dia) => [dia, dia])]}
              />

              <SelectCampo
                label="Próxima chegada"
                value={form.proximaChegadaDiaSemana}
                onChange={(valor) => alterarForm("proximaChegadaDiaSemana", valor)}
                options={[["", "Não informado"], ...DIAS_SEMANA.map((dia) => [dia, dia])]}
              />

              <Campo
                label="Tipo de embarcação"
                value={form.tipoEmbarcacao}
                onChange={(valor) => alterarForm("tipoEmbarcacao", valor)}
              />

              <SelectCampo
                label="Status"
                value={form.status}
                onChange={(valor) => alterarForm("status", valor)}
                options={STATUS_OPCOES.map((item) => [item.id, item.label])}
              />

              <SelectCampo
                label="Interesse"
                value={form.interesse}
                onChange={(valor) => alterarForm("interesse", valor)}
                options={[
                  ["baixo", "Baixo"],
                  ["medio", "Médio"],
                  ["alto", "Alto"],
                ]}
              />

              <SelectCampo
                label="Prioridade"
                value={form.prioridade}
                onChange={(valor) => alterarForm("prioridade", valor)}
                options={[
                  ["baixa", "Baixa"],
                  ["media", "Média"],
                  ["alta", "Alta"],
                  ["urgente", "Urgente"],
                ]}
              />

              <label className="flex items-center gap-3 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3">
                <input
                  type="checkbox"
                  checked={form.responsavelPresente}
                  onChange={(e) => alterarForm("responsavelPresente", e.target.checked)}
                />
                <span className="text-sm font-bold text-sky-100">
                  Responsável está presente
                </span>
              </label>

              <SelectCampo
                label="Produto indicado"
                value={form.produtoInteresse}
                onChange={(valor) => alterarForm("produtoInteresse", valor)}
                options={PRODUTOS.map((item) => [item.id, item.label])}
              />

              <Campo
                label="Próximo retorno"
                type="date"
                value={form.dataRetorno}
                onChange={(valor) => alterarForm("dataRetorno", valor)}
              />

              <Campo
                label="Origem do contato"
                value={form.origemContato}
                onChange={(valor) => alterarForm("origemContato", valor)}
              />

              <Campo
                label="Próxima ação"
                value={form.proximaAcao}
                onChange={(valor) => alterarForm("proximaAcao", valor)}
              />
            </div>

            <div className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <div className="flex flex-col gap-2 xl:flex-row xl:items-end">
                <label className="flex-1">
                  <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                    Escalas da rota
                  </p>
                  <select
                    value={portoEscalaSelecionado}
                    onChange={(e) => setPortoEscalaSelecionado(e.target.value)}
                    className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                  >
                    <option value="">Adicionar porto de escala</option>
                    {portos.map((porto) => (
                      <option key={porto.id} value={porto.id}>
                        {nomePortoExibicao(porto)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={adicionarEscala}
                  className="h-10 rounded-xl border border-sky-300/20 bg-sky-400/10 px-4 text-xs font-black uppercase text-sky-100 hover:bg-sky-400/20"
                >
                  Adicionar
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {(form.escalasPortos || []).map((escala) => (
                  <button
                    key={escala}
                    type="button"
                    onClick={() => removerEscala(escala)}
                    className="rounded-full border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-1 text-[10px] font-black uppercase text-sky-100/65 hover:bg-red-400/10 hover:text-red-300"
                    title="Clique para remover"
                  >
                    {escala} ×
                  </button>
                ))}

                {(form.escalasPortos || []).length === 0 && (
                  <span className="text-xs text-sky-100/40">
                    Nenhuma escala adicionada.
                  </span>
                )}
              </div>
            </div>

            <label className="mt-3 block">
              <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                Observação
              </p>
              <textarea
                value={form.observacao}
                onChange={(e) => alterarForm("observacao", e.target.value)}
                rows={4}
                placeholder="Resumo da conversa, quem decide, objeções, dia de saída, melhor momento para retorno..."
                className="w-full resize-none rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
              />
            </label>

            <div className="mt-3 flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={abrirWhatsApp}
                  className="h-10 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20"
                >
                  WhatsApp
                </button>

                <button
                  type="button"
                  onClick={converterEmCliente}
                  className="h-10 rounded-xl border border-sky-300/20 bg-sky-400/10 px-4 text-xs font-black uppercase text-sky-100 hover:bg-sky-400/20"
                >
                  Converter
                </button>
              </div>

              <button
                type="button"
                onClick={salvarProspecto}
                disabled={salvando}
                className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-5 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <h2 className="text-base font-black">Resumo</h2>
            <p className="mt-1 text-xs text-sky-100/45">
              Prioridade e próximos passos da oportunidade.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
            <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-black">
                  {form.embarcacaoNome || "Nova oportunidade"}
                </h3>
                <span
                  className={[
                    "rounded-full border px-2 py-1 text-[8px] font-black uppercase",
                    STATUS[form.status]?.classe || STATUS.novo.classe,
                  ].join(" ")}
                >
                  {STATUS[form.status]?.label || "Novo"}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Mini label="Responsável" valor={form.responsavelNome || "—"} />
                <Mini label="WhatsApp" valor={form.telefone || "—"} />
                <Mini
                  label="Cidade"
                  valor={`${form.cidade || "—"} / ${form.estado || "—"}`}
                />
                <Mini label="Porto atual" valor={form.portoAtualNome || "—"} />
                <Mini
                  label="Destino"
                  valor={form.portoDestinoNome || form.destinoAtual || "—"}
                />
                <Mini label="Chega" valor={form.chegadaDiaSemana || "—"} />
                <Mini
                  label="Sai"
                  valor={
                    form.saidaDiaSemana ? etiquetaDiaSaida(form.saidaDiaSemana) : "—"
                  }
                />
                <Mini label="Retorno" valor={formatarData(form.dataRetorno)} />
                <Mini label="Prioridade" valor={form.prioridade} />
                <Mini
                  label="Responsável"
                  valor={form.responsavelPresente ? "Presente" : "Não confirmado"}
                />
                <Mini label="Interesse" valor={form.interesse} />
                <Mini
                  label="Produto"
                  valor={
                    PRODUTOS.find((item) => item.id === form.produtoInteresse)?.label ||
                    "—"
                  }
                />
              </div>

              {(form.escalasPortos || []).length > 0 && (
                <div className="mt-3 rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-3">
                  <p className="text-[8px] font-black uppercase text-sky-100/40">
                    Escalas
                  </p>
                  <p className="mt-1 text-xs font-bold leading-5 text-sky-100/70">
                    {form.escalasPortos.join(" → ")}
                  </p>
                </div>
              )}

              {form.observacao && (
                <p className="mt-3 rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-3 text-xs leading-5 text-sky-100/65">
                  {form.observacao}
                </p>
              )}
            </div>

            <div className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <h3 className="text-sm font-black">Próxima ação</h3>
              <p className="mt-2 text-sm leading-5 text-sky-100/65">
                {form.proximaAcao || "Nenhuma ação definida."}
              </p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function CardResumo({
  label,
  valor,
  sub,
  alerta = false,
  positivo = false,
}: {
  label: string;
  valor: string | number;
  sub: string;
  alerta?: boolean;
  positivo?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
      <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
        {label}
      </p>
      <p
        className={[
          "mt-1 truncate text-xl font-black",
          alerta ? "text-amber-300" : positivo ? "text-emerald-300" : "text-sky-100",
        ].join(" ")}
      >
        {valor}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-sky-100/35">{sub}</p>
    </div>
  );
}

function Campo({
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
    <label>
      <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
        {label}
      </p>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
      />
    </label>
  );
}

function SelectCampo({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  options: [string, string][];
}) {
  return (
    <label>
      <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
        {label}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
      >
        {options.map(([id, labelOption]) => (
          <option key={id} value={id}>
            {labelOption}
          </option>
        ))}
      </select>
    </label>
  );
}

function Mini({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-2.5">
      <p className="text-[8px] font-black uppercase text-sky-100/40">{label}</p>
      <p className="mt-0.5 truncate text-xs font-black text-sky-100">{valor}</p>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#7ba6d4]/20 bg-[#17345e] px-2 py-0.5 text-[9px] font-black uppercase text-sky-100/50">
      {children}
    </span>
  );
}
