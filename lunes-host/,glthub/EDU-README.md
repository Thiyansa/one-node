
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
    }
  ],
  "routing": {
    "rules": [
      {
        "type": "field",
        "protocol": [
          "bittorrent"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "user": [
          "KUDDA"
        ],
        "outboundTag": "direct"
      },
      {
        "type": "field",
        "domain": [
          "geosite:category-ads-all",
          "geosite:category-porn"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:roblox.com",
          "domain:epicgames.com",
          "domain:steampowered.com",
          "domain:store.steampowered.com",
          "domain:steamcommunity.com",
          "domain:minecraft.net",
          "domain:valorant.com",
          "domain:playvalorant.com",
          "domain:riotgames.com",
          "domain:blizzard.com",
          "domain:rockstargames.com",
          "domain:activision.com",
          "domain:ea.com",
          "domain:ubisoft.com",
          "domain:xbox.com",
          "domain:xboxsocial.com",
          "domain:playstation.com",
          "domain:pubgmobile.com",
          "domain:freefiremobile.com",
          "domain:garena.com",
          "domain:brawlstars.com",
          "domain:clashofclans.com",
          "domain:poki.com",
          "domain:crazygames.com",
          "domain:geforcenow.com"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:bet365.com",
          "domain:1xbet.com",
          "domain:stake.com",
          "domain:melbet.com",
          "domain:mostbet.com",
          "domain:parimatch.com",
          "domain:bwin.com",
          "domain:888casino.com",
          "domain:1win.com",
          "domain:linebet.com",
          "domain:megapari.com",
          "domain:betwinner.com",
          "domain:roobet.com",
          "domain:rollbit.com",
          "domain:bc.game"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:netflix.com",
          "domain:twitch.tv",
          "domain:ext-twitch.tv",
          "domain:jtvnw.net",
          "domain:ttvnw.net",
          "domain:twitchcdn.net",
          "domain:twitchsvc.net",
          "domain:crunchyroll.com",
          "domain:9anime.to",
          "domain:aniwave.to",
          "domain:dailymotion.com",
          "domain:vimeo.com",
          "domain:rumble.com",
          "domain:kick.com"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:thepiratebay.org",
          "domain:1337x.to",
          "domain:yts.mx",
          "domain:torproject.org"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:spotify.com",
          "domain:soundcloud.com",
          "domain:audio-ak-spotify-com.akamaized.net",
          "domain:last.fm",
          "domain:genius.com",
          "domain:bandcamp.com",
          "domain:mixcloud.com"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:psiphon.ca"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:medium.com",
          "domain:substack.com"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:patreon.com",
          "domain:ko-fi.com"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:behance.net",
          "domain:dribbble.com"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:a2z.com",
          "domain:atomile.com",
          "domain:hypstarcdn.com",
          "domain:online-metrix.net",
          "domain:wsdvs.com"
        ],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": [
          "domain:facebook.com",
          "domain:tiktok.com",
          "domain:instagram.com",
          "domain:x.com",
          "domain:twitter.com",
          "domain:snapchat.com",
          "domain:reddit.com",
          "domain:pinterest.com",
          "domain:discord.com",
          "domain:quora.com",
          "domain:threads.net",
          "domain:tumblr.com",
          "domain:linkedin.com",
          "domain:linkedin.com.br",
          "domain:weibo.com",
          "domain:weibo.cn",
          "domain:qq.com",
          "domain:qzone.qq.com",
          "domain:douyin.com",
          "domain:kuaishou.com",
          "domain:xiaohongshu.com",
          "domain:zhihu.com",
          "domain:baidu.com",
          "domain:line.me",
          "domain:kakao.com",
          "domain:viber.com",
          "domain:skype.com",
          "domain:signal.org",
          "domain:wechat.com",
          "domain:vk.com",
          "domain:vk.ru",
          "domain:mastodon.social",
          "domain:mastodon.online",
          "domain:bsky.app",
          "domain:bsky.social",
          "domain:badoo.com",
          "domain:bumble.com",
          "domain:tinder.com",
          "domain:okcupid.com",
          "domain:pof.com",
          "domain:match.com",
          "domain:happn.com",
          "domain:hinge.co",
          "domain:coffeemeetsbagel.com",
          "domain:sniffies.com",
          "domain:allotalk.com",
          "domain:omegle.com",
          "domain:chatexpert.org",
          "domain:clubhouse.com",
          "domain:joinclubhouse.com",
          "domain:myspace.com",
          "domain:tagged.com",
          "domain:meetme.com",
          "domain:skout.com",
          "domain:grindr.com",
          "domain:her.com",
          "domain:weareher.com",
          "domain:thefacebook.com",
          "domain:fb.com",
          "domain:fb.me",
          "domain:m.me",
          "domain:messenger.com",
          "domain:messages-facebook.com",
          "domain:instagram.co",
          "domain:instagr.am",
          "domain:wwwinstagram.com",
          "domain:instagramthreads.com",
          "domain:redd.it",
          "domain:redditblog.com",
          "domain:redditinc.com",
          "domain:redditmedia.com",
          "domain:redditstatic.com",
          "domain:reddituploads.com",
          "domain:reddit-stream.com",
          "domain:redditgifts.com",
          "domain:pinterest.ca",
          "domain:pinterest.co.uk",
          "domain:pinterest.com.au",
          "domain:pinterest.de",
          "domain:pinterest.es",
          "domain:pinterest.fr",
          "domain:pinterest.it",
          "domain:pinterest.jp",
          "domain:pin.it",
          "domain:pinimg.com",
          "domain:t.co",
          "domain:twimg.com",
          "domain:twitter.co",
          "domain:twitter.de",
          "domain:ads-twitter.com",
          "domain:discordapp.com",
          "domain:discord.gg",
          "domain:discord.media",
          "domain:discordapp.net",
          "domain:tiktok.in",
          "domain:tiktok.org",
          "domain:tiktokcdn.com",
          "domain:tiktokv.com",
          "domain:tiktokv.us",
          "domain:tiktokmusic.app",
          "domain:tiktokshop.com",
          "domain:tiktoklive.com",
          "domain:bytedance.com",
          "domain:byteglb.com",
          "domain:byteoversea.com",
          "domain:byteoversea.net",
          "domain:bytetcdn.com",
          "domain:musical.ly",
          "domain:musically.ly",
          "domain:likee.video",
          "domain:facebook.at",
          "domain:facebook.be",
          "domain:facebook.ca",
          "domain:facebook.co",
          "domain:facebook.de",
          "domain:facebook.dk",
          "domain:facebook.es",
          "domain:facebook.fr",
          "domain:facebook.it",
          "domain:facebook.jp",
          "domain:facebook.nl",
          "domain:facebook.no",
          "domain:facebook.pl",
          "domain:facebook.ru",
          "domain:facebook.se",
          "domain:facebook.us",
          "domain:facebook.com.au",
          "domain:facebook.com.br",
          "domain:facebook.com.es",
          "domain:facebook.com.mx",
          "domain:facebook.com.vn",
          "domain:facebook.net",
          "domain:facebook.org",
          "domain:facebook.design",
          "domain:facebook-studio.com",
          "domain:viewpointsfromfacebook.com",
          "domain:fbcdn.com",
          "domain:fbcdn.net",
          "domain:fbsbx.com",
          "domain:fbstatic.net",
          "domain:tfbnw.net",
          "domain:wwwfacebook.com",
          "domain:instagram.com.br",
          "domain:instagram.de",
          "domain:instagram.fr",
          "domain:instagram.net",
          "domain:snap.com",
          "domain:snapkit.com",
          "domain:threads.com",
          "domain:meta.com",
          "domain:meta.ai",
          "domain:oculus.com",
          "domain:fb.watch",
          "domain:facebookgaming.com",
          "domain:rednote.com",
          "domain:internet.org",
          "domain:freebasics.com"
        ],
        "outboundTag": "blocked"
      }
    ]
  }
}
