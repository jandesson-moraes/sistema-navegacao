import React, { useMemo, useState } from "react";

import ControleRastreadoresGPS from "./ControleRastreadoresGPS";
import ModoTesteGPS from "./ModoTesteGPS";
import ProvisionamentoRastreadores from "./ProvisionamentoRastreadores";
import Rastreadores from "./Rastreadores";
import ChecklistRastreadorGPS from "./ChecklistRastreadorGPS";

type AbaGPS =
  | "visao"
  | "rastreadores"
  | "configuracao"
  | "provisionamento"
  | "teste"
  | "checklist";

const ABAS: {
  id: AbaGPS;
  titulo: string;
  descricao: string;
  icone: string;
}[] = [
  {
    id: "visao",
    titulo: "Visão Geral",
    descricao: "Resumo técnico e atalhos",
    icone: "◎",
  },
  {
    id: "rastreadores",
    titulo: "Rastreadores",
    descricao: "Dispositivos e status",
    icone: "◉",
  },
  {
    id: "configuracao",
    titulo: "Configuração",
    descricao: "Intervalos e Wi-Fi",
    icone: "▣",
  },
  {
    id: "provisionamento",
    titulo: "Provisionamento",
    descricao: "Instalação e vínculo",
    icone: "◇",
  },
  {
    id: "teste",
    titulo: "Modo Teste",
    descricao: "Rotas e simulação",
    icone: "⌁",
  },
  {
    id: "checklist",
    titulo: "Checklist GPS",
    descricao: "Verificação e suporte",
    icone: "✓",
  },
];

function CardAtalho({
  titulo,
  descricao,
  icone,
  onClick,
}: {
  titulo: string;
  descricao: string;
  icone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[92px] w-full rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4 text-left transition active:scale-[0.99] hover:border-sky-300/40 hover:bg-[#17345e] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-300/20 bg-sky-400/10 text-xl font-black text-sky-100">
          {icone}
        </span>

        <div className="min-w-0">
          <h3 className="text-base font-black leading-tight text-white">
            {titulo}
          </h3>
          <p className="mt-1 text-sm leading-5 text-sky-100/65">{descricao}</p>
        </div>
      </div>
    </button>
  );
}

function MiniResumo({
  label,
  valor,
  tom = "sky",
}: {
  label: string;
  valor: React.ReactNode;
  tom?: "sky" | "green" | "amber" | "red";
}) {
  const cor = {
    sky: "text-sky-100",
    green: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-red-300",
  }[tom];

  return (
    <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-4 sm:p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/45">
        {label}
      </p>
      <p className={["mt-2 text-xl font-black", cor].join(" ")}>{valor}</p>
    </div>
  );
}

export default function GPS() {
  const [aba, setAba] = useState<AbaGPS>("visao");

  const abaAtual = useMemo(
    () => ABAS.find((item) => item.id === aba) || ABAS[0],
    [aba],
  );

  return (
    <div className="flex min-h-[calc(100vh-74px)] flex-col overflow-hidden bg-[#0d0c2c] p-2 text-white sm:p-4">
      <header className="mb-2 shrink-0 rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3 sm:mb-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">
              Central GPS
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
              GPS
            </h1>
            <p className="mt-1 text-sm leading-5 text-sky-100/60">
              Rastreadores, configuração, provisionamento, teste e suporte em
              uma única área.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#7ba6d4]/15 bg-[#143760] p-2 sm:grid-cols-3 xl:grid-cols-6">
            {ABAS.map((item) => {
              const ativo = aba === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAba(item.id)}
                  className={[
                    "min-h-12 rounded-xl px-2 text-[11px] font-black uppercase leading-tight transition sm:px-3",
                    ativo
                      ? "bg-sky-400/15 text-sky-100"
                      : "text-sky-100/45 hover:bg-[#17345e] hover:text-sky-100",
                  ].join(" ")}
                >
                  {item.titulo}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {aba === "visao" && (
        <main className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-none">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MiniResumo label="Área principal" valor="GPS" />
            <MiniResumo label="Rastreadores" valor="Status" tom="green" />
            <MiniResumo label="Configuração" valor="Wi-Fi" tom="amber" />
            <MiniResumo label="Teste" valor="Rotas" />
            <MiniResumo label="Suporte" valor="Checklist" />
          </section>

          <section className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-black text-white">
                  Acessos rápidos
                </h2>
                <p className="mt-1 text-xs text-sky-100/45">
                  Escolha a função que deseja usar na central de GPS.
                </p>
              </div>

              <span className="rounded-full border border-[#7ba6d4]/20 bg-[#143760] px-3 py-1 text-[10px] font-black uppercase text-sky-100/55">
                {abaAtual.titulo}
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <CardAtalho
                titulo="Rastreadores"
                descricao="Veja dispositivos online, sem sinal, offline, Wi-Fi, satélites e vínculo com embarcação."
                icone="◉"
                onClick={() => setAba("rastreadores")}
              />

              <CardAtalho
                titulo="Configuração"
                descricao="Ajuste intervalo de envio, modo inteligente, ativação e troca remota de Wi-Fi."
                icone="▣"
                onClick={() => setAba("configuracao")}
              />

              <CardAtalho
                titulo="Provisionamento"
                descricao="Configure rastreador novo, barco vinculado, rede Wi-Fi e nome da placa."
                icone="◇"
                onClick={() => setAba("provisionamento")}
              />

              <CardAtalho
                titulo="Modo Teste"
                descricao="Crie rotas de teste, pontos, origem, destino e valide o comportamento do GPS."
                icone="⌁"
                onClick={() => setAba("teste")}
              />

              <CardAtalho
                titulo="Checklist GPS"
                descricao="Veja o passo a passo para verificar GPS offline, Wi-Fi, energia, fios e provisionamento."
                icone="✓"
                onClick={() => setAba("checklist")}
              />
            </div>
          </section>
        </main>
      )}

      {aba === "rastreadores" && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] pb-4 scrollbar-none">
          <Rastreadores />
        </div>
      )}

      {aba === "configuracao" && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] pb-4 scrollbar-none">
          <ControleRastreadoresGPS />
        </div>
      )}

      {aba === "provisionamento" && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] pb-4 scrollbar-none">
          <ProvisionamentoRastreadores />
        </div>
      )}

      {aba === "teste" && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] pb-4 scrollbar-none">
          <ModoTesteGPS />
        </div>
      )}

      {aba === "checklist" && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#7ba6d4]/20 bg-[#0d0c2c] pb-4 scrollbar-none">
          <ChecklistRastreadorGPS />
        </div>
      )}
    </div>
  );
}
