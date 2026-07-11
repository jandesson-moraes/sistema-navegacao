import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type Rastreador = {
  id: string;
  deviceId?: string;
  barcoId?: string;
  embarcacaoNome?: string;
  nomeNaRede?: string;
  wifiNome?: string;
  status?: string;
  ultimoSinal?: string;
  ipLocal?: string;
  rssi?: number;
  satelites?: number;
  versaoFirmware?: string;
  networkStatus?: any;
  rastreadorNetworkStatus?: any;
  macCliente?: string;
  macConfiguracao?: string;
  macAddress?: string;
  ativo?: boolean;
  apelido?: string;
  observacoes?: string;
  barcoIdAdmin?: string;
  ultima_posicao?: { latitude?: number; longitude?: number };
  comandoOperacionalPendente?: any;
  comandoOperacionalStatus?: any;
};

type Editando = {
  id: string;
  apelido: string;
  barcoIdAdmin: string;
  observacoes: string;
  ativo: boolean;
};

function statusRastreador(r: Rastreador) {
  const data = new Date(String(r.ultimoSinal || "")).getTime();

  if (!r.ultimoSinal || Number.isNaN(data)) {
    return { label: "Sem horário", tone: "slate", ordem: 3 };
  }

  const diff = (Date.now() - data) / 1000;

  if (diff <= 120) return { label: "Online", tone: "emerald", ordem: 0 };
  if (diff <= 600) return { label: "Sem sinal", tone: "amber", ordem: 1 };

  return { label: "Offline", tone: "red", ordem: 2 };
}

function parseData(valor: any): Date | null {
  try {
    if (!valor) return null;

    if (typeof valor?.toDate === "function") {
      const data = valor.toDate();
      return Number.isNaN(data.getTime()) ? null : data;
    }

    if (typeof valor === "number") {
      const data = new Date(valor < 10000000000 ? valor * 1000 : valor);
      return Number.isNaN(data.getTime()) ? null : data;
    }

    const data = new Date(String(valor));
    return Number.isNaN(data.getTime()) ? null : data;
  } catch {
    return null;
  }
}

