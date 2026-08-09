
## Configuration

```json
{
  "inbounds": [
    {
      "port": 10808,
      "listen": "0.0.0.0",
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "YOUR_UUID",
            "email": "KUDDA"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "ws",
        "wsSettings": {
          "path": "/kudda-vpn"
        }
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct"
    },
    {
      "protocol": "blackhole",
      "tag": "blocked"
    },
    {
      "protocol": "freedom",
      "settings": {
        "redirect": "https://edu-block.kudda.dev"
      },
      "tag": "Block-Redirect"
    }
  ],
  "routing": {
    "rules": [
      {
        "inboundTag": [
          "api"
        ],
        "outboundTag": "api",
        "type": "field"
      },
      {
        "ip": [
          "geoip:private"
        ],
        "outboundTag": "blocked",
        "type": "field"
      },
      {
        "type": "field",
        "protocol": [
          "bittorrent"
        ],
        "outboundTag": "blocked"
      },
      {
        "domain": [
          "geosite:category-ads-all",
          "ext:geosite_IR.dat:category-ads-all",
          "ext:geosite_RU.dat:category-ads-all",
          "ext:geosite_IR.dat:malware",
          "ext:geosite_IR.dat:phishing",
          "ext:geosite_IR.dat:cryptominers",
          "geosite:category-porn"
        ],
        "outboundTag": "Block-Redirect",
        "type": "field"
      },
      {
        "domain": [
          "domain:facebook.com",
          "domain:tiktok.com",
          "domain:instagram.com",
          "domain:x.com",
          "domain:twitter.com",
          "domain:snapchat.com",
          "domain:reddit.com",
          "domain:pinterest.com",
          "domain:twitch.tv",
          "domain:discord.com",
          "domain:netflix.com",
          "domain:9gag.com",
          "domain:imgur.com",
          "domain:quora.com",
          "domain:roblox.com",
          "domain:epicgames.com",
          "domain:steampowered.com",
          "domain:store.steampowered.com",
          "domain:spotify.com",
          "domain:soundcloud.com",
          "domain:bet365.com",
          "domain:1xbet.com",
          "domain:stake.com",
          "domain:thepiratebay.org",
          "domain:1337x.to",
          "domain:yts.mx",
          "domain:pubgmobile.com",
          "domain:freefiremobile.com",
          "domain:garena.com",
          "domain:minecraft.net",
          "domain:ea.com",
          "domain:ubisoft.com",
          "domain:geforcenow.com",
          "domain:xbox.com",
          "domain:playstation.com",
          "domain:melbet.com",
          "domain:mostbet.com",
          "domain:parimatch.com",
          "domain:bwin.com",
          "domain:888casino.com",
          "domain:spotify.com",
          "domain:audio-ak-spotify-com.akamaized.net",
          "domain:valorant.com",
          "domain:playvalorant.com",
          "domain:riotgames.com",
          "domain:blizzard.com",
          "domain:rockstargames.com",
          "domain:activision.com",
          "domain:clashofclans.com",
          "domain:brawlstars.com",
          "domain:poki.com",
          "domain:crazygames.com",
          "domain:1win.com",
          "domain:linebet.com",
          "domain:megapari.com",
          "domain:betwinner.com",
          "domain:roobet.com",
          "domain:rollbit.com",
          "domain:bc.game",
          "domain:torproject.org",
          "domain:psiphon.ca",
          "domain:omegle.com",
          "domain:chatexpert.org",
          "domain:crunchyroll.com",
          "domain:9anime.to",
          "domain:aniwave.to"
        ],
        "outboundTag": "Block-Redirect",
        "type": "field"
      }
    ]
  }
}

```

---

## Back

**← [Return to Main README](README.md)**