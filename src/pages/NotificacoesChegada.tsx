import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

const FUNCAO_ENVIO_MANUAL =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/enviarAvisoManualChegada";

const FUNCAO_ENVIO_SEGMENTADO =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/enviarNotificacaoSegmentada";

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

type PublicoNotificacao = "todos" | "cidade" | "estado" | "comprou_barco";

const PUBLICOS_NOTIFICACAO = {
  todos: {
    titulo: "Todos",
    resumo: "Envia para todos os usuários com token ativo.",
    icone: "🌎",
  },
  cidade: {
    titulo: "Cidade",
    resumo: "Envia para usuários cadastrados em uma cidade específica.",
    icone: "📍",
  },
  estado: {
    titulo: "Estado",
    resumo: "Envia para usuários cadastrados em um estado específico.",
    icone: "🗺️",
  },
  comprou_barco: {
    titulo: "Comprou passagem",
    resumo: "Envia para quem comprou passagem de um barco específico.",
    icone: "🎟️",
  },
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
  if (s === "enviado_segmentado") return "Enviado segmentado";
  if (s === "sem_tokens") return "Sem token";
  if (s === "sem_tokens_manual") return "Sem token manual";
  if (s === "sem_tokens_segmentado") return "Sem token segmentado";

  return status || "—";
}

function normalizarTexto(valor: any) {
  return String(valor || "").trim();
}

function cidadeUsuario(usuario: any) {
  if (usuario.cidadeResidenciaCompleta) return usuario.cidadeResidenciaCompleta;

  if (usuario.cidadeResidencia && usuario.estadoResidencia) {
    return `${usuario.cidadeResidencia} - ${usuario.estadoResidencia}`;
  }

  return usuario.cidade || usuario.cidadeUsuario || "";
}

function estadoUsuario(usuario: any) {
  return (
    usuario.estadoResidencia ||
    usuario.estado ||
    usuario.uf ||
    usuario.estadoUsuario ||
    ""
  );
}

function nomeBarcoOperacao(op: any) {
  return op.nome || op.barcoNome || op.barcoId || op.id || "Barco";
}

