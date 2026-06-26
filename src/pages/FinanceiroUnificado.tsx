import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../config/firebase";

import CentralFinanceira from "./CentralFinanceira";
import CentroFinanceiro from "./CentroFinanceiro";
import MercadoPagoFinanceiro from "./MercadoPagoFinanceiro";

type AbaFinanceiro =
  | "visao"
  | "clientes"
  | "movimentos"
  | "fornecedores"
  | "relatorios"
  | "mercado_pago";

type MovimentoResumo = {
  id: string;
  tipo?: "entrada" | "saida" | "transferencia";
  status?: "pago" | "pendente" | "cancelado";
  valor?: number;
  categoriaNome?: string;
  fornecedorNome?: string;
  clienteNome?: string;
  barcoNome?: string;
  competencia?: string;
};

type PagamentoClienteResumo = {
  id?: string;
  competencia?: string;
  valor?: number;
  pagoEm?: string;
  forma?: string;
  observacao?: string;
};

type ClienteResumo = {
  id: string;
  clienteNome?: string;
  embarcacaoNome?: string;
  status?: string;
  historicoPagamentos?: PagamentoClienteResumo[];
};

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function competenciaAtual(dataISO = hojeISO()) {
  const [ano, mes] = dataISO.split("-");
  return `${ano}-${mes}`;
}

function competenciaDePagamento(pagamento: PagamentoClienteResumo) {
  if (pagamento.competencia) {
    const texto = String(pagamento.competencia);
    if (/^\d{4}-\d{2}$/.test(texto)) return texto;
    if (/^\d{2}\/\d{4}$/.test(texto)) {
      const [mes, ano] = texto.split("/");
      return `${ano}-${mes}`;
    }
  }

  if (pagamento.pagoEm) {
    return competenciaAtual(String(pagamento.pagoEm).slice(0, 10));
  }

  return "";
}

function moeda(valor: any) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function classeSaldo(valor: number) {
  if (valor > 0) return "text-emerald-300";
  if (valor < 0) return "text-red-300";
  return "text-sky-100";
}

