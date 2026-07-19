# Atualização completa — Métricas da Landing Page

## O que este pacote inclui

- rota protegida `/metricas-landing`;
- menu **Métricas da Landing Page**;
- permissão configurável para funcionários;
- painel de visitas, visitantes únicos, cliques, conversão, origem e dispositivo;
- regras do Firestore sem escrita pública;
- Cloud Function `registrarMetricaLanding`;
- deduplicação de eventos repetidos em uma janela de 10 minutos;
- visitante diário estimado por hash, sem salvar IP, nome, telefone ou e-mail.

## 1. Faça um backup

Na raiz do Sistema de Navegação:

```bash
cp src/App.tsx src/App.tsx.backup_metricas
cp src/components/Layout.tsx src/components/Layout.tsx.backup_metricas
cp src/pages/FuncionariosPermissoes.tsx src/pages/FuncionariosPermissoes.tsx.backup_metricas
cp firestore.rules firestore.rules.backup_metricas
cp functions/src/index.ts functions/src/index.ts.backup_metricas
```

## 2. Extraia o ZIP na raiz do projeto

Coloque `sistema-navegacao-metricas-landing-atualizado.zip` dentro da pasta do projeto e execute:

```bash
unzip -o sistema-navegacao-metricas-landing-atualizado.zip
```

## 3. Valide o painel

```bash
npm run build
```

## 4. Valide e publique a função

```bash
cd functions
npm run build
cd ..
firebase deploy --only functions:registrarMetricaLanding
```

O endereço esperado da função é:

```text
https://us-central1-sistema-navegacao.cloudfunctions.net/registrarMetricaLanding
```

## 5. Publique as regras

```bash
firebase deploy --only firestore:rules
```

## 6. Publique o Sistema de Navegação

Use o mesmo procedimento que você já utiliza para publicar o painel. Antes, confirme:

```bash
npm run build
```

## 7. Teste

1. Abra a landing page em uma janela anônima.
2. Clique em **Baixar agora na Google Play**.
3. Aguarde alguns segundos.
4. Entre no Sistema de Navegação.
5. Abra **Métricas da Landing Page**.
6. Confirme uma visita e um clique.

## 8. Links para campanhas

Use estes endereços nos canais para identificar a origem:

Instagram:

```text
https://cade-meu-barco-empresas.jandessonmoraes.chatgpt.site/?utm_source=instagram
```

WhatsApp:

```text
https://cade-meu-barco-empresas.jandessonmoraes.chatgpt.site/?utm_source=whatsapp
```

Facebook:

```text
https://cade-meu-barco-empresas.jandessonmoraes.chatgpt.site/?utm_source=facebook
```

## Observação importante

O painel mede o clique que abre a Google Play. A instalação concluída continua sendo confirmada
no Google Play Console.

