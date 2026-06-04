import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../config/firebase";

const FUNCAO_ENVIO_MANUAL =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/enviarAvisoManualChegada";

const CONFIG_PADRAO_NOTIFICACOES = {
  automaticoAtivo: true,
  notificarSomenteOnline: true,
  faixasMinutos: [60, 30, 15, 5],
  tituloAutomatico: "Olá, {nome}",
  mensagemAutomatica:
    "{nome}, {barco} deve chegar em {porto} em aproximadamente {tempo}.",
  tituloManual: "Olá, {nome}",
  mensagemManualPadrao:
    "{nome}, {barco} deve chegar em {porto} em aproximadamente {tempo}.",
};

function faixasParaTexto(faixas: any) {
  const lista = Array.isArray(faixas) ? faixas : CONFIG_PADRAO_NOTIFICACOES.faixasMinutos;
  return lista.join(", ");
}

function textoParaFaixas(texto: string) {
  const faixas = texto
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0 && item <= 240)
    .map((item) => Math.round(item));

  return Array.from(new Set(faixas)).sort((a, b) => b - a);
}

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
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function dataMs(valor: any) {
  try {
    const data =
      typeof valor?.toDate === "function"
        ? valor.toDate()
        : valor
          ? new Date(valor)
          : null;

    if (!data || Number.isNaN(data.getTime())) return 0;
    return data.getTime();
  } catch {
    return 0;
  }
}

function badgeStatus(status: string) {
  const s = String(status || "").toLowerCase();

  if (s.includes("enviado")) {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }

  if (s.includes("sem_tokens")) {
    return "border-amber-400/20 bg-amber-400/10 text-amber-300";
  }

  if (s.includes("erro")) {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }

  return "border-slate-600/30 bg-slate-800 text-slate-300";
}

function textoStatus(status: string) {
  const s = String(status || "").toLowerCase();

  if (s === "enviado") return "Enviado automático";
  if (s === "enviado_manual") return "Enviado manual";
  if (s === "sem_tokens") return "Sem token";
  if (s === "sem_tokens_manual") return "Sem token manual";

  return status || "—";
}

