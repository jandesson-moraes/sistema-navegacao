import React, { useState } from "react";
import { getAuth, signOut, updatePassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../config/firebase";

export default function AlterarSenha() {
  const navigate = useNavigate();
  const auth = getAuth();
  const usuario = auth.currentUser;

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const alterarSenha = async () => {
    try {
      if (!usuario?.email) {
        alert("Sessão não encontrada. Faça login novamente.");
        navigate("/login", { replace: true });
        return;
      }

      if (senha.length < 6) {
        alert("A nova senha precisa ter pelo menos 6 caracteres.");
        return;
      }

      if (senha !== confirmacao) {
        alert("As senhas não conferem.");
        return;
      }

      setSalvando(true);

      await updatePassword(usuario, senha);

      await setDoc(
        doc(db, "funcionarios", usuario.email.toLowerCase()),
        {
          mustChangePassword: false,
          primeiroAcesso: false,
          senhaAlteradaEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      alert("Senha criada com sucesso.");
      navigate("/", { replace: true });
    } catch (error: any) {
      if (String(error?.code || "").includes("requires-recent-login")) {
        alert(
          "Por segurança, faça login novamente com a senha temporária e tente trocar a senha.",
        );
        await signOut(auth);
        navigate("/login", { replace: true });
        return;
      }

      alert(error?.message || "Erro ao alterar senha.");
    } finally {
      setSalvando(false);
    }
  };

  const sair = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f7fb] p-6 text-slate-900">
      <div className="w-full max-w-md rounded-[32px] border border-slate-200 bg-white p-8 shadow-2xl shadow-slate-200/70">
        <div className="mb-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#061b32] text-2xl text-sky-200">
              ⚓
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">
                Primeiro acesso
              </p>
              <h1 className="text-2xl font-black tracking-tight text-[#0f2240]">
                Crie sua senha
              </h1>
            </div>
          </div>

          <p className="text-sm leading-6 text-slate-500">
            Você entrou com uma senha temporária. Para continuar usando o Sistema de
            Navegação, crie uma senha própria.
          </p>
        </div>

        <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs text-slate-700">
            Usuário: <b>{usuario?.email || "não identificado"}</b>
          </p>
        </div>

        <div className="grid gap-4">
          <label>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
              Nova senha
            </p>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </label>

          <label>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
              Confirmar nova senha
            </p>
            <input
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </label>

          <button
            onClick={alterarSenha}
            disabled={salvando}
            className="rounded-2xl bg-[#0b4f9f] px-5 py-4 text-xs font-black uppercase tracking-wide text-white shadow-lg shadow-blue-900/20 transition hover:bg-[#073f80] disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Salvar nova senha"}
          </button>

          <button
            onClick={sair}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs font-black uppercase tracking-wide text-slate-600 transition hover:bg-slate-50"
          >
            Sair e voltar ao login
          </button>
        </div>
      </div>
    </div>
  );
}