export default function FinanceiroUnificado() {
  const [aba, setAba] = useState<AbaFinanceiro>("visao");
  const [movimentos, setMovimentos] = useState<MovimentoResumo[]>([]);
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [fornecedoresTotal, setFornecedoresTotal] = useState(0);
  const mesAtual = competenciaAtual();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "financeiro_movimentos"), (snapshot) => {
      const lista = snapshot.docs.map((docSnap) => ({
        ...(docSnap.data() as any),
        id: docSnap.id,
      })) as MovimentoResumo[];

      setMovimentos(lista);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "financeiro_clientes_gps"), (snapshot) => {
      const lista = snapshot.docs.map((docSnap) => ({
        ...(docSnap.data() as any),
        id: docSnap.id,
      })) as ClienteResumo[];

      setClientes(lista);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "financeiro_fornecedores"), (snapshot) => {
      setFornecedoresTotal(snapshot.size);
    });

    return () => unsub();
  }, []);

  const resumo = useMemo(() => {
    const movimentosMes = movimentos.filter((item) => item.competencia === mesAtual);
    const movimentosValidos = movimentosMes.filter((item) => item.status !== "cancelado");

    const pagamentosGpsMes = clientes.flatMap((cliente) =>
      (cliente.historicoPagamentos || [])
        .filter((pagamento) => competenciaDePagamento(pagamento) === mesAtual)
        .map((pagamento) => ({
          ...pagamento,
          clienteNome: cliente.clienteNome || "Cliente GPS",
          barcoNome: cliente.embarcacaoNome || "",
        })),
    );

    const entradasPagasMovimentos = movimentosValidos
      .filter((item) => item.tipo === "entrada" && item.status === "pago")
      .reduce((total, item) => total + Number(item.valor || 0), 0);

    const entradasGpsPagas = pagamentosGpsMes.reduce(
      (total, item) => total + Number(item.valor || 0),
      0,
    );

    const saidasPagas = movimentosValidos
      .filter((item) => item.tipo === "saida" && item.status === "pago")
      .reduce((total, item) => total + Number(item.valor || 0), 0);

    const entradasPendentes = movimentosValidos
      .filter((item) => item.tipo === "entrada" && item.status === "pendente")
      .reduce((total, item) => total + Number(item.valor || 0), 0);

    const saidasPendentes = movimentosValidos
      .filter((item) => item.tipo === "saida" && item.status === "pendente")
      .reduce((total, item) => total + Number(item.valor || 0), 0);

    const entradasPagas = entradasPagasMovimentos + entradasGpsPagas;
    const saldoAtual = entradasPagas - saidasPagas;
    const saldoPrevisto = saldoAtual + entradasPendentes - saidasPendentes;

    const clientesAtivos = clientes.filter((cliente) =>
      ["ativo", "promocional"].includes(String(cliente.status || "")),
    ).length;

    const clientesAtrasados = clientes.filter(
      (cliente) => String(cliente.status || "") === "atrasado",
    ).length;

    const rankingCategorias = movimentosValidos.reduce<Record<string, number>>(
      (acc, item) => {
        const chave = item.categoriaNome || "Sem categoria";
        acc[chave] = (acc[chave] || 0) + Number(item.valor || 0);
        return acc;
      },
      {},
    );

    if (entradasGpsPagas > 0) {
      rankingCategorias["Mensalidades / Instalações GPS"] =
        (rankingCategorias["Mensalidades / Instalações GPS"] || 0) + entradasGpsPagas;
    }

    const topCategorias = Object.entries(rankingCategorias)
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);

    return {
      movimentosMes,
      movimentosValidos,
      pagamentosGpsMes,
      entradasPagasMovimentos,
      entradasGpsPagas,
      entradasPagas,
      saidasPagas,
      entradasPendentes,
      saidasPendentes,
      saldoAtual,
      saldoPrevisto,
      clientesAtivos,
      clientesAtrasados,
      topCategorias,
    };
  }, [movimentos, clientes, mesAtual]);

  const abas = [
    { id: "visao", label: "Visão Geral" },
    { id: "clientes", label: "Clientes GPS" },
    { id: "movimentos", label: "Movimentos" },
    { id: "fornecedores", label: "Fornecedores" },
    { id: "relatorios", label: "Relatórios" },
    { id: "mercado_pago", label: "Mercado Pago" },
  ] as const;

  return (
    <div className="flex h-full min-h-[calc(100vh-74px)] flex-col overflow-hidden bg-[#0d0c2c] p-4 text-white">
      <header className="mb-3 shrink-0 rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">
              Financeiro
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
              Central financeira unificada
            </h1>
            <p className="mt-1 text-xs text-sky-100/50">
              Clientes GPS, mensalidades, movimentos, fornecedores, Mercado Pago, saldo e
              relatórios.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#7ba6d4]/15 bg-[#143760] p-1 md:grid-cols-6">
            {abas.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
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
        </div>
      </header>

      {aba === "visao" && (
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <CardResumo
              label="Saldo atual"
              valor={moeda(resumo.saldoAtual)}
              sub="Entradas pagas - saídas pagas"
              destaque={resumo.saldoAtual}
            />

            <CardResumo
              label="Saldo previsto"
              valor={moeda(resumo.saldoPrevisto)}
              sub="Inclui pendências"
              destaque={resumo.saldoPrevisto}
            />

            <CardResumo
              label="Entradas pagas"
              valor={moeda(resumo.entradasPagas)}
              sub="Movimentos + clientes GPS"
              positivo
            />

            <CardResumo
              label="Saídas pagas"
              valor={moeda(resumo.saidasPagas)}
              sub="Custos/despesas pagos"
              negativo
            />
          </section>

          <section className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniResumo label="Entrada GPS" valor={moeda(resumo.entradasGpsPagas)} />
            <MiniResumo
              label="Entradas pendentes"
              valor={moeda(resumo.entradasPendentes)}
            />
            <MiniResumo label="Saídas pendentes" valor={moeda(resumo.saidasPendentes)} />
            <MiniResumo
              label="Clientes atrasados"
              valor={resumo.clientesAtrasados}
              alerta
            />
          </section>

          <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-white">Resumo do mês</h2>
                  <p className="mt-1 text-xs text-sky-100/45">
                    Competência atual: {mesAtual}
                  </p>
                </div>

                <span className="rounded-full border border-[#7ba6d4]/20 bg-[#143760] px-3 py-1 text-[10px] font-black uppercase text-sky-100/55">
                  {resumo.movimentosValidos.length + resumo.pagamentosGpsMes.length}{" "}
                  registros
                </span>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <PainelValor label="Recebido" valor={resumo.entradasPagas} />
                <PainelValor label="Pago" valor={resumo.saidasPagas} negativo />
                <PainelValor label="Resultado" valor={resumo.saldoAtual} destaque />
              </div>
            </div>

            <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
              <h2 className="text-base font-black text-white">Indicadores rápidos</h2>

              <div className="mt-3 space-y-2">
                <LinhaIndicador
                  label="Fornecedores cadastrados"
                  valor={fornecedoresTotal}
                />
                <LinhaIndicador label="Clientes cadastrados" valor={clientes.length} />
                <LinhaIndicador label="Clientes ativos" valor={resumo.clientesAtivos} />
                <LinhaIndicador
                  label="Pagamentos GPS no mês"
                  valor={resumo.pagamentosGpsMes.length}
                />
              </div>
            </div>
          </section>

          <section className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
            <h2 className="text-base font-black text-white">Top nichos do mês</h2>
            <p className="mt-1 text-xs text-sky-100/45">
              Maiores valores classificados por categoria.
            </p>

            <div className="mt-3 space-y-2">
              {resumo.topCategorias.map((item) => {
                const max = Math.max(...resumo.topCategorias.map((i) => i.valor), 1);
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

              {resumo.topCategorias.length === 0 && (
                <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] p-6 text-center text-sm text-sky-100/50">
                  Ainda não há registros financeiros neste mês.
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {aba === "clientes" && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#7ba6d4]/20">
          <CentralFinanceira />
        </div>
      )}

      {aba === "movimentos" && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#7ba6d4]/20">
          <CentroFinanceiro abaInicial="movimentos" modoEmbed />
        </div>
      )}

      {aba === "fornecedores" && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#7ba6d4]/20">
          <CentroFinanceiro abaInicial="fornecedores" modoEmbed />
        </div>
      )}

      {aba === "relatorios" && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#7ba6d4]/20">
          <CentroFinanceiro abaInicial="relatorios" modoEmbed />
        </div>
      )}

      {aba === "mercado_pago" && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#7ba6d4]/20">
          <MercadoPagoFinanceiro />
        </div>
      )}
    </div>
  );
}

function CardResumo({
  label,
  valor,
  sub,
  destaque = 0,
  positivo = false,
  negativo = false,
}: {
  label: string;
  valor: string;
  sub: string;
  destaque?: number;
  positivo?: boolean;
  negativo?: boolean;
}) {
  const cor = positivo
    ? "text-emerald-300"
    : negativo
      ? "text-red-300"
      : classeSaldo(destaque);

  return (
    <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
      <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
        {label}
      </p>
      <p className={["mt-1 truncate text-xl font-black", cor].join(" ")}>{valor}</p>
      <p className="mt-0.5 truncate text-[10px] text-sky-100/35">{sub}</p>
    </div>
  );
}

function MiniResumo({
  label,
  valor,
  alerta = false,
}: {
  label: string;
  valor: string | number;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
      <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
        {label}
      </p>
      <p
        className={[
          "mt-1 truncate text-lg font-black",
          alerta ? "text-red-300" : "text-sky-100",
        ].join(" ")}
      >
        {valor}
      </p>
    </div>
  );
}

function PainelValor({
  label,
  valor,
  negativo = false,
  destaque = false,
}: {
  label: string;
  valor: number;
  negativo?: boolean;
  destaque?: boolean;
}) {
  const cor = destaque
    ? classeSaldo(valor)
    : negativo
      ? "text-red-300"
      : "text-emerald-300";

  return (
    <div className="rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-3">
      <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
        {label}
      </p>
      <p className={["mt-1 text-base font-black", cor].join(" ")}>{moeda(valor)}</p>
    </div>
  );
}

function LinhaIndicador({ label, valor }: { label: string; valor: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] px-3 py-2">
      <span className="text-xs font-bold text-sky-100/55">{label}</span>
      <span className="text-sm font-black text-white">{valor}</span>
    </div>
  );
}
