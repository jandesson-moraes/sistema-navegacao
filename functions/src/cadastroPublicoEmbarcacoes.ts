import * as admin from "firebase-admin";
import {onRequest} from "firebase-functions/v2/https";
import {randomBytes, randomUUID} from "node:crypto";

const REGIAO = "us-central1";
const LIMITE_FOTO_BYTES = 4 * 1024 * 1024;

function texto(valor: unknown, limite = 160) {
  return String(valor ?? "").trim().slice(0, limite);
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function normalizar(valor: unknown) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function idOperacional(valor: unknown) {
  return texto(valor, 120)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
}

function rotasValidas(valor: unknown) {
  if (!Array.isArray(valor)) return [];
  return valor.slice(0, 12).map((item: unknown) => {
    const rota = (item ?? {}) as Record<string, unknown>;
    const dias = Array.isArray(rota.diasSemana) ?
      rota.diasSemana.map(Number).filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6) :
      [];
    const escalasRecebidas = Array.isArray(rota.escalas) ? rota.escalas : [];
    const escalas = escalasRecebidas.slice(0, 30).map((itemEscala: unknown) => {
      const escala = (itemEscala ?? {}) as Record<string, unknown>;
      return {
        uf: texto(escala.uf, 2).toUpperCase(),
        cidade: texto(escala.cidade, 120),
        porto: texto(escala.porto, 160),
        diasPassagem: Array.from(new Set(
          (Array.isArray(escala.diasPassagem) ? escala.diasPassagem : [])
            .map(Number)
            .filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6),
        )).sort(),
        diaRelativo: Math.max(0, Math.min(60, Number(escala.diaRelativo) || 0)),
        horarioChegada: /^\d{2}:\d{2}$/.test(texto(escala.horarioChegada)) ?
          texto(escala.horarioChegada) : "",
        horarioSaida: /^\d{2}:\d{2}$/.test(texto(escala.horarioSaida)) ?
          texto(escala.horarioSaida) : "",
      };
    }).filter((escala) => escala.cidade || escala.porto);
    return {
      sentido: texto(rota.sentido) === "volta" ? "volta" : "ida",
      origemUf: texto(rota.origemUf, 2).toUpperCase(),
      origemCidade: texto(rota.origemCidade, 120),
      portoOrigem: texto(rota.portoOrigem, 160),
      destinoUf: texto(rota.destinoUf, 2).toUpperCase(),
      destinoCidade: texto(rota.destinoCidade, 120),
      portoDestino: texto(rota.portoDestino, 160),
      diasSemana: Array.from(new Set(dias)).sort(),
      horarioSaida: /^\d{2}:\d{2}$/.test(texto(rota.horarioSaida)) ?
        texto(rota.horarioSaida) : "",
      destinoDiaRelativo: Math.max(
        0,
        Math.min(60, Number(rota.destinoDiaRelativo) || 0),
      ),
      destinoHorarioChegada: /^\d{2}:\d{2}$/.test(texto(rota.destinoHorarioChegada)) ?
        texto(rota.destinoHorarioChegada) : "",
      duracaoNaoInformada: rota.duracaoNaoInformada !== false,
      duracaoHoras: rota.duracaoNaoInformada !== false ?
        0 :
        Math.max(0, Math.min(1440, Number(rota.duracaoHoras) || 0)),
      itinerarioPersonalizado: rota.itinerarioPersonalizado === true,
      escalas,
    };
  }).filter((rota) => rota.origemCidade || rota.destinoCidade || rota.escalas.length);
}

