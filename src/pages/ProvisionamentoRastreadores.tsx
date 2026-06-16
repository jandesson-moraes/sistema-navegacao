import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type Rastreador = {
  id: string;
  deviceId?: string;
  barcoId?: string;
  nomeNaRede?: string;
  wifiNome?: string;
  wifiSSIDAtual?: string;
  status?: string;
  ultimoSinal?: any;
  ipLocal?: string;
  rssi?: number;
  satelites?: number;
  versaoFirmware?: string;
  precisaProvisionar?: boolean;
  provisionamentoStatus?: any;
  provisionamentoPendente?: any;
  networkStatus?: any;
  macCliente?: string;
  macConfiguracao?: string;
  macAddress?: string;
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
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function limparBarcoId(valor: string) {
  return String(valor || "")
    .trim()
    .replace(/[\\/\s]+/g, "_")
    .toUpperCase();
}

type TipoRede = "wifi_comum" | "hotspot_mac_bypass";

function obterNetworkStatus(rastreador?: Rastreador | null) {
  return rastreador?.networkStatus || {};
}

function obterMacCliente(rastreador?: Rastreador | null) {
  const status = obterNetworkStatus(rastreador);

  return (
    status.macCliente ||
    status.macClient ||
    rastreador?.macCliente ||
    rastreador?.macAddress ||
    "—"
  );
}

function obterMacConfiguracao(rastreador?: Rastreador | null) {
  const status = obterNetworkStatus(rastreador);

  return status.macConfiguracao || status.macConfig || rastreador?.macConfiguracao || "—";
}

function textoTipoRede(tipo: TipoRede) {
  if (tipo === "hotspot_mac_bypass") return "Hotspot com MAC bypass";
  return "Wi-Fi comum";
}

function textoSimNao(valor: boolean) {
  return valor ? "Sim" : "Não";
}

export default function ProvisionamentoRastreadores() {
  const modal = useAppModal();
  const alert = (mensagem: any) => {
    void modal.aviso("Aviso do sistema", String(mensagem));
  };

  const [rastreadores, setRastreadores] = useState<Rastreador[]>([]);
  const [deviceSelecionado, setDeviceSelecionado] = useState("");
  const [busca, setBusca] = useState("");

  const [barcoId, setBarcoId] = useState("");
  const [nomeNaRede, setNomeNaRede] = useState("");
  const [wifiSsid, setWifiSsid] = useState("RoteadorTeste");
  const [wifiSenha, setWifiSenha] = useState("12341234");
  const [tipoRede, setTipoRede] = useState<TipoRede>("wifi_comum");
  const [macBypassLiberado, setMacBypassLiberado] = useState(false);
  const [responsavelRede, setResponsavelRede] = useState("");
  const [telefoneResponsavel, setTelefoneResponsavel] = useState("");
  const [observacaoRede, setObservacaoRede] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "rastreadores"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as Rastreador)
        .sort((a, b) => {
          const aPrecisa = a.precisaProvisionar ? 0 : 1;
          const bPrecisa = b.precisaProvisionar ? 0 : 1;

          if (aPrecisa !== bPrecisa) return aPrecisa - bPrecisa;

          return String(a.barcoId || a.id).localeCompare(String(b.barcoId || b.id));
        });

      setRastreadores(lista);

      if (!deviceSelecionado && lista.length > 0) {
        const preferido = lista.find((item) => item.precisaProvisionar) || lista[0];
        selecionarRastreador(preferido, false);
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSelecionado]);

  const rastreadoresFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    if (!texto) return rastreadores;

    return rastreadores.filter((item) =>
      [
        item.id,
        item.deviceId,
        item.barcoId,
        item.nomeNaRede,
        item.wifiNome,
        item.wifiSSIDAtual,
        item.versaoFirmware,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto),
    );
  }, [rastreadores, busca]);

  const rastreadorSelecionado = useMemo(
    () => rastreadores.find((item) => item.id === deviceSelecionado) || null,
    [rastreadores, deviceSelecionado],
  );

  function selecionarRastreador(item: Rastreador, limparSenha = true) {
    setDeviceSelecionado(item.id);
    setBarcoId(item.barcoId && item.barcoId !== "SEM_BARCO" ? item.barcoId : "");
    setNomeNaRede(item.nomeNaRede || "");
    setWifiSsid(item.wifiSSIDAtual || item.wifiNome || "RoteadorTeste");

    const rede = item.provisionamentoPendente || item.provisionamentoStatus || {};
    const tipo =
      rede.tipoRede === "hotspot_mac_bypass" ? "hotspot_mac_bypass" : "wifi_comum";

    setTipoRede(tipo);
    setMacBypassLiberado(Boolean(rede.macBypassLiberado));
    setResponsavelRede(String(rede.responsavelRede || ""));
    setTelefoneResponsavel(String(rede.telefoneResponsavel || ""));
    setObservacaoRede(String(rede.observacaoRede || ""));

    if (limparSenha) {
      setWifiSenha("");
    }
  }

  function modeloInstalacao() {
    setWifiSsid("RoteadorTeste");
    setWifiSenha("12341234");
    setNomeNaRede(barcoId ? `CMB_${limparBarcoId(barcoId)}` : "CMB_CONFIG");
    setTipoRede("wifi_comum");
    setMacBypassLiberado(false);
    setResponsavelRede("");
    setTelefoneResponsavel("");
    setObservacaoRede("");
  }

  async function copiarInstrucaoGerente() {
    const mac = obterMacCliente(rastreadorSelecionado);
    const rede = wifiSsid.trim() || "rede do barco";

    const mensagem = [
      "Olá, tudo bem?",
      "",
      "Para o rastreador GPS do Cadê Meu Barco funcionar na rede da embarcação, precisamos liberar o dispositivo no hotspot como bypass/whitelist/IP Binding.",
      "",
      `Rede/SSID: ${rede}`,
      `MAC do GPS: ${mac}`,
      "",
      "O GPS não abre tela de login de hotspot como um celular. Ele precisa conectar ao Wi-Fi e ter acesso direto à internet para enviar a localização ao sistema.",
      "",
      "Se for MikroTik, normalmente fica em IP > Hotspot > IP Bindings > Add, informando o MAC do GPS e Type: bypassed.",
      "",
      "O dispositivo envia apenas dados técnicos e localização para o Firebase. Ele não acessa rede interna e não interfere na internet dos passageiros.",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(mensagem);
      await modal.sucesso(
        "Instrução copiada",
        "A mensagem técnica para o gerente da rede foi copiada.",
      );
    } catch {
      await modal.aviso("Instrução técnica", mensagem);
    }
  }

  async function enviarProvisionamento() {
    try {
      if (!rastreadorSelecionado) {
        alert("Selecione um rastreador.");
        return;
      }

      const novoBarcoId = limparBarcoId(barcoId);

      if (!novoBarcoId) {
        alert("Informe o ID do barco.");
        return;
      }

      if (!wifiSsid.trim()) {
        alert("Informe a rede Wi-Fi.");
        return;
      }

      const confirmou = await modal.confirmar({
        tipo: "warning",
        titulo: "Enviar provisionamento?",
        mensagem: `Provisionar o rastreador ${rastreadorSelecionado.id} para o barco ${novoBarcoId}?`,
        confirmarTexto: "Provisionar",
        cancelarTexto: "Cancelar",
      });

      if (!confirmou) return;

      setEnviando(true);

      const comandoId = `prov_${Date.now()}`;
      const requerBypassMac = tipoRede === "hotspot_mac_bypass";
      const redeInfo = {
        tipoRede,
        requerBypassMac,
        macBypassLiberado: requerBypassMac ? macBypassLiberado : false,
        responsavelRede: responsavelRede.trim(),
        telefoneResponsavel: telefoneResponsavel.trim(),
        observacaoRede: observacaoRede.trim(),
      };

      await setDoc(
        doc(db, "rastreadores", rastreadorSelecionado.id),
        {
          provisionamentoPendente: {
            aplicar: true,
            barcoId: novoBarcoId,
            ssid: wifiSsid.trim(),
            senha: wifiSenha,
            nomeNaRede: nomeNaRede.trim() || `CMB_${novoBarcoId}`,
            ...redeInfo,
            comandoId,
            criadoEm: serverTimestamp(),
          },
          provisionamentoStatus: {
            status: "pendente",
            mensagem: "Provisionamento enviado. Aguardando rastreador ler o Firebase.",
            novoBarcoId,
            ssidTentado: wifiSsid.trim(),
            nomeNaRede: nomeNaRede.trim() || `CMB_${novoBarcoId}`,
            ...redeInfo,
            comandoId,
            atualizadoEm: serverTimestamp(),
          },
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      await modal.sucesso(
        "Provisionamento enviado",
        "Aguarde o rastreador testar a configuração e atualizar o status.",
      );

      setWifiSenha("");
    } catch (error: any) {
      await modal.erro(
        "Erro ao enviar provisionamento",
        error?.message || "Erro ao enviar provisionamento.",
      );
    } finally {
      setEnviando(false);
    }
  }

  async function cancelarPendente() {
    if (!rastreadorSelecionado) return;

    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Cancelar provisionamento?",
      mensagem: "O provisionamento pendente será marcado como cancelado no Firebase.",
      confirmarTexto: "Cancelar pendente",
      cancelarTexto: "Voltar",
    });

    if (!confirmou) return;

    await setDoc(
      doc(db, "rastreadores", rastreadorSelecionado.id),
      {
        provisionamentoPendente: {
          ...(rastreadorSelecionado.provisionamentoPendente || {}),
          aplicar: false,
          canceladoPeloSistema: true,
          canceladoEm: serverTimestamp(),
        },
        provisionamentoStatus: {
          ...(rastreadorSelecionado.provisionamentoStatus || {}),
          status: "cancelado",
          mensagem: "Provisionamento pendente cancelado pelo sistema.",
          atualizadoEm: serverTimestamp(),
        },
      },
      { merge: true },
    );

    await modal.sucesso(
      "Provisionamento cancelado",
      "Provisionamento pendente cancelado.",
    );
  }

  return (
    <div className="min-h-full bg-[#0d0c2c] p-3 text-white sm:p-5">
      <div className="mb-4 flex flex-col gap-4 xl:mb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em]">
            Instalação de rastreadores
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Provisionamento GPS</h1>
        </div>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar device, barco ou Wi‑Fi..."
          className="min-h-12 w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-base font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 sm:text-sm xl:w-[320px]"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr] xl:gap-6">
        <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] p-3 shadow-sm sm:rounded-3xl sm:p-4">
          <h2 className="px-1 text-lg font-black">Rastreadores online</h2>
          <p className="mt-1 px-1 text-xs text-sky-100/55">
            Dispositivos disponíveis para provisionamento.
          </p>

          <div className="mt-4 max-h-[360px] overflow-y-auto overflow-x-hidden pr-1 scrollbar-none xl:max-h-[calc(100vh-235px)]">
            {rastreadoresFiltrados.map((item) => {
              const ativo = item.id === deviceSelecionado;

              return (
                <button
                  key={item.id}
                  onClick={() => selecionarRastreador(item)}
                  className={[
                    "mb-2 w-full rounded-2xl border p-3 text-left transition shadow-sm",
                    ativo
                      ? "border-sky-300/45 bg-[#2b5b91]/45 ring-1 ring-sky-300/20"
                      : "border-[#7ba6d4]/25 bg-[#143760] hover:border-sky-300/30 hover:bg-[#17345e]/40",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">
                        {item.barcoId || "SEM_BARCO"}
                      </p>
                      <p className="mt-1 truncate text-xs text-sky-100/55">{item.id}</p>
                    </div>

                    {item.precisaProvisionar && (
                      <span className="shrink-0 rounded-full border border-amber-300/35 bg-amber-500/10 px-2 py-1 text-[9px] font-black uppercase text-amber-200">
                        novo
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Mini label="Status" valor={item.status || "—"} />
                    <Mini
                      label="Wi‑Fi"
                      valor={item.wifiSSIDAtual || item.wifiNome || "—"}
                    />
                  </div>
                </button>
              );
            })}

            {rastreadoresFiltrados.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#7ba6d4]/25 bg-[#143760] p-6 text-center text-sm text-sky-100/55">
                Nenhum rastreador encontrado.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#7ba6d4]/25 bg-[#0d0c2c] p-4 shadow-sm sm:rounded-3xl sm:p-5">
          <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-lg font-black">
                {rastreadorSelecionado?.id || "Selecione um rastreador"}
              </h2>
              <p className="mt-1 text-xs text-sky-100/55">
                Atual: {rastreadorSelecionado?.barcoId || "—"} • Firmware:{" "}
                {rastreadorSelecionado?.versaoFirmware || "—"}
              </p>
            </div>

            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <button
                onClick={modeloInstalacao}
                className="min-h-11 rounded-xl border border-amber-300/35 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase text-amber-200 hover:bg-amber-500/20"
              >
                Padrão instalação
              </button>

              <button
                onClick={enviarProvisionamento}
                disabled={enviando || !rastreadorSelecionado}
                className="min-h-11 rounded-xl border border-emerald-300/35 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {enviando ? "Enviando..." : "Enviar provisionamento"}
              </button>
            </div>
          </div>

          <div className="mb-5 rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3">
            <p className="text-sm text-sky-100/75">
              Use o padrão de instalação para acelerar o cadastro e depois envie o
              provisionamento. Em rede com hotspot, o caminho correto é liberar o MAC
              cliente do GPS como bypass.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Campo
              label="ID do barco no Firebase"
              descricao="Exemplo: OBDENSE_V"
              value={barcoId}
              onChange={(v) => {
                const id = limparBarcoId(v);
                setBarcoId(id);
                if (!nomeNaRede || nomeNaRede === "CMB_CONFIG") {
                  setNomeNaRede(id ? `CMB_${id}` : "");
                }
              }}
            />

            <Campo
              label="Nome da placa na rede"
              descricao="Exemplo: CMB_OBDENSE_V"
              value={nomeNaRede}
              onChange={setNomeNaRede}
            />

            <Campo
              label="Wi‑Fi definitivo"
              descricao="Starlink/roteador da embarcação ou hotspot de instalação"
              value={wifiSsid}
              onChange={setWifiSsid}
            />

            <Campo
              label="Senha do Wi‑Fi"
              descricao="Senha que será testada pelo rastreador"
              value={wifiSenha}
              onChange={setWifiSenha}
            />

            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">
                Tipo de rede
              </p>
              <select
                value={tipoRede}
                onChange={(e) => setTipoRede(e.target.value as TipoRede)}
                className="min-h-12 w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-base font-semibold text-white shadow-sm outline-none focus:border-sky-300/60 sm:text-sm"
              >
                <option value="wifi_comum">Wi‑Fi comum</option>
                <option value="hotspot_mac_bypass">Hotspot com MAC bypass</option>
              </select>
              <p className="mt-1 text-[11px] text-sky-100/55">
                Use hotspot quando a rede tiver portal/login para passageiros.
              </p>
            </label>

            <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] p-4">
              <div>
                <p className="text-[10px] font-black uppercase text-sky-100/55">
                  MAC liberado no hotspot
                </p>
                <p className="mt-1 text-[11px] text-sky-100/55">
                  Marque quando o gerente confirmar bypass/whitelist.
                </p>
              </div>
              <input
                type="checkbox"
                checked={macBypassLiberado}
                onChange={(e) => setMacBypassLiberado(e.target.checked)}
                disabled={tipoRede !== "hotspot_mac_bypass"}
                className="h-5 w-5 accent-sky-400 disabled:opacity-40"
              />
            </label>

            <Campo
              label="Responsável da rede"
              descricao="Nome do técnico ou gerente da internet do barco"
              value={responsavelRede}
              onChange={setResponsavelRede}
            />

            <Campo
              label="Telefone do responsável"
              descricao="Contato para liberação do MAC, se necessário"
              value={telefoneResponsavel}
              onChange={setTelefoneResponsavel}
            />

            <Campo
              label="Observação técnica"
              descricao="Exemplo: hotspot MikroTik, aguardar liberação do MAC"
              value={observacaoRede}
              onChange={setObservacaoRede}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => {
                setWifiSsid("");
                setWifiSenha("");
                setNomeNaRede(barcoId ? `CMB_${limparBarcoId(barcoId)}` : "");
              }}
              className="min-h-11 rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
            >
              Digitar Starlink
            </button>

            <button
              onClick={copiarInstrucaoGerente}
              disabled={!rastreadorSelecionado}
              className="min-h-11 rounded-xl border border-sky-300/35 bg-sky-500/10 px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-sky-500/20 disabled:opacity-60"
            >
              Copiar instrução rede
            </button>

            <button
              onClick={cancelarPendente}
              disabled={!rastreadorSelecionado}
              className="min-h-11 rounded-xl border border-red-300/35 bg-red-500/10 px-4 py-3 text-xs font-black uppercase text-red-200 hover:bg-red-500/20 disabled:opacity-60"
            >
              Cancelar pendente
            </button>
          </div>

          <section className="mt-6 rounded-3xl border border-[#7ba6d4]/25 bg-[#143760] p-5 shadow-sm">
            <h3 className="text-lg font-black">Status do provisionamento</h3>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini
                label="Status"
                valor={rastreadorSelecionado?.provisionamentoStatus?.status || "—"}
              />
              <Mini
                label="Mensagem"
                valor={rastreadorSelecionado?.provisionamentoStatus?.mensagem || "—"}
              />
              <Mini
                label="Novo barco"
                valor={rastreadorSelecionado?.provisionamentoStatus?.novoBarcoId || "—"}
              />
              <Mini
                label="SSID tentado"
                valor={rastreadorSelecionado?.provisionamentoStatus?.ssidTentado || "—"}
              />
              <Mini label="Tipo de rede" valor={textoTipoRede(tipoRede)} />
              <Mini label="MAC bypass" valor={textoSimNao(macBypassLiberado)} />
              <Mini label="Responsável" valor={responsavelRede || "—"} />
              <Mini label="Contato" valor={telefoneResponsavel || "—"} />
            </div>
          </section>

          <section className="mt-6 rounded-3xl border border-[#7ba6d4]/25 bg-[#143760] p-5 shadow-sm">
            <h3 className="text-lg font-black">Dados técnicos</h3>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini
                label="Último sinal"
                valor={formatarData(rastreadorSelecionado?.ultimoSinal)}
              />
              <Mini label="IP local" valor={rastreadorSelecionado?.ipLocal || "—"} />
              <Mini label="RSSI" valor={rastreadorSelecionado?.rssi ?? "—"} />
              <Mini label="Satélites" valor={rastreadorSelecionado?.satelites ?? "—"} />
              <Mini label="MAC cliente" valor={obterMacCliente(rastreadorSelecionado)} />
              <Mini
                label="MAC configuração"
                valor={obterMacConfiguracao(rastreadorSelecionado)}
              />
              <Mini
                label="Internet"
                valor={
                  obterNetworkStatus(rastreadorSelecionado).internetOk === true
                    ? "OK"
                    : obterNetworkStatus(rastreadorSelecionado).internetOk === false
                      ? "Sem internet"
                      : "—"
                }
              />
              <Mini
                label="Último erro"
                valor={obterNetworkStatus(rastreadorSelecionado).ultimoErro || "—"}
              />
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

function Campo({
  label,
  descricao,
  value,
  onChange,
}: {
  label: string;
  descricao: string;
  value: string;
  onChange: (valor: string) => void;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-12 w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-base font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 sm:text-sm"
      />
      <p className="mt-1 text-[11px] text-sky-100/55">{descricao}</p>
    </label>
  );
}

function Mini({ label, valor }: { label: string; valor: any }) {
  return (
    <div className="rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] p-3 sm:p-4">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-sky-100/55">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-black text-white">{valor}</p>
    </div>
  );
}
