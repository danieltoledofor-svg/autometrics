#!/bin/bash
# ============================================================
# Script de Deploy Autometrics.cloud → Hostinger
# ============================================================

HOSTINGER_USER="u905997120"
HOSTINGER_HOST="212.85.29.81"
HOSTINGER_PORT="65002"
REMOTE_PATH="domains/autometrics.cloud/public_html"
SSH_CMD="ssh -p $HOSTINGER_PORT $HOSTINGER_USER@$HOSTINGER_HOST"
SCP_CMD="scp -P $HOSTINGER_PORT"

echo "=============================="
echo "   DEPLOY AUTOMETRICS.CLOUD   "
echo "=============================="

# 1. Build local
echo ""
echo "[1/5] Compilando o projeto localmente..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Build falhou! Abortando deploy."
  exit 1
fi
echo "✅ Build concluído!"

# 2. Limpar .next antigo no servidor ANTES de enviar o novo
#    Evita corrupção por mix de arquivos de builds diferentes
echo ""
echo "[2/5] Limpando build antigo no servidor..."
echo "      (Será pedida a senha do Hostinger)"
$SSH_CMD "rm -rf ~/$REMOTE_PATH/.next && echo '[OK] .next antigo removido'"

if [ $? -ne 0 ]; then
  echo "⚠️  Não foi possível limpar o .next antigo (continuando mesmo assim...)"
fi

# 3. Upload dos arquivos novos
echo ""
echo "[3/5] Enviando arquivos para o Hostinger..."
echo "      (Será pedida a senha do Hostinger novamente)"
$SCP_CMD -r .next package.json package-lock.json server.js next.config.ts \
    $HOSTINGER_USER@$HOSTINGER_HOST:~/$REMOTE_PATH/

if [ $? -ne 0 ]; then
  echo "❌ Upload falhou!"
  exit 1
fi
echo "✅ Arquivos enviados!"

# 4. Instalar dependências e reiniciar no servidor
echo ""
echo "[4/5] Instalando dependências e reiniciando..."
echo "      (Será pedida a senha do Hostinger novamente)"
$SSH_CMD bash << 'ENDSSH'
  set -e
  cd ~/domains/autometrics.cloud/public_html

  echo "--- Instalando dependências..."
  npm ci --production --silent 2>/dev/null || npm install --production --silent 2>/dev/null
  echo "[OK] Dependências instaladas"

  echo "--- Reiniciando servidor (Passenger)..."
  mkdir -p ~/domains/autometrics.cloud/tmp
  touch ~/domains/autometrics.cloud/tmp/restart.txt
  # Fallback: restart.txt dentro do app também
  mkdir -p ~/domains/autometrics.cloud/public_html/tmp
  touch ~/domains/autometrics.cloud/public_html/tmp/restart.txt 2>/dev/null || true
  echo "[OK] Restart.txt atualizado"

  # Restart PM2 se disponível
  if command -v pm2 &>/dev/null; then
    pm2 restart autometrics 2>/dev/null || pm2 restart all 2>/dev/null || true
    echo "[OK] PM2 reiniciado"
  fi

  # Forçar kill do processo atual na porta 3000 (Passenger sobe novo)
  PID=$(lsof -ti:3000 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill -SIGTERM $PID 2>/dev/null || true
    echo "[OK] Processo Node.js anterior finalizado"
  fi

  echo "--- Reinicialização concluída."
ENDSSH

# 5. Verificar saúde
echo ""
echo "[5/5] Aguardando servidor inicializar (30s)..."
sleep 30

HEALTH_URL="https://autometrics.cloud/api/health"
echo "   Verificando: $HEALTH_URL"

for i in 1 2 3; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$HEALTH_URL" 2>/dev/null)
  if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Servidor OK (HTTP 200)"
    curl -s "$HEALTH_URL" | python3 -m json.tool 2>/dev/null || curl -s "$HEALTH_URL"
    break
  else
    echo "   Tentativa $i: HTTP $HTTP_STATUS — aguardando mais 15s..."
    sleep 15
  fi
done

if [ "$HTTP_STATUS" != "200" ]; then
  echo "⚠️  Servidor ainda retorna HTTP $HTTP_STATUS."
  echo "   Acesse: $HEALTH_URL"
fi

echo ""
echo "=============================="
echo "   Acesse: https://autometrics.cloud"
echo "   Health: $HEALTH_URL"
echo "=============================="
