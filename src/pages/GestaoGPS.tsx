import React, { useState } from "react";
import ControleRastreadoresGPS from "./ControleRastreadoresGPS";
import ProvisionamentoRastreadores from "./ProvisionamentoRastreadores";

type AbaGPS = "controle" | "provisionamento";

const ABAS = [
  {
    id: "controle" as const,
    titulo: "Controle GPS",
    resumo: "Configurações, intervalo e Wi‑Fi",
  },
  {
    id: "provisionamento" as const,
    titulo: "Provisionamento",
    resumo: "Instalação, vínculo e troca remota",
  },
];

export default function GestaoGPS() {
  const [aba, setAba] = useState<AbaGPS>("controle");

  return (
    <div className="min-h-full bg-[#0d0c2c] text-slate-100">
      <section className="border-b border-[#1d426b] bg-[#0f2240] px-3 py-4 shadow-sm sm:px-5 sm:py-5 xl:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] text-lg font-black text-sky-100">
              ◎
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">
                Central GPS
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
                Gestão GPS
              </h1>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[520px]">
            {ABAS.map((item) => {
              const ativo = aba === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setAba(item.id)}
                  className={[
                    "rounded-2xl border px-4 py-3 text-left transition-all duration-200",
                    ativo
                      ? "border-sky-300/35 bg-[#143760] text-white shadow-sm ring-1 ring-sky-300/20"
                      : "border-[#7ba6d4]/15 bg-[#2b5b91]/35 text-sky-100 hover:border-sky-300/30 hover:bg-[#17345e]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">
                        {item.titulo}
                      </p>

                      <p className="mt-1 truncate text-xs font-semibold text-sky-100/65">
                        {item.resumo}
                      </p>
                    </div>

                    <span
                      className={[
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        ativo
                          ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.14)]"
                          : "bg-sky-200/35",
                      ].join(" ")}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="bg-[#0d0c2c]">
        {aba === "controle" ? (
          <ControleRastreadoresGPS />
        ) : (
          <ProvisionamentoRastreadores />
        )}
      </div>
    </div>
  );
}
