import React, { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type StatusFinanceiroMercadoPago =
  | "nao_conectado"
  | "link_gerado"
  | "pendente"
  | "ativo"
  | "bloqueado";

type FinanceiroMercadoPago = {
  gateway?: "mercado_pago";
  modelo?: "checkout_pro_split";
  status?: StatusFinanceiroMercadoPago;
  contaConectada?: boolean;
  vendedorMercadoPagoId?: string;
  taxaPlataformaPercentual?: number;
  taxaPlataformaValorFixo?: number;
  vendaPassagemHabilitada?: boolean;
  ultimoLinkConexao?: string;
  ultimoState?: string;
  ultimoLinkGeradoEm?: any;
  conectadoEm?: any;
  aprovadoEm?: any;
  bloqueadoEm?: any;
  atualizadoEm?: any;
};

type EmbarcacaoFinanceira = {
  id: string;
  nome?: string;
  tipo?: string;
  tipoBarco?: string;
  categoriaPlano?: string;
  planoSistema?: string;
  status?: string;
  ativo?: boolean;
  ownerEmail?: string;
  emailDono?: string;
  donoNome?: string;
  financeiroMercadoPago?: FinanceiroMercadoPago;
};

const STATUS_CONFIG: Record<
  StatusFinanceiroMercadoPago,
  { label: string; resumo: string; classe: string; dot: string }
> = {
  nao_conectado: {
    label: "Não conectado",
    resumo: "Ainda não existe autorização Mercado Pago para esta embarcação.",
    classe: "border-slate-500/20 bg-slate-500/10 text-slate-300",
    dot: "bg-slate-400",
  },
  link_gerado: {
    label: "Link gerado",
    resumo: "O link foi criado e pode ser enviado ao responsável financeiro.",
    classe: "border-sky-300/25 bg-sky-400/10 text-sky-200",
    dot: "bg-sky-300",
  },
  pendente: {
    label: "Pendente",
    resumo: "Conta conectada, aguardando conferência da equipe Cadê Meu Barco.",
    classe: "border-amber-300/25 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-300",
  },
  ativo: {
    label: "Ativo",
    resumo: "Conta aprovada para testes/vendas com Checkout Pro + Split.",
    classe: "border-emerald-300/25 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-300",
  },
  bloqueado: {
    label: "Bloqueado",
    resumo: "Venda bloqueada até nova liberação financeira.",
    classe: "border-red-300/25 bg-red-400/10 text-red-300",
    dot: "bg-red-300",
  },
};

const STATUS_OPCOES: { id: StatusFinanceiroMercadoPago; label: string }[] = [
  { id: "nao_conectado", label: "Não conectado" },
  { id: "link_gerado", label: "Link gerado" },
  { id: "pendente", label: "Pendente" },
  { id: "ativo", label: "Ativo" },
  { id: "bloqueado", label: "Bloqueado" },
];

function financeiroPadrao(financeiro?: FinanceiroMercadoPago): FinanceiroMercadoPago {
  return {
    gateway: "mercado_pago",
    modelo: "checkout_pro_split",
    status: financeiro?.status || "nao_conectado",
    contaConectada: financeiro?.contaConectada === true,
    vendedorMercadoPagoId: financeiro?.vendedorMercadoPagoId || "",
    taxaPlataformaPercentual: Number(financeiro?.taxaPlataformaPercentual ?? 8),
    taxaPlataformaValorFixo: Number(financeiro?.taxaPlataformaValorFixo ?? 0),
    vendaPassagemHabilitada: financeiro?.vendaPassagemHabilitada === true,
    ultimoLinkConexao: financeiro?.ultimoLinkConexao || "",
    ultimoState: financeiro?.ultimoState || "",
    ultimoLinkGeradoEm: financeiro?.ultimoLinkGeradoEm || null,
    conectadoEm: financeiro?.conectadoEm || null,
    aprovadoEm: financeiro?.aprovadoEm || null,
    bloqueadoEm: financeiro?.bloqueadoEm || null,
    atualizadoEm: financeiro?.atualizadoEm || null,
  };
}

const URL_CRIAR_LINK_OAUTH =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/criarLinkOAuthMercadoPago";
const URL_CALLBACK_OAUTH =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/mercadoPagoOAuthCallback";
const URL_CHECKOUT_PRO_SPLIT_SANDBOX =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/criarCheckoutProSplitSandbox";
const URL_CONSULTAR_CHECKOUT_SPLIT_SANDBOX =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/consultarCheckoutSplitSandbox";
const URL_GERENCIAR_PAGAMENTO_MARKETPLACE_SANDBOX =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/gerenciarPagamentoMarketplaceSandbox";

type ResultadoCheckoutSandbox = {
  testeId: string;
  preferenciaId: string;
  sandboxInitPoint: string;
  valorTotal: number;
  marketplaceFee: number;
  valorPrevistoVendedorAntesTarifaMp: number;
  sellerTestUserValidado: boolean;
  ambiente: "sandbox";
  aviso: string;
};

type ResultadoConsultaSandbox = {
  testeId: string;
  encontrado: boolean;
  pagamentoId?: string;
  status: string;
  statusDetalhe?: string;
  valorTotal?: number;
  taxaMarketplace?: number;
  taxasMercadoPago?: number;
  valorLiquidoVendedor?: number;
  criadoEm?: string;
  aprovadoEm?: string;
  mensagem?: string;
  ambiente: "sandbox";
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

function numero(valor: any, padrao = 0) {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : padrao;
}

function moeda(valor: any) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function tipoEmbarcacao(barco: EmbarcacaoFinanceira) {
  return barco.tipoBarco || barco.tipo || "Sem tipo";
}

function categoriaPlano(barco: EmbarcacaoFinanceira) {
  return barco.categoriaPlano || barco.planoSistema || "GPS";
}

function statusVendaTexto(financeiro: FinanceiroMercadoPago) {
  if (financeiro.vendaPassagemHabilitada) return "Venda habilitada";
  if (financeiro.status === "ativo") return "Apta, venda desligada";
  return "Venda desabilitada";
}

function usuarioAuditoria() {
  const user = getAuth().currentUser;

  return {
    uid: user?.uid || "sem_uid",
    nome: user?.displayName || user?.email || "Usuário não identificado",
    email: user?.email || "sem_email",
  };
}

export default function MercadoPagoFinanceiro() {
  const modal = useAppModal();

  const [barcos, setBarcos] = useState<EmbarcacaoFinanceira[]>([]);
  const [selecionadoId, setSelecionadoId] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusFinanceiroMercadoPago>(
    "todos",
  );
  const [salvando, setSalvando] = useState(false);
  const [linkGerado, setLinkGerado] = useState("");
  const [taxaPercentual, setTaxaPercentual] = useState("8");
  const [taxaFixa, setTaxaFixa] = useState("0");
  const [resultadoCheckoutSandbox, setResultadoCheckoutSandbox] =
    useState<ResultadoCheckoutSandbox | null>(null);
  const [resultadoConsultaSandbox, setResultadoConsultaSandbox] =
    useState<ResultadoConsultaSandbox | null>(null);
  const [operandoPagamentoSandbox, setOperandoPagamentoSandbox] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as EmbarcacaoFinanceira)
        .sort((a, b) => String(a.nome || a.id).localeCompare(String(b.nome || b.id)));

      setBarcos(lista);

      if (!selecionadoId && lista.length > 0) {
        setSelecionadoId(lista[0].id);
      }
    });

    return () => unsub();
  }, [selecionadoId]);

  const selecionado = useMemo(
    () => barcos.find((barco) => barco.id === selecionadoId) || null,
    [barcos, selecionadoId],
  );

  const financeiroSelecionado = useMemo(
    () => financeiroPadrao(selecionado?.financeiroMercadoPago),
    [selecionado],
  );

  useEffect(() => {
    if (!selecionado) return;

    const financeiro = financeiroPadrao(selecionado.financeiroMercadoPago);
    setTaxaPercentual(String(financeiro.taxaPlataformaPercentual ?? 8).replace(".", ","));
    setTaxaFixa(String(financeiro.taxaPlataformaValorFixo ?? 0).replace(".", ","));
    setLinkGerado("");
    setResultadoCheckoutSandbox(null);
  }, [selecionado?.id]);

  const barcosFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return barcos.filter((barco) => {
      const financeiro = financeiroPadrao(barco.financeiroMercadoPago);

      if (filtroStatus !== "todos" && financeiro.status !== filtroStatus) return false;

      if (!texto) return true;

      return [
        barco.id,
        barco.nome,
        barco.donoNome,
        barco.ownerEmail,
        barco.emailDono,
        tipoEmbarcacao(barco),
        categoriaPlano(barco),
        financeiro.status,
        financeiro.vendedorMercadoPagoId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [barcos, busca, filtroStatus]);

  const resumo = useMemo(() => {
    const financeiros = barcos.map((barco) =>
      financeiroPadrao(barco.financeiroMercadoPago),
    );

    return {
      total: barcos.length,
      conectadas: financeiros.filter((item) => item.contaConectada).length,
      ativas: financeiros.filter((item) => item.status === "ativo").length,
      vendendo: financeiros.filter((item) => item.vendaPassagemHabilitada).length,
    };
  }, [barcos]);

  const atualizarFinanceiro = async (
    barco: EmbarcacaoFinanceira,
    dados: Partial<FinanceiroMercadoPago>,
    acao: string,
  ) => {
    const usuario = usuarioAuditoria();
    const atual = financeiroPadrao(barco.financeiroMercadoPago);
    const proximo = {
      ...atual,
      ...dados,
      gateway: "mercado_pago" as const,
      modelo: "checkout_pro_split" as const,
      atualizadoEm: serverTimestamp(),
    };

    await setDoc(
      doc(db, "embarcacoes", barco.id),
      {
        financeiroMercadoPago: proximo,
        vendaPassagemHabilitada: proximo.vendaPassagemHabilitada === true,
        vendaPassagemStatusFinanceiro: proximo.status,
        atualizadoEm: serverTimestamp(),
        auditoriaUltimaAlteracaoFinanceira: {
          acao,
          uid: usuario.uid,
          nome: usuario.nome,
          email: usuario.email,
          dataISO: new Date().toISOString(),
        },
      },
      { merge: true },
    );
  };

  const gerarLinkConexao = async () => {
    if (!selecionado) return;

    setSalvando(true);

    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Faça login novamente antes de gerar o link.");
      const idToken = await user.getIdToken();
      const resposta = await fetch(URL_CRIAR_LINK_OAUTH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ embarcacaoId: selecionado.id }),
      });
      const dados = await resposta.json();
      if (!resposta.ok || !dados?.link) {
        throw new Error(dados?.erro || "Não foi possível gerar o link seguro.");
      }
      const link = String(dados.link);

      setLinkGerado(link);
      await copiarTexto(link, false);

      await modal.sucesso(
        "Link Mercado Pago gerado",
        "O link foi criado e copiado. Envie para o responsável financeiro da embarcação autorizar a conexão.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao gerar link",
        error?.message || "Não foi possível gerar o link Mercado Pago.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const copiarTexto = async (texto: string, mostrarAviso = true) => {
    if (!texto) {
      if (mostrarAviso) await modal.aviso("Sem link", "Gere o link antes de copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(texto);
      if (mostrarAviso)
        await modal.sucesso("Copiado", "Link copiado para a área de transferência.");
    } catch {
      if (mostrarAviso) {
        await modal.aviso(
          "Copie manualmente",
          "Não foi possível copiar automaticamente. Selecione e copie o link exibido na tela.",
        );
      }
    }
  };

  const criarCheckoutSplitSandbox = async () => {
    if (!selecionado || selecionado.id !== "AGUIA_DOURADA") return;

    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Criar Checkout sandbox de R$ 1,00?",
      mensagem:
        "Será criada uma preferência de teste com split de R$ 0,08. Use somente o Buyer Test User e cartão oficial de teste. Não use cartão real e não habilite a venda.",
      confirmarTexto: "Criar teste",
      cancelarTexto: "Cancelar",
    });
    if (!confirmou) return;

    setSalvando(true);
    setResultadoCheckoutSandbox(null);
    setResultadoConsultaSandbox(null);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Faça login novamente antes do teste.");
      const idToken = await user.getIdToken();
      const chaveIdempotencia =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `split_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const resposta = await fetch(URL_CHECKOUT_PRO_SPLIT_SANDBOX, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          embarcacaoId: selecionado.id,
          chaveIdempotencia,
        }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error([dados?.erro, dados?.detalhe].filter(Boolean).join(": "));
      }

      setResultadoCheckoutSandbox(dados as ResultadoCheckoutSandbox);
      await modal.sucesso(
        "Checkout sandbox preparado",
        "A preferência de teste foi criada. Use o botão exibido no painel para abrir o ambiente sandbox.",
      );
    } catch (error: any) {
      await modal.erro(
        "Checkout sandbox não criado",
        error?.message || "A API do Mercado Pago recusou a preferência de teste.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const consultarCheckoutSplitSandbox = async () => {
    if (!selecionado || selecionado.id !== "AGUIA_DOURADA" || !resultadoCheckoutSandbox) {
      return;
    }

    setSalvando(true);
    setResultadoConsultaSandbox(null);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Faça login novamente antes da consulta.");
      const idToken = await user.getIdToken();

      const resposta = await fetch(URL_CONSULTAR_CHECKOUT_SPLIT_SANDBOX, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          embarcacaoId: selecionado.id,
          testeId: resultadoCheckoutSandbox.testeId,
        }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error([dados?.erro, dados?.detalhe].filter(Boolean).join(": "));
      }

      const resultado = dados as ResultadoConsultaSandbox;
      setResultadoConsultaSandbox(resultado);

      if (!resultado.encontrado) {
        await modal.aviso(
          "Pagamento não encontrado",
          "A preferência existe, mas nenhum pagamento sandbox foi concluído. A venda continuará desabilitada.",
        );
        return;
      }

      await modal.sucesso(
        "Resultado consultado",
        `Pagamento sandbox localizado com status: ${resultado.status}.`,
      );
    } catch (error: any) {
      await modal.erro(
        "Consulta não concluída",
        error?.message || "Não foi possível consultar o pagamento sandbox.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const gerenciarPagamentoSandbox = async (acao: "cancelar" | "reembolsar") => {
    if (
      !selecionado ||
      selecionado.id !== "AGUIA_DOURADA" ||
      !resultadoCheckoutSandbox ||
      !resultadoConsultaSandbox?.encontrado ||
      !resultadoConsultaSandbox.pagamentoId
    ) {
      return;
    }

    const cancelamento = acao === "cancelar";
    const frase = cancelamento ? "CANCELAR TESTE" : "REEMBOLSAR TESTE";
    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: cancelamento ? "Cancelar pagamento sandbox?" : "Reembolsar pagamento sandbox?",
      mensagem: cancelamento
        ? "O cancelamento só será enviado se o pagamento estiver pendente, em processamento ou autorizado."
        : "Será solicitado o reembolso integral do pagamento sandbox aprovado.",
      confirmarTexto: cancelamento ? "Continuar cancelamento" : "Continuar reembolso",
      cancelarTexto: "Voltar",
    });
    if (!confirmou) return;

    const confirmacaoDigitada = window.prompt(
      `Para confirmar a operação técnica, digite exatamente: ${frase}`,
    );
    if (confirmacaoDigitada?.trim().toUpperCase() !== frase) {
      await modal.aviso("Operação cancelada", "A frase de confirmação não corresponde.");
      return;
    }

    setOperandoPagamentoSandbox(true);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Faça login novamente antes da operação.");
      const idToken = await user.getIdToken();
      const chaveIdempotencia =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `operacao_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const resposta = await fetch(URL_GERENCIAR_PAGAMENTO_MARKETPLACE_SANDBOX, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          embarcacaoId: selecionado.id,
          testeId: resultadoCheckoutSandbox.testeId,
          pagamentoId: resultadoConsultaSandbox.pagamentoId,
          acao,
          confirmacao: frase,
          chaveIdempotencia,
        }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error(
          [dados?.erro, dados?.statusAtual, dados?.codigo].filter(Boolean).join(": "),
        );
      }

      await modal.sucesso(
        cancelamento ? "Pagamento sandbox cancelado" : "Pagamento sandbox reembolsado",
        cancelamento
          ? "O Mercado Pago confirmou o cancelamento técnico."
          : "O Mercado Pago confirmou o reembolso integral técnico.",
      );
      await consultarCheckoutSplitSandbox();
    } catch (error: any) {
      await modal.erro(
        "Operação financeira não concluída",
        error?.message || "O Mercado Pago não concluiu a operação sandbox.",
      );
    } finally {
      setOperandoPagamentoSandbox(false);
    }
  };

  const salvarTaxas = async () => {
    if (!selecionado) return;

    const percentual = Math.max(0, Math.min(100, numero(taxaPercentual, 8)));
    const fixo = Math.max(0, numero(taxaFixa, 0));

    setSalvando(true);

    try {
      await atualizarFinanceiro(
        selecionado,
        {
          taxaPlataformaPercentual: percentual,
          taxaPlataformaValorFixo: fixo,
        },
        "taxas_mercado_pago_atualizadas",
      );

      await modal.sucesso("Taxas salvas", "Configuração financeira atualizada.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar",
        error?.message || "Não foi possível salvar as taxas.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const alterarStatus = async (status: StatusFinanceiroMercadoPago) => {
    if (!selecionado) return;

    const config = STATUS_CONFIG[status];
    const confirmou = await modal.confirmar({
      tipo: status === "bloqueado" ? "warning" : "info",
      titulo: `Alterar status para ${config.label}?`,
      mensagem: config.resumo,
      confirmarTexto: "Confirmar",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    setSalvando(true);

    try {
      const dados: Partial<FinanceiroMercadoPago> = { status };

      if (status === "pendente" || status === "ativo") {
        dados.contaConectada = true;
        dados.conectadoEm = financeiroSelecionado.conectadoEm || serverTimestamp();
      }

      if (status === "ativo") {
        dados.aprovadoEm = serverTimestamp();
      }

      if (status === "bloqueado") {
        dados.bloqueadoEm = serverTimestamp();
        dados.vendaPassagemHabilitada = false;
      }

      if (status === "nao_conectado") {
        dados.contaConectada = false;
        dados.vendaPassagemHabilitada = false;
      }

      await atualizarFinanceiro(selecionado, dados, `status_mercado_pago_${status}`);
      await modal.sucesso("Status atualizado", "Status financeiro alterado com sucesso.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao atualizar",
        error?.message || "Não foi possível atualizar o status.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const alternarVenda = async (habilitar: boolean) => {
    if (!selecionado) return;

    if (habilitar && financeiroSelecionado.status !== "ativo") {
      await modal.aviso(
        "Financeiro não ativo",
        "Ative o Mercado Pago desta embarcação antes de habilitar venda de passagem.",
      );
      return;
    }

    const confirmou = await modal.confirmar({
      tipo: habilitar ? "success" : "warning",
      titulo: habilitar ? "Habilitar venda pelo app?" : "Desabilitar venda pelo app?",
      mensagem: habilitar
        ? "O app poderá exibir botão de compra quando a viagem também estiver liberada para venda."
        : "O botão de compra será ocultado para esta embarcação até nova liberação.",
      confirmarTexto: habilitar ? "Habilitar" : "Desabilitar",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    setSalvando(true);

    try {
      await atualizarFinanceiro(
        selecionado,
        { vendaPassagemHabilitada: habilitar },
        habilitar ? "venda_passagem_habilitada" : "venda_passagem_desabilitada",
      );

      await modal.sucesso(
        habilitar ? "Venda habilitada" : "Venda desabilitada",
        "Configuração de venda atualizada.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao atualizar",
        error?.message || "Não foi possível alterar a venda.",
      );
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0d0c2c] text-white">
      <header className="shrink-0 border-b border-[#7ba6d4]/15 bg-[#0f2240] p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">
              Mercado Pago
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-white">
              Checkout Transparente + Split por embarcação
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-sky-100/50">
              Use esta área para gerar o link de conexão, controlar o status financeiro e
              decidir quais embarcações estarão aptas a vender passagem pelo app.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:w-[520px]">
            <Resumo label="Embarcações" valor={resumo.total} />
            <Resumo label="Conectadas" valor={resumo.conectadas} destaque="sky" />
            <Resumo label="Ativas" valor={resumo.ativas} destaque="emerald" />
            <Resumo label="Vendendo" valor={resumo.vendendo} destaque="amber" />
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-black">Embarcações</h3>
              <span className="rounded-full border border-[#7ba6d4]/20 bg-[#143760] px-2.5 py-1 text-[9px] font-black uppercase text-sky-100/55">
                {barcosFiltrados.length}/{barcos.length}
              </span>
            </div>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar barco, dono, e-mail, status..."
              className="mt-3 h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
            />

            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as any)}
              className="mt-2 h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none focus:border-sky-300/60"
            >
              <option value="todos">Todos os status</option>
              {STATUS_OPCOES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
            {barcosFiltrados.map((barco) => {
              const financeiro = financeiroPadrao(barco.financeiroMercadoPago);
              const config = STATUS_CONFIG[financeiro.status || "nao_conectado"];
              const selecionadoAtual = selecionadoId === barco.id;

              return (
                <button
                  key={barco.id}
                  type="button"
                  onClick={() => setSelecionadoId(barco.id)}
                  className={[
                    "mb-2 w-full rounded-2xl border p-3 text-left transition",
                    selecionadoAtual
                      ? "border-sky-300/45 bg-sky-400/10"
                      : "border-[#7ba6d4]/15 bg-[#143760] hover:border-sky-300/35 hover:bg-[#17345e]",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">
                        {barco.nome || barco.id}
                      </p>
                      <p className="mt-1 truncate text-[10px] font-bold text-sky-100/45">
                        {barco.id} • {tipoEmbarcacao(barco)}
                      </p>
                    </div>
                    <span
                      className={[
                        "shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase",
                        config.classe,
                      ].join(" ")}
                    >
                      {config.label}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-black uppercase text-sky-100/45">
                    <span>{statusVendaTexto(financeiro)}</span>
                    <span>{financeiro.taxaPlataformaPercentual || 0}%</span>
                  </div>
                </button>
              );
            })}

            {barcosFiltrados.length === 0 && (
              <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sm text-sky-100/45">
                Nenhuma embarcação encontrada.
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3 scrollbar-none">
          {!selecionado ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sm text-sky-100/45">
              Selecione uma embarcação para configurar o Mercado Pago.
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-3">
                <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-300">
                        Embarcação selecionada
                      </p>
                      <h3 className="mt-1 text-2xl font-black text-white">
                        {selecionado.nome || selecionado.id}
                      </h3>
                      <p className="mt-1 text-xs text-sky-100/45">
                        {selecionado.id} • {tipoEmbarcacao(selecionado)} • Plano{" "}
                        {categoriaPlano(selecionado)}
                      </p>
                    </div>

                    <StatusBadge
                      status={financeiroSelecionado.status || "nao_conectado"}
                    />
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-4">
                    <Info
                      label="Conta conectada"
                      valor={financeiroSelecionado.contaConectada ? "Sim" : "Não"}
                    />
                    <Info
                      label="Venda pelo app"
                      valor={
                        financeiroSelecionado.vendaPassagemHabilitada
                          ? "Habilitada"
                          : "Desabilitada"
                      }
                    />
                    <Info
                      label="Taxa percentual"
                      valor={`${financeiroSelecionado.taxaPlataformaPercentual || 0}%`}
                    />
                    <Info
                      label="Taxa fixa"
                      valor={moeda(financeiroSelecionado.taxaPlataformaValorFixo || 0)}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4">
                  <h3 className="text-base font-black">Link de conexão Mercado Pago</h3>
                  <p className="mt-1 text-xs leading-5 text-sky-100/45">
                    Envie este link para o responsável financeiro da embarcação. Ele entra
                    no Mercado Pago, autoriza o Cadê Meu Barco e o retorno será tratado
                    pelo callback que vamos criar nas Cloud Functions.
                  </p>

                  <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_auto_auto]">
                    <input
                      value={linkGerado}
                      readOnly
                      placeholder="Gere o link para exibir aqui..."
                      className="h-11 rounded-xl border border-[#7ba6d4]/20 bg-[#0d0c2c] px-3 text-xs font-semibold text-sky-100 outline-none placeholder:text-sky-100/25"
                    />

                    <button
                      type="button"
                      onClick={gerarLinkConexao}
                      disabled={salvando}
                      className="h-11 rounded-xl border border-sky-300/25 bg-sky-400/10 px-4 text-xs font-black uppercase text-sky-200 transition hover:bg-sky-400/20 disabled:opacity-60"
                    >
                      {salvando ? "Gerando..." : "Gerar link"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        copiarTexto(
                          linkGerado,
                        )
                      }
                      className="h-11 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-4 text-xs font-black uppercase text-sky-100 transition hover:bg-[#1d426f]"
                    >
                      Copiar
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <Info
                      label="Último link"
                      valor={formatarData(financeiroSelecionado.ultimoLinkGeradoEm)}
                    />
                    <Info
                      label="State"
                      valor="Protegido no servidor"
                    />
                    <Info
                      label="Redirect URI"
                      valor={URL_CALLBACK_OAUTH}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4">
                  <h3 className="text-base font-black">Taxas da plataforma</h3>
                  <p className="mt-1 text-xs leading-5 text-sky-100/45">
                    Essa configuração define a taxa Cadê Meu Barco para simular/calcular o
                    split no futuro. A venda real ainda depende da viagem estar liberada.
                  </p>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <Campo
                      label="Taxa percentual"
                      value={taxaPercentual}
                      onChange={setTaxaPercentual}
                      suffix="%"
                    />
                    <Campo
                      label="Taxa fixa"
                      value={taxaFixa}
                      onChange={setTaxaFixa}
                      prefix="R$"
                    />
                    <button
                      type="button"
                      onClick={salvarTaxas}
                      disabled={salvando}
                      className="self-end rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
                    >
                      Salvar taxas
                    </button>
                  </div>
                </div>
              </div>

              <aside className="space-y-3">
                <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4">
                  <h3 className="text-base font-black">Controle financeiro</h3>
                  <p className="mt-1 text-xs leading-5 text-sky-100/45">
                    Use estes botões para acompanhar o teste com seu sócio e liberar a
                    venda somente quando tudo estiver aprovado.
                  </p>

                  <div className="mt-4 grid gap-2">
                    {STATUS_OPCOES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => alterarStatus(item.id)}
                        disabled={salvando || financeiroSelecionado.status === item.id}
                        className={[
                          "rounded-xl border px-3 py-2 text-left text-xs font-black uppercase transition disabled:cursor-not-allowed disabled:opacity-60",
                          financeiroSelecionado.status === item.id
                            ? STATUS_CONFIG[item.id].classe
                            : "border-[#7ba6d4]/20 bg-[#0d0c2c] text-sky-100/60 hover:bg-[#17345e] hover:text-white",
                        ].join(" ")}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4">
                  <h3 className="text-base font-black">Venda de passagens</h3>
                  <p className="mt-1 text-xs leading-5 text-sky-100/45">
                    O app só deve mostrar compra quando a embarcação e a viagem estiverem
                    liberadas.
                  </p>

                  <div className="mt-4 grid gap-2">
                    <button
                      type="button"
                      onClick={() => alternarVenda(true)}
                      disabled={salvando || financeiroSelecionado.vendaPassagemHabilitada}
                      className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-3 py-3 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
                    >
                      Habilitar venda no app
                    </button>

                    <button
                      type="button"
                      onClick={() => alternarVenda(false)}
                      disabled={
                        salvando || !financeiroSelecionado.vendaPassagemHabilitada
                      }
                      className="rounded-xl border border-red-300/25 bg-red-400/10 px-3 py-3 text-xs font-black uppercase text-red-300 transition hover:bg-red-400/20 disabled:opacity-60"
                    >
                      Desabilitar venda
                    </button>

                  </div>
                </div>

                <div className="rounded-2xl border border-amber-300/20 bg-amber-400/5 p-4">
                  <h3 className="text-sm font-black text-amber-200">
                    Teste seguro do split
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-amber-100/70">
                    Restrito à Águia Dourada e ao ambiente sandbox. Cria um Checkout Pro
                    de R$ 1,00 com taxa CMB de R$ 0,08. Use somente Buyer Test User e
                    cartão oficial de teste.
                  </p>

                  <button
                    type="button"
                    onClick={criarCheckoutSplitSandbox}
                    disabled={
                      salvando ||
                      selecionado.id !== "AGUIA_DOURADA" ||
                      financeiroSelecionado.status !== "pendente" ||
                      !financeiroSelecionado.contaConectada ||
                      financeiroSelecionado.vendaPassagemHabilitada
                    }
                    className="mt-3 w-full rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-xs font-black uppercase text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {salvando ? "Preparando..." : "Criar checkout sandbox"}
                  </button>

                  {resultadoCheckoutSandbox && (
                    <div className="mt-3 space-y-1 rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-[11px] text-emerald-100">
                      <p className="font-black uppercase text-emerald-300">
                        Preferência sandbox criada
                      </p>
                      <p>Preferência: {resultadoCheckoutSandbox.preferenciaId}</p>
                      <p>Valor técnico: {moeda(resultadoCheckoutSandbox.valorTotal)}</p>
                      <p>Taxa CMB: {moeda(resultadoCheckoutSandbox.marketplaceFee)}</p>
                      <p>
                        Vendedor antes da tarifa MP: {moeda(
                          resultadoCheckoutSandbox.valorPrevistoVendedorAntesTarifaMp,
                        )}
                      </p>
                      <p>Ambiente: Sandbox</p>
                      <a
                        href={resultadoCheckoutSandbox.sandboxInitPoint}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 block rounded-lg border border-emerald-300/30 bg-emerald-400/15 px-3 py-2 text-center text-xs font-black uppercase text-emerald-200 transition hover:bg-emerald-400/25"
                      >
                        Abrir checkout sandbox
                      </a>
                      <button
                        type="button"
                        onClick={consultarCheckoutSplitSandbox}
                        disabled={salvando}
                        className="mt-2 w-full rounded-lg border border-sky-300/30 bg-sky-400/15 px-3 py-2 text-center text-xs font-black uppercase text-sky-200 transition hover:bg-sky-400/25 disabled:opacity-50"
                      >
                        {salvando ? "Consultando..." : "Consultar resultado do teste"}
                      </button>

                      {resultadoConsultaSandbox && (
                        <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/30 p-3 text-[11px]">
                          <p className="font-black uppercase text-sky-200">
                            Resultado da consulta
                          </p>
                          <p>Pagamento encontrado: {resultadoConsultaSandbox.encontrado ? "Sim" : "Não"}</p>
                          <p>Status: {resultadoConsultaSandbox.status}</p>
                          {resultadoConsultaSandbox.pagamentoId && (
                            <p>Pagamento: {resultadoConsultaSandbox.pagamentoId}</p>
                          )}
                          {resultadoConsultaSandbox.valorTotal !== undefined && (
                            <p>Valor: {moeda(resultadoConsultaSandbox.valorTotal)}</p>
                          )}
                          {resultadoConsultaSandbox.taxaMarketplace !== undefined && (
                            <p>Taxa CMB confirmada: {moeda(resultadoConsultaSandbox.taxaMarketplace)}</p>
                          )}
                          {resultadoConsultaSandbox.taxasMercadoPago !== undefined && (
                            <p>Tarifas Mercado Pago: {moeda(resultadoConsultaSandbox.taxasMercadoPago)}</p>
                          )}
                          {resultadoConsultaSandbox.valorLiquidoVendedor !== undefined && (
                            <p>Valor líquido do vendedor: {moeda(resultadoConsultaSandbox.valorLiquidoVendedor)}</p>
                          )}
                          {resultadoConsultaSandbox.mensagem && (
                            <p className="mt-1 text-amber-200">{resultadoConsultaSandbox.mensagem}</p>
                          )}
                          {resultadoConsultaSandbox.encontrado &&
                            ["pending", "in_process", "authorized"].includes(
                              resultadoConsultaSandbox.status,
                            ) && (
                              <button
                                type="button"
                                onClick={() => gerenciarPagamentoSandbox("cancelar")}
                                disabled={operandoPagamentoSandbox || salvando}
                                className="mt-3 w-full rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase text-amber-200 transition hover:bg-amber-400/20 disabled:opacity-50"
                              >
                                {operandoPagamentoSandbox
                                  ? "Processando..."
                                  : "Cancelar pagamento sandbox"}
                              </button>
                            )}
                          {resultadoConsultaSandbox.encontrado &&
                            resultadoConsultaSandbox.status === "approved" && (
                              <button
                                type="button"
                                onClick={() => gerenciarPagamentoSandbox("reembolsar")}
                                disabled={operandoPagamentoSandbox || salvando}
                                className="mt-3 w-full rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-2 text-xs font-black uppercase text-red-200 transition hover:bg-red-400/20 disabled:opacity-50"
                              >
                                {operandoPagamentoSandbox
                                  ? "Processando..."
                                  : "Reembolsar pagamento sandbox"}
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Resumo({
  label,
  valor,
  destaque = "slate",
}: {
  label: string;
  valor: number;
  destaque?: "slate" | "sky" | "emerald" | "amber";
}) {
  const cor =
    destaque === "emerald"
      ? "text-emerald-300"
      : destaque === "sky"
        ? "text-sky-200"
        : destaque === "amber"
          ? "text-amber-300"
          : "text-white";

  return (
    <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
      <p className={["text-lg font-black", cor].join(" ")}>{valor}</p>
      <p className="mt-0.5 truncate text-[9px] font-black uppercase text-sky-100/40">
        {label}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: StatusFinanceiroMercadoPago }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.nao_conectado;

  return (
    <div className={["rounded-2xl border px-4 py-3", config.classe].join(" ")}>
      <div className="flex items-center gap-2">
        <span className={["h-2.5 w-2.5 rounded-full", config.dot].join(" ")} />
        <span className="text-xs font-black uppercase">{config.label}</span>
      </div>
      <p className="mt-1 max-w-[280px] text-[10px] leading-4 opacity-75">
        {config.resumo}
      </p>
    </div>
  );
}

function Info({ label, valor }: { label: string; valor: any }) {
  return (
    <div className="rounded-xl border border-[#7ba6d4]/15 bg-[#0d0c2c] p-3">
      <p className="text-[9px] font-black uppercase text-sky-100/35">{label}</p>
      <p className="mt-1 truncate text-xs font-black text-sky-100">{valor || "—"}</p>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  prefix = "",
  suffix = "",
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/40">{label}</p>
      <div className="flex h-11 items-center rounded-xl border border-[#7ba6d4]/20 bg-[#0d0c2c] focus-within:border-sky-300/60">
        {prefix && (
          <span className="pl-3 text-xs font-black text-sky-100/40">{prefix}</span>
        )}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/25"
        />
        {suffix && (
          <span className="pr-3 text-xs font-black text-sky-100/40">{suffix}</span>
        )}
      </div>
    </label>
  );
}
