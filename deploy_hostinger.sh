#!/bin/bash
# ============================================================
# Script de Deploy Autometrics.cloud → Hostinger
# Usa tar+gzip para evitar erros com nomes de arquivo especiais
# ============================================================

HOSTINGER_USER="u905997120"
HOSTINGER_HOST="212.85.29.81"
HOSTINGER_PORT="65002"
REMOTE_PATH="domains/autometrics.cloud/public_html"
SSH_CMD="ssh -p $HOSTINGER_PORT $HOSTINGER_USER@$HOSTINGER_HOST"
SCP_CMD="scp -P $HOSTINGER_PORT"
TARBALL="deploy_$(date +%Y%m%d_%H%M%S).tar.gz"

echo "=============================="
echo "   DEPLOY AUTOMETRICS.CLOUD   "
echo "=============================="

# 1. Build local
echo ""
echo "[1/4] Compilando o projeto localmente..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Build falhou! Abortando deploy."
  exit 1
fi
echo "✅ Build concluído!"

# 2. Empacotar em tarball (exclui /dev pois tem nomes com caracteres especiais)
echo ""
echo "[2/4] Empacotando arquivos para envio..."
tar czf "$TARBALL" \
  --exclude='.next/dev' \
  --exclude='.next/cache' \
  .next package.json package-lock.json server.js next.config.ts

if [ $? -ne 0 ]; then
  echo "❌ Falha ao criar pacote!"
  exit 1
fi
TARBALL_SIZE=$(du -sh "$TARBALL" | cut -f1)
echo "✅ Pacote criado: $TARBALL ($TARBALL_SIZE)"

# 3. Upload do tarball (um único arquivo, sem problemas de nomes especiais)
echo ""
echo "[3/4] Enviando pacote para o Hostinger..."
echo "      (Será pedida a senha do Hostinger)"
cat "$TARBALL" | $SSH_CMD "cat > ~/$REMOTE_PATH/$TARBALL"

if [ $? -ne 0 ]; then
  echo "❌ Upload falhou!"
  rm -f "$TARBALL"
  exit 1
fi
echo "✅ Pacote enviado!"
rm -f "$TARBALL"

# 4. Extrair no servidor, instalar dependências e reiniciar
echo ""
echo "[4/4] Extraindo, instalando e reiniciando no servidor..."
echo "      (Será pedida a senha do Hostinger novamente)"
$SSH_CMD bash << ENDSSH
  set -e
  cd ~/domains/autometrics.cloud/public_html

  echo "--- Extraindo build..."
  TARBALL=\$(ls deploy_*.tar.gz 2>/dev/null | head -1)
  if [ -z "\$TARBALL" ]; then
    echo "ERRO: tarball não encontrado!"
    exit 1
  fi
  tar xzf "\$TARBALL" && rm "\$TARBALL"
  echo "[OK] Build extraído"

  echo "--- Instalando dependências..."
  npm ci --production --silent 2>/dev/null || npm install --production --silent 2>/dev/null
  echo "[OK] Dependências instaladas"

  echo "--- Reiniciando servidor (Passenger)..."
  mkdir -p ~/domains/autometrics.cloud/tmp
  touch ~/domains/autometrics.cloud/tmp/restart.txt
  mkdir -p ~/domains/autometrics.cloud/public_html/tmp
  touch ~/domains/autometrics.cloud/public_html/tmp/restart.txt 2>/dev/null || true
  echo "[OK] Restart solicitado"

  if command -v pm2 &>/dev/null; then
    pm2 restart autometrics 2>/dev/null || pm2 restart all 2>/dev/null || true
    echo "[OK] PM2 reiniciado"
  fi

  PID=\$(lsof -ti:3000 2>/dev/null || true)
  if [ -n "\$PID" ]; then
    kill -SIGTERM \$PID 2>/dev/null || true
    echo "[OK] Processo anterior finalizado"
  fi
ENDSSH

if [ $? -ne 0 ]; then
  echo "⚠️  Erro durante configuração no servidor."
fi

# Verificar saúde com até 3 tentativas (45s total)
echo ""
echo "Aguardando servidor inicializar..."
sleep 20

HEALTH_URL="https://autometrics.cloud/api/health"
HTTP_STATUS=""
for i in 1 2 3; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH_URL" 2>/dev/null)
  if [ "$HTTP_STATUS" = "200" ]; then
    break
  fi
  echo "   Tentativa $i: HTTP $HTTP_STATUS — aguardando 15s..."
  sleep 15
done

echo ""
if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Servidor OK!"
  curl -s "$HEALTH_URL" | python3 -m json.tool 2>/dev/null || curl -s "$HEALTH_URL"
else
  echo "⚠️  Servidor retornou HTTP $HTTP_STATUS."
  echo "   Verifique: $HEALTH_URL"
fi

echo ""
echo "=============================="
echo "   Acesse: https://autometrics.cloud"
echo "   Health: $HEALTH_URL"
echo "=============================="
