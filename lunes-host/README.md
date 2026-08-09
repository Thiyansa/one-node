## 📦 Normal Usage

The following command will automatically download and run the installation script.

```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/install.sh |
env DOMAIN=YOUR_DOMAIN \
    PORT=YOUR_PORT \
    UUID=2584b733-9095-4bec-a7d5-62b473540f7a \
    bash
```

Or Single line
```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/install.sh |
env DOMAIN=YOUR_DOMAIN PORT=YOUR_PORT UUID=2584b733-9095-4bec-a7d5-62b473540f7a bash
```

StartUpfor use this (Startup command)
```bash
node app.js
```

### ⚙️ Configuration

Replace the following values with your own settings:

| Variable | Description              |
| -------- | ------------------------ |
| `DOMAIN` | Your domain name         |
| `PORT`   | Port used by the service |
| `UUID`   | Client UUID              |

> **Note:** Make sure your domain is correctly pointed to the VPS before running the installation command.

### ▶️ Start the Server

After installation, start the application with:

```bash
node app.js
```

---

## 🤖 Bot Usage

To install the Telegram Bot version, run:

```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/bot-install.sh |
env DOMAIN=YOUR_DOMAIN \
    PORT=YOUR_PORT \
    UUID=2584b733-9095-4bec-a7d5-62b473540f7a \
    TOKEN=YOUR_BOT_TOKEN \
    OWNER=YOUR_TELEGRAM_ID \
    bash
```

Or Single line
```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/bot-install.sh |
env DOMAIN=YOUR_DOMAIN PORT=YOUR_PORT UUID=2584b733-9095-4bec-a7d5-62b473540f7a TOKEN=YOUR_BOT_TOKEN OWNER=YOUR_TELEGRAM_ID bash
```

StartUpfor use this (Startup command)
```bash
node bot.js
```

### 🔑 Bot Configuration

| Variable | Description                      |
| -------- | -------------------------------- |
| `DOMAIN` | Your domain name                 |
| `PORT`   | Port used by the service         |
| `UUID`   | Client UUID                      |
| `TOKEN`  | Telegram Bot Token               |
| `OWNER`  | Telegram Owner/Admin Telegram ID |

### ▶️ Start the Bot

After the installation is completed:

```bash
node bot.js
```

### 📝 Example

```bash
env \
DOMAIN=vpn.example.com \
PORT=443 \
UUID=2584b733-9095-4bec-a7d5-62b473540f7a \
TOKEN=123456789:YOUR_BOT_TOKEN \
OWNER=123456789 \
bash
```

> ⚠️ **Security:** Never publicly share your Telegram Bot Token or other private credentials.

---

## 🔄 Updating

To update the installation, simply run the corresponding installation command again. Always make sure you have a backup of your existing configuration before updating.

## 📌 Requirements

* Linux VPS
* Node.js
* A valid domain name
* Open/available service port
* Telegram Bot Token *(Bot version only)*
* Telegram Owner ID *(Bot version only)*

## 🚀 Quick Start

**Normal Server**

```bash
node app.js
```

**Telegram Bot**

```bash
node bot.js
```

<div align="center">

## Developed by

### **Thiyansa**

[Built for the open-source community.](https://t.me/mataberiyo)

</div>

