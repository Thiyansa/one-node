## How To use This Script

Run the installer with the required environment variables:

```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/webhostmost/install.sh |
env DOMAIN=example.com REMARKS=KUDDA bash
```
Or You can use this installing methods
```bash
curl -fsSL https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/webhostmost/install.sh | \
env DOMAIN=example.com REMARKS=KUDDA bash
```
### Uninstall
```bash
curl -s https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/webhostmost/uninstall.sh | env DOMAIN=example.com bash
```

### Available Parameters

| Parameter  | Required | Default                  | Description                                                                              |
| ---------- | -------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `DOMAIN`   | ✅ Yes    | `example.com`            | Domain name where the Node.js application will be installed.                             |
| `REMARKS`  | ❌ No     | `KUDDA`            | Friendly name displayed in generated VLESS configurations.                               |
| `WEB_PATH` | ❌ No     | Random 14-character path | Custom WebSocket/HTTP path. If omitted, a secure random path is generated automatically. |

### Examples

**Basic Installation**

```bash
curl -fsSL https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/webhostmost/install.sh | \
env DOMAIN=mydomain.com bash
```

**Custom Remarks**

```bash
curl -fsSL https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/webhostmost/install.sh | \
env DOMAIN=mydomain.com REMARKS=Singapore-01 bash
```

**Custom Web Path**

```bash
curl -fsSL https://raw.githubusercontent.com/Thiyansa/one-node/refs/heads/main/webhostmost/install.sh | \
env DOMAIN=mydomain.com \
REMARKS=Production \
WEB_PATH=/mypath123 bash
```

### What the Installer Does

* Downloads the latest application files.
* Generates a deterministic UUID based on the Web Path.
* Creates and configures a CloudLinux Node.js application.
* Installs all required npm dependencies.
* Configures an automatic keep-alive cron job.
* Displays the generated UUID, Web Path, and Access URL after installation.

### Output Example

```text
============================================================
✅ Service Ready – Access Information
------------------------------------------------------------
📁 Path        : /mypath123
🧬 UUID        : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
🌐 Access URL  : https://example.com/mypath123
============================================================
```

## Acknowledgements

- [@闹海金蛟](https://www.youtube.com/@%E9%97%B9%E6%B5%B7%E9%87%91%E8%9B%9F)
- [town95/node-ws](https://github.com/town95/node-ws)

This version documents every configurable parameter (`DOMAIN`, `REMARKS`, and `WEB_PATH`) and includes practical usage examples for each.

# Contributing

Contributions are welcome.

If you discover a bug or have a feature request, please open an issue or submit a pull request.

---

# Support

If you find this project useful, please consider giving it a **GitHub Star**.

Your support helps improve and maintain the project.

---

# License

Released under the **MIT License**.

---

<div align="center">

## Developed by

### **Thiyansa**
