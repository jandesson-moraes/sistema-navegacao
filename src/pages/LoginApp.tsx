import React, { useEffect } from "react";

export default function LoginApp() {
  useEffect(() => {
    window.location.href = "cadeomeubarco://login";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] p-6 text-white">
      <div className="max-w-md rounded-3xl bg-[#0f172a] p-8 text-center">
        <h1 className="text-2xl font-black">Senha alterada</h1>
        <p className="mt-3 text-slate-400">Abrindo o login do app...</p>

        <a
          href="cadeomeubarco://login"
          className="mt-6 inline-block rounded-2xl bg-sky-500 px-6 py-4 font-black text-white"
        >
          Abrir app
        </a>
      </div>
    </div>
  );
}