function cnpjValido(valor: string) {
  const cnpj = somenteDigitos(valor);
  if (!cnpj) return true;
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calcular = (base: string, pesos: number[]) => {
    const soma = base
      .split("")
      .reduce((total, numero, indice) => total + Number(numero) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = calcular(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcular(cnpj.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${d1}${d2}`);
}

function codigoProvisorio() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(7);
  let codigo = "";
  for (let i = 0; i < 7; i += 1) codigo += alfabeto[bytes[i] % alfabeto.length];
  return `CMB-${codigo}`;
}

function liberarCors(req: {headers: Record<string, unknown>}, res: {
  set: (campo: string, valor: string) => void;
}) {
  const origem = texto(req.headers.origin, 300);
  const permitida =
    /^https:\/\/([a-z0-9-]+\.)*(cadeomeubarco|sistema-navegacao)\./i.test(origem) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origem);
  res.set("Access-Control-Allow-Origin", permitida ? origem : "https://sistema-navegacao.web.app");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

export const solicitarCadastroPublicoEmbarcacao = onRequest(
  {region: REGIAO, timeoutSeconds: 60, memory: "512MiB"},
  async (req, res) => {
    liberarCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({erro: "Método não permitido."});
      return;
    }

    try {
      const dados = (req.body ?? {}) as Record<string, unknown>;
      const nomeEmbarcacao = texto(dados.nomeEmbarcacao, 120);
      const nomeSolicitante = texto(dados.nomeSolicitante, 120);
      const telefone = somenteDigitos(dados.telefone);
      const cidade = texto(dados.cidade, 100);
      const portoSaida = texto(dados.portoSaida, 120);
      const cnpj = somenteDigitos(dados.cnpj);
      const rotasCadastro = rotasValidas(dados.rotas);
      const rotaPrincipal = rotasCadastro.find((rota) => rota.sentido === "ida") ||
        rotasCadastro[0];

      const partesNome = nomeSolicitante.split(/\s+/).filter((parte) => parte.length >= 2);
      if (nomeEmbarcacao.length < 2 || partesNome.length < 2) {
        res.status(400).json({erro: "Informe o nome da embarcação e o nome completo do responsável."});
        return;
      }
      if (telefone.length < 10 || telefone.length > 13) {
        res.status(400).json({erro: "Informe um telefone com WhatsApp válido."});
        return;
      }
      if (!cnpjValido(cnpj)) {
        res.status(400).json({erro: "O CNPJ informado não é válido."});
        return;
      }

      const banco = admin.firestore();
      const hoje = new Date().toISOString().slice(0, 10);
      const limiteId = `${telefone}_${hoje}`;
      const limiteRef = banco.collection("limites_cadastro_publico").doc(limiteId);
      const limiteSnap = await limiteRef.get();
      if (Number(limiteSnap.data()?.quantidade ?? 0) >= 3) {
        res.status(429).json({erro: "Limite diário atingido para este telefone."});
        return;
      }

      let codigo = codigoProvisorio();
      for (let tentativa = 0; tentativa < 4; tentativa += 1) {
        const existente = await banco
          .collection("solicitacoes_cadastro_embarcacoes")
          .where("codigoProvisorio", "==", codigo)
          .limit(1)
          .get();
        if (existente.empty) break;
        codigo = codigoProvisorio();
      }

      const ref = banco.collection("solicitacoes_cadastro_embarcacoes").doc();
      let fotoUrl = "";
      const fotoBase64 = texto(dados.fotoBase64, 6_500_000);
      if (fotoBase64) {
        const correspondencia = fotoBase64.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!correspondencia) {
          res.status(400).json({erro: "Formato de foto inválido."});
          return;
        }
        const arquivo = Buffer.from(correspondencia[2], "base64");
        if (arquivo.length > LIMITE_FOTO_BYTES) {
          res.status(400).json({erro: "A foto deve ter no máximo 4 MB."});
          return;
        }
        const extensao = correspondencia[1] === "image/png" ? "png" :
          correspondencia[1] === "image/webp" ? "webp" : "jpg";
        const caminho = `solicitacoes-cadastro/${ref.id}/original.${extensao}`;
        const bucket = admin.storage().bucket();
        const arquivoStorage = bucket.file(caminho);
        const tokenDownload = randomUUID();
        await arquivoStorage.save(arquivo, {
          contentType: correspondencia[1],
          metadata: {
            cacheControl: "public,max-age=3600",
            metadata: {firebaseStorageDownloadTokens: tokenDownload},
          },
        });
        fotoUrl =
          `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
          `${encodeURIComponent(caminho)}?alt=media&token=${tokenDownload}`;
      }

      const agora = admin.firestore.FieldValue.serverTimestamp();
      await banco.runTransaction(async (transacao) => {
        const limiteAtual = await transacao.get(limiteRef);
        const quantidade = Number(limiteAtual.data()?.quantidade ?? 0);
        if (quantidade >= 3) throw new Error("LIMITE_DIARIO");
        transacao.set(limiteRef, {quantidade: quantidade + 1, atualizadoEm: agora}, {merge: true});
        transacao.set(ref, {
          codigoProvisorio: codigo,
          idEmbarcacaoSugerido: idOperacional(nomeEmbarcacao),
          nomeEmbarcacao,
          nomeNormalizado: normalizar(nomeEmbarcacao),
          tipoEmbarcacao: texto(dados.tipoEmbarcacao, 80),
          cidade,
          portoSaida: portoSaida || rotaPrincipal?.portoOrigem || "",
          descricao: texto(dados.descricao, 1500),
          origemCidade: texto(dados.origemCidade, 100) || rotaPrincipal?.origemCidade || "",
          destinoCidade: texto(dados.destinoCidade, 100) || rotaPrincipal?.destinoCidade || "",
          escalasTexto: texto(dados.escalasTexto, 800),
          rotas: rotasCadastro,
          cnpj,
          nomeSolicitante,
          telefone,
          vinculo: texto(dados.vinculo, 50),
          planoInteresse: texto(dados.planoInteresse, 30) || "basico",
          autorizaMelhoria: dados.autorizaMelhoria === true,
          observacoes: texto(dados.observacoes, 1000),
          fotoOriginalUrl: fotoUrl,
          status: "aguardando_whatsapp",
          telefoneValidado: false,
          criadoEm: agora,
          atualizadoEm: agora,
          origem: "cadastro_publico",
        });
      });

      res.status(201).json({
        sucesso: true,
        solicitacaoId: ref.id,
        codigoProvisorio: codigo,
        status: "aguardando_whatsapp",
      });
    } catch (erro) {
      console.error("Erro no cadastro público de embarcação:", erro);
      const mensagem = erro instanceof Error && erro.message === "LIMITE_DIARIO" ?
        "Limite diário atingido para este telefone." :
        "Não foi possível enviar o cadastro agora.";
      res.status(500).json({erro: mensagem});
    }
  },
);
