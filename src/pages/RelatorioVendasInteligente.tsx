import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../config/firebase";

type Venda = {
  id: string;
  vendaId?: string;
  barcoId?: string;
  barcoNome?: string;
  ownerId?: string;
  viagemId?: string;
  origem?: string;
  destino?: string;
  dataViagem?: string;
  horarioSaida?: string;
  quantidadePassagens?: number;
  quantidadePassageiros?: number;
  valorUnitarioPassagem?: number;
  valorPassagens?: number;
  valorAdicionais?: number;
  valorTotalCobrado?: number;
  totalPagoPassageiro?: number;
  valorBrutoArmador?: number;
  valorLiquidoArmador?: number;
  taxaPlataformaValor?: number;
  receitaBrutaPlataforma?: number;
  taxaProcessadorValor?: number;
  receitaLiquidaPlataforma?: number;
  statusPagamento?: string;
  statusVenda?: string;
  formaPagamento?: string;
  criadoEm?: any;
  pagoEm?: any;
  bilhetesEmitidos?: number;
  taxaAplicada?: {
    tipo?: string;
    percentual?: number;
    valorFixo?: number;
    responsavel?: string;
    valorTaxaTotal?: number;
    taxaPagaPassageiro?: number;
    taxaDescontadaArmador?: number;
  };
};

function numero(valor: unknown) {
  const n = Number(valor || 0);
  return Number.isFinite(n) ? n : 0;
}

