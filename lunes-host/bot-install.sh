#!/usr/bin/env sh

DOMAIN="${DOMAIN:-node68.lunes.host}"
PORT="${PORT:-10808}"
PATH="${PATH:-/kudda-vpn}"
BOT_TOKEN="${TOKEN:-https://t.me/mataberiyo}"
OWNER_ID="${OWNER:-https://t.me/mataberiyo}"

curl -sSL -o app.js https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/app.js
curl -sSL -o package.json https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/package.json
curl -sSL -o index.html https://raw.githubusercontent.com/Thiyansa/nodejs-vless/refs/heads/main/index.html
curl -sSL -o db.json https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/db.json
curl -sSL -o bot.js https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/bot.js

mkdir -p /home/container/xy
cd /home/container/xy
curl -sSL -o Xray-linux-64.zip https://github.com/Thiyansa/one-node/releases/download/lunes-host-xray/Xray-linux-64.zip
unzip Xray-linux-64.zip
rm Xray-linux-64.zip
mv xray xy
curl -sSL -o config.json https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/xray-config.json
sed -i "s/10808/$PORT/g" config.json
sed -i "s/YOUR_UUID/$UUID/g" config.json

sed -i "s/YOUR_TG_BOT_API_KEY/$TOKEN/g" db.json
sed -i "s/YOUR_TG_ID/$OWNER/g" db.json
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" db.json
sed -i "s/10808/$PORT/g" db.json
sed -i "s/YOUR_PATH/$PATH/g" db.json

keyPair=$(./xy x25519)
privateKey=$(echo "$keyPair" | grep "Private key" | awk '{print $3}')
publicKey=$(echo "$keyPair" | grep "Public key" | awk '{print $3}')
sed -i "s/YOUR_PRIVATE_KEY/$privateKey/g" config.json
shortId=$(openssl rand -hex 4)
sed -i "s/YOUR_SHORT_ID/$shortId/g" config.json
vlessUrl="vless://$UUID@$DOMAIN:$PORT?encryption=none&security=none&type=ws&host=www.cloudflare.com&path=/kudda-vpn#lunes-ws"
echo $vlessUrl > /home/container/node.txt

echo "============================================================"
echo "🚀 VLESS FOR ADMIN"
echo "------------------------------------------------------------"
echo "$vlessUrl"
echo "============================================================"
