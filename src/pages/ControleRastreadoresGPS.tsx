import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type TipoRede = "wifi_comum" | "hotspot_mac_bypass";

type ConfigGPS = {
  rastreadorAtivo: boolean;
  modoEnvio: "fixo" | "inteligente";
  intervaloEnvioSegundos: string;
  intervaloTesteSegundos: string;
  intervaloNavegandoSegundos: string;
  intervaloParadoSegundos: string;
  intervaloPertoPortoSegundos: string;
  distanciaPertoPortoMetros: string;
  atualizarConfigACadaSegundos: string;
};

const CONFIG_PADRAO: ConfigGPS = {
  rastreadorAtivo: true,
  modoEnvio: "inteligente",
  intervaloEnvioSegundos: "15",
  intervaloTesteSegundos: "5",
  intervaloNavegandoSegundos: "15",
  intervaloParadoSegundos: "60",
  intervaloPertoPortoSegundos: "5",
  distanciaPertoPortoMetros: "1000",
  atualizarConfigACadaSegundos: "60",
};

function numero(valor: string, fallback: number, min: number, max: number) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function pegarConfig(barco: any): ConfigGPS {
  const config = barco?.rastreadorConfig || {};

  return {
    rastreadorAtivo:
      typeof config.rastreadorAtivo === "boolean"
        ? config.rastreadorAtivo
        : typeof barco?.rastreadorAtivo === "boolean"
          ? barco.rastreadorAtivo
          : CONFIG_PADRAO.rastreadorAtivo,
    modoEnvio:
      config.modoEnvio === "fixo" || config.modoEnvio === "inteligente"
        ? config.modoEnvio
        : CONFIG_PADRAO.modoEnvio,
    intervaloEnvioSegundos: String(
      config.intervaloEnvioSegundos ??
        barco?.intervaloEnvioSegundos ??
        CONFIG_PADRAO.intervaloEnvioSegundos,
    ),
    intervaloTesteSegundos: String(
      config.intervaloTesteSegundos ?? CONFIG_PADRAO.intervaloTesteSegundos,
    ),
    intervaloNavegandoSegundos: String(
      config.intervaloNavegandoSegundos ?? CONFIG_PADRAO.intervaloNavegandoSegundos,
    ),
    intervaloParadoSegundos: String(
      config.intervaloParadoSegundos ?? CONFIG_PADRAO.intervaloParadoSegundos,
    ),
    intervaloPertoPortoSegundos: String(
      config.intervaloPertoPortoSegundos ?? CONFIG_PADRAO.intervaloPertoPortoSegundos,
    ),
    distanciaPertoPortoMetros: String(
      config.distanciaPertoPortoMetros ?? CONFIG_PADRAO.distanciaPertoPortoMetros,
    ),
    atualizarConfigACadaSegundos: String(
      config.atualizarConfigACadaSegundos ?? CONFIG_PADRAO.atualizarConfigACadaSegundos,
    ),
  };
}

function statusTexto(barco: any) {
  if (barco?.modoTeste) return "Teste GPS";
  if (barco?.ultima_posicao?.latitude) return "GPS ativo";
  return "Sem posição";
}

function parseDataSistema(valor: any): Date | null {
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

    const texto = String(valor).trim();
    if (!texto || texto.startsWith("sem_data")) return null;

    const numeroTexto = Number(texto);
    if (Number.isFinite(numeroTexto) && numeroTexto > 0) {
      const data = new Date(numeroTexto < 10000000000 ? numeroTexto * 1000 : numeroTexto);
      return Number.isNaN(data.getTime()) ? null : data;
    }

    const data = new Date(texto);
    return Number.isNaN(data.getTime()) ? null : data;
  } catch {
    return null;
  }
}