function formatarData(valor?: any) {
  const data = parseData(valor);

  if (!data) return valor ? String(valor) : "—";

  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function qualidadeWifi(rssi?: number) {
  const valor = Number(rssi || 0);

  if (!valor) return "—";
  if (valor >= -55) return "Excelente";
  if (valor >= -67) return "Bom";
  if (valor >= -75) return "Fraco";

  return "Muito fraco";
}

function obterNetworkStatus(r: Rastreador | null) {
  return r?.networkStatus || r?.rastreadorNetworkStatus || {};
}

function obterWifiNome(r: Rastreador) {
  const status = obterNetworkStatus(r);
  return r.wifiNome || status.ssidAtual || status.currentSSID || "—";
}

function obterRssi(r: Rastreador) {
  const status = obterNetworkStatus(r);
  return Number(r.rssi ?? status.rssi ?? 0) || undefined;
}

function obterMacCliente(r: Rastreador | null) {
  const status = obterNetworkStatus(r);
  return status.macCliente || status.macClient || r?.macCliente || r?.macAddress || "—";
}

function obterMacConfiguracao(r: Rastreador | null) {
  const status = obterNetworkStatus(r);
  return status.macConfiguracao || status.macConfig || r?.macConfiguracao || "—";
}

function textoStatusBoolean(valor: any) {
  if (valor === true) return "OK";
  if (valor === false) return "Falhou";
  return "—";
}

function montarInstrucaoGerente(r: Rastreador | null) {
  const mac = obterMacCliente(r);
  const rede = r ? obterWifiNome(r) : "rede do barco";

  return [
    "Olá, tudo bem?",
    "",
    "Para o rastreador GPS do Cadê Meu Barco funcionar na rede da embarcação, precisamos liberar o dispositivo no hotspot como bypass/whitelist/IP Binding.",
    "",
    `Rede/SSID: ${rede}`,
    `MAC do GPS: ${mac}`,
    "",
    "O GPS não abre tela de login de hotspot como um celular. Ele precisa conectar ao Wi‑Fi e ter acesso direto à internet para enviar a localização ao sistema.",
    "",
    "Se for MikroTik, normalmente fica em IP > Hotspot > IP Bindings > Add, informando o MAC do GPS e Type: bypassed.",
    "",
    "O dispositivo envia apenas dados técnicos e localização para o Firebase. Ele não acessa rede interna e não interfere na internet dos passageiros.",
  ].join("\n");
}

function mensagemComando(tipo: string) {
  if (tipo === "reiniciar")
    return "Reiniciar o rastreador agora? Ele ficará offline por alguns segundos.";
  if (tipo === "reconectar_wifi")
    return "Forçar reconexão do Wi‑Fi agora? Use quando a Starlink/roteador voltou, mas o GPS não retomou.";
  if (tipo === "testar_internet") return "Pedir um diagnóstico de internet agora?";
  return "Enviar comando ao rastreador?";
}

function tituloComando(tipo: string) {
  if (tipo === "reiniciar") return "Reiniciar rastreador";
  if (tipo === "reconectar_wifi") return "Reconectar Wi‑Fi";
  if (tipo === "testar_internet") return "Testar internet";
  return "Comando remoto";
}

function Badge({ status }: { status: ReturnType<typeof statusRastreador> }) {
  const classes: Record<string, string> = {
    emerald: "border-emerald-300/70 bg-emerald-100 text-emerald-800",
    amber: "border-amber-300/70 bg-amber-100 text-amber-800",
    red: "border-red-300/70 bg-red-100 text-red-800",
    slate: "border-slate-300 bg-slate-100 text-slate-700",
  };

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${classes[status.tone]}`}
    >
      {status.label}
    </span>
  );
}

function InfoMini({
  label,
  valor,
  tom = "blue",
}: {
  label: string;
  valor: any;
  tom?: "blue" | "green" | "amber" | "red";
}) {
  const estilos = {
    blue: "border-[#7ba6d4]/30 bg-[#123761] text-sky-100",
    green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    red: "border-red-400/25 bg-red-400/10 text-red-100",
  };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${estilos[tom]}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
        {label}
      </p>
      <p className="mt-2 text-xl font-black text-white sm:text-2xl">{valor}</p>
    </div>
  );
}

function CampoInfo({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-2xl border border-[#9db9d8]/20 bg-[#0d0c2c]/55 p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/45">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-bold text-sky-50">{value}</p>
    </div>
  );
}

export default function Rastreadores() {
  const modal = useAppModal();

  const [rastreadores, setRastreadores] = useState<Rastreador[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [detalhe, setDetalhe] = useState<Rastreador | null>(null);
  const [editando, setEditando] = useState<Editando | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "rastreadores"), orderBy("ultimoSinal", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setRastreadores(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })) as Rastreador[],
        );
        setCarregando(false);
      },
      (error) => {
        console.error("Erro ao carregar rastreadores:", error);
        setCarregando(false);
      },
    );

    return () => unsub();
  }, []);

  const dados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    const lista = rastreadores
      .map((r) => ({ ...r, _status: statusRastreador(r) }))
      .filter((r: any) => {
        if (filtroStatus !== "todos") {
          const s = String(r._status.label).toLowerCase();

          if (filtroStatus === "online" && s !== "online") return false;
          if (filtroStatus === "sem_sinal" && s !== "sem sinal") return false;
          if (filtroStatus === "offline" && s !== "offline") return false;
        }

        if (!texto) return true;

        return [
          r.id,
          r.deviceId,
          r.barcoId,
          r.barcoIdAdmin,
          r.nomeNaRede,
          r.wifiNome,
          obterNetworkStatus(r).ssidAtual,
          obterMacCliente(r),
          r.apelido,
          r.ipLocal,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(texto);
      })
      .sort((a: any, b: any) => a._status.ordem - b._status.ordem);

    return {
      lista,
      total: rastreadores.length,
      online: rastreadores.filter((r) => statusRastreador(r).label === "Online").length,
      semSinal: rastreadores.filter((r) => statusRastreador(r).label === "Sem sinal")
        .length,
      offline: rastreadores.filter((r) => statusRastreador(r).label === "Offline").length,
    };
  }, [rastreadores, busca, filtroStatus]);

  const abrirEdicao = (r: Rastreador) => {
    setEditando({
      id: r.id,
      apelido: r.apelido || "",
      barcoIdAdmin: r.barcoIdAdmin || r.barcoId || "",
      observacoes: r.observacoes || "",
      ativo: r.ativo !== false,
    });
  };

  const salvarEdicao = async () => {
    if (!editando) return;

    setSalvando(true);

    try {
      await updateDoc(doc(db, "rastreadores", editando.id), {
        apelido: editando.apelido.trim(),
        barcoIdAdmin: editando.barcoIdAdmin.trim(),
        observacoes: editando.observacoes.trim(),
        ativo: editando.ativo,
        atualizadoPeloSistemaEm: new Date().toISOString(),
      });

      setEditando(null);
      await modal.sucesso(
        "Rastreador atualizado",
        "As informações do rastreador foram salvas com sucesso.",
      );
    } catch (error: any) {
      console.error(error);
      await modal.erro(
        "Erro ao salvar",
        error?.message || "Não foi possível salvar o rastreador.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const enviarComandoOperacional = async (rastreador: Rastreador, tipo: string) => {
    const confirmou = await modal.confirmar({
      tipo: tipo === "reiniciar" ? "warning" : "confirm",
      titulo: tituloComando(tipo),
      mensagem: mensagemComando(tipo),
      confirmarTexto: "Enviar comando",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    const comandoId = `cmd_${tipo}_${Date.now()}`;

    try {
      await setDoc(
        doc(db, "rastreadores", rastreador.id),
        {
          comandoOperacionalPendente: {
            aplicar: true,
            tipo,
            comandoId,
            origem: "sistema_navegacao",
            criadoEm: serverTimestamp(),
          },
          comandoOperacionalStatus: {
            status: "pendente",
            tipo,
            mensagem:
              "Comando enviado. O rastreador executará quando estiver online e ler o Firebase.",
            comandoId,
            atualizadoEm: serverTimestamp(),
          },
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      await modal.sucesso(
        "Comando enviado",
        "Se o rastreador estiver online, ele executará em poucos segundos. Se estiver offline, o comando ficará pendente até voltar.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao enviar comando",
        error?.message || "Não foi possível enviar o comando remoto.",
      );
    }
  };

  return (
    <div className="min-h-full bg-[#0d0c2c] p-2 text-slate-100 sm:p-4 lg:p-6">
      <div className="mb-4 overflow-hidden rounded-2xl border border-[#1d426b] bg-gradient-to-r from-[#0f2240] to-[#13345d] shadow-sm sm:rounded-[26px]">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">
              Controle técnico
            </p>
            <h1 className="mt-2 text-xl font-black text-white sm:text-2xl">
              Rastreadores
            </h1>
            <p className="mt-1 text-sm font-medium text-sky-100/70">
              Monitore sinal, Wi‑Fi, GPS e vínculo dos dispositivos instalados.
            </p>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="min-h-12 w-full rounded-xl border border-sky-300/20 bg-sky-300/10 px-4 py-3 text-xs font-black uppercase text-sky-100 transition hover:bg-sky-300/20 sm:w-auto"
          >
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-white/10 bg-[#0d0c2c]/35 p-3 sm:p-4 md:grid-cols-4">
          <InfoMini label="Total" valor={dados.total} tom="blue" />
          <InfoMini label="Online" valor={dados.online} tom="green" />
          <InfoMini label="Sem sinal" valor={dados.semSinal} tom="amber" />
          <InfoMini label="Offline" valor={dados.offline} tom="red" />
        </div>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_220px]">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar rastreador, barco, Wi‑Fi ou IP"
          className="min-h-12 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] px-4 py-3 text-base font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 sm:text-sm"
        />

        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className="min-h-12 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] px-4 py-3 text-base font-semibold text-white shadow-sm outline-none focus:border-sky-300/60 sm:text-sm"
        >
          <option value="todos">Todos</option>
          <option value="online">Online</option>
          <option value="sem_sinal">Sem sinal</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#1d426b] bg-[#0f2240] shadow-sm sm:rounded-[26px]">
        <div className="hidden grid-cols-[1.3fr_1fr_1fr_0.8fr_0.9fr_120px] gap-4 border-b border-white/10 bg-[#143760] px-5 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/60 lg:grid">
          <span>Placa</span>
          <span>Barco</span>
          <span>Wi‑Fi</span>
          <span>GPS</span>
          <span>Último sinal</span>
          <span className="text-right">Ações</span>
        </div>

        {carregando ? (
          <div className="p-8 text-center text-sm text-sky-100/60">
            Carregando rastreadores...
          </div>
        ) : dados.lista.length === 0 ? (
          <div className="p-8 text-center text-sm text-sky-100/60">
            Nenhum rastreador encontrado.
          </div>
        ) : (
          dados.lista.map((r: any) => {
            const st = statusRastreador(r);
            const ns = obterNetworkStatus(r);
            const rssiAtual = obterRssi(r);

            return (
              <div
                key={r.id}
                className="grid gap-3 border-b border-white/10 bg-[#0f2240] p-4 text-sm last:border-b-0 hover:bg-[#17345e] lg:grid-cols-[1.3fr_1fr_1fr_0.8fr_0.9fr_120px] lg:items-center lg:gap-4 lg:px-5 lg:py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge status={st} />
                    {r.ativo === false && (
                      <span className="rounded-full border border-red-300/40 bg-red-500/15 px-2 py-1 text-[10px] font-black uppercase text-red-100">
                        Inativo
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate font-black text-white">
                    {r.apelido || r.nomeNaRede || r.deviceId || r.id}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-sky-100/45">
                    {r.deviceId || r.id}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="truncate font-bold text-sky-50">
                    {r.barcoIdAdmin || r.barcoId || "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-sky-100/45">
                    Placa: {r.barcoId || "—"}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="truncate font-bold text-sky-50">{obterWifiNome(r)}</p>
                  <p className="mt-0.5 text-[11px] text-sky-100/45">
                    {qualidadeWifi(rssiAtual)} {rssiAtual ? `• ${rssiAtual} dBm` : ""}
                  </p>
                </div>

                <div>
                  <p className="font-bold text-sky-50">{Number(r.satelites || 0)}</p>
                  <p className="text-[11px] text-sky-100/45">satélites</p>
                </div>

                <div>
                  <p className="font-bold text-sky-50">{formatarData(r.ultimoSinal)}</p>
                  <p className="text-[11px] text-sky-100/45">
                    IP {r.ipLocal || ns.ipLocal || ns.ipAddress || "—"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 lg:flex lg:justify-end">
                  <button
                    onClick={() => setDetalhe(r)}
                    className="min-h-10 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase text-sky-100 transition hover:bg-white/10"
                  >
                    Ver
                  </button>
                  <button
                    onClick={() => abrirEdicao(r)}
                    className="min-h-10 rounded-lg border border-sky-300/30 bg-sky-300/15 px-3 py-2 text-[11px] font-black uppercase text-sky-100 transition hover:bg-sky-300/25"
                  >
                    Editar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {detalhe && (
        <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-[#315b88] bg-gradient-to-br from-[#0f2240] to-[#13345d] p-4 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-300">
                  Detalhes técnicos
                </p>
                <h2 className="mt-1 text-xl font-black text-white">
                  {detalhe.apelido || detalhe.nomeNaRede || detalhe.id}
                </h2>
              </div>
              <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <button
                  onClick={() => copiarInstrucaoGerente(detalhe)}
                  className="rounded-xl border border-sky-300/25 bg-sky-300/10 px-3 py-2 text-xs font-black uppercase text-sky-100 hover:bg-sky-300/20"
                >
                  Copiar instrução rede
                </button>
                <button
                  onClick={() => enviarComandoOperacional(detalhe, "testar_internet")}
                  className="rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase text-emerald-100 hover:bg-emerald-300/20"
                >
                  Testar internet
                </button>
                <button
                  onClick={() => enviarComandoOperacional(detalhe, "reconectar_wifi")}
                  className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-black uppercase text-amber-100 hover:bg-amber-300/20"
                >
                  Reconectar Wi‑Fi
                </button>
                <button
                  onClick={() => enviarComandoOperacional(detalhe, "reiniciar")}
                  className="rounded-xl border border-red-300/25 bg-red-300/10 px-3 py-2 text-xs font-black uppercase text-red-100 hover:bg-red-300/20"
                >
                  Reiniciar
                </button>
                <button
                  onClick={() => setDetalhe(null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-sky-100 hover:bg-white/10"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["Device ID", detalhe.deviceId || detalhe.id],
                ["Barco", detalhe.barcoId || "—"],
                ["Nome na rede", detalhe.nomeNaRede || "—"],
                ["Wi‑Fi", obterWifiNome(detalhe)],
                ["RSSI", obterRssi(detalhe) ? `${obterRssi(detalhe)} dBm` : "—"],
                [
                  "IP local",
                  detalhe.ipLocal ||
                    obterNetworkStatus(detalhe).ipLocal ||
                    obterNetworkStatus(detalhe).ipAddress ||
                    "—",
                ],
                ["MAC cliente", obterMacCliente(detalhe)],
                ["MAC configuração", obterMacConfiguracao(detalhe)],
                ["Internet", textoStatusBoolean(obterNetworkStatus(detalhe).internetOk)],
                ["Firebase", textoStatusBoolean(obterNetworkStatus(detalhe).firebaseOk)],
                [
                  "Último erro",
                  obterNetworkStatus(detalhe).ultimoErro ||
                    obterNetworkStatus(detalhe).lastError ||
                    "—",
                ],
                [
                  "Diagnóstico atualizado",
                  formatarData(obterNetworkStatus(detalhe).atualizadoEm),
                ],
                [
                  "Último comando",
                  detalhe.comandoOperacionalStatus
                    ? `${detalhe.comandoOperacionalStatus.tipo || "—"} • ${detalhe.comandoOperacionalStatus.status || "—"}`
                    : "—",
                ],
                [
                  "Mensagem do comando",
                  detalhe.comandoOperacionalStatus?.mensagem || "—",
                ],
                ["Firmware", detalhe.versaoFirmware || "—"],
                ["Último sinal", formatarData(detalhe.ultimoSinal)],
                [
                  "Latitude",
                  detalhe.ultima_posicao?.latitude
                    ? String(detalhe.ultima_posicao.latitude)
                    : "—",
                ],
                [
                  "Longitude",
                  detalhe.ultima_posicao?.longitude
                    ? String(detalhe.ultima_posicao.longitude)
                    : "—",
                ],
              ].map(([label, value]) => (
                <CampoInfo key={label} label={label} value={value} />
              ))}
            </div>
          </div>
        </div>
      )}

      {editando && (
        <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[24px] border border-[#315b88] bg-gradient-to-br from-[#0f2240] to-[#13345d] p-4 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-300">
                  Editar rastreador
                </p>
                <h2 className="mt-1 text-xl font-black text-white">{editando.id}</h2>
              </div>
              <button
                onClick={() => setEditando(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-sky-100 hover:bg-white/10"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-4">
              <input
                value={editando.apelido}
                onChange={(e) => setEditando({ ...editando, apelido: e.target.value })}
                placeholder="Apelido interno"
                className="w-full rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] px-4 py-3 text-sm text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/50"
              />

              <input
                value={editando.barcoIdAdmin}
                onChange={(e) =>
                  setEditando({ ...editando, barcoIdAdmin: e.target.value })
                }
                placeholder="Barco vinculado"
                className="w-full rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] px-4 py-3 text-sm text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/50"
              />

              <textarea
                value={editando.observacoes}
                onChange={(e) =>
                  setEditando({ ...editando, observacoes: e.target.value })
                }
                placeholder="Observações"
                rows={4}
                className="w-full resize-none rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] px-4 py-3 text-sm text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/50"
              />

              <label className="flex items-center gap-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] px-4 py-3 text-sm text-sky-100">
                <input
                  type="checkbox"
                  checked={editando.ativo}
                  onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })}
                  className="h-4 w-4 accent-sky-400"
                />
                Rastreador ativo
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => setEditando(null)}
                className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-sky-100 hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                disabled={salvando}
                className="min-h-11 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
