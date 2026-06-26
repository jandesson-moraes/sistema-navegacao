import React, { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { getAuth, onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../src/config/firebase";

import { Layout } from "../src/components/Layout";
import { AppModalProvider } from "./components/AppModal";
import AlterarSenha from "../src/pages/AlterarSenha";
import Embarcacoes from "../src/pages/Embarcacoes";
import FuncionariosPermissoes from "../src/pages/FuncionariosPermissoes";
import GestaoBanners from "../src/pages/GestaoBanners";
import GPS from "../src/pages/GPS";
import InteligenciaComercial from "../src/pages/InteligenciaComercial";
import Prospecao from "../src/pages/Prospecao";
import Login from "../src/pages/Login";
import MapaTatico from "../src/pages/MapaTatico";
import NotificacoesChegada from "../src/pages/NotificacoesChegada";
import Rotas from "../src/pages/Rotas";
import Terminais from "../src/pages/Terminais";
import FinanceiroUnificado from "../src/pages/FinanceiroUnificado";
import ChecklistRastreadorGPS from "../src/pages/ChecklistRastreadorGPS";
import RedefinirSenha from "../src/pages/RedefinirSenha";
import LoginApp from "../src/pages/LoginApp";

function AppShell({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}

const ADMIN_FIXOS = ["jandessonmoraes@gmail.com", "escdecastrousinagen@gmail.com"];

type PermissaoKey =
  | "mapa"
  | "rotas"
  | "frota"
  | "portos"
  | "banners"
  | "gps"
  | "rastreadores"
  | "modoTesteGps"
  | "controleGps"
  | "prospeccao"
  | "financeiro"
  | "inteligencia"
  | "notificacoes"
  | "funcionarios";

function normalizarEmail(email: string) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isAdminFixo(email: string) {
  return ADMIN_FIXOS.includes(normalizarEmail(email));
}

function TelaCarregandoAcesso() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0d0c2c] p-6 text-white">
      <div className="rounded-3xl border border-sky-400/20 bg-sky-400/10 p-8 text-center shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-300">
          Verificando acesso
        </p>
        <h1 className="mt-3 text-2xl font-black">Aguarde...</h1>
      </div>
    </div>
  );
}

function TelaAcessoNegado() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0d0c2c] p-6 text-white">
      <div className="max-w-xl rounded-3xl border border-red-400/20 bg-red-400/10 p-8 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-red-300">
          Acesso negado
        </p>
        <h1 className="mt-3 text-2xl font-black">Você não tem permissão</h1>
        <p className="mt-3 text-sm leading-6 text-red-100/75">
          Esta área é restrita. Faça login com uma conta autorizada ou solicite liberação
          para um administrador.
        </p>
      </div>
    </div>
  );
}

function useUsuarioAutorizado(permissao?: PermissaoKey, somenteAdmin = false) {
  const [carregando, setCarregando] = useState(true);
  const [usuario, setUsuario] = useState<User | null>(null);
  const [autorizado, setAutorizado] = useState(false);

  useEffect(() => {
    const auth = getAuth();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUsuario(user);

      try {
        if (!user?.email) {
          setAutorizado(false);
          return;
        }

        const emailNormalizado = normalizarEmail(user.email);

        if (isAdminFixo(emailNormalizado)) {
          setAutorizado(true);
          return;
        }

        if (somenteAdmin) {
          setAutorizado(false);
          return;
        }

        if (!permissao) {
          setAutorizado(true);
          return;
        }

        const ref = doc(db, "funcionarios", emailNormalizado);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setAutorizado(false);
          return;
        }

        const dados = snap.data() as any;

        if (dados.excluido === true || dados.ativo === false) {
          setAutorizado(false);
          return;
        }

        if (dados.tipo === "admin") {
          setAutorizado(true);
          return;
        }

        const permissoes = dados.permissoes || {};

        if (permissao === "gps") {
          setAutorizado(
            permissoes.gps === true ||
              permissoes.rastreadores === true ||
              permissoes.controleGps === true ||
              permissoes.modoTesteGps === true,
          );
          return;
        }

        setAutorizado(permissoes[permissao] === true);
      } catch (error) {
        console.error("Erro ao verificar permissão:", error);
        setAutorizado(false);
      } finally {
        setCarregando(false);
      }
    });

    return () => unsubscribe();
  }, [permissao, somenteAdmin]);

  return { carregando, usuario, autorizado };
}

