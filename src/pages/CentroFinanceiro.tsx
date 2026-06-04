import React, { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type TipoMovimento = "entrada" | "saida" | "transferencia";
type StatusMovimento = "pago" | "pendente" | "cancelado";
type OrigemMovimento = "manual" | "pagbank" | "sistema" | "importado";
type FormaPagamento =
  | "pix"
  | "dinheiro"
  | "cartao"
  | "boleto"
  | "transferencia"
  | "debito_automatico"
  | "outro";

type CategoriaFinanceira = {
  id: string;
  nome: string;
  tipo: TipoMovimento | "ambos";
  grupo: string;
  descricao: string;
  cor: string;
  icone: string;
  ativa: boolean;
  palavrasChave: string[];
  criadoEm?: any;
  atualizadoEm?: any;
};

type FornecedorFinanceiro = {
  id: string;
  nome: string;
  documento: string;
  tipo: string;
  telefone: string;
  email: string;
  cidade: string;
  estado: string;
  chavePix: string;
  banco: string;
  observacao: string;
  ativo: boolean;
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

type TransacaoFinanceira = {
  id: string;
  tipo: TipoMovimento;
  status: StatusMovimento;
  origem: OrigemMovimento;
  data: string;
  competencia: string;
  valor: number;
  descricao: string;
  observacao: string;
  categoriaId: string;
  categoriaNome: string;
  grupo: string;
  formaPagamento: FormaPagamento;
  clienteId: string;
  clienteNome: string;
  barcoId: string;
  barcoNome: string;
  fornecedorId: string;
  fornecedorNome: string;
  banco: string;
  transacaoBancoId: string;
  pagbankId: string;
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

const CATEGORIAS_PADRAO: CategoriaFinanceira[] = [
  {
    id: "entrada_mensalidade_gps",
    nome: "Mensalidade GPS",
    tipo: "entrada",
    grupo: "Receitas recorrentes",
    descricao: "Mensalidades do módulo GPS profissional.",
    cor: "#22c55e",
    icone: "📍",
    ativa: true,
    palavrasChave: ["mensalidade", "gps", "rastreador", "plano"],
  },
  {
    id: "entrada_contrato_gps",
    nome: "Contrato GPS",
    tipo: "entrada",
    grupo: "Contratos",
    descricao: "Valores de contrato, ativação ou adesão.",
    cor: "#38bdf8",
    icone: "📄",
    ativa: true,
    palavrasChave: ["contrato", "adesao", "adesão", "ativacao", "ativação"],
  },
  {
    id: "entrada_instalacao",
    nome: "Instalação de rastreador",
    tipo: "entrada",
    grupo: "Serviços",
    descricao: "Receitas relacionadas à instalação do GPS.",
    cor: "#a78bfa",
    icone: "🛠️",
    ativa: true,
    palavrasChave: ["instalacao", "instalação", "instalar", "rastreador"],
  },
  {
    id: "entrada_taxa_passagem",
    nome: "Taxa administrativa de passagem",
    tipo: "entrada",
    grupo: "Taxas do app",
    descricao: "Taxa administrativa/conveniência de passagens.",
    cor: "#0ea5e9",
    icone: "🎟️",
    ativa: true,
    palavrasChave: ["taxa", "conveniencia", "conveniência", "passagem", "app"],
  },
  {
    id: "saida_equipamentos_gps",
    nome: "Equipamentos GPS",
    tipo: "saida",
    grupo: "Equipamentos",
    descricao: "Rastreadores, ESP32, módulos GPS, caixas e peças.",
    cor: "#f97316",
    icone: "📦",
    ativa: true,
    palavrasChave: ["gps", "esp32", "rastreador", "modulo", "módulo", "equipamento"],
  },
  {
    id: "saida_instalacao_embarcacao",
    nome: "Instalação em embarcação",
    tipo: "saida",
    grupo: "Operação técnica",
    descricao: "Custos técnicos para instalar equipamentos em barcos.",
    cor: "#f59e0b",
    icone: "🚢",
    ativa: true,
    palavrasChave: ["instalacao", "instalação", "barco", "embarcacao", "embarcação"],
  },
  {
    id: "saida_transporte",
    nome: "Transporte e deslocamento",
    tipo: "saida",
    grupo: "Operação técnica",
    descricao: "Viagens, combustível, transporte e deslocamentos.",
    cor: "#fb7185",
    icone: "🚗",
    ativa: true,
    palavrasChave: [
      "transporte",
      "deslocamento",
      "combustivel",
      "combustível",
      "viagem",
      "uber",
      "taxi",
    ],
  },
  {
    id: "saida_manutencao",
    nome: "Manutenção técnica",
    tipo: "saida",
    grupo: "Operação técnica",
    descricao: "Manutenções, reparos e suporte técnico em campo.",
    cor: "#eab308",
    icone: "🔧",
    ativa: true,
    palavrasChave: ["manutencao", "manutenção", "reparo", "suporte"],
  },
  {
    id: "saida_ferramentas",
    nome: "Ferramentas e materiais",
    tipo: "saida",
    grupo: "Materiais",
    descricao: "Ferramentas, cabos, conectores, parafusos e materiais.",
    cor: "#facc15",
    icone: "🧰",
    ativa: true,
    palavrasChave: ["ferramenta", "cabo", "conector", "material", "parafuso"],
  },
  {
    id: "saida_folha_pagamento",
    nome: "Folha de pagamento",
    tipo: "saida",
    grupo: "Pessoas",
    descricao: "Salários, pró-labore, diárias e pagamentos de equipe.",
    cor: "#ef4444",
    icone: "👥",
    ativa: true,
    palavrasChave: ["salario", "salário", "equipe", "diaria", "diária"],
  },
  {
    id: "saida_comissao_vendedor",
    nome: "Comissão de vendedor",
    tipo: "saida",
    grupo: "Vendas",
    descricao: "Comissões pagas por vendas ou contratos fechados.",
    cor: "#fb923c",
    icone: "🤝",
    ativa: true,
    palavrasChave: ["comissao", "comissão", "vendedor", "venda"],
  },
  {
    id: "saida_marketing",
    nome: "Marketing e anúncios",
    tipo: "saida",
    grupo: "Marketing",
    descricao: "Anúncios, artes, tráfego pago e divulgação.",
    cor: "#ec4899",
    icone: "📣",
    ativa: true,
    palavrasChave: [
      "marketing",
      "anuncio",
      "anúncio",
      "facebook",
      "instagram",
      "trafego",
      "tráfego",
    ],
  },
  {
    id: "saida_sistema_tecnologia",
    nome: "Sistema / tecnologia",
    tipo: "saida",
    grupo: "Tecnologia",
    descricao: "Hospedagem, domínio, APIs, ferramentas e softwares.",
    cor: "#818cf8",
    icone: "💻",
    ativa: true,
    palavrasChave: [
      "sistema",
      "tecnologia",
      "servidor",
      "dominio",
      "domínio",
      "api",
      "software",
    ],
  },
  {
    id: "saida_taxas_bancarias",
    nome: "Taxas bancárias",
    tipo: "saida",
    grupo: "Financeiro",
    descricao: "Tarifas, taxas de banco e taxas de pagamento.",
    cor: "#94a3b8",
    icone: "🏦",
    ativa: true,
    palavrasChave: ["taxa", "tarifa", "banco", "pagbank", "pagseguro"],
  },
  {
    id: "saida_impostos",
    nome: "Impostos",
    tipo: "saida",
    grupo: "Fiscal",
    descricao: "Tributos, impostos e custos fiscais.",
    cor: "#64748b",
    icone: "🧾",
    ativa: true,
    palavrasChave: ["imposto", "tributo", "fiscal", "nota"],
  },
  {
    id: "saida_outros",
    nome: "Outras despesas",
    tipo: "saida",
    grupo: "Outros",
    descricao: "Despesas não classificadas em outros nichos.",
    cor: "#94a3b8",
    icone: "📌",
    ativa: true,
    palavrasChave: ["outros", "diverso"],
  },
  {
    id: "entrada_outros",
    nome: "Outras receitas",
    tipo: "entrada",
    grupo: "Outros",
    descricao: "Receitas não classificadas em outros nichos.",
    cor: "#22c55e",
    icone: "➕",
    ativa: true,
    palavrasChave: ["outros", "receita"],
  },
];

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function competenciaAtual(dataISO = hojeISO()) {
  const [ano, mes] = dataISO.split("-");
  return `${ano}-${mes}`;
}

function moeda(valor: any) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function numeroMoeda(valor: any) {
  const texto = String(valor || "")
    .replace(/[R$\s.]/g, "")
    .replace(",", ".");
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
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
    .toLowerCase();

  return base || `item_${Date.now()}`;
}

function novaTransacao(): TransacaoFinanceira {
  const data = hojeISO();
  const usuario = usuarioAtualAuditoria();

  return {
    id: "",
    tipo: "saida",
    status: "pago",
    origem: "manual",
    data,
    competencia: competenciaAtual(data),
    valor: 0,
    descricao: "",
    observacao: "",
    categoriaId: "",
    categoriaNome: "",
    grupo: "",
    formaPagamento: "pix",
    clienteId: "",
    clienteNome: "",
    barcoId: "",
    barcoNome: "",
    fornecedorId: "",
    fornecedorNome: "",
    banco: "",
    transacaoBancoId: "",
    pagbankId: "",
    criadoPorUid: usuario.uid,
    criadoPorNome: usuario.nome,
    criadoPorEmail: usuario.email,
    criadoEmISO: new Date().toISOString(),
  };
}

function novaCategoria(tipo: TipoMovimento | "ambos" = "saida"): CategoriaFinanceira {
  return {
    id: "",
    nome: "",
    tipo,
    grupo: "",
    descricao: "",
    cor: "#38bdf8",
    icone: "📌",
    ativa: true,
    palavrasChave: [],
  };
}

function novoFornecedor(): FornecedorFinanceiro {
  const usuario = usuarioAtualAuditoria();

  return {
    id: "",
    nome: "",
    documento: "",
    tipo: "Fornecedor",
    telefone: "",
    email: "",
    cidade: "",
    estado: "PA",
    chavePix: "",
    banco: "",
    observacao: "",
    ativo: true,
    criadoPorUid: usuario.uid,
    criadoPorNome: usuario.nome,
    criadoPorEmail: usuario.email,
    criadoEmISO: new Date().toISOString(),
  };
}

function categoriaCompativel(categoria: CategoriaFinanceira, tipo: TipoMovimento) {
  return categoria.ativa && (categoria.tipo === "ambos" || categoria.tipo === tipo);
}

function sugerirCategoria(
  categorias: CategoriaFinanceira[],
  descricao: string,
  tipo: TipoMovimento,
) {
  const texto = descricao.toLowerCase();
  if (!texto.trim()) return null;

  return (
    categorias.find(
      (categoria) =>
        categoriaCompativel(categoria, tipo) &&
        (categoria.palavrasChave || []).some((palavra) =>
          texto.includes(String(palavra).toLowerCase().trim()),
        ),
    ) || null
  );
}

function escaparCSV(valor: any) {
  const texto = String(valor ?? "").replace(/"/g, '""');
  return `"${texto}"`;
}

function baixarArquivo(
  nome: string,
  conteudo: string,
  tipo = "text/plain;charset=utf-8",
) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function moedaNumero(valor: any) {
  return Number(valor || 0)
    .toFixed(2)
    .replace(".", ",");
}

type CentroFinanceiroProps = {
  abaInicial?: "movimentos" | "categorias" | "fornecedores" | "relatorios";
  modoEmbed?: boolean;
};

export default function CentroFinanceiro({
  abaInicial = "movimentos",
  modoEmbed = false,
}: CentroFinanceiroProps) {
  const modal = useAppModal();

  const [transacoes, setTransacoes] = useState<TransacaoFinanceira[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanceira[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorFinanceiro[]>([]);
  const [selecionadaId, setSelecionadaId] = useState("");
  const [form, setForm] = useState<TransacaoFinanceira>(novaTransacao());
  const [categoriaForm, setCategoriaForm] =
    useState<CategoriaFinanceira>(novaCategoria());
  const [fornecedorForm, setFornecedorForm] =
    useState<FornecedorFinanceiro>(novoFornecedor());
  const [aba, setAba] = useState<
    "movimentos" | "categorias" | "fornecedores" | "relatorios"
  >(abaInicial);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoMovimento>("todos");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusMovimento>("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [busca, setBusca] = useState("");
  const [mesFiltro, setMesFiltro] = useState(competenciaAtual());
  const [salvando, setSalvando] = useState(false);
  const [salvandoCategoria, setSalvandoCategoria] = useState(false);
  const [salvandoFornecedor, setSalvandoFornecedor] = useState(false);

  useEffect(() => {
    setAba(abaInicial);
  }, [abaInicial]);

  useEffect(() => {
    const qCategorias = query(
      collection(db, "financeiro_categorias"),
      orderBy("nome", "asc"),
    );

    const unsubCategorias = onSnapshot(
      qCategorias,
      async (snapshot) => {
        if (snapshot.empty) {
          await Promise.all(
            CATEGORIAS_PADRAO.map((categoria) =>
              setDoc(
                doc(db, "financeiro_categorias", categoria.id),
                {
                  ...categoria,
                  criadoEm: serverTimestamp(),
                  atualizadoEm: serverTimestamp(),
                },
                { merge: true },
              ),
            ),
          );
          return;
        }

        const lista = snapshot.docs.map((docSnap) => ({
          ...docSnap.data(),
          id: docSnap.id,
        })) as CategoriaFinanceira[];

        setCategorias(lista);
      },
      (error) => {
        console.error("Erro ao carregar categorias:", error);
        void modal.erro(
          "Erro ao carregar categorias",
          "Não foi possível ler financeiro_categorias.",
        );
      },
    );

    return () => unsubCategorias();
  }, [modal]);

  useEffect(() => {
    const qFornecedores = query(
      collection(db, "financeiro_fornecedores"),
      orderBy("nome", "asc"),
    );

    const unsubFornecedores = onSnapshot(
      qFornecedores,
      (snapshot) => {
        const lista = snapshot.docs.map((docSnap) => ({
          ...novoFornecedor(),
          ...docSnap.data(),
          id: docSnap.id,
        })) as FornecedorFinanceiro[];

        setFornecedores(lista);
      },
      (error) => {
        console.error("Erro ao carregar fornecedores:", error);
        void modal.erro(
          "Erro ao carregar fornecedores",
          "Não foi possível ler financeiro_fornecedores.",
        );
      },
    );

    return () => unsubFornecedores();
  }, [modal]);

  useEffect(() => {
    const qTransacoes = query(
      collection(db, "financeiro_movimentos"),
      orderBy("data", "desc"),
    );

    const unsubTransacoes = onSnapshot(
      qTransacoes,
      (snapshot) => {
        const lista = snapshot.docs.map((docSnap) => ({
          ...novaTransacao(),
          ...docSnap.data(),
          id: docSnap.id,
        })) as TransacaoFinanceira[];

        setTransacoes(lista);
      },
      (error) => {
        console.error("Erro ao carregar movimentos:", error);
        void modal.erro(
          "Erro ao carregar movimentos",
          "Não foi possível ler financeiro_movimentos.",
        );
      },
    );

    return () => unsubTransacoes();
  }, [modal]);

  const categoriasAtivas = useMemo(
    () => categorias.filter((categoria) => categoria.ativa),
    [categorias],
  );

  const fornecedoresAtivos = useMemo(
    () => fornecedores.filter((fornecedor) => fornecedor.ativo),
    [fornecedores],
  );

  const categoriasDoTipo = useMemo(
    () =>
      categoriasAtivas.filter((categoria) => categoriaCompativel(categoria, form.tipo)),
    [categoriasAtivas, form.tipo],
  );

  const sugestaoCategoria = useMemo(
    () => sugerirCategoria(categoriasAtivas, form.descricao, form.tipo),
    [categoriasAtivas, form.descricao, form.tipo],
  );

  const transacoesFiltradas = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return transacoes.filter((item) => {
      if (mesFiltro && item.competencia !== mesFiltro) return false;
      if (filtroTipo !== "todos" && item.tipo !== filtroTipo) return false;
      if (filtroStatus !== "todos" && item.status !== filtroStatus) return false;
      if (filtroCategoria !== "todas" && item.categoriaId !== filtroCategoria)
        return false;

      if (!texto) return true;

      return [
        item.descricao,
        item.observacao,
        item.categoriaNome,
        item.grupo,
        item.clienteNome,
        item.barcoNome,
        item.fornecedorNome,
        item.transacaoBancoId,
        item.pagbankId,
        item.criadoPorEmail,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [transacoes, busca, mesFiltro, filtroTipo, filtroStatus, filtroCategoria]);

  const resumo = useMemo(() => {
    const movimentosValidos = transacoesFiltradas.filter(
      (item) => item.status !== "cancelado",
    );

    const entradas = movimentosValidos
      .filter((item) => item.tipo === "entrada")
      .reduce((total, item) => total + Number(item.valor || 0), 0);

    const saidas = movimentosValidos
      .filter((item) => item.tipo === "saida")
      .reduce((total, item) => total + Number(item.valor || 0), 0);

    const pendentes = transacoesFiltradas
      .filter((item) => item.status === "pendente")
      .reduce((total, item) => total + Number(item.valor || 0), 0);

    const porCategoria = movimentosValidos.reduce<Record<string, number>>((acc, item) => {
      const chave = item.categoriaNome || "Sem categoria";
      acc[chave] = (acc[chave] || 0) + Number(item.valor || 0);
      return acc;
    }, {});

    const rankingCategorias = Object.entries(porCategoria)
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);

    return {
      entradas,
      saidas,
      lucro: entradas - saidas,
      pendentes,
      total: movimentosValidos.length,
      rankingCategorias,
    };
  }, [transacoesFiltradas]);

  const selecionarTransacao = (item: TransacaoFinanceira) => {
    setSelecionadaId(item.id);
    setForm(item);
    setAba("movimentos");
  };

  const novoMovimento = (tipo: TipoMovimento = "saida") => {
    const novo = novaTransacao();
    novo.tipo = tipo;
    setSelecionadaId("__novo__");
    setForm(novo);
    setAba("movimentos");
  };

  const alterarForm = (campo: keyof TransacaoFinanceira, valor: any) => {
    setForm((atual) => {
      const novo = { ...atual, [campo]: valor };

      if (campo === "data") {
        novo.competencia = competenciaAtual(valor);
      }

      if (campo === "tipo") {
        novo.categoriaId = "";
        novo.categoriaNome = "";
        novo.grupo = "";
      }

      return novo;
    });
  };

  const aplicarCategoria = (categoriaId: string) => {
    const categoria = categorias.find((item) => item.id === categoriaId);

    setForm((atual) => ({
      ...atual,
      categoriaId: categoria?.id || "",
      categoriaNome: categoria?.nome || "",
      grupo: categoria?.grupo || "",
    }));
  };

  const aplicarFornecedor = (fornecedorId: string) => {
    const fornecedor = fornecedores.find((item) => item.id === fornecedorId);

    setForm((atual) => ({
      ...atual,
      fornecedorId: fornecedor?.id || "",
      fornecedorNome: fornecedor?.nome || "",
    }));
  };

  const salvarTransacao = async () => {
    try {
      if (!form.descricao.trim()) {
        await modal.aviso(
          "Descrição obrigatória",
          "Informe uma descrição para a transação.",
        );
        return;
      }

      if (Number(form.valor || 0) <= 0) {
        await modal.aviso("Valor obrigatório", "Informe o valor da transação.");
        return;
      }

      if (!form.categoriaId) {
        const confirmar = await modal.confirmar({
          tipo: "warning",
          titulo: "Salvar sem categoria?",
          mensagem:
            "Essa transação ficará sem nicho/categoria e pode prejudicar os relatórios. Deseja continuar?",
          confirmarTexto: "Salvar mesmo assim",
          cancelarTexto: "Voltar",
        });

        if (!confirmar) return;
      }

      setSalvando(true);

      const usuario = usuarioAtualAuditoria();
      const id = form.id || `mov_${Date.now()}`;

      const payload: TransacaoFinanceira = {
        ...form,
        id,
        valor: Number(form.valor || 0),
        descricao: form.descricao.trim(),
        observacao: form.observacao.trim(),
        clienteNome: form.clienteNome.trim(),
        barcoNome: form.barcoNome.trim(),
        fornecedorNome: form.fornecedorNome.trim(),
        banco: form.banco.trim(),
        transacaoBancoId: form.transacaoBancoId.trim(),
        pagbankId: form.pagbankId.trim(),
        competencia: form.competencia || competenciaAtual(form.data),
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
        doc(db, "financeiro_movimentos", id),
        {
          ...payload,
          atualizadoEm: serverTimestamp(),
          criadoEm: form.id ? form.criadoEm || serverTimestamp() : serverTimestamp(),
          auditoriaUltimaAlteracao: {
            acao: form.id ? "movimento_atualizado" : "movimento_criado",
            uid: usuario.uid,
            nome: usuario.nome,
            email: usuario.email,
            dataISO: new Date().toISOString(),
          },
        },
        { merge: true },
      );

      setSelecionadaId(id);
      setForm(payload);

      await modal.sucesso(
        "Movimento salvo",
        "A transação financeira foi salva com sucesso.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar",
        error?.message || "Não foi possível salvar o movimento.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const removerTransacao = async () => {
    if (!form.id) return;

    const confirmar = await modal.confirmar({
      tipo: "warning",
      titulo: "Remover movimento?",
      mensagem:
        "Use essa opção apenas para lançamentos manuais feitos por engano. Movimentos importados do banco futuramente devem ser cancelados ou classificados, não apagados.",
      confirmarTexto: "Remover",
      cancelarTexto: "Cancelar",
    });

    if (!confirmar) return;

    await deleteDoc(doc(db, "financeiro_movimentos", form.id));
    novoMovimento(form.tipo);
    await modal.sucesso("Movimento removido", "A transação foi removida.");
  };

  const salvarCategoria = async () => {
    try {
      if (!categoriaForm.nome.trim()) {
        await modal.aviso("Nome obrigatório", "Informe o nome do nicho/categoria.");
        return;
      }

      setSalvandoCategoria(true);

      const usuario = usuarioAtualAuditoria();
      const id =
        categoriaForm.id || slugId(`${categoriaForm.tipo}_${categoriaForm.nome}`);

      const payload: CategoriaFinanceira = {
        ...categoriaForm,
        id,
        nome: categoriaForm.nome.trim(),
        grupo: categoriaForm.grupo.trim() || "Sem grupo",
        descricao: categoriaForm.descricao.trim(),
        palavrasChave: Array.isArray(categoriaForm.palavrasChave)
          ? categoriaForm.palavrasChave.map((item) => String(item).trim()).filter(Boolean)
          : [],
      };

      await setDoc(
        doc(db, "financeiro_categorias", id),
        {
          ...payload,
          atualizadoEm: serverTimestamp(),
          criadoEm: categoriaForm.id
            ? categoriaForm.criadoEm || serverTimestamp()
            : serverTimestamp(),
          auditoriaUltimaAlteracao: {
            acao: categoriaForm.id ? "categoria_atualizada" : "categoria_criada",
            uid: usuario.uid,
            nome: usuario.nome,
            email: usuario.email,
            dataISO: new Date().toISOString(),
          },
        },
        { merge: true },
      );

      setCategoriaForm(novaCategoria(categoriaForm.tipo));
      await modal.sucesso("Nicho salvo", "Categoria financeira salva com sucesso.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar categoria",
        error?.message || "Não foi possível salvar o nicho.",
      );
    } finally {
      setSalvandoCategoria(false);
    }
  };

  const editarCategoria = (categoria: CategoriaFinanceira) => {
    setCategoriaForm({ ...categoria, palavrasChave: categoria.palavrasChave || [] });
    setAba("categorias");
  };

  const alternarCategoria = async (categoria: CategoriaFinanceira) => {
    const usuario = usuarioAtualAuditoria();

    await setDoc(
      doc(db, "financeiro_categorias", categoria.id),
      {
        ativa: !categoria.ativa,
        atualizadoEm: serverTimestamp(),
        auditoriaUltimaAlteracao: {
          acao: !categoria.ativa ? "categoria_ativada" : "categoria_desativada",
          uid: usuario.uid,
          nome: usuario.nome,
          email: usuario.email,
          dataISO: new Date().toISOString(),
        },
      },
      { merge: true },
    );
  };

  const salvarFornecedor = async () => {
    try {
      if (!fornecedorForm.nome.trim()) {
        await modal.aviso("Nome obrigatório", "Informe o nome do fornecedor.");
        return;
      }

      setSalvandoFornecedor(true);

      const usuario = usuarioAtualAuditoria();
      const id =
        fornecedorForm.id || slugId(`fornecedor_${fornecedorForm.nome}_${Date.now()}`);

      const payload: FornecedorFinanceiro = {
        ...fornecedorForm,
        id,
        nome: fornecedorForm.nome.trim(),
        documento: fornecedorForm.documento.trim(),
        tipo: fornecedorForm.tipo.trim() || "Fornecedor",
        telefone: fornecedorForm.telefone.trim(),
        email: fornecedorForm.email.trim().toLowerCase(),
        cidade: fornecedorForm.cidade.trim(),
        estado: fornecedorForm.estado.trim().toUpperCase(),
        chavePix: fornecedorForm.chavePix.trim(),
        banco: fornecedorForm.banco.trim(),
        observacao: fornecedorForm.observacao.trim(),
        atualizadoPorUid: usuario.uid,
        atualizadoPorNome: usuario.nome,
        atualizadoPorEmail: usuario.email,
        atualizadoEmISO: new Date().toISOString(),
      };

      if (!fornecedorForm.id) {
        payload.criadoPorUid = usuario.uid;
        payload.criadoPorNome = usuario.nome;
        payload.criadoPorEmail = usuario.email;
        payload.criadoEmISO = new Date().toISOString();
      }

      await setDoc(
        doc(db, "financeiro_fornecedores", id),
        {
          ...payload,
          atualizadoEm: serverTimestamp(),
          criadoEm: fornecedorForm.id
            ? fornecedorForm.criadoEm || serverTimestamp()
            : serverTimestamp(),
          auditoriaUltimaAlteracao: {
            acao: fornecedorForm.id ? "fornecedor_atualizado" : "fornecedor_criado",
            uid: usuario.uid,
            nome: usuario.nome,
            email: usuario.email,
            dataISO: new Date().toISOString(),
          },
        },
        { merge: true },
      );

      setFornecedorForm(novoFornecedor());
      await modal.sucesso("Fornecedor salvo", "Fornecedor salvo com sucesso.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar fornecedor",
        error?.message || "Não foi possível salvar o fornecedor.",
      );
    } finally {
      setSalvandoFornecedor(false);
    }
  };

  const editarFornecedor = (fornecedor: FornecedorFinanceiro) => {
    setFornecedorForm(fornecedor);
    setAba("fornecedores");
  };

  const alternarFornecedor = async (fornecedor: FornecedorFinanceiro) => {
    const usuario = usuarioAtualAuditoria();

    await setDoc(
      doc(db, "financeiro_fornecedores", fornecedor.id),
      {
        ativo: !fornecedor.ativo,
        atualizadoEm: serverTimestamp(),
        auditoriaUltimaAlteracao: {
          acao: !fornecedor.ativo ? "fornecedor_ativado" : "fornecedor_desativado",
          uid: usuario.uid,
          nome: usuario.nome,
          email: usuario.email,
          dataISO: new Date().toISOString(),
        },
      },
      { merge: true },
    );
  };

  const gerarHtmlRelatorio = () => {
    const tituloPeriodo = mesFiltro || "Todos os períodos";
    const linhas = transacoesFiltradas
      .map(
        (item) => `
          <tr>
            <td>${formatarData(item.data)}</td>
            <td>${item.tipo}</td>
            <td>${item.status}</td>
            <td>${item.descricao || "—"}</td>
            <td>${item.categoriaNome || "Sem categoria"}</td>
            <td>${item.fornecedorNome || "—"}</td>
            <td>${item.clienteNome || "—"}</td>
            <td>${item.barcoNome || "—"}</td>
            <td style="text-align:right;">${moeda(item.valor)}</td>
          </tr>
        `,
      )
      .join("");

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Relatório Centro Financeiro</title>
          <style>
            @page { size: A4; margin: 18mm; }
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; background: #ffffff; }
            header { border-bottom: 3px solid #0ea5e9; padding-bottom: 14px; margin-bottom: 18px; }
            .marca { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #0369a1; margin: 0 0 6px; }
            h1 { font-size: 22px; color: #082f49; margin: 0; }
            .sub { font-size: 12px; color: #64748b; margin: 6px 0 0; }
            .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
            .card { border: 1px solid #dbeafe; border-radius: 12px; padding: 10px; background: #f8fafc; }
            .card span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 800; }
            .card strong { display: block; margin-top: 4px; font-size: 15px; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
            th { background: #082f49; color: #ffffff; padding: 8px; text-align: left; }
            td { border-bottom: 1px solid #e2e8f0; padding: 7px; vertical-align: top; }
            footer { margin-top: 24px; font-size: 10px; color: #64748b; text-align: center; }
          </style>
        </head>
        <body>
          <header>
            <p class="marca">Cadê o Meu Barco • Centro Financeiro</p>
            <h1>Relatório financeiro</h1>
            <p class="sub">Período: ${tituloPeriodo} • Gerado em ${new Date().toLocaleString("pt-BR")}</p>
          </header>
      )}

          <section class="cards">
            <div class="card"><span>Entradas</span><strong>${moeda(resumo.entradas)}</strong></div>
            <div class="card"><span>Saídas</span><strong>${moeda(resumo.saidas)}</strong></div>
            <div class="card"><span>Resultado</span><strong>${moeda(resumo.lucro)}</strong></div>
            <div class="card"><span>Movimentos</span><strong>${resumo.total}</strong></div>
          </section>

          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Fornecedor</th>
                <th>Cliente</th>
                <th>Barco</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              ${
                linhas ||
                `<tr><td colspan="9" style="text-align:center;">Nenhum movimento encontrado.</td></tr>`
              }
            </tbody>
          </table>

          <footer>Documento gerado automaticamente pelo Sistema de Navegação Cadê o Meu Barco.</footer>
        </body>
      </html>
    `;
  };

  const imprimirRelatorio = () => {
    const janela = window.open("", "_blank", "width=1000,height=900");

    if (!janela) {
      void modal.aviso(
        "Pop-up bloqueado",
        "Libere pop-ups no navegador para imprimir o relatório.",
      );
      return;
    }

    janela.document.write(gerarHtmlRelatorio());
    janela.document.close();

    janela.onload = () => {
      janela.focus();
      janela.print();
    };
  };

  const exportarCSV = () => {
    const cabecalho = [
      "Data",
      "Competência",
      "Tipo",
      "Status",
      "Origem",
      "Descrição",
      "Categoria",
      "Grupo",
      "Fornecedor",
      "Cliente",
      "Barco",
      "Forma de pagamento",
      "Valor",
      "ID PagBank/Banco",
      "Criado por",
      "Criado em",
      "Observação",
    ];

    const linhas = transacoesFiltradas.map((item) => [
      formatarData(item.data),
      item.competencia,
      item.tipo,
      item.status,
      item.origem,
      item.descricao,
      item.categoriaNome || "Sem categoria",
      item.grupo,
      item.fornecedorNome,
      item.clienteNome,
      item.barcoNome,
      item.formaPagamento,
      moedaNumero(item.valor),
      item.pagbankId || item.transacaoBancoId,
      item.criadoPorEmail,
      formatarData(item.criadoEmISO),
      item.observacao,
    ]);

    const csv = [cabecalho, ...linhas]
      .map((linha) => linha.map(escaparCSV).join(";"))
      .join("\n");

    baixarArquivo(
      `centro-financeiro-${mesFiltro || "todos"}.csv`,
      "\ufeff" + csv,
      "text/csv;charset=utf-8",
    );
  };

  const enviarRelatorioPorEmail = () => {
    const assunto = `Relatório Centro Financeiro - ${mesFiltro || "Período completo"}`;
    const corpo = [
      "Olá,",
      "",
      `Segue o resumo do Centro Financeiro referente ao período ${mesFiltro || "completo"}.`,
      "",
      `Entradas: ${moeda(resumo.entradas)}`,
      `Saídas: ${moeda(resumo.saidas)}`,
      `Resultado: ${moeda(resumo.lucro)}`,
      `Movimentos no filtro: ${resumo.total}`,
      "",
      "Para enviar o relatório detalhado, gere o PDF em Imprimir/Salvar PDF ou exporte o CSV e anexe ao e-mail.",
      "",
      "Cadê o Meu Barco",
    ].join("\n");

    window.location.href = `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  };

  return (
    <div
      className={[
        "flex h-full flex-col overflow-hidden bg-[#0d0c2c] text-white",
        modoEmbed ? "min-h-0 p-0" : "min-h-[calc(100vh-74px)] p-4",
      ].join(" ")}
    >
      <header className="mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">
            Centro Financeiro
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
            Entradas, saídas, fornecedores e nichos
          </h1>
          <p className="mt-1 text-xs text-sky-100/50">
            Classifique cada movimentação por tipo, fornecedor, nicho e origem.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => novoMovimento("entrada")}
            className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20"
          >
            Nova entrada
          </button>

          <button
            onClick={() => novoMovimento("saida")}
            className="h-10 rounded-xl border border-red-400/25 bg-red-400/10 px-4 text-xs font-black uppercase text-red-300 transition hover:bg-red-400/20"
          >
            Nova saída
          </button>
        </div>
      </header>

      <section className="mb-3 grid shrink-0 gap-2 md:grid-cols-2 xl:grid-cols-5">
        <ResumoCard
          label="Entradas"
          valor={moeda(resumo.entradas)}
          sub="Receitas do período"
          destaque="emerald"
        />
        <ResumoCard
          label="Saídas"
          valor={moeda(resumo.saidas)}
          sub="Custos e despesas"
          destaque="red"
        />
        <ResumoCard
          label="Resultado"
          valor={moeda(resumo.lucro)}
          sub="Entradas - saídas"
          destaque={resumo.lucro >= 0 ? "emerald" : "red"}
        />
        <ResumoCard
          label="Pendente"
          valor={moeda(resumo.pendentes)}
          sub="A pagar/receber"
          destaque="amber"
        />
        <ResumoCard
          label="Movimentos"
          valor={resumo.total}
          sub="Itens no filtro"
          destaque="sky"
        />
      </section>

      <main className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[360px_minmax(0,1fr)_390px]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black">Movimentações</h2>
              <span className="rounded-full border border-[#7ba6d4]/20 bg-[#143760] px-2.5 py-1 text-[9px] font-black uppercase text-sky-100/55">
                {transacoesFiltradas.length}
              </span>
            </div>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar descrição, cliente, fornecedor..."
              className="mt-3 h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
            />

            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="month"
                value={mesFiltro}
                onChange={(e) => setMesFiltro(e.target.value)}
                className="h-9 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none focus:border-sky-300/60"
              />

              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value as any)}
                className="h-9 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none focus:border-sky-300/60"
              >
                <option value="todos">Todos</option>
                <option value="entrada">Entradas</option>
                <option value="saida">Saídas</option>
                <option value="transferencia">Transferências</option>
              </select>

              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value as any)}
                className="h-9 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none focus:border-sky-300/60"
              >
                <option value="todos">Status</option>
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
                <option value="cancelado">Cancelado</option>
              </select>

              <select
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
                className="h-9 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none focus:border-sky-300/60"
              >
                <option value="todas">Categorias</option>
                {categoriasAtivas.map((categoria) => (
                  <option key={categoria.id} value={categoria.id}>
                    {categoria.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2.5 scrollbar-none">
            {transacoesFiltradas.map((item) => {
              const ativo = item.id === selecionadaId;
              const entrada = item.tipo === "entrada";

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selecionarTransacao(item)}
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
                        {item.descricao || "Sem descrição"}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-sky-100/50">
                        {item.categoriaNome || "Sem categoria"} •{" "}
                        {formatarData(item.data)}
                      </p>
                    </div>

                    <span
                      className={[
                        "shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase",
                        entrada
                          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                          : "border-red-400/20 bg-red-400/10 text-red-300",
                      ].join(" ")}
                    >
                      {entrada ? "+" : "-"} {moeda(item.valor)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag>{item.status}</Tag>
                    <Tag>{item.origem}</Tag>
                    {item.clienteNome && <Tag>{item.clienteNome}</Tag>}
                    {item.fornecedorNome && <Tag>{item.fornecedorNome}</Tag>}
                  </div>
                </button>
              );
            })}

            {transacoesFiltradas.length === 0 && (
              <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sm text-sky-100/50">
                Nenhuma movimentação encontrada.
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-base font-black">Lançamento financeiro</h2>
                <p className="mt-1 text-xs text-sky-100/45">
                  Cadastre entradas, saídas, custos, fornecedores e nichos.
                </p>
              </div>

              {!modoEmbed && (
                <div className="grid grid-cols-4 gap-2 rounded-xl border border-[#7ba6d4]/15 bg-[#143760] p-1">
                  {[
                    { id: "movimentos", label: "Movimentos" },
                    { id: "categorias", label: "Nichos" },
                    { id: "fornecedores", label: "Fornecedores" },
                    { id: "relatorios", label: "Relatórios" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setAba(item.id as any)}
                      className={[
                        "h-9 rounded-lg px-3 text-[10px] font-black uppercase transition",
                        aba === item.id
                          ? "bg-sky-400/15 text-sky-100"
                          : "text-sky-100/45 hover:bg-[#17345e] hover:text-sky-100",
                      ].join(" ")}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {aba === "movimentos" && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
              <div className="grid gap-3 xl:grid-cols-3">
                <SelectCampo
                  label="Tipo"
                  value={form.tipo}
                  onChange={(valor) => alterarForm("tipo", valor)}
                  options={[
                    ["entrada", "Entrada"],
                    ["saida", "Saída"],
                    ["transferencia", "Transferência"],
                  ]}
                />

                <Campo
                  label="Data"
                  type="date"
                  value={form.data}
                  onChange={(valor) => alterarForm("data", valor)}
                />

                <SelectCampo
                  label="Status"
                  value={form.status}
                  onChange={(valor) => alterarForm("status", valor)}
                  options={[
                    ["pago", "Pago"],
                    ["pendente", "Pendente"],
                    ["cancelado", "Cancelado"],
                  ]}
                />

                <Campo
                  label="Valor"
                  value={String(form.valor || "").replace(".", ",")}
                  onChange={(valor) => alterarForm("valor", numeroMoeda(valor))}
                />

                <SelectCampo
                  label="Forma de pagamento"
                  value={form.formaPagamento}
                  onChange={(valor) => alterarForm("formaPagamento", valor)}
                  options={[
                    ["pix", "Pix"],
                    ["dinheiro", "Dinheiro"],
                    ["cartao", "Cartão"],
                    ["boleto", "Boleto"],
                    ["transferencia", "Transferência"],
                    ["debito_automatico", "Débito automático"],
                    ["outro", "Outro"],
                  ]}
                />

                <SelectCampo
                  label="Origem"
                  value={form.origem}
                  onChange={(valor) => alterarForm("origem", valor)}
                  options={[
                    ["manual", "Manual"],
                    ["pagbank", "PagBank"],
                    ["sistema", "Sistema"],
                    ["importado", "Importado"],
                  ]}
                />
              </div>

              <div className="mt-3">
                <Campo
                  label="Descrição"
                  value={form.descricao}
                  onChange={(valor) => alterarForm("descricao", valor)}
                />
              </div>

              {sugestaoCategoria && !form.categoriaId && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-sky-300/20 bg-sky-400/10 p-3">
                  <div>
                    <p className="text-xs font-black text-sky-100">
                      Sugestão inteligente: {sugestaoCategoria.icone}{" "}
                      {sugestaoCategoria.nome}
                    </p>
                    <p className="mt-0.5 text-[11px] text-sky-100/45">
                      Baseado nas palavras da descrição.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => aplicarCategoria(sugestaoCategoria.id)}
                    className="h-9 rounded-xl border border-sky-300/25 bg-sky-400/10 px-3 text-[10px] font-black uppercase text-sky-100 hover:bg-sky-400/20"
                  >
                    Aplicar
                  </button>
                </div>
              )}

              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <label>
                  <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                    Nicho / categoria
                  </p>
                  <select
                    value={form.categoriaId}
                    onChange={(e) => aplicarCategoria(e.target.value)}
                    className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                  >
                    <option value="">Selecione uma categoria</option>
                    {categoriasDoTipo.map((categoria) => (
                      <option key={categoria.id} value={categoria.id}>
                        {categoria.icone} {categoria.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                    Fornecedor
                  </p>
                  <select
                    value={form.fornecedorId}
                    onChange={(e) => aplicarFornecedor(e.target.value)}
                    className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                  >
                    <option value="">Sem fornecedor</option>
                    {fornecedoresAtivos.map((fornecedor) => (
                      <option key={fornecedor.id} value={fornecedor.id}>
                        {fornecedor.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <Campo
                  label="Cliente vinculado"
                  value={form.clienteNome}
                  onChange={(valor) => alterarForm("clienteNome", valor)}
                />

                <Campo
                  label="Barco vinculado"
                  value={form.barcoNome}
                  onChange={(valor) => alterarForm("barcoNome", valor)}
                />

                <Campo
                  label="ID PagBank / Banco"
                  value={form.pagbankId || form.transacaoBancoId}
                  onChange={(valor) => {
                    alterarForm("pagbankId", valor);
                    alterarForm("transacaoBancoId", valor);
                  }}
                />
              </div>

              <label className="mt-3 block">
                <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                  Observação
                </p>
                <textarea
                  value={form.observacao}
                  onChange={(e) => alterarForm("observacao", e.target.value)}
                  rows={4}
                  placeholder="Detalhe o motivo, comprovante, contexto ou responsável..."
                  className="w-full resize-none rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                />
              </label>

              <div className="mt-3 flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAba("categorias")}
                    className="h-10 rounded-xl border border-[#7ba6d4]/20 bg-[#143760] px-4 text-xs font-black uppercase text-sky-100 hover:bg-[#17345e]"
                  >
                    Criar novo nicho
                  </button>

                  <button
                    type="button"
                    onClick={() => setAba("fornecedores")}
                    className="h-10 rounded-xl border border-[#7ba6d4]/20 bg-[#143760] px-4 text-xs font-black uppercase text-sky-100 hover:bg-[#17345e]"
                  >
                    Cadastrar fornecedor
                  </button>
                </div>

                <div className="flex gap-2">
                  {form.id && (
                    <button
                      onClick={removerTransacao}
                      className="h-10 rounded-xl border border-red-400/20 bg-red-400/10 px-4 text-xs font-black uppercase text-red-300 hover:bg-red-400/20"
                    >
                      Remover
                    </button>
                  )}

                  <button
                    onClick={salvarTransacao}
                    disabled={salvando}
                    className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-5 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
                  >
                    {salvando ? "Salvando..." : "Salvar movimento"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {aba === "categorias" && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
              <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black">Cadastrar novo nicho</h3>
                    <p className="mt-1 text-xs text-sky-100/45">
                      Crie categorias futuras sem precisar mexer no código.
                    </p>
                  </div>

                  <button
                    onClick={() => setCategoriaForm(novaCategoria("saida"))}
                    className="h-9 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-[10px] font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                  >
                    Limpar
                  </button>
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  <Campo
                    label="Nome do nicho"
                    value={categoriaForm.nome}
                    onChange={(valor) =>
                      setCategoriaForm((atual) => ({ ...atual, nome: valor }))
                    }
                  />

                  <label>
                    <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                      Tipo
                    </p>
                    <select
                      value={categoriaForm.tipo}
                      onChange={(e) =>
                        setCategoriaForm((atual) => ({
                          ...atual,
                          tipo: e.target.value as any,
                        }))
                      }
                      className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                    >
                      <option value="entrada">Entrada</option>
                      <option value="saida">Saída</option>
                      <option value="transferencia">Transferência</option>
                      <option value="ambos">Ambos</option>
                    </select>
                  </label>

                  <Campo
                    label="Grupo"
                    value={categoriaForm.grupo}
                    onChange={(valor) =>
                      setCategoriaForm((atual) => ({ ...atual, grupo: valor }))
                    }
                  />

                  <Campo
                    label="Ícone"
                    value={categoriaForm.icone}
                    onChange={(valor) =>
                      setCategoriaForm((atual) => ({ ...atual, icone: valor }))
                    }
                  />

                  <Campo
                    label="Cor"
                    type="color"
                    value={categoriaForm.cor}
                    onChange={(valor) =>
                      setCategoriaForm((atual) => ({ ...atual, cor: valor }))
                    }
                  />

                  <label className="flex items-center gap-3 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3">
                    <input
                      type="checkbox"
                      checked={categoriaForm.ativa}
                      onChange={(e) =>
                        setCategoriaForm((atual) => ({
                          ...atual,
                          ativa: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-bold text-sky-100">
                      Categoria ativa
                    </span>
                  </label>
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  <Campo
                    label="Palavras-chave para sugestão automática"
                    value={(categoriaForm.palavrasChave || []).join(", ")}
                    onChange={(valor) =>
                      setCategoriaForm((atual) => ({
                        ...atual,
                        palavrasChave: valor
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      }))
                    }
                  />

                  <Campo
                    label="Descrição"
                    value={categoriaForm.descricao}
                    onChange={(valor) =>
                      setCategoriaForm((atual) => ({ ...atual, descricao: valor }))
                    }
                  />
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    onClick={salvarCategoria}
                    disabled={salvandoCategoria}
                    className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-5 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
                  >
                    {salvandoCategoria ? "Salvando..." : "Salvar nicho"}
                  </button>
                </div>
              </section>

              <section className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <h3 className="text-sm font-black">Nichos cadastrados</h3>

                <div className="mt-3 grid gap-2 xl:grid-cols-2">
                  {categorias.map((categoria) => (
                    <div
                      key={categoria.id}
                      className="rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">
                            {categoria.icone} {categoria.nome}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-sky-100/45">
                            {categoria.grupo} • {categoria.tipo}
                          </p>
                        </div>

                        <span
                          className={[
                            "rounded-full border px-2 py-1 text-[8px] font-black uppercase",
                            categoria.ativa
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                              : "border-slate-500/20 bg-slate-500/10 text-slate-300",
                          ].join(" ")}
                        >
                          {categoria.ativa ? "ativa" : "inativa"}
                        </span>
                      </div>

                      <p className="mt-2 line-clamp-2 text-xs text-sky-100/50">
                        {categoria.descricao || "Sem descrição."}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => editarCategoria(categoria)}
                          className="h-8 rounded-lg border border-sky-300/20 bg-sky-400/10 px-3 text-[9px] font-black uppercase text-sky-100 hover:bg-sky-400/20"
                        >
                          Editar
                        </button>

                        <button
                          onClick={() => alternarCategoria(categoria)}
                          className="h-8 rounded-lg border border-[#7ba6d4]/20 bg-[#143760] px-3 text-[9px] font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                        >
                          {categoria.ativa ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {aba === "fornecedores" && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
              <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black">Cadastrar fornecedor</h3>
                    <p className="mt-1 text-xs text-sky-100/45">
                      Cadastre quem recebe pagamentos da empresa.
                    </p>
                  </div>

                  <button
                    onClick={() => setFornecedorForm(novoFornecedor())}
                    className="h-9 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-[10px] font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                  >
                    Limpar
                  </button>
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  <Campo
                    label="Nome / razão social"
                    value={fornecedorForm.nome}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, nome: valor }))
                    }
                  />

                  <Campo
                    label="CPF/CNPJ"
                    value={fornecedorForm.documento}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, documento: valor }))
                    }
                  />

                  <Campo
                    label="Tipo de fornecedor"
                    value={fornecedorForm.tipo}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, tipo: valor }))
                    }
                  />

                  <Campo
                    label="Telefone / WhatsApp"
                    value={fornecedorForm.telefone}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, telefone: valor }))
                    }
                  />

                  <Campo
                    label="E-mail"
                    value={fornecedorForm.email}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, email: valor }))
                    }
                  />

                  <Campo
                    label="Cidade"
                    value={fornecedorForm.cidade}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, cidade: valor }))
                    }
                  />

                  <Campo
                    label="Estado"
                    value={fornecedorForm.estado}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, estado: valor }))
                    }
                  />

                  <Campo
                    label="Chave Pix"
                    value={fornecedorForm.chavePix}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, chavePix: valor }))
                    }
                  />

                  <Campo
                    label="Banco"
                    value={fornecedorForm.banco}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, banco: valor }))
                    }
                  />
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_190px]">
                  <Campo
                    label="Observação"
                    value={fornecedorForm.observacao}
                    onChange={(valor) =>
                      setFornecedorForm((atual) => ({ ...atual, observacao: valor }))
                    }
                  />

                  <label className="flex items-center gap-3 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3">
                    <input
                      type="checkbox"
                      checked={fornecedorForm.ativo}
                      onChange={(e) =>
                        setFornecedorForm((atual) => ({
                          ...atual,
                          ativo: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-bold text-sky-100">
                      Fornecedor ativo
                    </span>
                  </label>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    onClick={salvarFornecedor}
                    disabled={salvandoFornecedor}
                    className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-5 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
                  >
                    {salvandoFornecedor ? "Salvando..." : "Salvar fornecedor"}
                  </button>
                </div>
              </section>

              <section className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <h3 className="text-sm font-black">Fornecedores cadastrados</h3>

                <div className="mt-3 grid gap-2 xl:grid-cols-2">
                  {fornecedores.map((fornecedor) => (
                    <div
                      key={fornecedor.id}
                      className="rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">
                            {fornecedor.nome}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-sky-100/45">
                            {fornecedor.tipo || "Fornecedor"} •{" "}
                            {fornecedor.telefone || "sem telefone"}
                          </p>
                        </div>

                        <span
                          className={[
                            "rounded-full border px-2 py-1 text-[8px] font-black uppercase",
                            fornecedor.ativo
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                              : "border-slate-500/20 bg-slate-500/10 text-slate-300",
                          ].join(" ")}
                        >
                          {fornecedor.ativo ? "ativo" : "inativo"}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Mini label="Documento" valor={fornecedor.documento || "—"} />
                        <Mini label="Pix" valor={fornecedor.chavePix || "—"} />
                        <Mini label="Banco" valor={fornecedor.banco || "—"} />
                        <Mini
                          label="Cidade"
                          valor={`${fornecedor.cidade || "—"} / ${
                            fornecedor.estado || "—"
                          }`}
                        />
                      </div>

                      {fornecedor.observacao && (
                        <p className="mt-2 rounded-lg border border-[#7ba6d4]/15 bg-[#143760] p-2 text-xs text-sky-100/60">
                          {fornecedor.observacao}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => editarFornecedor(fornecedor)}
                          className="h-8 rounded-lg border border-sky-300/20 bg-sky-400/10 px-3 text-[9px] font-black uppercase text-sky-100 hover:bg-sky-400/20"
                        >
                          Editar
                        </button>

                        <button
                          onClick={() => alternarFornecedor(fornecedor)}
                          className="h-8 rounded-lg border border-[#7ba6d4]/20 bg-[#143760] px-3 text-[9px] font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                        >
                          {fornecedor.ativo ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {fornecedores.length === 0 && (
                    <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] p-6 text-center text-sm text-sky-100/50">
                      Nenhum fornecedor cadastrado.
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {aba === "relatorios" && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
              <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <h3 className="text-sm font-black">Relatórios e exportação</h3>
                    <p className="mt-1 text-xs text-sky-100/45">
                      Imprima, salve em PDF, exporte CSV ou prepare envio por e-mail.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={imprimirRelatorio}
                      className="h-9 rounded-xl border border-sky-300/25 bg-sky-400/10 px-3 text-[10px] font-black uppercase text-sky-100 hover:bg-sky-400/20"
                    >
                      Imprimir / PDF
                    </button>

                    <button
                      type="button"
                      onClick={exportarCSV}
                      className="h-9 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 text-[10px] font-black uppercase text-emerald-300 hover:bg-emerald-400/20"
                    >
                      Exportar CSV
                    </button>

                    <button
                      type="button"
                      onClick={enviarRelatorioPorEmail}
                      className="h-9 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-[10px] font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                    >
                      Enviar e-mail
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <Mini label="Entradas" valor={moeda(resumo.entradas)} destaque />
                  <Mini label="Saídas" valor={moeda(resumo.saidas)} />
                  <Mini
                    label="Resultado"
                    valor={moeda(resumo.lucro)}
                    destaque={resumo.lucro >= 0}
                  />
                  <Mini label="Movimentos" valor={resumo.total} />
                </div>
              </section>

              <section className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <h3 className="text-sm font-black">Ranking por nicho</h3>
                <p className="mt-1 text-xs text-sky-100/45">
                  Total classificado por categoria no filtro atual.
                </p>

                <div className="mt-3 space-y-2">
                  {resumo.rankingCategorias.map((item) => {
                    const max = Math.max(
                      ...resumo.rankingCategorias.map((i) => i.valor),
                      1,
                    );
                    const largura = Math.max(8, (item.valor / max) * 100);

                    return (
                      <div
                        key={item.nome}
                        className="rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-black text-white">
                            {item.nome}
                          </p>
                          <p className="shrink-0 text-xs font-black text-sky-100">
                            {moeda(item.valor)}
                          </p>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-900/40">
                          <div
                            className="h-full rounded-full bg-sky-400/70"
                            style={{ width: `${largura}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {resumo.rankingCategorias.length === 0 && (
                    <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] p-6 text-center text-sm text-sky-100/50">
                      Nenhum dado para o relatório.
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <h2 className="text-base font-black">Detalhes e auditoria</h2>
            <p className="mt-1 text-xs text-sky-100/45">
              Segurança para saber quem lançou, alterou e classificou.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
            <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <h3 className="text-sm font-black">Resumo do movimento</h3>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Mini label="Tipo" valor={form.tipo} />
                <Mini label="Status" valor={form.status} />
                <Mini label="Valor" valor={moeda(form.valor)} destaque />
                <Mini label="Data" valor={formatarData(form.data)} />
                <Mini label="Categoria" valor={form.categoriaNome || "—"} />
                <Mini label="Fornecedor" valor={form.fornecedorNome || "—"} />
                <Mini label="Grupo" valor={form.grupo || "—"} />
                <Mini label="Origem" valor={form.origem} />
                <Mini label="Forma" valor={form.formaPagamento} />
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <h3 className="text-sm font-black">Auditoria</h3>

              <div className="mt-3 space-y-2">
                <AuditoriaLinha label="Criado por" valor={form.criadoPorNome || "—"} />
                <AuditoriaLinha label="E-mail" valor={form.criadoPorEmail || "—"} />
                <AuditoriaLinha
                  label="Criado em"
                  valor={formatarData(form.criadoEmISO)}
                />
                <AuditoriaLinha
                  label="Atualizado por"
                  valor={form.atualizadoPorNome || "—"}
                />
                <AuditoriaLinha
                  label="Atualizado em"
                  valor={formatarData(form.atualizadoEmISO)}
                />
                {form.pagbankId && (
                  <AuditoriaLinha label="ID PagBank" valor={form.pagbankId} />
                )}
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3">
              <p className="text-[10px] font-black uppercase text-amber-300">
                Regra de segurança
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-100/75">
                Quando a integração PagBank for ativada, movimentos vindos do banco devem
                ser apenas classificados/cancelados. Não devem ser apagados para manter
                conciliação e auditoria.
              </p>
            </div>

            <div className="mt-3 rounded-2xl border border-sky-300/20 bg-sky-400/10 p-3">
              <p className="text-[10px] font-black uppercase text-sky-200">
                Importante sobre Starlink
              </p>
              <p className="mt-1 text-xs leading-5 text-sky-100/70">
                O Centro Financeiro não inclui chip de internet como custo padrão, porque
                o sistema usa a Starlink da própria embarcação.
              </p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function ResumoCard({
  label,
  valor,
  sub,
  destaque = "default",
}: {
  label: string;
  valor: string | number;
  sub: string;
  destaque?: "default" | "emerald" | "red" | "sky" | "amber";
}) {
  const cor =
    destaque === "emerald"
      ? "text-emerald-300"
      : destaque === "red"
        ? "text-red-300"
        : destaque === "sky"
          ? "text-sky-200"
          : destaque === "amber"
            ? "text-amber-300"
            : "text-white";

  return (
    <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
      <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
        {label}
      </p>
      <p className={["mt-1 truncate text-lg font-black", cor].join(" ")}>{valor}</p>
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

function Mini({
  label,
  valor,
  destaque = false,
}: {
  label: string;
  valor: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-2.5">
      <p className="text-[8px] font-black uppercase text-sky-100/40">{label}</p>
      <p
        className={[
          "mt-0.5 truncate text-xs font-black",
          destaque ? "text-emerald-300" : "text-sky-100",
        ].join(" ")}
      >
        {valor}
      </p>
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

function AuditoriaLinha({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-2.5">
      <p className="text-[8px] font-black uppercase tracking-wide text-sky-100/40">
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-bold text-sky-100">{valor}</p>
    </div>
  );
}
