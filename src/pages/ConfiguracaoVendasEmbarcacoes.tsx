import React, { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import {
  calcularTaxaVenda,
  normalizarConfiguracaoVendas,
} from "../services/motorTaxasVenda";
import type {
  ConfiguracaoVendasPassagens,
  ResponsavelTaxaVenda,
  TipoTaxaVenda,
} from "../types/vendas";

type Embarcacao = {
  id: string;
  nome?: string;
  ownerEmail?: string;
  emailDono?: string;
  categoriaPlano?: string;
  tipoBarco?: string;
  vendasPassagens?: Partial<ConfiguracaoVendasPassagens>;
  vendaPassagemHabilitada?: boolean;
  financeiroMercadoPago?: {
    contaConectada?: boolean;
    vendedorMercadoPagoId?: string;
    vendaPassagemHabilitada?: boolean;
    taxaPlataformaPercentual?: number;
    taxaPlataformaValorFixo?: number;
  };
};

const TIPOS_TAXA: { id: TipoTaxaVenda; nome: string; descricao: string }[] = [
  {
    id: "percentual",
    nome: "Percentual",
    descricao: "Calculado sobre o valor definido como base.",
  },
  {
    id: "fixa_por_passagem",
    nome: "Valor fixo por passagem",
    descricao: "Multiplica o valor fixo pela quantidade de passageiros.",
  },
  {
    id: "fixa_por_venda",
    nome: "Valor fixo por compra",
    descricao: "Uma cobrança única, independentemente da quantidade.",
  },
  {
    id: "percentual_mais_fixa",
    nome: "Percentual + valor fixo",
    descricao: "Soma o percentual ao valor fixo por passagem.",
  },
];

function moeda(valor: number) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function numero(valor: string | number | null | undefined, padrao = 0) {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : padrao;
}

function paraInput(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "";
  return String(valor).replace(".", ",");
}

function Toggle({
  ativo,
  aoAlterar,
  titulo,
  descricao,
}: {
  ativo: boolean;
  aoAlterar: () => void;
  titulo: string;
  descricao: string;
}) {
  return (
    <button
      type="button"
      onClick={aoAlterar}
      className={[
        "flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition",
        ativo
          ? "border-emerald-300/30 bg-emerald-400/10"
          : "border-slate-500/20 bg-slate-500/10",
      ].join(" ")}
    >
      <div>
        <div className="font-black text-white">{titulo}</div>
        <div className="mt-1 text-xs text-sky-100/55">{descricao}</div>
      </div>
      <span
        className={[
          "relative h-7 w-12 shrink-0 rounded-full transition",
          ativo ? "bg-emerald-400" : "bg-slate-600",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1 h-5 w-5 rounded-full bg-white transition",
            ativo ? "left-6" : "left-1",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

export default function ConfiguracaoVendasEmbarcacoes() {
  const [barcos, setBarcos] = useState<Embarcacao[]>([]);
  const [selecionadoId, setSelecionadoId] = useState("");
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [form, setForm] = useState<ConfiguracaoVendasPassagens>(
    normalizarConfiguracaoVendas(null),
  );

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs
        .map((documento) => ({ id: documento.id, ...documento.data() }) as Embarcacao)
        .sort((a, b) => String(a.nome || a.id).localeCompare(String(b.nome || b.id)));

      setBarcos(lista);

      if (!selecionadoId && lista.length > 0) {
        setSelecionadoId(lista[0].id);
      }
    });

    return () => unsubscribe();
  }, [selecionadoId]);

  const selecionado = useMemo(
    () => barcos.find((barco) => barco.id === selecionadoId) || null,
    [barcos, selecionadoId],
  );

  useEffect(() => {
    if (!selecionado) return;

    const legado = selecionado.financeiroMercadoPago;

    const configuracao = normalizarConfiguracaoVendas({
      ...(selecionado.vendasPassagens || {}),
      ativa:
        selecionado.vendasPassagens?.ativa ??
        selecionado.vendaPassagemHabilitada ??
        legado?.vendaPassagemHabilitada ??
        false,
      regraTaxa: {
        ...(selecionado.vendasPassagens?.regraTaxa || {}),
        percentual:
          selecionado.vendasPassagens?.regraTaxa?.percentual ??
          legado?.taxaPlataformaPercentual ??
          8,
        valorFixo:
          selecionado.vendasPassagens?.regraTaxa?.valorFixo ??
          legado?.taxaPlataformaValorFixo ??
          0,
      },
      pagamento: {
        ...(selecionado.vendasPassagens?.pagamento || {}),
        mercadoPagoConectado:
          selecionado.vendasPassagens?.pagamento?.mercadoPagoConectado ??
          legado?.contaConectada ??
          false,
        vendedorMercadoPagoId:
          selecionado.vendasPassagens?.pagamento?.vendedorMercadoPagoId ??
          legado?.vendedorMercadoPagoId ??
          "",
      },
    });

    setForm(configuracao);
    setMensagem("");
  }, [selecionado]);

  const filtrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    if (!texto) return barcos;

    return barcos.filter((barco) =>
      [
        barco.id,
        barco.nome,
        barco.ownerEmail,
        barco.emailDono,
        barco.categoriaPlano,
        barco.tipoBarco,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto),
    );
  }, [barcos, busca]);

  const previa = useMemo(
    () =>
      calcularTaxaVenda(form.regraTaxa, {
        quantidadePassagens: 2,
        valorUnitarioPassagem: 100,
        valorAdicionais: 20,
      }),
    [form.regraTaxa],
  );

  function alterarRegra(campo: string, valor: unknown) {
    setForm((atual) => ({
      ...atual,
      regraTaxa: {
        ...atual.regraTaxa,
        [campo]: valor,
      },
    }));
  }

  async function salvar() {
    if (!selecionado) return;

    setSalvando(true);
    setMensagem("");

    try {
      const usuario = getAuth().currentUser;

      const configuracaoNormalizada = normalizarConfiguracaoVendas({
        ...form,
        atualizadoPor: {
          uid: usuario?.uid || "sem_uid",
          email: usuario?.email || "sem_email",
          nome: usuario?.displayName || usuario?.email || "Usuário não identificado",
        },
      });

      await setDoc(
        doc(db, "embarcacoes", selecionado.id),
        {
          vendasPassagens: {
            ...configuracaoNormalizada,
            atualizadoEm: serverTimestamp(),
          },

          // Compatibilidade com as telas antigas.
          vendaPassagemHabilitada: configuracaoNormalizada.ativa,
          financeiroMercadoPago: {
            ...(selecionado.financeiroMercadoPago || {}),
            vendaPassagemHabilitada: configuracaoNormalizada.ativa,
            taxaPlataformaPercentual: configuracaoNormalizada.regraTaxa.percentual,
            taxaPlataformaValorFixo: configuracaoNormalizada.regraTaxa.valorFixo,
            contaConectada: configuracaoNormalizada.pagamento.mercadoPagoConectado,
            vendedorMercadoPagoId:
              configuracaoNormalizada.pagamento.vendedorMercadoPagoId,
            atualizadoEm: serverTimestamp(),
          },
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      setMensagem("Configuração salva com sucesso.");
    } catch (error) {
      console.error(error);
      setMensagem("Não foi possível salvar a configuração.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="min-h-full bg-[#0d0c2c] p-4 text-white md:p-6">
      <div className="mx-auto grid max-w-[1500px] gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-sky-300/15 bg-[#0f2240] p-4">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">
              Embarcações
            </p>
            <h1 className="mt-1 text-xl font-black">Venda de passagens</h1>
          </div>

          <input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Pesquisar embarcação..."
            className="mb-3 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-sm text-white outline-none placeholder:text-sky-100/35"
          />

          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {filtrados.map((barco) => {
              const configuracao = normalizarConfiguracaoVendas({
                ...(barco.vendasPassagens || {}),
                ativa:
                  barco.vendasPassagens?.ativa ??
                  barco.vendaPassagemHabilitada ??
                  barco.financeiroMercadoPago?.vendaPassagemHabilitada ??
                  false,
              });

              const ativo = barco.id === selecionadoId;

              return (
                <button
                  key={barco.id}
                  type="button"
                  onClick={() => setSelecionadoId(barco.id)}
                  className={[
                    "w-full rounded-2xl border p-3 text-left transition",
                    ativo
                      ? "border-sky-300/35 bg-sky-400/15"
                      : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-sm">{barco.nome || barco.id}</strong>
                    <span
                      className={[
                        "rounded-full px-2 py-1 text-[9px] font-black uppercase",
                        configuracao.ativa
                          ? "bg-emerald-400/15 text-emerald-200"
                          : "bg-slate-400/10 text-slate-300",
                      ].join(" ")}
                    >
                      {configuracao.ativa ? "Vendendo" : "Desativada"}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-sky-100/45">
                    {barco.id}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="space-y-4">
          {!selecionado ? (
            <div className="rounded-3xl border border-dashed border-sky-300/20 bg-[#0f2240] p-12 text-center text-sky-100/50">
              Selecione uma embarcação.
            </div>
          ) : (
            <>
              <section className="rounded-3xl border border-sky-300/15 bg-[#0f2240] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-300">
                      Configuração individual
                    </p>
                    <h2 className="mt-1 text-2xl font-black">
                      {selecionado.nome || selecionado.id}
                    </h2>
                    <p className="mt-1 text-xs text-sky-100/45">ID: {selecionado.id}</p>
                  </div>

                  <button
                    type="button"
                    onClick={salvar}
                    disabled={salvando}
                    className="rounded-2xl bg-sky-500 px-5 py-3 text-xs font-black uppercase tracking-wide text-white disabled:opacity-60"
                  >
                    {salvando ? "Salvando..." : "Salvar configuração"}
                  </button>
                </div>

                {mensagem ? (
                  <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-400/10 p-3 text-sm text-sky-100">
                    {mensagem}
                  </div>
                ) : null}
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-3xl border border-sky-300/15 bg-[#0f2240] p-5">
                  <h3 className="text-lg font-black">Disponibilidade</h3>

                  <Toggle
                    ativo={form.ativa}
                    aoAlterar={() =>
                      setForm((atual) => ({
                        ...atual,
                        ativa: !atual.ativa,
                      }))
                    }
                    titulo="Vender passagens desta embarcação"
                    descricao="O botão de compra aparecerá somente para esta embarcação."
                  />

                  <Toggle
                    ativo={form.pagamento.pixAtivo}
                    aoAlterar={() =>
                      setForm((atual) => ({
                        ...atual,
                        pagamento: {
                          ...atual.pagamento,
                          pixAtivo: !atual.pagamento.pixAtivo,
                        },
                      }))
                    }
                    titulo="Pagamento por Pix"
                    descricao="Permite gerar pagamento Pix quando o backend estiver integrado."
                  />

                  <label className="block">
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      Encerrar vendas antes da saída
                    </span>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={form.limiteHorasAntesSaida}
                        onChange={(event) =>
                          setForm((atual) => ({
                            ...atual,
                            limiteHorasAntesSaida: Math.max(
                              0,
                              numero(event.target.value, 0),
                            ),
                          }))
                        }
                        className="w-28 rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none"
                      />
                      <span className="text-sm text-sky-100/55">horas antes</span>
                    </div>
                  </label>
                </div>

                <div className="space-y-3 rounded-3xl border border-sky-300/15 bg-[#0f2240] p-5">
                  <h3 className="text-lg font-black">Conta de recebimento</h3>

                  <Toggle
                    ativo={form.pagamento.mercadoPagoConectado}
                    aoAlterar={() =>
                      setForm((atual) => ({
                        ...atual,
                        pagamento: {
                          ...atual.pagamento,
                          mercadoPagoConectado: !atual.pagamento.mercadoPagoConectado,
                        },
                      }))
                    }
                    titulo="Mercado Pago conectado"
                    descricao="Controle administrativo da situação da conta."
                  />

                  <label className="block">
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      ID do vendedor Mercado Pago
                    </span>
                    <input
                      value={form.pagamento.vendedorMercadoPagoId}
                      onChange={(event) =>
                        setForm((atual) => ({
                          ...atual,
                          pagamento: {
                            ...atual.pagamento,
                            vendedorMercadoPagoId: event.target.value,
                          },
                        }))
                      }
                      placeholder="Identificador da conta"
                      className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none placeholder:text-sky-100/30"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-3xl border border-sky-300/15 bg-[#0f2240] p-5">
                <h3 className="text-lg font-black">Regra da taxa CMB</h3>
                <p className="mt-1 text-sm text-sky-100/50">
                  A regra será copiada para cada venda, preservando o histórico.
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {TIPOS_TAXA.map((tipo) => (
                    <button
                      key={tipo.id}
                      type="button"
                      onClick={() => alterarRegra("tipo", tipo.id)}
                      className={[
                        "rounded-2xl border p-4 text-left transition",
                        form.regraTaxa.tipo === tipo.id
                          ? "border-sky-300/40 bg-sky-400/15"
                          : "border-white/10 bg-white/[0.04]",
                      ].join(" ")}
                    >
                      <div className="font-black">{tipo.nome}</div>
                      <div className="mt-1 text-xs text-sky-100/45">{tipo.descricao}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label>
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      Percentual
                    </span>
                    <input
                      value={paraInput(form.regraTaxa.percentual)}
                      onChange={(event) =>
                        alterarRegra(
                          "percentual",
                          Math.max(0, numero(event.target.value)),
                        )
                      }
                      inputMode="decimal"
                      className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      Valor fixo
                    </span>
                    <input
                      value={paraInput(form.regraTaxa.valorFixo)}
                      onChange={(event) =>
                        alterarRegra("valorFixo", Math.max(0, numero(event.target.value)))
                      }
                      inputMode="decimal"
                      className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      Taxa mínima
                    </span>
                    <input
                      value={paraInput(form.regraTaxa.valorMinimo)}
                      onChange={(event) =>
                        alterarRegra(
                          "valorMinimo",
                          event.target.value.trim()
                            ? Math.max(0, numero(event.target.value))
                            : null,
                        )
                      }
                      inputMode="decimal"
                      placeholder="Sem mínimo"
                      className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none placeholder:text-sky-100/30"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      Taxa máxima
                    </span>
                    <input
                      value={paraInput(form.regraTaxa.valorMaximo)}
                      onChange={(event) =>
                        alterarRegra(
                          "valorMaximo",
                          event.target.value.trim()
                            ? Math.max(0, numero(event.target.value))
                            : null,
                        )
                      }
                      inputMode="decimal"
                      placeholder="Sem máximo"
                      className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none placeholder:text-sky-100/30"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      Quem paga a taxa
                    </span>
                    <select
                      value={form.regraTaxa.responsavel}
                      onChange={(event) =>
                        alterarRegra(
                          "responsavel",
                          event.target.value as ResponsavelTaxaVenda,
                        )
                      }
                      className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none"
                    >
                      <option value="passageiro">Passageiro</option>
                      <option value="armador">Armador</option>
                      <option value="dividida">Dividida</option>
                    </select>
                  </label>

                  {form.regraTaxa.responsavel === "dividida" ? (
                    <label>
                      <span className="text-xs font-black uppercase text-sky-100/60">
                        Parte paga pelo passageiro
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={form.regraTaxa.percentualPagoPassageiro}
                        onChange={(event) =>
                          alterarRegra(
                            "percentualPagoPassageiro",
                            Math.min(100, Math.max(0, numero(event.target.value))),
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none"
                      />
                    </label>
                  ) : null}

                  <label>
                    <span className="text-xs font-black uppercase text-sky-100/60">
                      Base de cálculo
                    </span>
                    <select
                      value={form.regraTaxa.baseCalculo}
                      onChange={(event) =>
                        alterarRegra("baseCalculo", event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-sky-300/15 bg-[#143760] px-4 py-3 text-white outline-none"
                    >
                      <option value="somente_passagens">Somente passagens</option>
                      <option value="passagens_e_adicionais">
                        Passagens e adicionais
                      </option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="rounded-3xl border border-emerald-300/20 bg-emerald-400/[0.07] p-5">
                <h3 className="text-lg font-black">Simulação da cobrança</h3>
                <p className="mt-1 text-sm text-emerald-100/60">
                  Exemplo com 2 passagens de R$ 100,00 e R$ 20,00 de adicionais.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    ["Passagens", moeda(previa.valorPassagens)],
                    ["Taxa CMB", moeda(previa.valorTaxaTotal)],
                    ["Pago pelo passageiro", moeda(previa.totalPagoPassageiro)],
                    ["Líquido do armador", moeda(previa.valorLiquidoArmador)],
                    ["Receita CMB", moeda(previa.receitaBrutaPlataforma)],
                  ].map(([titulo, valor]) => (
                    <div
                      key={titulo}
                      className="rounded-2xl border border-white/10 bg-black/10 p-4"
                    >
                      <div className="text-[10px] font-black uppercase tracking-wide text-emerald-100/55">
                        {titulo}
                      </div>
                      <div className="mt-1 text-xl font-black">{valor}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
