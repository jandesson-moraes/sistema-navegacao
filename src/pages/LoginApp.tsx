import React, { useEffect } from "react";

export default function LoginApp() {
  useEffect(() => {
    window.location.href = "cadeomeubarco://login";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] p-6 text-white">
      <div className="w-full max-w-md rounded-[32px] border border-sky-400/20 bg-[#0f172a] p-8 text-center shadow-2xl">
        <h1 className="text-3xl font-black">Senha alterada</h1>

        <p className="mt-4 text-sm leading-6 text-slate-400">
          Sua senha foi alterada com sucesso. Agora abra o app Cadê o Meu Barco e faça
          login com a nova senha.
        </p>

        <a
          href="cadeomeubarco://login"
          className="mt-6 inline-block w-full rounded-2xl bg-sky-500 px-5 py-4 text-xs font-black uppercase tracking-wide text-white"
        >
          Abrir login do app
        </a>
      </div>
    </div>
  );
}
