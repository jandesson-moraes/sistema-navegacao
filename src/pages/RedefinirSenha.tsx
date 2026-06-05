import React, { useState } from "react";
import { confirmPasswordReset, sendPasswordResetEmail } from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle, Eye, EyeOff, Mail, Send } from "lucide-react";
import { auth } from "../config/firebase";
import logoApp from "../assets/icon.png";

export default function RedefinirSenha() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const oobCode = params.get("oobCode");
  const modoNovaSenha = !!oobCode;

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [sucesso, setSucesso] = useState(false);

  const senhaMinima = senha.length >= 6;
  const digitouConfirmacao = confirmacao.length > 0;
  const senhasIguais = senha === confirmacao && digitouConfirmacao;

  const enviarLink = async () => {
    if (!email.trim()) {
      setSucesso(false);
      setMensagem("Digite seu e-mail para receber o link.");
      return;
    }

    try {
      setCarregando(true);

      await sendPasswordResetEmail(auth, email.trim().toLowerCase(), {
        url: "cadeomeubarco://login",
        handleCodeInApp: false,
      });

      setSucesso(true);
      setMensagem(
        "Enviamos o link de redefinição para seu e-mail. Verifique também o spam.",
      );
    } catch {
      setSucesso(false);
      setMensagem("Não foi possível enviar o link. Verifique o e-mail informado.");
    } finally {
      setCarregando(false);
    }
  };

  const salvarNovaSenha = async () => {
    if (!oobCode) {
      setSucesso(false);
      setMensagem("Link inválido ou expirado.");
      return;
    }

    if (!senhaMinima) {
      setSucesso(false);
      setMensagem("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    if (!senhasIguais) {
      setSucesso(false);
      setMensagem("As senhas não conferem.");
      return;
    }

    try {
      setCarregando(true);
      await confirmPasswordReset(auth, oobCode, senha);
      setSucesso(true);
      setMensagem("Senha redefinida com sucesso.");
    } catch (error: any) {
      console.error("ERRO RESET:", error.code, error.message);
      setSucesso(false);
      setMensagem(`${error.code}: ${error.message}`);
    } finally {
      setCarregando(false);
    }
  };

  const bordaSenha =
    digitouConfirmacao && !senhasIguais
      ? "border-red-500"
      : senhasIguais
        ? "border-emerald-500"
        : "border-[#334155]";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] p-6 text-white">
      <div className="w-full max-w-md rounded-[32px] border border-sky-400/20 bg-[#0f172a] p-8 shadow-2xl shadow-sky-950/60">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-3xl bg-sky-400/10 p-2">
            <img
              src={logoApp}
              alt="Cadê o Meu Barco"
              className="h-full w-full rounded-2xl object-cover"
            />
          </div>

          <p className="text-xs font-black uppercase tracking-[0.28em] text-sky-400">
            Cadê o Meu Barco
          </p>

          <h1 className="mt-3 text-4xl font-black">
            {modoNovaSenha ? "Redefinir senha" : "Recuperar senha"}
          </h1>

          <p className="mt-4 text-sm leading-6 text-slate-400">
            {modoNovaSenha
              ? "Crie uma nova senha para acessar sua conta de passageiro."
              : "Informe seu e-mail para receber o link de redefinição."}
          </p>
        </div>

        {!modoNovaSenha ? (
          <div className="grid gap-4">
            <label>
              <p className="mb-2 text-xs font-black uppercase text-sky-400">E-mail</p>

              <div className="flex items-center rounded-2xl border border-[#334155] bg-[#020617] px-4">
                <Mail size={20} className="text-sky-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full bg-transparent px-3 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-500"
                />
              </div>
            </label>

            {mensagem && (
              <div
                className={`flex gap-2 rounded-2xl p-3 text-sm ${
                  sucesso
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-red-500/10 text-red-300"
                }`}
              >
                {sucesso ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                <span>{mensagem}</span>
              </div>
            )}

            <button
              onClick={enviarLink}
              disabled={carregando}
              className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-4 text-xs font-black uppercase tracking-wide text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {carregando ? "Enviando..." : "Enviar link"}
              {!carregando && <Send size={18} />}
            </button>
          </div>
        ) : sucesso ? (
          <div className="text-center">
            <div className="mb-5 rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-300">
              {mensagem}
            </div>

            <button
              onClick={() => navigate("/login")}
              className="w-full rounded-2xl bg-sky-500 px-5 py-4 text-xs font-black uppercase tracking-wide text-white"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            <label>
              <p className="mb-2 text-xs font-black uppercase text-sky-400">Nova senha</p>

              <div
                className={`flex items-center rounded-2xl border bg-[#020617] px-4 ${bordaSenha}`}
              >
                <input
                  type={mostrarSenha ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Digite sua nova senha"
                  className="w-full bg-transparent py-4 text-sm font-bold text-white outline-none placeholder:text-slate-500"
                />
                <button type="button" onClick={() => setMostrarSenha(!mostrarSenha)}>
                  {mostrarSenha ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </label>

            <label>
              <p className="mb-2 text-xs font-black uppercase text-sky-400">
                Confirmar senha
              </p>

              <div
                className={`flex items-center rounded-2xl border bg-[#020617] px-4 ${bordaSenha}`}
              >
                <input
                  type={mostrarConfirmacao ? "text" : "password"}
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  placeholder="Repita sua nova senha"
                  className="w-full bg-transparent py-4 text-sm font-bold text-white outline-none placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setMostrarConfirmacao(!mostrarConfirmacao)}
                >
                  {mostrarConfirmacao ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </label>

            {digitouConfirmacao && (
              <div
                className={`flex items-center gap-2 rounded-2xl p-3 text-sm ${
                  senhasIguais
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-red-500/10 text-red-300"
                }`}
              >
                {senhasIguais ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                <span>
                  {senhasIguais ? "As senhas estão iguais." : "As senhas não conferem."}
                </span>
              </div>
            )}

            {mensagem && (
              <div className="rounded-2xl bg-red-500/10 p-3 text-sm text-red-300">
                {mensagem}
              </div>
            )}

            <button
              onClick={salvarNovaSenha}
              disabled={carregando || !senhaMinima || !senhasIguais}
              className="mt-4 rounded-2xl bg-sky-500 px-5 py-4 text-xs font-black uppercase tracking-wide text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {carregando ? "Salvando..." : "Salvar nova senha"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