export default function NotificacoesChegada() {
  const modal = useAppModal();
  const [operacoes, setOperacoes] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [historico, setHistorico] = useState<any[]>([]);
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState("");
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  const [mensagemExtra, setMensagemExtra] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [enviandoSegmentado, setEnviandoSegmentado] = useState(false);
  const [publicoManual, setPublicoManual] = useState<PublicoNotificacao>("todos");
  const [cidadeAlvo, setCidadeAlvo] = useState("");
  const [estadoAlvo, setEstadoAlvo] = useState("");
  const [barcoAlvo, setBarcoAlvo] = useState("");
  const [tituloSegmentado, setTituloSegmentado] = useState("Aviso importante");
  const [mensagemSegmentada, setMensagemSegmentada] = useState("");

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

    const unsubUsuarios = onSnapshot(
      collection(db, "usuarios"),
      (snapshot) => {
        setUsuarios(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        console.error("Erro ao ler usuarios:", error);
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
      unsubUsuarios();
      unsubHistorico();
      unsubConfig();
    };
  }, []);

  useEffect(() => {
    setSelecionados((atuais) => {
      const idsAtivos = new Set(historico.map((item) => item.id));
      const filtrado = Object.fromEntries(
        Object.entries(atuais).filter(([id, marcado]) => marcado && idsAtivos.has(id)),
      );

      return filtrado as Record<string, boolean>;
    });
  }, [historico]);

  const cidades = useMemo(() => {
    const lista = usuarios.map(cidadeUsuario).map(normalizarTexto).filter(Boolean);
    return Array.from(new Set(lista)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [usuarios]);

  const estados = useMemo(() => {
    const lista = usuarios.map(estadoUsuario).map(normalizarTexto).filter(Boolean);
    return Array.from(new Set(lista)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [usuarios]);

  const barcosDisponiveis = useMemo(() => {
    return operacoes
      .map((op) => ({
        id: op.barcoId || op.id,
        nome: nomeBarcoOperacao(op),
      }))
      .filter((barco) => barco.id)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [operacoes]);

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

  const historicoSelecionado = useMemo(
    () => historico.filter((item) => selecionados[item.id]),
    [historico, selecionados],
  );

  const totalSelecionado = historicoSelecionado.length;

  const todosHistoricoSelecionados =
    historico.length > 0 && historico.every((item) => selecionados[item.id]);

  const alternarSelecionado = (id: string) => {
    setSelecionados((atuais) => ({
      ...atuais,
      [id]: !atuais[id],
    }));
  };

  const alternarTodosHistorico = () => {
    if (todosHistoricoSelecionados) {
      setSelecionados({});
      return;
    }

    setSelecionados(
      historico.reduce(
        (acc, item) => {
          acc[item.id] = true;
          return acc;
        },
        {} as Record<string, boolean>,
      ),
    );
  };

  const excluirSelecionados = async () => {
    if (totalSelecionado === 0) {
      await modal.aviso(
        "Selecione notificações",
        "Marque pelo menos uma notificação do histórico para excluir.",
      );
      return;
    }

    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Excluir notificações selecionadas?",
      mensagem: `Excluir ${totalSelecionado} registro(s) do histórico?\n\nEssa ação apaga apenas os registros de notificação enviados.`,
      confirmarTexto: "Excluir",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    try {
      const batch = writeBatch(db);

      historicoSelecionado.forEach((item) => {
        batch.delete(doc(db, "notificacoes_chegada", item.id));
      });

      await batch.commit();
      setSelecionados({});
    } catch (error: any) {
      await modal.erro(
        "Erro ao excluir",
        error?.message || "Não foi possível excluir as notificações selecionadas.",
      );
    }
  };

  const salvarConfiguracaoNotificacoes = async () => {
    try {
      setSalvandoConfig(true);

      const faixasMinutos = textoParaFaixas(configNotificacoes.faixasTexto);

      if (faixasMinutos.length === 0) {
        await modal.aviso(
          "Faixas obrigatórias",
          "Informe pelo menos uma faixa de minutos. Exemplo: 60, 30, 15, 5",
        );
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

      await modal.sucesso(
        "Configurações salvas",
        "As configurações de notificações foram atualizadas.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar configurações",
        error?.message || "Não foi possível salvar as configurações.",
      );
    } finally {
      setSalvandoConfig(false);
    }
  };

  const enviarAvisoManual = async (operacao: any) => {
    try {
      setEnviandoId(operacao.id);

      const usuario = getAuth().currentUser;

      if (!usuario) {
        await modal.aviso("Login necessário", "Faça login novamente para enviar aviso.");
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
        await modal.aviso(
          "Aviso não enviado",
          `Passageiros encontrados: ${dados.passageirosEncontrados}.\nNenhum token vinculado.`,
        );
      } else {
        await modal.sucesso("Aviso enviado", `Tokens enviados: ${dados.tokensEnviados}.`);
      }

      setMensagemExtra((atual) => ({ ...atual, [operacao.id]: "" }));
    } catch (error: any) {
      await modal.erro(
        "Erro ao enviar aviso",
        error?.message || "Não foi possível enviar o aviso.",
      );
    } finally {
      setEnviandoId(null);
    }
  };

  const enviarNotificacaoSegmentada = async () => {
    const titulo = tituloSegmentado.trim();
    const mensagem = mensagemSegmentada.trim();

    if (!titulo || !mensagem) {
      await modal.aviso(
        "Mensagem obrigatória",
        "Informe o título e a mensagem da notificação.",
      );
      return;
    }

    if (publicoManual === "cidade" && !cidadeAlvo.trim()) {
      await modal.aviso("Cidade obrigatória", "Selecione ou digite a cidade.");
      return;
    }

    if (publicoManual === "estado" && !estadoAlvo.trim()) {
      await modal.aviso("Estado obrigatório", "Selecione ou digite o estado.");
      return;
    }

    if (publicoManual === "comprou_barco" && !barcoAlvo.trim()) {
      await modal.aviso("Barco obrigatório", "Selecione o barco da passagem.");
      return;
    }

    try {
      setEnviandoSegmentado(true);

      const usuario = getAuth().currentUser;

      if (!usuario) {
        await modal.aviso(
          "Login necessário",
          "Faça login novamente para enviar notificação.",
        );
        return;
      }

      const idToken = await usuario.getIdToken();

      const resposta = await fetch(FUNCAO_ENVIO_SEGMENTADO, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          publicoAlvo: publicoManual,
          cidadeAlvo: cidadeAlvo.trim(),
          estadoAlvo: estadoAlvo.trim(),
          barcoIdAlvo: barcoAlvo.trim(),
          titulo,
          mensagem,
          origem: "sistema_navegacao",
        }),
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok || dados.erro) {
        throw new Error(dados.erro || dados.detalhe || "Erro ao enviar notificação.");
      }

      await modal.sucesso(
        "Notificação enviada",
        `Usuários encontrados: ${dados.usuariosEncontrados ?? "—"}\nTokens enviados: ${dados.tokensEnviados ?? "—"}`,
      );

      setMensagemSegmentada("");
    } catch (error: any) {
      await modal.erro(
        "Erro ao enviar notificação",
        error?.message ||
          "Não foi possível enviar. Verifique se a função enviarNotificacaoSegmentada já foi publicada no Firebase Functions.",
      );
    } finally {
      setEnviandoSegmentado(false);
    }
  };

  const removerNotificacaoHistorico = async (item: any) => {
    try {
      await deleteDoc(doc(db, "notificacoes_chegada", item.id));
      setSelecionados((atuais) => {
        const copia = { ...atuais };
        delete copia[item.id];
        return copia;
      });
    } catch (error: any) {
      await modal.erro(
        "Erro ao remover",
        error?.message || "Não foi possível remover a notificação.",
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0d0c2c] p-4 text-white">
      <div className="mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">
            Sistema de Navegação
          </p>
        </div>

        <div className="w-full xl:w-[360px]">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar barco, porto ou cidade..."
            className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
          />
        </div>
      </div>

      {erro && (
        <div className="mb-3 shrink-0 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
          {erro}
        </div>
      )}

      <main className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div className="grid shrink-0 gap-3 xl:grid-cols-[minmax(0,1fr)_210px]">
            <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3.5">
              <div className="mb-3">
                <h2 className="text-base font-black leading-none">Envio segmentado</h2>
              </div>

              <div className="grid items-start gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
                <div className="grid content-start grid-cols-2 gap-2">
                  {(Object.keys(PUBLICOS_NOTIFICACAO) as PublicoNotificacao[]).map(
                    (tipo) => {
                      const ativo = publicoManual === tipo;
                      const item = PUBLICOS_NOTIFICACAO[tipo];

                      return (
                        <button
                          key={tipo}
                          type="button"
                          onClick={() => setPublicoManual(tipo)}
                          className={[
                            "h-[40px] rounded-xl border px-3 text-left transition",
                            ativo
                              ? "border-sky-300/45 bg-sky-400/15 shadow-[0_0_0_1px_rgba(56,189,248,0.08)]"
                              : "border-[#7ba6d4]/20 bg-[#143760] hover:bg-[#17345e]",
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{item.icone}</span>
                            <span className="truncate text-[11px] font-black text-white">
                              {item.titulo}
                            </span>
                          </div>
                        </button>
                      );
                    },
                  )}
                </div>

                <div className="min-w-0">
                  <div className="grid gap-2 md:grid-cols-[minmax(210px,260px)_minmax(230px,300px)]">
                    <label>
                      <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
                        Título
                      </p>
                      <input
                        value={tituloSegmentado}
                        onChange={(e) => setTituloSegmentado(e.target.value)}
                        placeholder="Aviso importante"
                        className="h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                      />
                    </label>

                    {publicoManual === "cidade" && (
                      <label>
                        <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
                          Cidade
                        </p>
                        <input
                          value={cidadeAlvo}
                          onChange={(e) => setCidadeAlvo(e.target.value)}
                          list="cidades-notificacoes"
                          placeholder="Juruti - PA"
                          className="h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                        />
                        <datalist id="cidades-notificacoes">
                          {cidades.map((cidade) => (
                            <option key={cidade} value={cidade} />
                          ))}
                        </datalist>
                      </label>
                    )}

                    {publicoManual === "estado" && (
                      <label>
                        <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
                          Estado
                        </p>
                        <input
                          value={estadoAlvo}
                          onChange={(e) => setEstadoAlvo(e.target.value)}
                          list="estados-notificacoes"
                          placeholder="PA"
                          className="h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                        />
                        <datalist id="estados-notificacoes">
                          {estados.map((estado) => (
                            <option key={estado} value={estado} />
                          ))}
                        </datalist>
                      </label>
                    )}

                    {publicoManual === "comprou_barco" && (
                      <label>
                        <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
                          Barco
                        </p>
                        <select
                          value={barcoAlvo}
                          onChange={(e) => setBarcoAlvo(e.target.value)}
                          className="h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                        >
                          <option value="">Selecione</option>
                          {barcosDisponiveis.map((barco) => (
                            <option key={barco.id} value={barco.id}>
                              {barco.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {publicoManual === "todos" && (
                      <div>
                        <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
                          Público
                        </p>
                        <div className="flex h-9 items-center rounded-xl border border-[#7ba6d4]/20 bg-[#143760] px-3 text-xs font-black text-white">
                          Todos com token ativo
                        </div>
                      </div>
                    )}
                  </div>

                  <label className="mt-2 block">
                    <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
                      Mensagem
                    </p>
                    <textarea
                      value={mensagemSegmentada}
                      onChange={(e) => setMensagemSegmentada(e.target.value)}
                      rows={3}
                      placeholder="Digite a mensagem que será enviada por push..."
                      className="min-h-[72px] w-full resize-none rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-2 text-sm font-bold leading-5 text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                    />
                  </label>

                  <div className="mt-2 flex items-center justify-between gap-3">
                    <button
                      onClick={enviarNotificacaoSegmentada}
                      disabled={enviandoSegmentado}
                      className="h-10 min-w-[118px] rounded-xl border border-sky-300/25 bg-[#2b5b91] px-5 text-[10px] font-black uppercase text-white transition hover:bg-[#346aa3] disabled:opacity-60"
                    >
                      {enviandoSegmentado ? "Enviando..." : "Enviar"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid content-start gap-2 rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
              <CardResumo icone="🚢" label="Barcos monitorados" valor={resumo.barcos} />
              <CardResumo
                icone="⏱️"
                label="Chegando em até 60min"
                valor={resumo.chegando}
              />
              <CardResumo icone="✅" label="Avisos enviados" valor={resumo.enviados} />
              <CardResumo icone="⚠️" label="Sem token" valor={resumo.semToken} />
            </section>
          </div>

          <details className="shrink-0 rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black leading-none">
                  Automação inteligente
                </h2>
                <p className="mt-1 text-[11px] text-sky-100/45">
                  Configurações automáticas de chegada.
                </p>
              </div>

              <button
                onClick={(e) => {
                  e.preventDefault();
                  salvarConfiguracaoNotificacoes();
                }}
                disabled={salvandoConfig}
                className="h-9 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 text-[10px] font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
              >
                {salvandoConfig ? "Salvando..." : "Salvar"}
              </button>
            </summary>

            <div className="mt-3 grid gap-2 xl:grid-cols-[220px_220px_minmax(0,1fr)]">
              <label className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase text-sky-100/55">
                      Automático
                    </p>
                    <p className="mt-0.5 text-[10px] text-sky-100/35">
                      Enviar sem ação manual
                    </p>
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
                    className="h-4 w-4"
                  />
                </div>
              </label>

              <label className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase text-sky-100/55">
                      Só online
                    </p>
                    <p className="mt-0.5 text-[10px] text-sky-100/35">
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
                    className="h-4 w-4"
                  />
                </div>
              </label>

              <label>
                <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
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
                  className="h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                />
              </label>
            </div>

            <div className="mt-2 grid gap-2 xl:grid-cols-2">
              <label>
                <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
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
                  className="h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                />
              </label>

              <label>
                <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
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
                  className="h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                />
              </label>

              <label>
                <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
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
                  rows={2}
                  className="w-full resize-none rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                />
              </label>

              <label>
                <p className="mb-1 text-[8px] font-black uppercase tracking-wide text-sky-100/45">
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
                  rows={2}
                  className="w-full resize-none rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                />
              </label>
            </div>
          </details>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
            <div className="shrink-0 flex items-center justify-between border-b border-[#7ba6d4]/15 px-4 py-2.5">
              <div>
                <h2 className="text-base font-black">Barcos e avisos manuais</h2>
                <p className="mt-0.5 text-[11px] text-sky-100/45">
                  Reforce a chegada de um barco manualmente.
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-none">
              {filtradas.map((op) => {
                const chegando = Number(op.previsaoMinutos) <= 60;

                return (
                  <div
                    key={op.id}
                    className="mb-2 rounded-xl border border-[#7ba6d4]/15 bg-[#143760] p-3"
                  >
                    <div className="grid gap-3 xl:grid-cols-[1fr_170px]">
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

                        <div className="mt-2 grid gap-2 md:grid-cols-4">
                          <InfoMini
                            label="Próximo porto"
                            valor={op.proximoPortoNome || "—"}
                          />
                          <InfoMini label="Cidade" valor={op.proximoPortoCidade || "—"} />
                          <InfoMini
                            label="Distância"
                            valor={op.distanciaKm ? `${op.distanciaKm} km` : "—"}
                          />
                          <InfoMini
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
                          className="mt-2 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-2 text-sm text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                        />
                      </div>

                      <div className="flex flex-col justify-between gap-2">
                        <button
                          onClick={() => enviarAvisoManual(op)}
                          disabled={enviandoId === op.id}
                          className="h-9 rounded-xl border border-sky-300/25 bg-sky-400/10 px-3 text-[10px] font-black uppercase text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {enviandoId === op.id ? "Enviando..." : "Enviar aviso"}
                        </button>

                        <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] p-2">
                          <p className="text-[8px] font-black uppercase text-sky-100/45">
                            Atualizado
                          </p>
                          <p className="mt-0.5 text-xs font-bold text-sky-100">
                            {formatarData(op.atualizadoEm)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filtradas.length === 0 && (
                <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sky-100/55">
                  Nenhuma operação encontrada.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-black leading-none">Histórico</h2>
                <p className="mt-1 truncate text-[10px] text-sky-100/45">
                  Avisos automáticos, manuais e segmentados.
                </p>
              </div>

              <span className="shrink-0 rounded-full border border-[#7ba6d4]/20 bg-[#143760] px-2.5 py-1 text-[9px] font-black uppercase text-sky-100/55">
                {historico.length}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={alternarTodosHistorico}
                className="h-8 rounded-lg border border-[#7ba6d4]/20 bg-[#143760] px-3 text-[9px] font-black uppercase text-sky-100/65 transition hover:bg-[#17345e]"
              >
                {todosHistoricoSelecionados ? "Limpar" : "Selecionar"}
              </button>

              <button
                type="button"
                onClick={excluirSelecionados}
                disabled={totalSelecionado === 0}
                className="h-8 rounded-lg border border-red-400/20 bg-red-400/10 px-3 text-[9px] font-black uppercase text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Excluir {totalSelecionado > 0 ? `(${totalSelecionado})` : ""}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-none">
            {historico.map((item) => {
              const marcado = !!selecionados[item.id];

              return (
                <div
                  key={item.id}
                  className={[
                    "mb-2 rounded-xl border p-2.5 transition",
                    marcado
                      ? "border-sky-300/45 bg-[#2b5b91]/35"
                      : "border-[#7ba6d4]/15 bg-[#143760]",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => alternarSelecionado(item.id)}
                      className="mt-1 h-4 w-4 shrink-0"
                      aria-label="Selecionar notificação"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">
                            {item.barcoNome ||
                              item.barcoId ||
                              item.titulo ||
                              "Notificação"}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-sky-100/50">
                            {item.proximoPortoNome ||
                              item.publicoAlvo ||
                              "Porto não informado"}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removerNotificacaoHistorico(item)}
                          className="shrink-0 rounded-lg border border-red-400/20 bg-red-400/10 px-2 py-1 text-[8px] font-black uppercase text-red-300 transition hover:bg-red-400/20"
                          title="Remover do histórico"
                        >
                          Excluir
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className={[
                            "rounded-full border px-2 py-0.5 text-[8px] font-black uppercase",
                            badgeStatus(item.status),
                          ].join(" ")}
                        >
                          {textoStatus(item.status)}
                        </span>

                        <span className="rounded-full border border-[#7ba6d4]/20 bg-[#17345e] px-2 py-0.5 text-[8px] font-black uppercase text-sky-100/50">
                          {formatarData(item.criadoEm)}
                        </span>

                        <span className="rounded-full border border-[#7ba6d4]/20 bg-[#17345e] px-2 py-0.5 text-[8px] font-black uppercase text-sky-100/50">
                          Tokens {item.tokensEnviados ?? "—"}
                        </span>
                      </div>

                      {item.mensagem && (
                        <p className="mt-2 line-clamp-2 rounded-lg border border-[#7ba6d4]/15 bg-[#17345e] p-2 text-[11px] leading-4 text-sky-100/65">
                          {item.mensagem}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {historico.length === 0 && (
              <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sky-100/55">
                Nenhum aviso registrado ainda.
              </div>
            )}
          </div>
        </section>
      </main>
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
    <div className="flex h-[50px] items-center gap-2.5 rounded-xl border border-[#7ba6d4]/20 bg-[#143760] px-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-400/10 text-sm">
        {icone}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-black leading-none text-white">{valor}</p>
        <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-wide text-sky-100/45">
          {label}
        </p>
      </div>
    </div>
  );
}

function InfoMini({
  label,
  valor,
  destaque = false,
}: {
  label: string;
  valor: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#7ba6d4]/15 bg-[#17345e] p-2">
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
