#!/bin/bash
# ============================================================
# Script de Deploy Automático para Hostinger
# Autometrics - autometrics.cloud
# ============================================================

HOSTINGER_USER="u905997120"
HOSTINGER_HOST="212.85.29.81"
HOSTINGER_PORT="65002"
REMOTE_PATH="domains/autometrics.cloud/public_html"
APP_ROOT="domains/autometrics.cloud"

echo "=============================="
echo "   DEPLOY AUTOMETRICS.CLOUD   "
echo "=============================="

# 1. Build local (NEXT_PUBLIC_ vars são embutidas do .env.local)
echo ""
echo "[1/4] Compilando o projeto localmente..."
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") npm run build

if [ $? -ne 0 ]; then
  echo "❌ Build falhou! Abortando deploy."
  exit 1
fi

echo "✅ Build concluído com sucesso!"

# 2. Upload dos arquivos compilados
echo ""
echo "[2/4] Enviando arquivos para o Hostinger via SCP..."
echo "      (Será pedida a senha do Hostinger)"
scp -P $HOSTINGER_PORT -r .next next.config.ts package.json server.js \
    $HOSTINGER_USER@$HOSTINGER_HOST:$REMOTE_PATH/

if [ $? -ne 0 ]; then
  echo "❌ Upload falhou! Verifique a senha e tente novamente."
  exit 1
fi

echo "✅ Arquivos enviados com sucesso!"

# 3. Instalar dependências no servidor
echo ""
echo "[3/4] Instalando dependências e reiniciando o servidor..."
echo "      (Será pedida a senha do Hostinger novamente)"
ssh -p $HOSTINGER_PORT $HOSTINGER_USER@$HOSTINGER_HOST << 'ENDSSH'
  # Instalar dependências de produção
  cd ~/domains/autometrics.cloud/public_html
  npm install --production 2>/dev/null

  # Estratégia 1: Passenger restart (local correto - raiz da app)
  mkdir -p ~/domains/autometrics.cloud/tmp
  touch ~/domains/autometrics.cloud/tmp/restart.txt
  echo "[OK] Passenger restart.txt atualizado"

  # Estratégia 2: restart.txt dentro de public_html (fallback)
  touch ~/domains/autometrics.cloud/public_html/tmp/restart.txt 2>/dev/null || true

  # Estratégia 3: Se PM2 estiver disponível
  if command -v pm2 &> /dev/null; then
    pm2 restart autometrics 2>/dev/null || pm2 restart all 2>/dev/null || true
    echo "[OK] PM2 reiniciado"
  fi

  # Estratégia 4: Forçar reinício matando o processo Node atual
  # (Passenger vai subir um novo automaticamente)
  PID=$(lsof -ti:3000 2>/dev/null)
  if [ -n "$PID" ]; then
    kill -SIGTERM $PID 2>/dev/null || true
    echo "[OK] Processo na porta 3000 finalizado (será reiniciado automaticamente)"
  fi

  echo "Reinicialização concluída."
ENDSSH

# 4. Verificar saúde do deploy
echo ""
echo "[4/4] Aguardando servidor reiniciar..."
sleep 15

HEALTH_URL="https://autometrics.cloud/api/health"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Servidor respondendo (HTTP $HTTP_STATUS)"
  echo "   Detalhes do deploy:"
  curl -s "$HEALTH_URL" | python3 -m json.tool 2>/dev/null || curl -s "$HEALTH_URL"
else
  echo "⚠️  Servidor respondeu com HTTP $HTTP_STATUS ou não está acessível ainda."
  echo "   Tente acessar manualmente: $HEALTH_URL"
fi

echo ""
echo "=============================="
echo "✅ DEPLOY CONCLUÍDO!"
echo "   Acesse: https://autometrics.cloud"
echo "   Health: https://autometrics.cloud/api/health"
echo "=============================="
