import React from "react";

type TipoImagem = "foto_embarcacao" | "logo_oficial";

export default function EscolhaTipoImagem({
  valor,
  onChange,
  claro = false,
}: {
  valor: string;
  onChange: (valor: TipoImagem) => void;
  claro?: boolean;
}) {
  const opcoes: Array<{
    valor: TipoImagem;
    icone: string;
    titulo: string;
    descricao: string;
  }> = [
    {
      valor: "foto_embarcacao",
      icone: "⛴",
      titulo: "Foto da embarcação",
      descricao: "Imagem limpa, inteira e sem dados pessoais.",
    },
    {
      valor: "logo_oficial",
      icone: "✦",
      titulo: "Marca oficial",
      descricao: "Logomarca própria da embarcação ou empresa.",
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {opcoes.map((opcao) => {
        const selecionada = valor === opcao.valor;
        return (
          <button
            type="button"
            key={opcao.valor}
            onClick={() => onChange(opcao.valor)}
            className={`group relative min-h-[106px] overflow-hidden rounded-2xl border p-3 text-left transition ${
              selecionada
                ? "border-sky-400 bg-gradient-to-br from-sky-500/20 to-cyan-400/5 shadow-[0_0_0_1px_rgba(56,189,248,.18)]"
                : claro
                  ? "border-slate-200 bg-slate-50 hover:border-sky-300"
                  : "border-white/10 bg-white/[0.045] hover:border-sky-400/40"
            }`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${
              selecionada ? "bg-sky-400 text-slate-950" : claro ? "bg-white text-slate-700" : "bg-white/10 text-slate-200"
            }`}>
              {opcao.icone}
            </span>
            <strong className={`mt-2 block text-sm ${claro ? "text-slate-900" : "text-white"}`}>
              {opcao.titulo}
            </strong>
            <span className={`mt-0.5 block text-xs leading-4 ${claro ? "text-slate-500" : "text-slate-400"}`}>
              {opcao.descricao}
            </span>
            <span className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-black ${
              selecionada
                ? "border-sky-300 bg-sky-400 text-slate-950"
                : claro ? "border-slate-300 text-transparent" : "border-white/20 text-transparent"
            }`}>
              ✓
            </span>
          </button>
        );
      })}
    </div>
  );
}
