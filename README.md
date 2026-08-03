# Pesquisa de Satisfação — Gran SPA · Hotel Gran Marquise

Sistema de coleta de avaliações via QR Code / WhatsApp.

## Instalação local

```bash
git clone https://github.com/Hotel-Gran-Marquise/hub-spa.git
cd PesquisaSatisfacao
npm install
cp .env.example .env
npm start
```

Acesse: http://localhost:3000 (formulário) · http://localhost:3000/admin (painel)

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (padrão: 3000) |
| `JWT_SECRET` | Chave JWT (gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `ADMIN_USER` | Usuário do painel admin |
| `ADMIN_PASS` | Senha do painel admin |
| `NODE_ENV` | `development` ou `production` |

## Primeiro deploy (executar UMA VEZ)

```bash
fly launch --no-deploy
fly volumes create feedback_data --size 1 --region gru
fly secrets set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly secrets set ADMIN_USER=admin
fly secrets set ADMIN_PASS='MinhaSenhaForte123!'
fly deploy
```

## Deploy automático (GitHub Actions)

```bash
fly tokens create deploy -x 999999h
```

Adicione o token em: GitHub → Settings → Secrets → `FLY_API_TOKEN`

## Backup

```bash
fly ssh sftp get /app/data/feedback.db ./backup.db --app pesquisa-satisfacao
```