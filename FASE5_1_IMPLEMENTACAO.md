# Cadê Meu Barco — Fase 5.1

## Entregas desta versão

- Edição administrativa de embarcações com confirmação de persistência no Firestore.
- Alteração segura do ID operacional no padrão `FB_DONA_ANA`.
- Migração em lote dos vínculos de programação, grades, rotas, banners, acessos e GPS.
- Histórico e alias do ID anterior, mantendo links antigos do aplicativo funcionando.
- Dados de planos pagos preservados quando o plano vence ou volta ao Básico.
- Formulário administrativo dinâmico por plano.
- Até 3 contatos com nome, WhatsApp, mensagem editável e situação ativo/desativado.
- Rotas de ida/volta, escalas e horários editáveis no cadastro unificado.
- Plano Básico mostra horários da origem e do destino; horários das escalas ficam nos pagos.
- Link seguro para o responsável solicitar mudanças sem publicar diretamente.
- Fila de análise das solicitações de alteração no painel de embarcações.
- Aplicativo acompanhando o Firestore em tempo real e reconhecendo IDs antigos.

## Instalação local

Faça um backup antes. Estando na pasta que contém os dois ZIPs:

```bash
cd ~/Documentos/SistemaNavegacao

cp -a sistema-navegacao "sistema-navegacao-backup-$(date +%Y%m%d-%H%M)"
cp -a app-passageiro "app-passageiro-backup-$(date +%Y%m%d-%H%M)"

unzip -o sistema-navegacao-fase5-1.zip -d sistema-navegacao-fase5-1
unzip -o app-passageiro-fase5-1.zip -d app-passageiro-fase5-1

rsync -av --delete \
  --exclude node_modules --exclude .git --exclude .env \
  sistema-navegacao-fase5-1/ sistema-navegacao/

rsync -av --delete \
  --exclude node_modules --exclude .git --exclude .env \
  app-passageiro-fase5-1/ app-passageiro/
```

## Teste e publicação do sistema

```bash
cd ~/Documentos/SistemaNavegacao/sistema-navegacao
npm install
npm run build

cd functions
npm install
npm run build
cd ..

firebase deploy --only firestore:rules,functions

git add .
git commit -m "Implementa edição segura, planos e atualização do proprietário"
git push origin main
```

Depois, confirme no Vercel que o commit publicado é o mesmo retornado por:

```bash
git rev-parse --short HEAD
```

## Publicação do aplicativo por EAS Update

```bash
cd ~/Documentos/SistemaNavegacao/app-passageiro
npm install
npx expo-doctor
npx eas update --branch preview \
  --message "Fase 5.1 planos, horários e IDs seguros"
```

Abra o aplicativo de desenvolvimento/preview, feche-o completamente e abra outra vez.

## Roteiro mínimo de validação

1. Edite uma embarcação sem trocar o ID e confirme a alteração no Firestore e no app.
2. Troque o nome e use **Atualizar ID pelo nome**.
3. Confirme o novo documento, o alias do ID antigo e os vínculos do GPS.
4. Alterne Básico → Vitrine → Tempo Real e verifique os campos liberados.
5. Volte ao Básico e confirme que os dados pagos ficaram ocultos, mas preservados.
6. Gere **Link para atualizar**, abra em aba anônima e confirme com o WhatsApp.
7. Envie uma mudança e aprove-a na fila do painel.
8. Confirme no app os horários terminais do Básico e a ocultação dos horários das escalas.