function moeda(valor: unknown) {
  return numero(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dataDoFirestore(valor: any): Date | null {
  if (!valor) return null;

  if (typeof valor?.toDate === "function") {
    return valor.toDate();
  }

  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function formatarData(valor: any) {
  const data = dataDoFirestore(valor);
  if (!data) return "—";

  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dataInputHoje() {
  const data = new Date();
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function dataInputDiasAtras(dias: number) {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function normalizarStatus(valor: unknown) {
  return String(valor || "")
    .trim()
    .toLowerCase();
}

function valorVenda(venda: Venda, campos: (keyof Venda)[]) {
  for (const campo of campos) {
    const valor = venda[campo];
    if (valor !== undefined && valor !== null) {
      return numero(valor);
    }
  }
  return 0;
}

function baixarCsv(vendas: Venda[]) {
  const cabecalho = [
    "Venda",
    "Data",
    "Embarcação",
    "Origem",
    "Destino",
    "Passagens",
    "Valor passagens",
    "Adicionais",
    "Taxa CMB",
    "Taxa processador",
    "Total passageiro",
    "Líquido armador",
    "Receita líquida CMB",
    "Status pagamento",
    "Status venda",
  ];

  const escapar = (valor: unknown) =>
    `"${String(valor ?? "").replace(/"/g, '""')}"`;

  const linhas = vendas.map((venda) => [
    venda.vendaId || venda.id,
    formatarData(venda.criadoEm),
    venda.barcoNome || venda.barcoId || "",
    venda.origem || "",
    venda.destino || "",
    numero(venda.quantidadePassagens || venda.quantidadePassageiros),
    valorVenda(venda, ["valorPassagens"]),
    valorVenda(venda, ["valorAdicionais"]),
    valorVenda(venda, [
      "receitaBrutaPlataforma",
      "taxaPlataformaValor",
    ]),
    valorVenda(venda, ["taxaProcessadorValor"]),
    valorVenda(venda, [
      "totalPagoPassageiro",
      "valorTotalCobrado",
    ]),
    valorVenda(venda, ["valorLiquidoArmador"]),
    valorVenda(venda, ["receitaLiquidaPlataforma"]),
    venda.statusPagamento || "",
    venda.statusVenda || "",
  ]);

  const csv = [cabecalho, ...linhas]
    .map((linha) => linha.map(escapar).join(";"))
    .join("\n");

  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-vendas-${dataInputHoje()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function Card({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: React.ReactNode;
  detalhe: string;
}) {
  return (
    <div className="rounded-3xl border border-sky-300/15 bg-[#0f2240] p-5">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-300">
        {titulo}
      </div>
      <div className="mt-2 text-3xl font-black text-white">{valor}</div>
      <div className="mt-1 text-xs text-sky-100/45">{detalhe}</div>
    </div>
  );
}

export default function RelatorioVendasInteligente() {
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [inicio, setInicio] = useState(dataInputDiasAtras(30));
  const [fim, setFim] = useState(dataInputHoje());
  const [barcoId, setBarcoId] = useState("todos");
  const [status, setStatus] = useState("todos");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "vendas"),
      (snapshot) => {
        const lista = snapshot.docs
          .map(
            (documento) =>
              ({ id: documento.id, ...documento.data() }) as Venda,
          )
          .sort((a, b) => {
            const dataA = dataDoFirestore(a.criadoEm)?.getTime() || 0;
            const dataB = dataDoFirestore(b.criadoEm)?.getTime() || 0;
            return dataB - dataA;
          });

        setVendas(lista);
        setCarregando(false);
      },
      (error) => {
        console.error(error);
        setCarregando(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const embarcacoes = useMemo(() => {
    const mapa = new Map<string, string>();

    vendas.forEach((venda) => {
      const id = String(venda.barcoId || venda.barcoNome || "").trim();
      if (!id) return;
      mapa.set(id, venda.barcoNome || venda.barcoId || id);
    });

    return Array.from(mapa.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [vendas]);

  const filtradas = useMemo(() => {
    const inicioData = inicio
      ? new Date(`${inicio}T00:00:00`)
      : null;
    const fimData = fim
      ? new Date(`${fim}T23:59:59`)
      : null;
    const texto = busca.trim().toLowerCase();

    return vendas.filter((venda) => {
      const data = dataDoFirestore(venda.criadoEm);

      if (inicioData && data && data < inicioData) return false;
      if (fimData && data && data > fimData) return false;

      if (
        barcoId !== "todos" &&
        String(venda.barcoId || venda.barcoNome) !== barcoId
      ) {
        return false;
      }

      const statusVenda = normalizarStatus(
        venda.statusPagamento || venda.statusVenda,
      );

      if (status !== "todos" && statusVenda !== status) {
        return false;
      }

      if (!texto) return true;

      return [
        venda.vendaId,
        venda.id,
        venda.barcoId,
        venda.barcoNome,
        venda.origem,
        venda.destino,
        venda.viagemId,
        venda.statusPagamento,
        venda.statusVenda,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [vendas, inicio, fim, barcoId, status, busca]);

  const resumo = useMemo(() => {
    const aprovadas = filtradas.filter((venda) =>
      ["approved", "aprovado", "pago", "confirmada", "concluido"].includes(
        normalizarStatus(venda.statusPagamento || venda.statusVenda),
      ),
    );

    const pendentes = filtradas.filter((venda) =>
      ["pending", "pendente", "aguardando", "aguardando_pagamento", "in_process", "criando_pagamento"].includes(
        normalizarStatus(venda.statusPagamento || venda.statusVenda),
      ),
    );

    const canceladas = filtradas.filter((venda) =>
      ["cancelled", "canceled", "rejected", "refunded", "charged_back", "cancelada", "cancelado", "rejeitada", "rejeitado", "reembolsada", "reembolsado", "contestada"].includes(
        normalizarStatus(venda.statusPagamento || venda.statusVenda),
      ),
    );

    const somar = (
      lista: Venda[],
      campos: (keyof Venda)[],
    ) =>
      lista.reduce(
        (total, venda) => total + valorVenda(venda, campos),
        0,
      );

    const quantidadePassagens = aprovadas.reduce(
      (total, venda) =>
        total +
        numero(
          venda.quantidadePassagens ||
            venda.quantidadePassageiros ||
            1,
        ),
      0,
    );

    const totalPago = somar(aprovadas, [
      "totalPagoPassageiro",
      "valorTotalCobrado",
    ]);
    const liquidoArmador = somar(aprovadas, [
      "valorLiquidoArmador",
      "valorBrutoArmador",
    ]);
    const receitaBrutaCmb = somar(aprovadas, [
      "receitaBrutaPlataforma",
      "taxaPlataformaValor",
    ]);
    const taxaProcessador = somar(aprovadas, [
      "taxaProcessadorValor",
    ]);
    const receitaLiquidaCmb =
      somar(aprovadas, ["receitaLiquidaPlataforma"]) ||
      receitaBrutaCmb - taxaProcessador;

    return {
      aprovadas,
      pendentes,
      canceladas,
      quantidadePassagens,
      totalPago,
      liquidoArmador,
      receitaBrutaCmb,
      taxaProcessador,
      receitaLiquidaCmb,
      ticketMedio:
        aprovadas.length > 0 ? totalPago / aprovadas.length : 0,
    };
  }, [filtradas]);

  const auditoria = useMemo(() => {
    return filtradas
      .map((venda) => {
        const alertas: string[] = [];

        const totalPassageiro = valorVenda(venda, [
          "totalPagoPassageiro",
          "valorTotalCobrado",
        ]);
        const brutoArmador = valorVenda(venda, [
          "valorBrutoArmador",
          "valorPassagens",
        ]);
        const taxa = valorVenda(venda, [
          "receitaBrutaPlataforma",
          "taxaPlataformaValor",
        ]);

        const taxaPassageiro =
          numero(venda.taxaAplicada?.taxaPagaPassageiro);
        const totalEsperado = brutoArmador + taxaPassageiro;

        if (
          totalPassageiro > 0 &&
          totalEsperado > 0 &&
          Math.abs(totalPassageiro - totalEsperado) > 0.05
        ) {
          alertas.push("Total cobrado não confere com a composição");
        }

        const aprovado = [
          "aprovado",
          "pago",
          "confirmada",
          "concluido",
        ].includes(
          normalizarStatus(venda.statusPagamento || venda.statusVenda),
        );

        if (aprovado && numero(venda.bilhetesEmitidos) === 0) {
          alertas.push("Pagamento aprovado sem bilhete emitido");
        }

        if (taxa < 0 || brutoArmador < 0 || totalPassageiro < 0) {
          alertas.push("Valor financeiro negativo");
        }

        return alertas.length > 0
          ? { venda, alertas }
          : null;
      })
      .filter(Boolean) as { venda: Venda; alertas: string[] }[];
  }, [filtradas]);

  return (
    <div className="min-h-full bg-[#0d0c2c] p-4 text-white md:p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="rounded-3xl border border-sky-300/15 bg-[#0f2240] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">
                Cadê Meu Barco
              </p>
              <h1 className="mt-1 text-3xl font-black">
                Relatório inteligente de vendas
              </h1>
              <p className="mt-1 text-sm text-sky-100/50">
                Passagens, repasses, taxas, receita e auditoria.
              </p>
            </div>

            <button
              type="button"
              onClick={() => baixarCsv(filtradas)}
              className="rounded-2xl bg-emerald-500 px-5 py-3 text-xs font-black uppercase tracking-wide text-white"
            >
              Exportar CSV
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label>
              <span className="text-[10px] font-black uppercase text-sky-100/55">
                De
              </span>
              <input
                type="date"
                value={inicio}
                onChange={(event) => setInicio(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-3 py-3 text-white"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase text-sky-100/55">
                Até
              </span>
              <input
                type="date"
                value={fim}
                onChange={(event) => setFim(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-3 py-3 text-white"
              />
            </label>

            <label>
              <span className="text-[10px] font-black uppercase text-sky-100/55">
                Embarcação
              </span>
              <select
                value={barcoId}
                onChange={(event) => setBarcoId(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-3 py-3 text-white"
              >
                <option value="todos">Todas</option>
                {embarcacoes.map((barco) => (
                  <option key={barco.id} value={barco.id}>
                    {barco.nome}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-[10px] font-black uppercase text-sky-100/55">
                Status
              </span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-3 py-3 text-white"
              >
                <option value="todos">Todos</option>
                <option value="approved">Aprovado</option>
                <option value="pending">Pendente</option>
                <option value="in_process">Em processamento</option>
                <option value="rejected">Rejeitado</option>
                <option value="cancelled">Cancelado</option>
                <option value="refunded">Reembolsado</option>
              </select>
            </label>

            <label>
              <span className="text-[10px] font-black uppercase text-sky-100/55">
                Busca
              </span>
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Venda, rota, barco..."
                className="mt-1 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-3 py-3 text-white placeholder:text-sky-100/30"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card
            titulo="Vendas aprovadas"
            valor={resumo.aprovadas.length}
            detalhe={`${resumo.quantidadePassagens} passagens`}
          />
          <Card
            titulo="Total pago"
            valor={moeda(resumo.totalPago)}
            detalhe="Valor desembolsado pelos passageiros"
          />
          <Card
            titulo="Líquido dos armadores"
            valor={moeda(resumo.liquidoArmador)}
            detalhe="Valor destinado às embarcações"
          />
          <Card
            titulo="Receita bruta CMB"
            valor={moeda(resumo.receitaBrutaCmb)}
            detalhe="Total de taxas da plataforma"
          />
          <Card
            titulo="Taxa do processador"
            valor={moeda(resumo.taxaProcessador)}
            detalhe="Custo financeiro registrado"
          />
          <Card
            titulo="Receita líquida CMB"
            valor={moeda(resumo.receitaLiquidaCmb)}
            detalhe="Taxa CMB menos processador"
          />
          <Card
            titulo="Ticket médio"
            valor={moeda(resumo.ticketMedio)}
            detalhe="Média por venda aprovada"
          />
          <Card
            titulo="Pendências"
            valor={resumo.pendentes.length}
            detalhe={`${resumo.canceladas.length} canceladas/reembolsadas`}
          />
        </div>

        {auditoria.length > 0 ? (
          <section className="mt-4 rounded-3xl border border-amber-300/25 bg-amber-400/10 p-5">
            <h2 className="text-lg font-black text-amber-100">
              Alertas de auditoria ({auditoria.length})
            </h2>
            <div className="mt-3 space-y-2">
              {auditoria.slice(0, 20).map(({ venda, alertas }) => (
                <div
                  key={venda.id}
                  className="rounded-2xl border border-amber-300/20 bg-black/10 p-3"
                >
                  <div className="font-black">
                    {venda.vendaId || venda.id} —{" "}
                    {venda.barcoNome || venda.barcoId || "Sem barco"}
                  </div>
                  <div className="mt-1 text-sm text-amber-100/70">
                    {alertas.join(" • ")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-4 rounded-3xl border border-sky-300/15 bg-[#0f2240] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-black">
              Vendas encontradas ({filtradas.length})
            </h2>
            {carregando ? (
              <span className="text-xs text-sky-100/45">Carregando...</span>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full border-collapse text-left text-xs">
              <thead className="text-sky-300">
                <tr>
                  {[
                    "Data",
                    "Venda",
                    "Embarcação",
                    "Rota",
                    "Passagens",
                    "Total passageiro",
                    "Líquido armador",
                    "Taxa CMB",
                    "Receita líquida",
                    "Status",
                  ].map((titulo) => (
                    <th
                      key={titulo}
                      className="border-b border-white/10 px-3 py-3"
                    >
                      {titulo}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filtradas.map((venda) => (
                  <tr key={venda.id} className="hover:bg-white/[0.035]">
                    <td className="border-b border-white/[0.07] px-3 py-3 text-sky-100/65">
                      {formatarData(venda.criadoEm)}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3 font-black">
                      {venda.vendaId || venda.id}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3">
                      {venda.barcoNome || venda.barcoId || "—"}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3">
                      {venda.origem || "—"} → {venda.destino || "—"}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3">
                      {numero(
                        venda.quantidadePassagens ||
                          venda.quantidadePassageiros ||
                          1,
                      )}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3">
                      {moeda(
                        valorVenda(venda, [
                          "totalPagoPassageiro",
                          "valorTotalCobrado",
                        ]),
                      )}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3">
                      {moeda(
                        valorVenda(venda, ["valorLiquidoArmador"]),
                      )}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3">
                      {moeda(
                        valorVenda(venda, [
                          "receitaBrutaPlataforma",
                          "taxaPlataformaValor",
                        ]),
                      )}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3 text-emerald-200">
                      {moeda(
                        valorVenda(venda, [
                          "receitaLiquidaPlataforma",
                        ]),
                      )}
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3">
                      {venda.statusPagamento ||
                        venda.statusVenda ||
                        "—"}
                    </td>
                  </tr>
                ))}

                {!carregando && filtradas.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-3 py-10 text-center text-sky-100/40"
                    >
                      Nenhuma venda encontrada.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