export default function NotificacoesChegada() {
  const [operacoes, setOperacoes] = useState<any[]>([]);
  const [historico, setHistorico] = useState<any[]>([]);
  const [busca, setBusca] = useState("");
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  const [mensagemExtra, setMensagemExtra] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [configNotificacoes, setConfigNotificacoes] = useState({
    ...CONFIG_PADRAO_NOTIFICACOES,
    faixasTexto: faixasParaTexto(CONFIG_PADRAO_NOTIFICACOES.faixasMinutos),
  });

  useEffect(() => {
    const unsubOperacoes = onSnapshot(
      collection(db, "operacao_barcos"),
      (snapshot) => {
        setOperacoes(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        console.error("Erro ao ler operacao_barcos:", error);
        setErro(
          "Não foi possível ler operacao_barcos. Verifique as regras do Firestore para esta coleção.",
        );
      },
    );

    const unsubHistorico = onSnapshot(
      collection(db, "notificacoes_chegada"),
      (snapshot) => {
        const lista = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a: any, b: any) => dataMs(b.criadoEm) - dataMs(a.criadoEm))
          .slice(0, 80);

        setHistorico(lista);
      },
      (error) => {
        console.error("Erro ao ler notificacoes_chegada:", error);
        setErro(
          "Não foi possível ler notificacoes_chegada. Verifique as regras do Firestore para esta coleção.",
        );
      },
    );

    const unsubConfig = onSnapshot(
      doc(db, "configuracoes", "notificacoes_chegada"),
      (snapshot) => {
        const dados = snapshot.exists() ? snapshot.data() : {};

        setConfigNotificacoes({
          automaticoAtivo:
            typeof dados.automaticoAtivo === "boolean"
              ? dados.automaticoAtivo
              : CONFIG_PADRAO_NOTIFICACOES.automaticoAtivo,
          notificarSomenteOnline:
            typeof dados.notificarSomenteOnline === "boolean"
              ? dados.notificarSomenteOnline
              : CONFIG_PADRAO_NOTIFICACOES.notificarSomenteOnline,
          faixasMinutos: Array.isArray(dados.faixasMinutos)
            ? dados.faixasMinutos
            : CONFIG_PADRAO_NOTIFICACOES.faixasMinutos,
          faixasTexto: faixasParaTexto(dados.faixasMinutos),
          tituloAutomatico:
            dados.tituloAutomatico || CONFIG_PADRAO_NOTIFICACOES.tituloAutomatico,
          mensagemAutomatica:
            dados.mensagemAutomatica || CONFIG_PADRAO_NOTIFICACOES.mensagemAutomatica,
          tituloManual: dados.tituloManual || CONFIG_PADRAO_NOTIFICACOES.tituloManual,
          mensagemManualPadrao:
            dados.mensagemManualPadrao || CONFIG_PADRAO_NOTIFICACOES.mensagemManualPadrao,
        });
      },
      (error) => {
        console.error("Erro ao ler configuração de notificações:", error);
      },
    );

    return () => {
      unsubOperacoes();
      unsubHistorico();
      unsubConfig();
    };
  }, []);

  const filtradas = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return operacoes
      .filter((op) => {
        if (!texto) return true;

        return [
          op.id,
          op.barcoId,
          op.nome,
          op.proximoPortoNome,
          op.proximoPortoCidade,
          op.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(texto);
      })
      .sort((a, b) => {
        const ma = Number(a.previsaoMinutos ?? 999999);
        const mb = Number(b.previsaoMinutos ?? 999999);
        return ma - mb;
      });
  }, [operacoes, busca]);

  const resumo = useMemo(() => {
    return {
      barcos: operacoes.length,
      chegando: operacoes.filter((op) => Number(op.previsaoMinutos) <= 60).length,
      enviados: historico.filter((h) => String(h.status || "").includes("enviado"))
        .length,
      semToken: historico.filter((h) => String(h.status || "").includes("sem_tokens"))
        .length,
    };
  }, [operacoes, historico]);

  const salvarConfiguracaoNotificacoes = async () => {
    try {
      setSalvandoConfig(true);

      const faixasMinutos = textoParaFaixas(configNotificacoes.faixasTexto);

      if (faixasMinutos.length === 0) {
        alert("Informe pelo menos uma faixa de minutos. Exemplo: 60, 30, 15, 5");
        return;
      }

      await setDoc(
        doc(db, "configuracoes", "notificacoes_chegada"),
        {
          automaticoAtivo: configNotificacoes.automaticoAtivo,
          notificarSomenteOnline: configNotificacoes.notificarSomenteOnline,
          faixasMinutos,
          tituloAutomatico: configNotificacoes.tituloAutomatico,
          mensagemAutomatica: configNotificacoes.mensagemAutomatica,
          tituloManual: configNotificacoes.tituloManual,
          mensagemManualPadrao: configNotificacoes.mensagemManualPadrao,
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Configurações salvas com sucesso.");
    } catch (error: any) {
      alert(error?.message || "Erro ao salvar configurações.");
    } finally {
      setSalvandoConfig(false);
    }
  };

  const enviarAvisoManual = async (operacao: any) => {
    try {
      setEnviandoId(operacao.id);

      const usuario = getAuth().currentUser;

      if (!usuario) {
        alert("Faça login novamente para enviar aviso.");
        return;
      }

      const idToken = await usuario.getIdToken();

      const resposta = await fetch(FUNCAO_ENVIO_MANUAL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          barcoId: operacao.barcoId || operacao.id,
          mensagemExtra: mensagemExtra[operacao.id] || "",
        }),
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok || dados.erro) {
        throw new Error(dados.erro || dados.detalhe || "Erro ao enviar aviso.");
      }

      if (dados.status === "sem_tokens") {
        alert(
          `Aviso não enviado: passageiros encontrados ${dados.passageirosEncontrados}, mas nenhum token vinculado.`,
        );
      } else {
        alert(`Aviso enviado com sucesso. Tokens enviados: ${dados.tokensEnviados}.`);
      }

      setMensagemExtra((atual) => ({ ...atual, [operacao.id]: "" }));
    } catch (error: any) {
      alert(error?.message || "Erro ao enviar aviso.");
    } finally {
      setEnviandoId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950 p-6 text-white">
      <div className="mb-6 shrink-0 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-sky-400">
            Sistema de Navegação
          </p>
          <h1 className="mt-2 text-3xl font-black text-white">Notificações</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Acompanhe avisos automáticos de chegada e envie notificações manuais para
            passageiros com passagem aprovada.
          </p>
        </div>

        <div className="w-full xl:w-[360px]">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar barco, porto ou cidade..."
            className="w-full rounded-2xl border border-white/5 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
          />
        </div>
      </div>

      {erro && (
        <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          {erro}
        </div>
      )}

      <div className="mb-6 shrink-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <CardResumo icone="🚢" label="Barcos monitorados" valor={resumo.barcos} />
        <CardResumo icone="⏱️" label="Chegando em até 60min" valor={resumo.chegando} />
        <CardResumo icone="✅" label="Avisos enviados" valor={resumo.enviados} />
        <CardResumo icone="⚠️" label="Sem token" valor={resumo.semToken} />
      </div>

      <section className="mb-6 shrink-0 rounded-3xl border border-white/5 bg-slate-900/60 p-5">
        <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-black">Automação inteligente</h2>
            <p className="mt-1 text-xs text-slate-500">
              Personalize os avisos automáticos para todos os barcos. Use variáveis:{" "}
              <b className="text-slate-300">{"{nome}"}</b>,{" "}
              <b className="text-slate-300">{"{barco}"}</b>,{" "}
              <b className="text-slate-300">{"{porto}"}</b>,{" "}
              <b className="text-slate-300">{"{tempo}"}</b>,{" "}
              <b className="text-slate-300">{"{cidade}"}</b>.
            </p>
          </div>

          <button
            onClick={salvarConfiguracaoNotificacoes}
            disabled={salvandoConfig}
            className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-60"
          >
            {salvandoConfig ? "Salvando..." : "Salvar automação"}
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-4">
          <label className="rounded-2xl border border-white/5 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-slate-400">Automático</p>
                <p className="mt-1 text-[11px] text-slate-600">Enviar sem ação manual</p>
              </div>
              <input
                type="checkbox"
                checked={configNotificacoes.automaticoAtivo}
                onChange={(e) =>
                  setConfigNotificacoes((atual) => ({
                    ...atual,
                    automaticoAtivo: e.target.checked,
                  }))
                }
                className="h-5 w-5"
              />
            </div>
          </label>

          <label className="rounded-2xl border border-white/5 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-slate-400">Só online</p>
                <p className="mt-1 text-[11px] text-slate-600">
                  Evita aviso com sinal ruim
                </p>
              </div>
              <input
                type="checkbox"
                checked={configNotificacoes.notificarSomenteOnline}
                onChange={(e) =>
                  setConfigNotificacoes((atual) => ({
                    ...atual,
                    notificarSomenteOnline: e.target.checked,
                  }))
                }
                className="h-5 w-5"
              />
            </div>
          </label>

          <label className="xl:col-span-2">
            <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
              Faixas de aviso em minutos
            </p>
            <input
              value={configNotificacoes.faixasTexto}
              onChange={(e) =>
                setConfigNotificacoes((atual) => ({
                  ...atual,
                  faixasTexto: e.target.value,
                }))
              }
              placeholder="60, 30, 15, 5"
              className="w-full rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <label>
            <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
              Título automático
            </p>
            <input
              value={configNotificacoes.tituloAutomatico}
              onChange={(e) =>
                setConfigNotificacoes((atual) => ({
                  ...atual,
                  tituloAutomatico: e.target.value,
                }))
              }
              className="w-full rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
            />
          </label>

          <label>
            <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
              Título manual
            </p>
            <input
              value={configNotificacoes.tituloManual}
              onChange={(e) =>
                setConfigNotificacoes((atual) => ({
                  ...atual,
                  tituloManual: e.target.value,
                }))
              }
              className="w-full rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
            />
          </label>

          <label>
            <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
              Mensagem automática
            </p>
            <textarea
              value={configNotificacoes.mensagemAutomatica}
              onChange={(e) =>
                setConfigNotificacoes((atual) => ({
                  ...atual,
                  mensagemAutomatica: e.target.value,
                }))
              }
              rows={3}
              className="w-full resize-none rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
            />
          </label>

          <label>
            <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
              Mensagem manual padrão
            </p>
            <textarea
              value={configNotificacoes.mensagemManualPadrao}
              onChange={(e) =>
                setConfigNotificacoes((atual) => ({
                  ...atual,
                  mensagemManualPadrao: e.target.value,
                }))
              }
              rows={3}
              className="w-full resize-none rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
            />
          </label>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[1.45fr_0.95fr]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/5 bg-slate-900/60">
          <div className="shrink-0 flex items-center justify-between border-b border-white/5 px-5 py-4">
            <div>
              <h2 className="text-lg font-black">Barcos e avisos manuais</h2>
              <p className="mt-1 text-xs text-slate-500">
                Use o botão manual quando quiser reforçar a chegada de um barco.
              </p>
            </div>
            <span className="text-xl">📡</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 custom-scrollbar">
            {filtradas.map((op) => {
              const chegando = Number(op.previsaoMinutos) <= 60;

              return (
                <div
                  key={op.id}
                  className="mb-3 rounded-2xl border border-white/5 bg-slate-950/70 p-4"
                >
                  <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-black text-white">
                          {op.nome || op.barcoId || op.id}
                        </h3>
                        <span
                          className={[
                            "rounded-full border px-2.5 py-1 text-[10px] font-black uppercase",
                            op.status === "online"
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                              : op.status === "sem_sinal"
                                ? "border-slate-500/20 bg-slate-500/10 text-slate-300"
                                : "border-red-400/20 bg-red-400/10 text-red-300",
                          ].join(" ")}
                        >
                          {op.status || "—"}
                        </span>
                        {chegando && (
                          <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-sky-300">
                            Próximo
                          </span>
                        )}
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-4">
                        <MiniInfo
                          label="Próximo porto"
                          valor={op.proximoPortoNome || "—"}
                        />
                        <MiniInfo label="Cidade" valor={op.proximoPortoCidade || "—"} />
                        <MiniInfo
                          label="Distância"
                          valor={op.distanciaKm ? `${op.distanciaKm} km` : "—"}
                        />
                        <MiniInfo
                          label="Previsão"
                          valor={op.previsaoTexto || "—"}
                          destaque
                        />
                      </div>

                      <input
                        value={mensagemExtra[op.id] || ""}
                        onChange={(e) =>
                          setMensagemExtra((atual) => ({
                            ...atual,
                            [op.id]: e.target.value,
                          }))
                        }
                        placeholder="Mensagem personalizada opcional..."
                        className="mt-4 w-full rounded-xl border border-white/5 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
                      />
                    </div>

                    <div className="flex flex-col justify-between gap-3">
                      <button
                        onClick={() => enviarAvisoManual(op)}
                        disabled={enviandoId === op.id}
                        className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-xs font-black uppercase text-sky-200 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {enviandoId === op.id ? "Enviando..." : "Enviar aviso"}
                      </button>

                      <div className="rounded-xl border border-white/5 bg-slate-900 p-3">
                        <p className="text-[10px] font-black uppercase text-slate-500">
                          Atualizado
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-300">
                          {formatarData(op.atualizadoEm)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {filtradas.length === 0 && (
              <div className="rounded-2xl border border-white/5 bg-slate-950 p-8 text-center text-slate-500">
                Nenhuma operação encontrada.
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/5 bg-slate-900/60">
          <div className="shrink-0 flex items-center justify-between border-b border-white/5 px-5 py-4">
            <div>
              <h2 className="text-lg font-black">Histórico</h2>
              <p className="mt-1 text-xs text-slate-500">
                Últimos avisos automáticos e manuais.
              </p>
            </div>
            <span className="text-xl">🔔</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 custom-scrollbar">
            {historico.map((item) => (
              <div
                key={item.id}
                className="mb-3 rounded-2xl border border-white/5 bg-slate-950/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">
                      {item.barcoNome || item.barcoId || "Barco"}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {item.proximoPortoNome || "Porto não informado"}
                    </p>
                  </div>

                  <span
                    className={[
                      "shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase",
                      badgeStatus(item.status),
                    ].join(" ")}
                  >
                    {textoStatus(item.status)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniInfo
                    label="Passageiros"
                    valor={item.passageirosEncontrados ?? "—"}
                  />
                  <MiniInfo label="Tokens" valor={item.tokensEnviados ?? "—"} />
                  <MiniInfo label="Quando" valor={formatarData(item.criadoEm)} />
                </div>

                {item.mensagem && (
                  <p className="mt-3 rounded-xl border border-white/5 bg-slate-900 p-3 text-xs leading-5 text-slate-400">
                    {item.mensagem}
                  </p>
                )}
              </div>
            ))}

            {historico.length === 0 && (
              <div className="rounded-2xl border border-white/5 bg-slate-950 p-8 text-center text-slate-500">
                Nenhum aviso registrado ainda.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CardResumo({
  icone,
  label,
  valor,
}: {
  icone: string;
  label: string;
  valor: number;
}) {
  return (
    <div className="rounded-3xl border border-white/5 bg-slate-900/70 p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-400/10 text-xl">
        {icone}
      </div>
      <p className="text-2xl font-black text-white">{valor}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
    </div>
  );
}

function MiniInfo({
  label,
  valor,
  destaque = false,
}: {
  label: string;
  valor: any;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/5 bg-slate-900/80 p-3">
      <p className="text-[9px] font-black uppercase text-slate-600">{label}</p>
      <p
        className={[
          "mt-1 truncate text-sm font-black",
          destaque ? "text-emerald-300" : "text-slate-200",
        ].join(" ")}
      >
        {valor}
      </p>
    </div>
  );
}
