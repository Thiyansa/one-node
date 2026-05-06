#!/usr/bin/env sh

DOMAIN="${DOMAIN:-node68.lunes.host}"
PORT="${PORT:-10008}"
UUID="${UUID:-2584b733-9095-4bec-a7d5-62b473540f7a}"

curl -sSL -o app.js https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/app.js
curl -sSL -o package.json https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/package.json

mkdir -p /home/container/xy
cd /home/container/xy
curl -sSL -o Xray-linux-64.zip https://github.com/XTLS/Xray-core/releases/download/v25.8.3/Xray-linux-64.zip
unzip Xray-linux-64.zip
rm Xray-linux-64.zip
mv xray xy
curl -sSL -o config.json https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/xray-config.json
sed -i "s/10008/$PORT/g" config.json
sed -i "s/YOUR_UUID/$UUID/g" config.json
keyPair=$(./xy x25519)
privateKey=$(echo "$keyPair" | grep "Private key" | awk '{print $3}')
publicKey=$(echo "$keyPair" | grep "Public key" | awk '{print $3}')
sed -i "s/YOUR_PRIVATE_KEY/$privateKey/g" config.json
shortId=$(openssl rand -hex 4)
sed -i "s/YOUR_SHORT_ID/$shortId/g" config.json
vlessUrl="vless://$UUID@$DOMAIN:$PORT?encryption=none&security=none&sni=www.cloudflare.com&type=ws&host=www.cloudflare.com&path=%2kudda-vpn#lunes-ws"
echo $vlessUrl > /home/container/node.txt

echo "============================================================"
echo "🚀 VLESS Ws Node Info"
echo "------------------------------------------------------------"
echo "$vlessUrl"
echo "============================================================"
