import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

const EMAIL_SALVO_KEY = "cademeubarco_login_email";
const LEMBRAR_EMAIL_KEY = "cademeubarco_lembrar_email";

export default function Login() {
  const modal = useAppModal();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [lembrarEmail, setLembrarEmail] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [enviandoReset, setEnviandoReset] = useState(false);

  useEffect(() => {
    const lembrar = localStorage.getItem(LEMBRAR_EMAIL_KEY) === "true";
    const emailSalvo = localStorage.getItem(EMAIL_SALVO_KEY) || "";

    setLembrarEmail(lembrar);

    if (lembrar && emailSalvo) {
      setEmail(emailSalvo);
    }
  }, []);

  const salvarPreferenciaLogin = (emailAtual: string) => {
    if (lembrarEmail) {
      localStorage.setItem(LEMBRAR_EMAIL_KEY, "true");
      localStorage.setItem(EMAIL_SALVO_KEY, emailAtual);
    } else {
      localStorage.removeItem(LEMBRAR_EMAIL_KEY);
      localStorage.removeItem(EMAIL_SALVO_KEY);
    }
  };

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setEntrando(true);

      const emailNormalizado = email.trim().toLowerCase();
      const senhaDigitada = senha.trim();

      const credencial = await signInWithEmailAndPassword(
        auth,
        emailNormalizado,
        senhaDigitada,
      );

      const emailLogado = credencial.user.email?.toLowerCase() || emailNormalizado;
      const funcionarioSnap = await getDoc(doc(db, "funcionarios", emailLogado));
      const funcionario = funcionarioSnap.exists() ? funcionarioSnap.data() : null;

      if (funcionario?.ativo === false || funcionario?.excluido === true) {
        await signOut(auth);
        await modal.erro(
          "Acesso desativado",
          "Seu acesso está desativado. Fale com o administrador.",
        );
        return;
      }

      salvarPreferenciaLogin(emailLogado);

      if (funcionario?.mustChangePassword === true) {
        navigate("/alterar-senha", { replace: true });
        return;
      }

      navigate("/", { replace: true });
    } catch (error: any) {
      console.error("Erro no login:", {
        code: error?.code,
        message: error?.message,
        email: email.trim().toLowerCase(),
      });

      const codigo = String(error?.code || "");

      if (
        codigo.includes("auth/invalid-credential") ||
        codigo.includes("auth/wrong-password")
      ) {
        await modal.erro(
          "E-mail ou senha incorretos",
          "O Firebase recusou o login. Isso normalmente significa que a senha temporária salva no Authentication não é a mesma senha mostrada na tela de permissões.",
        );
        return;
      }

      if (codigo.includes("auth/user-not-found")) {
        await modal.erro(
          "Usuário não existe no login",
          "Esse e-mail existe no Firestore, mas não foi encontrado no Firebase Authentication.",
        );
        return;
      }

      if (codigo.includes("auth/user-disabled")) {
        await modal.erro(
          "Usuário desativado",
          "Esse usuário está desativado no Firebase Authentication.",
        );
        return;
      }

      if (codigo.includes("auth/too-many-requests")) {
        await modal.erro(
          "Muitas tentativas",
          "O Firebase bloqueou temporariamente por muitas tentativas. Aguarde alguns minutos ou redefina a senha pelo administrador.",
        );
        return;
      }

      await modal.erro(
        "Erro no login",
        `${error?.message || "Não foi possível entrar."}\n\nCódigo: ${codigo || "sem código"}`,
      );
    } finally {
      setEntrando(false);
    }
  };

  const enviarNovaSenha = async () => {
    const emailNormalizado = email.trim().toLowerCase();

    if (!emailNormalizado) {
      await modal.aviso(
        "Informe seu e-mail",
        "Digite seu e-mail para receber o link de criação de nova senha.",
      );
      return;
    }

    try {
      setEnviandoReset(true);

      await sendPasswordResetEmail(auth, emailNormalizado);

      await modal.sucesso(
        "Link enviado",
        "Enviamos um link para criar uma nova senha. Verifique sua caixa de entrada e spam.",
      );
    } catch (error: any) {
      await modal.erro(
        "Não foi possível enviar",
        error?.message || "Verifique o e-mail informado e tente novamente.",
      );
    } finally {
      setEnviandoReset(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0d0c2c] p-5 text-white">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[30px] border border-[#7ba6d4]/20 bg-[#0f2240] shadow-2xl lg:grid-cols-[0.95fr_390px]">
        <section className="hidden bg-linear-to-br from-[#071a31] via-[#0f2240] to-[#143760] p-8 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-6xl border border-none bg-sky-300/10 text-3xl text-sky-100">
                <img
                  src="https://firebasestorage.googleapis.com/v0/b/sistema-navegacao.firebasestorage.app/o/loho%20pequena.png?alt=media&token=661b1dcd-fc5c-404a-82c9-d0f00566c2b3"
                  alt="Logo"
                />
              </div>

              <div>
                <h1 className="text-lg font-black uppercase tracking-[0.10em]">
                  Cadê Meu Barco
                </h1>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.1em] text-sky-100/55">
                  Sistema de Navegação
                </p>
              </div>
            </div>

            <div className="mt-12">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-sky-300">
                Central operacional
              </p>
              <h2 className="mt-2 max-w-md text-2xl font-black leading-tight">
                Controle da frota
              </h2>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="text-sm font-black">Sistema operacional</span>
            </div>
          </div>
        </section>

        <form onSubmit={entrar} className="bg-[#071a31] p-7 sm:p-8">
          <div className="mb-7">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-sky-300">
              Acesso
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Entrar</h1>
          </div>

          <label className="block">
            <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-sky-100/55">
              E-mail
            </p>
            <input
              type="email"
              placeholder="seuemail@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3.5 text-sm font-bold text-white outline-none transition placeholder:text-sky-100/35 focus:border-sky-300/60"
              required
            />
          </label>

          <label className="mt-4 block">
            <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-sky-100/55">
              Senha
            </p>

            <div className="relative">
              <input
                type={mostrarSenha ? "text" : "password"}
                placeholder="Digite sua senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] py-3.5 pl-4 pr-12 text-sm font-bold text-white outline-none transition placeholder:text-sky-100/35 focus:border-sky-300/60"
                required
              />

              <button
                type="button"
                onClick={() => setMostrarSenha((atual) => !atual)}
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-sky-100 transition hover:bg-white/10"
                title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              >
                {mostrarSenha ? "🙈" : "👁️"}
              </button>
            </div>
          </label>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-sky-100/70">
              <input
                type="checkbox"
                checked={lembrarEmail}
                onChange={(e) => setLembrarEmail(e.target.checked)}
                className="h-4 w-4 accent-sky-400"
              />
              Lembrar e-mail
            </label>

            <button
              type="button"
              onClick={enviarNovaSenha}
              disabled={enviandoReset}
              className="text-left text-xs font-black uppercase tracking-wide text-sky-300 transition hover:text-sky-100 disabled:opacity-60"
            >
              {enviandoReset ? "Enviando..." : "Esqueci a senha"}
            </button>
          </div>

          <button
            disabled={entrando}
            className="mt-6 w-full rounded-2xl border border-sky-300/30 bg-[#2b5b91] px-5 py-4 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-black/20 transition hover:bg-[#346aa3] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {entrando ? "Entrando..." : "Entrar no sistema"}
          </button>

          <button
            type="button"
            onClick={enviarNovaSenha}
            disabled={enviandoReset}
            className="mt-3 w-full rounded-2xl border border-[#7ba6d4]/20 bg-[#17345e] px-5 py-3 text-xs font-black uppercase tracking-wide text-sky-100 transition hover:bg-[#2b5b91] disabled:opacity-60"
          >
            Criar nova senha
          </button>
        </form>
      </div>
    </div>
  );
}
