import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

export const receberDadosGPS = functions.https.onRequest(async (req, res) => {
  try {
    const dados = req.body; // { idBarco, lat, lng, vel, rumo }

    if (!dados.idBarco || !dados.lat || !dados.lng) {
      res.status(400).send("Dados incompletos.");
      return;
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const pontoGeografico = new admin.firestore.GeoPoint(dados.lat, dados.lng);

    // 1. ATUALIZA O BARCO AGORA (Para o mapa mostrar ele andando)
    await db.collection('embarcacoes').doc(dados.idBarco).set({
      ultima_posicao: pontoGeografico,
      velocidade: dados.vel || 0,
      rumo: dados.rumo || 0,
      ultima_atualizacao: timestamp
    }, { merge: true });

    // 2. GRAVA O RASTRO (Para aprendermos a rota do rio)
    // Criamos um sub-coleção chamada 'rastro' dentro do documento do barco
    await db.collection('embarcacoes').doc(dados.idBarco)
            .collection('rastros_viagem').add({
      posicao: pontoGeografico,
      timestamp: timestamp,
      velocidade: dados.vel || 0
    });

    res.status(200).send("Posição e rastro gravados!");
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao processar sinal.");
  }
});