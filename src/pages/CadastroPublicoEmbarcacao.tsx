import React, { useState } from "react";
import { Link } from "react-router-dom";

const URL_CADASTRO =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/solicitarCadastroPublicoEmbarcacao";
const WHATSAPP_EQUIPE = "5592991903278";

type RetornoCadastro = {
  sucesso?: boolean;
  codigoProvisorio?: string;
  erro?: string;
};

async function fotoParaBase64(arquivo: File) {
  if (arquivo.size > 4 * 1024 * 1024) throw new Error("A foto deve ter no máximo 4 MB.");
  return await new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result ?? ""));
    leitor.onerror = () => reject(new Error("Não foi possível ler a foto."));
    leitor.readAsDataURL(arquivo);
  });
}

export default function CadastroPublicoEmbarcacao() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [codigo, setCodigo] = useState("");
  const [telefone, setTelefone] = useState("");

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const formulario = new FormData(evento.currentTarget);
      const foto = formulario.get("foto");
      const corpo: Record<string, unknown> = Object.fromEntries(formulario.entries());
      delete corpo.foto;
      corpo.autorizaMelhoria = formulario.get("autorizaMelhoria") === "on";
      if (foto instanceof File && foto.size > 0) corpo.fotoBase64 = await fotoParaBase64(foto);

      const resposta = await fetch(URL_CADASTRO, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(corpo),
      });
      const retorno = (await resposta.json()) as RetornoCadastro;
      if (!resposta.ok || !retorno.codigoProvisorio) {
        throw new Error(retorno.erro || "Não foi possível enviar o cadastro.");
      }
      setCodigo(retorno.codigoProvisorio);
      setTelefone(String(corpo.telefone ?? ""));
      window.scrollTo({top: 0, behavior: "smooth"});
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  if (codigo) {
    const mensagem = encodeURIComponent(
      `Olá! Finalizei o cadastro da embarcação no Cadê o Meu Barco. Meu código é ${codigo} e meu telefone é ${telefone}.`,
    );
    return (
      <main className="min-h-screen bg-[#020817] px-4 py-10 text-white">
        <section className="mx-auto max-w-xl rounded-[32px] border border-emerald-400/25 bg-[#071a2f] p-6 shadow-2xl sm:p-9">
          <div className="text-5xl">✅</div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
            Cadastro recebido
          </p>
          <h1 className="mt-2 text-3xl font-black">Agora confirme pelo WhatsApp</h1>
          <p className="mt-4 text-base leading-7 text-slate-300">
            A embarcação ainda não está publicada. Nossa equipe conferirá os dados antes
            da aprovação.
          </p>
          <div className="mt-6 rounded-3xl bg-white/8 p-5 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Código provisório
            </p>
            <strong className="mt-2 block text-3xl tracking-wider text-amber-300">{codigo}</strong>
          </div>
          <a
            href={`https://wa.me/${WHATSAPP_EQUIPE}?text=${mensagem}`}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-emerald-500 px-5 text-center text-base font-black text-white"
          >
            Confirmar cadastro no WhatsApp
          </a>
          <p className="mt-4 text-center text-xs text-slate-400">
            Guarde este código para acompanhar ou corrigir o cadastro.
          </p>
        </section>
      </main>
    );
  }

  const campo =
    "mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-base text-white outline-none placeholder:text-slate-500 focus:border-sky-400";
  return (
    <main className="min-h-screen bg-[#020817] px-4 py-7 text-white sm:py-12">
      <section className="mx-auto max-w-3xl">
        <header className="mb-7">
          <Link to="/login" className="text-sm font-bold text-sky-300">← Área da equipe</Link>
          <p className="mt-7 text-xs font-black uppercase tracking-[0.22em] text-amber-300">
            Cadê o Meu Barco
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">Cadastre sua embarcação</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            É gratuito começar. Envie os dados, confirme seu WhatsApp e aguarde a análise.
          </p>
        </header>

        <form onSubmit={enviar} className="space-y-6 rounded-[32px] border border-white/10 bg-[#071a2f] p-5 shadow-2xl sm:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="font-bold">Nome da embarcação *
              <input name="nomeEmbarcacao" required minLength={2} className={campo} />
            </label>
            <label className="font-bold">Tipo
              <select name="tipoEmbarcacao" className={campo} defaultValue="">
                <option value="" className="text-black">Selecione</option>
                <option value="barco regional" className="text-black">Barco regional</option>
                <option value="lancha" className="text-black">Lancha</option>
                <option value="balsa" className="text-black">Balsa</option>
                <option value="outro" className="text-black">Outro</option>
              </select>
            </label>
            <label className="font-bold">Cidade
              <input name="cidade" className={campo} placeholder="Ex.: Manaus" />
            </label>
            <label className="font-bold">Porto de saída
              <input name="portoSaida" className={campo} />
            </label>
            <label className="font-bold">Cidade de origem
              <input name="origemCidade" className={campo} placeholder="Ex.: Manaus - AM" />
            </label>
            <label className="font-bold">Cidade de destino
              <input name="destinoCidade" className={campo} placeholder="Ex.: Santarém - PA" />
            </label>
            <label className="font-bold">CNPJ
              <input name="cnpj" inputMode="numeric" className={campo} placeholder="Se a operação possuir" />
            </label>
            <label className="font-bold">Plano de interesse
              <select name="planoInteresse" className={campo} defaultValue="basico">
                <option value="basico" className="text-black">Básico gratuito</option>
                <option value="vitrine" className="text-black">Vitrine</option>
                <option value="tempo_real" className="text-black">Tempo Real</option>
              </select>
            </label>
          </div>

          <label className="block font-bold">Descrição da embarcação
            <textarea
              name="descricao"
              rows={5}
              className={`${campo} py-3`}
              placeholder="Conte como é a embarcação e quais informações são úteis ao passageiro."
            />
          </label>
          <label className="block font-bold">Escalas
            <textarea
              name="escalasTexto"
              rows={3}
              className={`${campo} py-3`}
              placeholder="Uma por linha ou separadas por vírgula. Não informe horários."
            />
          </label>

          <div className="border-t border-white/10 pt-6">
            <h2 className="text-xl font-black">Quem está cadastrando?</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <label className="font-bold">Seu nome *
                <input name="nomeSolicitante" required minLength={2} className={campo} />
              </label>
              <label className="font-bold">WhatsApp *
                <input name="telefone" required inputMode="tel" className={campo} placeholder="92999999999" />
              </label>
              <label className="font-bold">Sua relação com o barco
                <select name="vinculo" className={campo}>
                  <option value="dono" className="text-black">Sou proprietário</option>
                  <option value="tripulante" className="text-black">Sou tripulante</option>
                  <option value="representante" className="text-black">Sou representante</option>
                  <option value="passageiro" className="text-black">Sou passageiro/colaborador</option>
                </select>
              </label>
              <label className="font-bold">Foto limpa da embarcação
                <input name="foto" type="file" accept="image/jpeg,image/png,image/webp" className={`${campo} py-3`} />
              </label>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-2xl bg-sky-400/8 p-4 text-sm leading-6 text-slate-200">
            <input name="autorizaMelhoria" type="checkbox" className="mt-1 h-5 w-5" />
            Autorizo a equipe a melhorar a foto e o texto, sem inventar informações e sem
            alterar a identidade da embarcação.
          </label>
          <label className="block font-bold">Observações
            <textarea name="observacoes" rows={4} className={`${campo} py-3`} />
          </label>
          {erro && <p className="rounded-2xl bg-red-500/15 p-4 font-bold text-red-200">{erro}</p>}
          <button disabled={enviando} className="min-h-14 w-full rounded-2xl bg-sky-500 px-5 text-lg font-black disabled:opacity-60">
            {enviando ? "Enviando..." : "Enviar para análise"}
          </button>
          <p className="text-center text-xs leading-5 text-slate-400">
            O envio não publica automaticamente. A equipe valida telefone, duplicidade,
            imagem e informações antes de liberar no aplicativo.
          </p>
        </form>
      </section>
    </main>
  );
}