function RotaProtegida({
  children,
  permissao,
}: {
  children: React.ReactNode;
  permissao?: PermissaoKey;
}) {
  const { carregando, usuario, autorizado } = useUsuarioAutorizado(permissao);

  if (carregando) return <TelaCarregandoAcesso />;

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  if (!autorizado) {
    return <TelaAcessoNegado />;
  }

  return <AppShell>{children}</AppShell>;
}

function RotaAdmin({ children }: { children: React.ReactNode }) {
  const { carregando, usuario, autorizado } = useUsuarioAutorizado(undefined, true);

  if (carregando) return <TelaCarregandoAcesso />;

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  if (!autorizado) {
    return <TelaAcessoNegado />;
  }

  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <AppModalProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/alterar-senha" element={<AlterarSenha />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          <Route path="/login-app" element={<LoginApp />} />
          <Route
            path="/"
            element={
              <RotaProtegida permissao="mapa">
                <MapaTatico />
              </RotaProtegida>
            }
          />

          <Route
            path="/dashboard"
            element={
              <RotaProtegida permissao="mapa">
                <MapaTatico />
              </RotaProtegida>
            }
          />

          <Route
            path="/embarcacoes"
            element={
              <RotaProtegida permissao="frota">
                <Embarcacoes />
              </RotaProtegida>
            }
          />

          <Route
            path="/frota"
            element={
              <RotaProtegida permissao="frota">
                <Embarcacoes />
              </RotaProtegida>
            }
          />

          <Route
            path="/terminais"
            element={
              <RotaProtegida permissao="portos">
                <Terminais />
              </RotaProtegida>
            }
          />

          <Route
            path="/banners"
            element={
              <RotaProtegida permissao="banners">
                <GestaoBanners />
              </RotaProtegida>
            }
          />

          <Route path="/rastreadores" element={<Navigate to="/gps" replace />} />

          <Route
            path="/inteligencia-comercial"
            element={
              <RotaProtegida permissao="inteligencia">
                <InteligenciaComercial />
              </RotaProtegida>
            }
          />

          <Route
            path="/prospeccao"
            element={
              <RotaProtegida permissao="prospeccao">
                <Prospecao />
              </RotaProtegida>
            }
          />

          <Route
            path="/rotas"
            element={
              <RotaProtegida permissao="rotas">
                <Rotas />
              </RotaProtegida>
            }
          />

          <Route
            path="/notificacoes"
            element={
              <RotaProtegida permissao="notificacoes">
                <NotificacoesChegada />
              </RotaProtegida>
            }
          />

          <Route path="/modo-teste-gps" element={<Navigate to="/gps" replace />} />
          <Route path="/controle-gps" element={<Navigate to="/gps" replace />} />
          <Route path="/provisionamento-gps" element={<Navigate to="/gps" replace />} />
          <Route path="/gestao-gps" element={<Navigate to="/gps" replace />} />

          <Route
            path="/gps"
            element={
              <RotaProtegida permissao="gps">
                <GPS />
              </RotaProtegida>
            }
          />

          <Route
            path="/checklist-gps"
            element={
              <RotaProtegida permissao="gps">
                <ChecklistRastreadorGPS />
              </RotaProtegida>
            }
          />

          <Route path="/suporte-gps" element={<Navigate to="/checklist-gps" replace />} />

          <Route
            path="/checklist-gps"
            element={
              <RotaProtegida permissao="gps">
                <ChecklistRastreadorGPS />
              </RotaProtegida>
            }
          />

          <Route
            path="/usuarios"
            element={
              <RotaAdmin>
                <FuncionariosPermissoes />
              </RotaAdmin>
            }
          />

          <Route
            path="/permissoes-usuarios"
            element={
              <RotaAdmin>
                <FuncionariosPermissoes />
              </RotaAdmin>
            }
          />

          <Route
            path="/funcionarios"
            element={
              <RotaAdmin>
                <FuncionariosPermissoes />
              </RotaAdmin>
            }
          />

          <Route
            path="/financeiro"
            element={
              <RotaProtegida permissao="financeiro">
                <FinanceiroUnificado />
              </RotaProtegida>
            }
          />

          <Route
            path="/centro-financeiro"
            element={<Navigate to="/financeiro" replace />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppModalProvider>
  );
}
