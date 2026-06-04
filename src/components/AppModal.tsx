import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type ModalTipo = "info" | "success" | "error" | "warning" | "confirm";

type ModalConfig = {
  tipo?: ModalTipo;
  titulo: string;
  mensagem?: string;
  confirmarTexto?: string;
  cancelarTexto?: string;
};

type ModalAberto = Required<Omit<ModalConfig, "mensagem">> & {
  mensagem?: string;
  resolver: (valor: boolean) => void;
};

type AppModalContextValue = {
  abrir: (config: ModalConfig) => Promise<boolean>;
  aviso: (titulo: string, mensagem?: string) => Promise<boolean>;
  sucesso: (titulo: string, mensagem?: string) => Promise<boolean>;
  erro: (titulo: string, mensagem?: string) => Promise<boolean>;
  confirmar: (config: ModalConfig) => Promise<boolean>;
};

const AppModalContext = createContext<AppModalContextValue | null>(null);

const estilos = {
  info: {
    icone: "i",
    etiqueta: "Informação",
    aura: "from-sky-400/25 via-cyan-300/10 to-transparent",
    iconeBox: "border-sky-300/30 bg-sky-300/10 text-sky-100 shadow-sky-400/10",
    detalhe: "bg-sky-300",
    confirmar: "border-sky-300/30 bg-sky-300/15 text-sky-50 hover:bg-sky-300/25",
  },
  success: {
    icone: "✓",
    etiqueta: "Concluído",
    aura: "from-emerald-400/25 via-teal-300/10 to-transparent",
    iconeBox:
      "border-emerald-300/30 bg-emerald-300/10 text-emerald-100 shadow-emerald-400/10",
    detalhe: "bg-emerald-300",
    confirmar:
      "border-emerald-300/30 bg-emerald-300/15 text-emerald-50 hover:bg-emerald-300/25",
  },
  error: {
    icone: "!",
    etiqueta: "Atenção",
    aura: "from-red-400/25 via-rose-300/10 to-transparent",
    iconeBox: "border-red-300/30 bg-red-300/10 text-red-100 shadow-red-400/10",
    detalhe: "bg-red-300",
    confirmar: "border-red-300/30 bg-red-300/15 text-red-50 hover:bg-red-300/25",
  },
  warning: {
    icone: "!",
    etiqueta: "Confirmação",
    aura: "from-amber-400/25 via-orange-300/10 to-transparent",
    iconeBox: "border-amber-300/30 bg-amber-300/10 text-amber-100 shadow-amber-400/10",
    detalhe: "bg-amber-300",
    confirmar: "border-amber-300/30 bg-amber-300/15 text-amber-50 hover:bg-amber-300/25",
  },
  confirm: {
    icone: "?",
    etiqueta: "Confirmação",
    aura: "from-sky-400/25 via-blue-300/10 to-transparent",
    iconeBox: "border-sky-300/30 bg-sky-300/10 text-sky-100 shadow-sky-400/10",
    detalhe: "bg-sky-300",
    confirmar: "border-sky-300/35 bg-[#2b5b91] text-white hover:bg-[#346aa3]",
  },
};

export function AppModalProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<ModalAberto | null>(null);

  const abrir = useCallback((config: ModalConfig) => {
    return new Promise<boolean>((resolver) => {
      setModal({
        tipo: config.tipo || "info",
        titulo: config.titulo,
        mensagem: config.mensagem,
        confirmarTexto: config.confirmarTexto || "Ok",
        cancelarTexto: config.cancelarTexto || "Cancelar",
        resolver,
      });
    });
  }, []);

  const fechar = useCallback(
    (valor: boolean) => {
      if (!modal) return;

      modal.resolver(valor);
      setModal(null);
    },
    [modal],
  );

  const value = useMemo<AppModalContextValue>(
    () => ({
      abrir,
      aviso: (titulo, mensagem) =>
        abrir({
          tipo: "info",
          titulo,
          mensagem,
          confirmarTexto: "Entendi",
        }),
      sucesso: (titulo, mensagem) =>
        abrir({
          tipo: "success",
          titulo,
          mensagem,
          confirmarTexto: "Ok",
        }),
      erro: (titulo, mensagem) =>
        abrir({
          tipo: "error",
          titulo,
          mensagem,
          confirmarTexto: "Fechar",
        }),
      confirmar: (config) =>
        abrir({
          tipo: "confirm",
          confirmarTexto: "Confirmar",
          cancelarTexto: "Cancelar",
          ...config,
        }),
    }),
    [abrir],
  );

  const visual = modal ? estilos[modal.tipo] : estilos.info;

  return (
    <AppModalContext.Provider value={value}>
      {children}

      {modal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#020617]/75 px-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-[420px] overflow-hidden rounded-[30px] border border-white/10 bg-[#071a31]/95 shadow-[0_26px_90px_rgba(0,0,0,0.55)] ring-1 ring-sky-300/10">
            <div
              className={[
                "pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-gradient-to-br blur-2xl",
                visual.aura,
              ].join(" ")}
            />

            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/45 to-transparent" />

            <div className="relative px-5 pb-4 pt-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={["h-2 w-2 rounded-full", visual.detalhe].join(" ")} />
                  <span className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-100/55">
                    {visual.etiqueta}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => fechar(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sm font-black text-sky-100/60 transition hover:bg-white/10 hover:text-white"
                  title="Fechar"
                >
                  ×
                </button>
              </div>

              <div className="flex gap-4">
                <div
                  className={[
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-lg font-black shadow-xl",
                    visual.iconeBox,
                  ].join(" ")}
                >
                  {visual.icone}
                </div>

                <div className="min-w-0 flex-1">
                  <h2 className="text-[19px] font-black leading-6 tracking-tight text-white">
                    {modal.titulo}
                  </h2>

                  {modal.mensagem && (
                    <p className="mt-2 max-h-[210px] overflow-y-auto whitespace-pre-line pr-1 text-[13px] leading-5 text-sky-100/68 scrollbar-none">
                      {modal.mensagem}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="relative flex flex-col-reverse gap-2 border-t border-white/10 bg-[#051326]/70 px-5 py-4 sm:flex-row sm:justify-end">
              {modal.tipo === "confirm" && (
                <button
                  type="button"
                  onClick={() => fechar(false)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-sky-100/70 transition hover:bg-white/10 hover:text-white"
                >
                  {modal.cancelarTexto}
                </button>
              )}

              <button
                type="button"
                onClick={() => fechar(true)}
                className={[
                  "rounded-2xl border px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] shadow-lg transition",
                  visual.confirmar,
                ].join(" ")}
              >
                {modal.confirmarTexto}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppModalContext.Provider>
  );
}

export function useAppModal() {
  const context = useContext(AppModalContext);

  if (!context) {
    throw new Error("useAppModal precisa estar dentro de AppModalProvider.");
  }

  return context;
}