function formatarData(valor: any) {
  const data = parseDataSistema(valor);
  if (!data) return "—";

  return data.toLocaleString("pt-BR", {
    timeZone: "America/Santarem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function textoTipoRede(tipo: TipoRede) {
  if (tipo === "hotspot_mac_bypass") return "Hotspot com MAC bypass";
  return "Wi‑Fi comum";
}

function textoSimNao(valor: boolean) {
  return valor ? "Sim" : "Não";
}

function obterNetworkStatus(barco: any) {
  return barco?.rastreadorNetworkStatus || barco?.networkStatus || {};
}

function obterMacCliente(barco: any) {
  const status = obterNetworkStatus(barco);

  return (
    status.macCliente || status.macClient || barco?.macCliente || barco?.macAddress || "—"
  );
}

function obterMacConfiguracao(barco: any) {
  const status = obterNetworkStatus(barco);
  return status.macConfiguracao || status.macConfig || barco?.macConfiguracao || "—";
}

export default function ControleRastreadoresGPS() {
  const modal = useAppModal();
  const alert = (mensagem: any) => {
    void modal.aviso("Aviso do sistema", String(mensagem));
  };

  const [barcos, setBarcos] = useState<any[]>([]);
  const [barcoId, setBarcoId] = useState("");
  const [busca, setBusca] = useState("");
  const [config, setConfig] = useState<ConfigGPS>(CONFIG_PADRAO);
  const [salvando, setSalvando] = useState(false);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiSenha, setWifiSenha] = useState("");
  const [wifiNomeRede, setWifiNomeRede] = useState("");
  const [wifiTipoRede, setWifiTipoRede] = useState<TipoRede>("wifi_comum");
  const [wifiMacBypassLiberado, setWifiMacBypassLiberado] = useState(false);
  const [wifiResponsavelRede, setWifiResponsavelRede] = useState("");
  const [wifiTelefoneResponsavel, setWifiTelefoneResponsavel] = useState("");
  const [wifiObservacaoRede, setWifiObservacaoRede] = useState("");
  const [enviandoWifi, setEnviandoWifi] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a: any, b: any) =>
          String(a.nome || a.id).localeCompare(String(b.nome || b.id)),
        );

      setBarcos(lista);

      if (!barcoId && lista.length > 0) {
        const preferido = lista.find((item: any) => item.modoTeste === true) || lista[0];

        setBarcoId(preferido.id);
        setConfig(pegarConfig(preferido));
      }
    });

    return () => unsubscribe();
  }, [barcoId]);

  const barcosFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return barcos.filter((barco) => {
      if (!texto) return true;

      return [barco.id, barco.nome, barco.tipo, barco.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [barcos, busca]);

  const barcoSelecionado = useMemo(
    () => barcos.find((barco) => barco.id === barcoId) || null,
    [barcos, barcoId],
  );

  const selecionarBarco = (id: string) => {
    const barco = barcos.find((item) => item.id === id);

    setBarcoId(id);

    if (barco) {
      setConfig(pegarConfig(barco));
      setWifiSsid(
        barco?.rastreadorWifiStatus?.ssidAtual ||
          barco?.wifiSSIDAtual ||
          barco?.wifiNome ||
          "",
      );
      setWifiNomeRede(barco?.nomeNaRede || barco?.rastreadorWifiStatus?.nomeNaRede || "");

      const rede = barco?.rastreadorWifiPendente || barco?.rastreadorWifiStatus || {};
      const tipo =
        rede.tipoRede === "hotspot_mac_bypass" ? "hotspot_mac_bypass" : "wifi_comum";

      setWifiTipoRede(tipo);
      setWifiMacBypassLiberado(Boolean(rede.macBypassLiberado));
      setWifiResponsavelRede(String(rede.responsavelRede || ""));
      setWifiTelefoneResponsavel(String(rede.telefoneResponsavel || ""));
      setWifiObservacaoRede(String(rede.observacaoRede || ""));
      setWifiSenha("");
    }
  };

  useEffect(() => {
    if (!barcoSelecionado) return;

    setWifiSsid(
      barcoSelecionado?.rastreadorWifiStatus?.ssidAtual ||
        barcoSelecionado?.wifiSSIDAtual ||
        barcoSelecionado?.wifiNome ||
        "",
    );
    setWifiNomeRede(
      barcoSelecionado?.nomeNaRede ||
        barcoSelecionado?.rastreadorWifiStatus?.nomeNaRede ||
        "",
    );

    const rede =
      barcoSelecionado?.rastreadorWifiPendente ||
      barcoSelecionado?.rastreadorWifiStatus ||
      {};
    const tipo =
      rede.tipoRede === "hotspot_mac_bypass" ? "hotspot_mac_bypass" : "wifi_comum";

    setWifiTipoRede(tipo);
    setWifiMacBypassLiberado(Boolean(rede.macBypassLiberado));
    setWifiResponsavelRede(String(rede.responsavelRede || ""));
    setWifiTelefoneResponsavel(String(rede.telefoneResponsavel || ""));
    setWifiObservacaoRede(String(rede.observacaoRede || ""));
    setWifiSenha("");
  }, [barcoSelecionado?.id]);

  const alterar = (campo: keyof ConfigGPS, valor: any) => {
    setConfig((atual) => ({
      ...atual,
      [campo]: valor,
    }));
  };

  const aplicarModoTeste = () => {
    setConfig((atual) => ({
      ...atual,
      rastreadorAtivo: true,
      modoEnvio: "fixo",
      intervaloEnvioSegundos: "5",
      intervaloTesteSegundos: "5",
      intervaloNavegandoSegundos: "5",
      intervaloParadoSegundos: "5",
      intervaloPertoPortoSegundos: "5",
      distanciaPertoPortoMetros: "300",
      atualizarConfigACadaSegundos: "30",
    }));
  };

  const aplicarModoProducao = () => {
    setConfig({
      ...CONFIG_PADRAO,
      rastreadorAtivo: true,
      modoEnvio: "inteligente",
    });
  };

  const salvarConfig = async () => {
    try {
      if (!barcoId) {
        alert("Selecione um rastreador/barco.");
        return;
      }

      setSalvando(true);

      const payload = {
        rastreadorAtivo: config.rastreadorAtivo,
        modoEnvio: config.modoEnvio,
        intervaloEnvioSegundos: numero(config.intervaloEnvioSegundos, 15, 3, 600),
        intervaloTesteSegundos: numero(config.intervaloTesteSegundos, 5, 3, 600),
        intervaloNavegandoSegundos: numero(config.intervaloNavegandoSegundos, 15, 3, 600),
        intervaloParadoSegundos: numero(config.intervaloParadoSegundos, 60, 5, 1800),
        intervaloPertoPortoSegundos: numero(
          config.intervaloPertoPortoSegundos,
          5,
          3,
          600,
        ),
        distanciaPertoPortoMetros: numero(
          config.distanciaPertoPortoMetros,
          1000,
          50,
          10000,
        ),
        atualizarConfigACadaSegundos: numero(
          config.atualizarConfigACadaSegundos,
          60,
          10,
          3600,
        ),
        atualizadoEm: serverTimestamp(),
      };

      await setDoc(
        doc(db, "embarcacoes", barcoId),
        {
          rastreadorAtivo: payload.rastreadorAtivo,
          intervaloEnvioSegundos: payload.intervaloEnvioSegundos,
          rastreadorConfig: payload,
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Configuração do rastreador salva no Firebase.");
    } catch (error: any) {
      alert(error?.message || "Erro ao salvar configuração.");
    } finally {
      setSalvando(false);
    }
  };

  const copiarInstrucaoGerente = async () => {
    const mac = obterMacCliente(barcoSelecionado);
    const rede = wifiSsid.trim() || "rede do barco";

    const mensagem = [
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

    try {
      await navigator.clipboard.writeText(mensagem);
      await modal.sucesso(
        "Instrução copiada",
        "A mensagem técnica para o gerente da rede foi copiada.",
      );
    } catch {
      await modal.aviso("Instrução técnica", mensagem);
    }
  };

  const enviarTrocaWifiRemota = async () => {
    try {
      if (!barcoId) {
        alert("Selecione um rastreador/barco.");
        return;
      }

      if (!wifiSsid.trim()) {
        alert("Informe o nome da nova rede Wi-Fi.");
        return;
      }

      const confirmou = await modal.confirmar({
        tipo: "warning",
        titulo: "Enviar troca remota de Wi‑Fi?",
        mensagem:
          "Se a senha estiver errada, o rastreador tentará voltar para a rede anterior.",
        confirmarTexto: "Enviar",
        cancelarTexto: "Cancelar",
      });

      if (!confirmou) return;

      setEnviandoWifi(true);

      const comandoId = `wifi_${Date.now()}`;
      const requerBypassMac = wifiTipoRede === "hotspot_mac_bypass";
      const redeInfo = {
        tipoRede: wifiTipoRede,
        requerBypassMac,
        macBypassLiberado: requerBypassMac ? wifiMacBypassLiberado : false,
        responsavelRede: wifiResponsavelRede.trim(),
        telefoneResponsavel: wifiTelefoneResponsavel.trim(),
        observacaoRede: wifiObservacaoRede.trim(),
      };

      await setDoc(
        doc(db, "embarcacoes", barcoId),
        {
          rastreadorWifiPendente: {
            aplicar: true,
            ssid: wifiSsid.trim(),
            senha: wifiSenha,
            nomeNaRede: wifiNomeRede.trim() || `CMB_${barcoId}`,
            ...redeInfo,
            comandoId,
            criadoEm: serverTimestamp(),
          },
          rastreadorWifiStatus: {
            status: "pendente",
            mensagem: "Troca remota enviada. Aguardando rastreador ler o Firebase.",
            ssidTentado: wifiSsid.trim(),
            nomeNaRede: wifiNomeRede.trim() || `CMB_${barcoId}`,
            ...redeInfo,
            comandoId,
            atualizadoEm: serverTimestamp(),
          },
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Troca de Wi-Fi enviada. Aguarde o rastreador testar e atualizar o status.");
      setWifiSenha("");
    } catch (error: any) {
      alert(error?.message || "Erro ao enviar troca de Wi-Fi.");
    } finally {
      setEnviandoWifi(false);
    }
  };

  return (
    <div className="min-h-full bg-[#0d0c2c] p-3 text-white sm:p-5">
      <div className="mb-4 flex flex-col gap-4 xl:mb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em]">
            Rastreamento remoto
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Controle GPS</h1>
        </div>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar barco ou rastreador..."
          className="min-h-12 w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-base font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 sm:text-sm xl:w-[320px]"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr] xl:gap-6">
        <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] p-3 shadow-sm sm:rounded-3xl sm:p-4">
          <h2 className="px-1 text-lg font-black">Rastreadores</h2>
          <p className="mt-1 px-1 text-xs text-sky-100/55">
            Selecione o rastreador para editar.
          </p>

          <div className="mt-4 max-h-[360px] overflow-y-auto overflow-x-hidden pr-1 xl:max-h-[calc(100vh-230px)]">
            {barcosFiltrados.map((barco) => {
              const ativo = barco.id === barcoId;

              return (
                <button
                  key={barco.id}
                  onClick={() => selecionarBarco(barco.id)}
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
                        {barco.nome || barco.id}
                      </p>
                      <p className="mt-1 truncate text-xs text-sky-100/55">{barco.id}</p>
                    </div>

                    {barco.modoTeste && (
                      <span className="shrink-0 rounded-full border border-amber-300/35 bg-amber-500/10 px-2 py-1 text-[9px] font-black uppercase text-amber-200">
                        teste
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Mini label="Status" valor={statusTexto(barco)} />
                    <Mini
                      label="Intervalo"
                      valor={`${barco?.rastreadorConfig?.intervaloEnvioSegundos || barco?.intervaloEnvioSegundos || "—"}s`}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[#7ba6d4]/25 bg-[#0d0c2c] p-4 shadow-sm sm:rounded-3xl sm:p-5">
          <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-lg font-black">
                {barcoSelecionado?.nome || "Selecione um rastreador"}
              </h2>
              <p className="mt-1 text-xs text-sky-100/55">
                {barcoSelecionado?.id || "—"} • {statusTexto(barcoSelecionado)}
              </p>
            </div>

            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <button
                onClick={aplicarModoTeste}
                className="min-h-11 rounded-xl border border-amber-300/35 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase text-amber-200 hover:bg-amber-500/20"
              >
                Modo teste 5s
              </button>

              <button
                onClick={aplicarModoProducao}
                className="min-h-11 rounded-xl border border-emerald-300/35 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase text-emerald-200 hover:bg-emerald-500/20"
              >
                Modo produção
              </button>

              <button
                onClick={salvarConfig}
                disabled={salvando || !barcoId}
                className="min-h-11 rounded-xl border border-sky-300/30 bg-[#17345e] px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-[#2b5b91] disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>

          <div className="mb-5 rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3">
            <p className="text-sm text-sky-100/75">
              As alterações desta tela passam a valer pelo Firebase para o rastreador
              selecionado.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <label className="flex items-center justify-between rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] p-4 shadow-sm">
              <div>
                <p className="text-xs font-black uppercase text-sky-100/55">
                  Rastreador ativo
                </p>
                <p className="mt-1 text-[11px] text-sky-100/55">
                  Se desligar, o ESP32 pode pausar o envio.
                </p>
              </div>

              <input
                type="checkbox"
                checked={config.rastreadorAtivo}
                onChange={(e) => alterar("rastreadorAtivo", e.target.checked)}
                className="h-5 w-5"
              />
            </label>

            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">
                Modo de envio
              </p>
              <select
                value={config.modoEnvio}
                onChange={(e) => alterar("modoEnvio", e.target.value)}
                className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
              >
                <option value="fixo">Fixo</option>
                <option value="inteligente">Inteligente</option>
              </select>
            </label>

            <Campo
              label="Intervalo fixo em segundos"
              descricao="Usado quando modoEnvio = fixo"
              value={config.intervaloEnvioSegundos}
              onChange={(v) => alterar("intervaloEnvioSegundos", v)}
            />

            <Campo
              label="Atualizar config a cada segundos"
              descricao="Com que frequência o ESP32 relê o Firebase"
              value={config.atualizarConfigACadaSegundos}
              onChange={(v) => alterar("atualizarConfigACadaSegundos", v)}
            />

            <Campo
              label="Modo teste segundos"
              descricao="Recomendado: 5s"
              value={config.intervaloTesteSegundos}
              onChange={(v) => alterar("intervaloTesteSegundos", v)}
            />

            <Campo
              label="Navegando segundos"
              descricao="Recomendado: 10s a 15s"
              value={config.intervaloNavegandoSegundos}
              onChange={(v) => alterar("intervaloNavegandoSegundos", v)}
            />

            <Campo
              label="Parado segundos"
              descricao="Recomendado: 60s"
              value={config.intervaloParadoSegundos}
              onChange={(v) => alterar("intervaloParadoSegundos", v)}
            />

            <Campo
              label="Perto do porto segundos"
              descricao="Recomendado: 5s"
              value={config.intervaloPertoPortoSegundos}
              onChange={(v) => alterar("intervaloPertoPortoSegundos", v)}
            />

            <Campo
              label="Distância perto do porto em metros"
              descricao="Abaixo disso usa envio rápido"
              value={config.distanciaPertoPortoMetros}
              onChange={(v) => alterar("distanciaPertoPortoMetros", v)}
            />
          </div>

          <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-500/10 p-4 sm:rounded-3xl sm:p-5">
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-lg font-black text-amber-200">
                  Troca remota de Wi-Fi
                </h3>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-sky-100/55">
                  Funciona quando o rastreador ainda está online na rede atual. O ESP32
                  testa a nova rede e, se falhar, tenta voltar para a rede anterior.
                </p>
              </div>

              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <button
                  onClick={copiarInstrucaoGerente}
                  disabled={!barcoId}
                  className="min-h-11 rounded-xl border border-sky-300/35 bg-sky-500/10 px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-sky-500/20 disabled:opacity-60"
                >
                  Copiar instrução rede
                </button>

                <button
                  onClick={enviarTrocaWifiRemota}
                  disabled={enviandoWifi || !barcoId}
                  className="min-h-11 rounded-xl border border-amber-300/35 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                >
                  {enviandoWifi ? "Enviando..." : "Enviar troca Wi-Fi"}
                </button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Campo
                label="Nova rede Wi-Fi"
                descricao="SSID da Starlink/roteador"
                value={wifiSsid}
                onChange={setWifiSsid}
              />

              <Campo
                label="Nova senha Wi-Fi"
                descricao="Fica salva no Firebase para o rastreador ler"
                value={wifiSenha}
                onChange={setWifiSenha}
              />

              <Campo
                label="Nome da placa na rede"
                descricao="Exemplo: CMB_OBDENSE_V"
                value={wifiNomeRede}
                onChange={setWifiNomeRede}
              />

              <label>
                <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">
                  Tipo de rede
                </p>
                <select
                  value={wifiTipoRede}
                  onChange={(e) => setWifiTipoRede(e.target.value as TipoRede)}
                  className="min-h-12 w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-base font-semibold text-white shadow-sm outline-none focus:border-sky-300/60 sm:text-sm"
                >
                  <option value="wifi_comum">Wi‑Fi comum</option>
                  <option value="hotspot_mac_bypass">Hotspot com MAC bypass</option>
                </select>
                <p className="mt-1 text-[11px] text-sky-100/55">
                  Hotspot exige liberação do MAC como bypass/whitelist.
                </p>
              </label>

              <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] p-4">
                <div>
                  <p className="text-[10px] font-black uppercase text-sky-100/55">
                    MAC liberado no hotspot
                  </p>
                  <p className="mt-1 text-[11px] text-sky-100/55">
                    Confirmação do gerente da rede.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={wifiMacBypassLiberado}
                  onChange={(e) => setWifiMacBypassLiberado(e.target.checked)}
                  disabled={wifiTipoRede !== "hotspot_mac_bypass"}
                  className="h-5 w-5 accent-sky-400 disabled:opacity-40"
                />
              </label>

              <Campo
                label="Responsável da rede"
                descricao="Nome do técnico ou gerente da internet do barco"
                value={wifiResponsavelRede}
                onChange={setWifiResponsavelRede}
              />

              <Campo
                label="Telefone do responsável"
                descricao="Contato para liberação do MAC, se necessário"
                value={wifiTelefoneResponsavel}
                onChange={setWifiTelefoneResponsavel}
              />

              <Campo
                label="Observação técnica"
                descricao="Exemplo: hotspot MikroTik, aguardar liberação do MAC"
                value={wifiObservacaoRede}
                onChange={setWifiObservacaoRede}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini
                label="Status Wi-Fi"
                valor={barcoSelecionado?.rastreadorWifiStatus?.status || "—"}
              />
              <Mini
                label="Mensagem"
                valor={barcoSelecionado?.rastreadorWifiStatus?.mensagem || "—"}
              />
              <Mini
                label="Rede atual"
                valor={
                  barcoSelecionado?.rastreadorWifiStatus?.ssidAtual ||
                  barcoSelecionado?.wifiSSIDAtual ||
                  barcoSelecionado?.wifiNome ||
                  "—"
                }
              />
              <Mini
                label="Rede tentada"
                valor={barcoSelecionado?.rastreadorWifiStatus?.ssidTentado || "—"}
              />
              <Mini label="Tipo de rede" valor={textoTipoRede(wifiTipoRede)} />
              <Mini label="MAC bypass" valor={textoSimNao(wifiMacBypassLiberado)} />
              <Mini label="MAC cliente" valor={obterMacCliente(barcoSelecionado)} />
              <Mini
                label="Último erro"
                valor={obterNetworkStatus(barcoSelecionado).ultimoErro || "—"}
              />
            </div>
          </section>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Mini
              label="Último sinal"
              valor={formatarData(
                barcoSelecionado?.ultima_posicao?.visto_por_ultimo ||
                  barcoSelecionado?.ultimoSinal ||
                  barcoSelecionado?.atualizadoEm,
              )}
            />
            <Mini
              label="Latitude"
              valor={barcoSelecionado?.ultima_posicao?.latitude || "—"}
            />
            <Mini
              label="Longitude"
              valor={barcoSelecionado?.ultima_posicao?.longitude || "—"}
            />
            <Mini
              label="Velocidade"
              valor={
                barcoSelecionado?.ultima_posicao?.velocidade
                  ? `${barcoSelecionado.ultima_posicao.velocidade} km/h`
                  : "—"
              }
            />
          </div>
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
  inputMode,
}: {
  label: string;
  descricao: string;
  value: string;
  onChange: (valor: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
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
