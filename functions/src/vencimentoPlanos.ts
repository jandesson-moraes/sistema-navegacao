import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Rebaixa a experiência pública para o Básico quando uma assinatura vence.
 * O plano contratado e os dados premium continuam salvos para uma renovação.
 */
export const processarVencimentoPlanos = functions
  .region("us-central1")
  .pubsub.schedule("every 60 minutes")
  .timeZone("America/Manaus")
  .onRun(async () => {
    const agora = admin.firestore.Timestamp.now();
    const snapshot = await db
      .collection("embarcacoes")
      .where("planoStatus", "in", ["ativo", "cortesia"])
      .get();

    const vencidas = snapshot.docs.filter((documento) => {
      const dados = documento.data();
      const planoId = String(dados.planoId || "").toLowerCase();
      const validade = dados.planoValidoAte;
      return (
        planoId !== "basico" &&
        validade instanceof admin.firestore.Timestamp &&
        validade.toMillis() <= agora.toMillis()
      );
    });

    for (let inicio = 0; inicio < vencidas.length; inicio += 400) {
      const lote = db.batch();
      vencidas.slice(inicio, inicio + 400).forEach((documento) => {
        lote.set(
          documento.ref,
          {
            planoStatus: "vencido",
            planoEfetivoId: "basico",
            planoVencidoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
      });
      await lote.commit();
    }

    console.log(`Planos vencidos processados: ${vencidas.length}`);
  });
