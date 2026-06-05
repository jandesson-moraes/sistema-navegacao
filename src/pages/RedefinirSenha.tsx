import React, { useState } from "react";
import { confirmPasswordReset } from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../config/firebase";

export default function RedefinirSenha() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const oobCode = params.get("oobCode");

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  const redefinirSenha = async () => {
    if (!oobCode) {
      alert("Link inválido ou expirado.");
      return;
    }

    if (senha.length < 6) {
      alert("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    if (senha !== confirmacao) {
      alert("As senhas não conferem.");
      return;
    }

    try {
      setSalvando(true);
      await confirmPasswordReset(auth, oobCode, senha);
      setSucesso(true);
    } catch (error) {
      alert("Link inválido, expirado ou já utilizado.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] p-6 text-white">
      <div className="w-full max-w-md rounded-[32px] border border-sky-400/20 bg-[#0f172a] p-8 shadow-2xl shadow-sky-950/60">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-sky-400/10 text-4xl">
            ⚓
          </div>

          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-400">
            Cadê o Meu Barco
          </p>

          <h1 className="mt-2 text-3xl font-black">Redefinir senha</h1>

          <p className="mt-3 text-sm leading-6 text-slate-400">
            Crie uma nova senha para acessar sua conta de passageiro.
          </p>
        </div>

        {sucesso ? (
          <div className="text-center">
            <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
              Senha redefinida com sucesso.
            </div>

            <button
              onClick={() => navigate("/login")}
              className="w-full rounded-2xl bg-sky-500 px-5 py-4 text-xs font-black uppercase tracking-wide text-white hover:bg-sky-600"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            <label>
              <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-sky-400">
                Nova senha
              </p>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Digite sua nova senha"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3.5 text-sm font-bold text-white outline-none focus:border-sky-400"
              />
            </label>

            <label>
              <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-sky-400">
                Confirmar senha
              </p>
              <input
                type="password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder="Repita sua nova senha"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3.5 text-sm font-bold text-white outline-none focus:border-sky-400"
              />
            </label>

            <button
              onClick={redefinirSenha}
              disabled={salvando}
              className="rounded-2xl bg-sky-500 px-5 py-4 text-xs font-black uppercase tracking-wide text-white hover:bg-sky-600 disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar nova senha"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
