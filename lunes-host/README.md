# 🛡️ Kudda VPN

> **Secure • Fast • Private**
> Your trusted companion for anonymous browsing.

<div align="center">

<img src="https://img.shields.io/badge/Version-1.0.0-blue?style=for-the-badge" alt="Version">
<img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License">
<img src="https://img.shields.io/badge/Platform-Linux-lightgrey?style=for-the-badge&logo=linux&logoColor=white" alt="Platform">
<img src="https://img.shields.io/badge/Node.js-Runtime-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">

<br>

<img src="https://img.shields.io/badge/Protocol-VLESS-00ADD8?style=for-the-badge" alt="VLESS">
<img src="https://img.shields.io/badge/Transport-WebSocket-orange?style=for-the-badge" alt="WebSocket">
<img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge" alt="Status">

</div>

---

## ✨ Features

* 🔐 **Secure & Private** — Designed for private network communication.
* ⚡ **Fast & Lightweight** — Simple and efficient server implementation.
* 🌐 **VLESS Support** — Modern proxy protocol support.
* 🔌 **WebSocket Support** — WebSocket-based transport.
* 🤖 **Telegram Bot** — Optional Telegram Bot integration.
* 🚀 **Easy Installation** — Install with a single command.
* ⚙️ **Environment Configuration** — Configure the server using environment variables.
* 🐧 **Linux VPS Support** — Designed for Linux VPS environments.

---

# 📦 Normal Usage

The following command will automatically download and run the installation script.

```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/install.sh |
env DOMAIN=YOUR_DOMAIN \
    PORT=YOUR_PORT \
    UUID=2584b733-9095-4bec-a7d5-62b473540f7a \
    bash
```

### ⚡ Single-Line Installation

```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/install.sh | env DOMAIN=YOUR_DOMAIN PORT=YOUR_PORT UUID=2584b733-9095-4bec-a7d5-62b473540f7a bash
```

---

## ⚙️ Configuration

Replace the following values with your own settings:

| Variable | Description              |
| :------- | :----------------------- |
| `DOMAIN` | Your domain name         |
| `PORT`   | Port used by the service |
| `UUID`   | Client UUID              |

> 💡 **Note:** Make sure your domain is correctly pointed to the VPS before running the installation command.

---

## ▶️ Start the Server

After installation, start the application with:

```bash
node app.js
```

### 🚀 Startup Command

```bash
node app.js
```

---

# 🤖 Bot Usage

To install the **Telegram Bot** version, run:

```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/bot-install.sh |
env DOMAIN=YOUR_DOMAIN \
    PORT=YOUR_PORT \
    UUID=2584b733-9095-4bec-a7d5-62b473540f7a \
    TOKEN=YOUR_BOT_TOKEN \
    OWNER=YOUR_TELEGRAM_ID \
    bash
```

### ⚡ Single-Line Installation

```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/lunes-host/bot-install.sh | env DOMAIN=YOUR_DOMAIN PORT=YOUR_PORT UUID=2584b733-9095-4bec-a7d5-62b473540f7a TOKEN=YOUR_BOT_TOKEN OWNER=YOUR_TELEGRAM_ID bash
```

---

## 🔑 Bot Configuration

| Variable | Description                      |
| :------- | :------------------------------- |
| `DOMAIN` | Your domain name                 |
| `PORT`   | Port used by the service         |
| `UUID`   | Client UUID                      |
| `TOKEN`  | Telegram Bot Token               |
| `OWNER`  | Telegram Owner/Admin Telegram ID |

---

## ▶️ Start the Bot

After the installation is completed:

```bash
node bot.js
```

### 🚀 Startup Command

```bash
node bot.js
```

---

## 📝 Example

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

# 🔄 Updating

To update the installation, simply run the corresponding installation command again.

> 💡 **Tip:** Always make sure you have a backup of your existing configuration before updating.

---

# 📌 Requirements

### 🖥️ Normal Server

* 🐧 Linux VPS
* 🟢 Node.js
* 🌐 Valid domain name
* 🔌 Open/available service port

### 🤖 Telegram Bot

Everything above, plus:

* 🤖 Telegram Bot Token
* 👤 Telegram Owner ID

---

# 🚀 Quick Start

### 🌐 Normal Server

```bash
node app.js
```

### 🤖 Telegram Bot

```bash
node bot.js
```

---

# 🗂️ Project Structure

```text
Kudda-VPN/
│
├── install.sh
├── bot-install.sh
├── app.js
├── bot.js
├── package.json
├── README.md
└── LICENSE
```

---

# 🔐 Security

Please keep the following credentials private:

* 🔑 UUID
* 🤖 Telegram Bot Token
* 👤 Telegram Owner ID
* 🌐 Server configuration
* 🔒 Any private keys or authentication credentials

**Never commit secrets or private credentials to a public GitHub repository.**

---

# 🤝 Contributing

Contributions, improvements, bug reports, and suggestions are welcome.

If you find an issue or have an idea to improve **Kudda VPN**, feel free to open an issue or submit a pull request.

---

# 📄 License

This project is licensed under the **MIT License**.

See the `LICENSE` file for more information.

---

<div align="center">

## 🛡️ Kudda VPN

**Secure • Fast • Private**

<br>

### Developed by

**Thiyansa**

<br>

[![Telegram](https://img.shields.io/badge/Telegram-Contact-26A5E4?style=for-the-badge\&logo=telegram\&logoColor=white)](https://t.me/mataberiyo)

<br><br>

⭐ **If you find this project useful, consider giving it a star!** ⭐

</div>
