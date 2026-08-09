// bot.js - Enhanced Telegram Bot with VPN Management
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// Configuration - Will be loaded from db.json
let CONFIG = {};
let BOT_TOKEN, OWNER_ID, DOMAIN, PORT, PATH;

// Load configuration from db.json
async function loadConfig() {
    try {
        const configData = await fs.readFile(path.join(__dirname, 'db.json'), 'utf8');
        CONFIG = JSON.parse(configData);
        
        BOT_TOKEN = CONFIG.bot_token;
        OWNER_ID = CONFIG.owner_id;
        DOMAIN = CONFIG.domain;
        PORT = CONFIG.port;
        PATH = CONFIG.path || '/kudda-vpn';
        
        console.log('✅ Configuration loaded from db.json');
        console.log(`📡 Domain: ${DOMAIN}`);
        console.log(`🔌 Port: ${PORT}`);
        console.log(`🛤️ Path: ${PATH}`);
        console.log(`🤖 Bot Token: ${BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
        
        if (!BOT_TOKEN) {
            console.error('❌ BOT_TOKEN is missing from db.json!');
            return false;
        }
        if (!OWNER_ID) {
            console.error('❌ OWNER_ID is missing from db.json!');
            return false;
        }
        if (!DOMAIN) {
            console.error('❌ DOMAIN is missing from db.json!');
            return false;
        }
        if (!PORT) {
            console.error('❌ PORT is missing from db.json!');
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error loading db.json:', error);
        console.error('Make sure db.json exists in the same directory with required fields.');
        return false;
    }
}

// Create db.json if it doesn't exist
async function createDefaultConfig() {
    const defaultConfig = {
        "bot_token": "YOUR_BOT_TOKEN_HERE",
        "owner_id": "YOUR_TELEGRAM_USER_ID",
        "domain": "your-domain.com",
        "port": 10808,
        "path": "/kudda-vpn"
    };
    
    try {
        await fs.writeFile(
            path.join(__dirname, 'db.json'), 
            JSON.stringify(defaultConfig, null, 2)
        );
        console.log('📝 Created default db.json. Please edit it with your values!');
        return false;
    } catch (error) {
        console.error('❌ Error creating db.json:', error);
        return false;
    }
}

const DATA_FILE = path.join(__dirname, 'data', 'users.json');
const CONFIGS_DIR = path.join(__dirname, 'data', 'configs');
const XRAY_DIR = path.join(__dirname, 'xy');
const XRAY_BINARY = path.join(XRAY_DIR, 'xy');
const XRAY_CONFIG = path.join(XRAY_DIR, 'config.json');

// Initialize bot (will be re-initialized after config loads)
let bot = null;

// Xray process reference
let xrayProcess = null;
let isXrayRunning = false;
let xrayRestartCount = 0;
let lastRestartTime = Date.now();

// Read Xray config to get port and path
async function getXrayConfigSettings() {
    try {
        const configData = await fs.readFile(XRAY_CONFIG, 'utf8');
        const xrayConfig = JSON.parse(configData);
        
        if (xrayConfig.inbounds && xrayConfig.inbounds.length > 0) {
            const inbound = xrayConfig.inbounds[0];
            return {
                port: inbound.port || PORT || 10808,
                path: inbound.streamSettings?.wsSettings?.path || PATH || '/kudda-vpn',
                domain: DOMAIN
            };
        }
        return { port: PORT || 10808, path: PATH || '/kudda-vpn', domain: DOMAIN };
    } catch (error) {
        console.error('Error reading Xray config:', error);
        return { port: PORT || 10808, path: PATH || '/kudda-vpn', domain: DOMAIN };
    }
}

// Formatting helpers for beautiful messages
function formatVPNMessage(config, user) {
    const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
    const expiryDate = new Date(config.expiryTime);
    const progressBar = createProgressBar(remaining, config.duration);
    
    return {
        text: `
<b>🔐 VPN Configuration Created</b>

<b>👤 User:</b> <code>${user.first_name || user.username || user.id}</code>
<b>🆔 ID:</b> <code>${config.id}</code>
<b>⏱ Duration:</b> <code>${config.duration}h</code>
<b>⏰ Expires:</b> <code>${expiryDate.toLocaleString()}</code>
<b>⏳ Remaining:</b> <code>${remaining}h</code>

<b>📊 Status:</b>
${progressBar}

<b>🔗 Connection Link:</b>
<code>${config.config.vless}</code>

<b>📋 Click below to copy</b>
        `,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📋 Copy Link', callback_data: `copy_${config.id}` },
                    { text: '🔙 Back', callback_data: 'back_to_menu' }
                ]
            ]
        }
    };
}

function createProgressBar(remaining, total) {
    const filled = Math.min(10, Math.round((remaining / total) * 10));
    const empty = 10 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `┃${bar}┃ ${remaining}h/${total}h`;
}

function formatConfigList(configs) {
    if (configs.length === 0) {
        return {
            text: `
<b>📋 No Active Configurations</b>

<i>You don't have any active VPN configurations.</i>

<b>💡 Tip:</b> Use the <b>🔐 Create VPN</b> button to get started.`,
            parse_mode: 'HTML'
        };
    }

    let message = `
<b>📋 Your Active Configurations</b>

<i>Here are your current VPN connections:</i>\n\n`;
    
    for (const config of configs) {
        const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
        const bar = createProgressBar(remaining, config.duration);
        message += `
<b>🔹 ${config.duration}h VPN</b>
${bar}
<b>ID:</b> <code>${config.id}</code>
<b>Expires:</b> <code>${new Date(config.expiryTime).toLocaleString()}</code>\n`;
    }
    
    return { text: message, parse_mode: 'HTML' };
}

// User data management functions
async function getUserData(userId) {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const users = JSON.parse(data);
        return users[userId] || null;
    } catch (error) {
        console.error('Error reading user data:', error);
        return null;
    }
}

async function saveUserData(userId, userData) {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const users = JSON.parse(data);
        users[userId] = userData;
        await fs.writeFile(DATA_FILE, JSON.stringify(users, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving user data:', error);
        return false;
    }
}

// Xray Management Functions
async function checkXrayBinary() {
    try {
        await fs.access(XRAY_BINARY);
        return true;
    } catch {
        return false;
    }
}

async function startXray() {
    try {
        if (!await checkXrayBinary()) {
            console.error('Xray binary not found!');
            return false;
        }

        try {
            await fs.access(XRAY_CONFIG);
        } catch {
            console.error('Xray config not found!');
            return false;
        }

        if (xrayProcess) {
            try {
                xrayProcess.kill();
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error('Error killing existing process:', error);
            }
        }

        const args = ['run', '-c', XRAY_CONFIG];
        xrayProcess = spawn(XRAY_BINARY, args);
        isXrayRunning = true;
        xrayRestartCount = 0;

        xrayProcess.stdout.on('data', (data) => {
            console.log(`[XRAY]: ${data.toString()}`);
        });

        xrayProcess.stderr.on('data', (data) => {
            console.error(`[XRAY ERR]: ${data.toString()}`);
        });

        xrayProcess.on('error', (error) => {
            console.error('Xray process error:', error);
            isXrayRunning = false;
        });

        xrayProcess.on('exit', (code) => {
            console.log(`Xray exited with code: ${code}`);
            isXrayRunning = false;
            
            if (code !== 0) {
                const now = Date.now();
                const timeSinceLastRestart = now - lastRestartTime;
                
                if (timeSinceLastRestart > 300000) {
                    xrayRestartCount = 0;
                }
                
                xrayRestartCount++;
                lastRestartTime = now;
                
                const backoffDelay = Math.min(30000, xrayRestartCount * 5000);
                
                console.log(`Restarting Xray in ${backoffDelay/1000}s (attempt ${xrayRestartCount})`);
                
                setTimeout(async () => {
                    if (xrayRestartCount < 10) {
                        await startXray();
                    } else {
                        console.error('Xray restart limit reached!');
                        notifyOwner('⚠️ Xray restart limit reached! Manual intervention required.');
                    }
                }, backoffDelay);
            }
        });

        console.log('✅ Xray started!');
        return true;
    } catch (error) {
        console.error('Error starting Xray:', error);
        return false;
    }
}

async function stopXray() {
    try {
        if (xrayProcess) {
            xrayProcess.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 1000));
            xrayProcess = null;
            isXrayRunning = false;
            console.log('✅ Xray stopped!');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error stopping Xray:', error);
        return false;
    }
}

async function restartXray() {
    await stopXray();
    await new Promise(resolve => setTimeout(resolve, 2000));
    return await startXray();
}

async function getXrayStatus() {
    if (isXrayRunning && xrayProcess) {
        return {
            running: true,
            pid: xrayProcess.pid,
            restarts: xrayRestartCount
        };
    }
    return {
        running: false,
        pid: null,
        restarts: xrayRestartCount
    };
}

async function notifyOwner(message) {
    try {
        if (bot && OWNER_ID) {
            await bot.telegram.sendMessage(OWNER_ID, `🤖 Bot Alert\n\n${message}`, {
                parse_mode: 'HTML'
            });
        }
    } catch (error) {
        console.error('Error notifying owner:', error);
    }
}

// Generate VPN configuration
async function generateVPNConfig(userId, duration) {
    const configId = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const expiryTime = now + (duration * 60 * 60 * 1000);
    
    const uuid = crypto.randomUUID();
    
    const xraySettings = await getXrayConfigSettings();
    const domain = DOMAIN;
    const port = xraySettings.port || PORT || 10808;
    const path = xraySettings.path || PATH || '/kudda-vpn';
    
    const vlessLink = `vless://${uuid}@${domain}:${port}?encryption=none&security=none&type=ws&host=m.zoom.us&path=${encodeURIComponent(path)}#VPN-${duration}h`;
    
    const config = {
        id: configId,
        userId: userId,
        createdAt: now,
        expiryTime: expiryTime,
        duration: duration,
        config: {
            vless: vlessLink,
            details: {
                uuid: uuid,
                domain: domain,
                port: port,
                path: path
            }
        }
    };
    
    return config;
}

async function saveVPNConfig(userId, config) {
    try {
        const userData = await getUserData(userId) || { configs: [] };
        userData.configs = userData.configs || [];
        userData.configs.push({
            id: config.id,
            createdAt: config.createdAt,
            expiryTime: config.expiryTime,
            duration: config.duration,
            uuid: config.config.details.uuid
        });
        
        await saveUserData(userId, userData);
        
        await updateXrayConfig(userId, config);
        
        const configPath = path.join(CONFIGS_DIR, `${config.id}.json`);
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        
        return true;
    } catch (error) {
        console.error('Error saving VPN config:', error);
        return false;
    }
}

async function updateXrayConfig(userId, newConfig) {
    try {
        const configData = await fs.readFile(XRAY_CONFIG, 'utf8');
        const xrayConfig = JSON.parse(configData);
        
        if (xrayConfig.inbounds && xrayConfig.inbounds.length > 0) {
            const inbound = xrayConfig.inbounds[0];
            if (!inbound.settings.clients) {
                inbound.settings.clients = [];
            }
            
            inbound.settings.clients.push({
                id: newConfig.config.details.uuid,
                email: `user_${userId}_${newConfig.id}`
            });
            
            if (!inbound.settings.decryption) {
                inbound.settings.decryption = "none";
            }
            
            await fs.writeFile(XRAY_CONFIG, JSON.stringify(xrayConfig, null, 2));
            
            await restartXray();
        }
    } catch (error) {
        console.error('Error updating Xray config:', error);
        throw error;
    }
}

async function getActiveConfigs(userId) {
    try {
        const userData = await getUserData(userId);
        if (!userData || !userData.configs) return [];
        
        const now = Date.now();
        const activeConfigs = [];
        
        for (const configRef of userData.configs) {
            if (configRef.expiryTime > now) {
                const configPath = path.join(CONFIGS_DIR, `${configRef.id}.json`);
                try {
                    const data = await fs.readFile(configPath, 'utf8');
                    const fullConfig = JSON.parse(data);
                    activeConfigs.push(fullConfig);
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        console.log(`Config file ${configRef.id}.json not found, removing from user data`);
                        userData.configs = userData.configs.filter(c => c.id !== configRef.id);
                        await saveUserData(userId, userData);
                    } else {
                        console.error('Error reading config file:', error);
                    }
                }
            }
        }
        
        return activeConfigs;
    } catch (error) {
        console.error('Error getting active configs:', error);
        return [];
    }
}

async function deleteUserConfig(userId, configId) {
    try {
        const userData = await getUserData(userId);
        if (!userData || !userData.configs) return false;
        
        const configToDelete = userData.configs.find(c => c.id === configId);
        if (configToDelete) {
            await removeFromXrayConfig(configToDelete.uuid);
        }
        
        userData.configs = userData.configs.filter(c => c.id !== configId);
        await saveUserData(userId, userData);
        
        const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
        try {
            await fs.unlink(configPath);
        } catch (error) {
            console.error('Error deleting config file:', error);
        }
        
        return true;
    } catch (error) {
        console.error('Error deleting config:', error);
        return false;
    }
}

async function removeFromXrayConfig(uuid) {
    try {
        const configData = await fs.readFile(XRAY_CONFIG, 'utf8');
        const xrayConfig = JSON.parse(configData);
        
        if (xrayConfig.inbounds && xrayConfig.inbounds.length > 0) {
            const inbound = xrayConfig.inbounds[0];
            if (inbound.settings.clients) {
                inbound.settings.clients = inbound.settings.clients.filter(
                    client => client.id !== uuid
                );
                
                await fs.writeFile(XRAY_CONFIG, JSON.stringify(xrayConfig, null, 2));
                await restartXray();
            }
        }
    } catch (error) {
        console.error('Error removing from Xray config:', error);
    }
}

// Clean expired configs
async function cleanupExpiredConfigs() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const users = JSON.parse(data);
        const now = Date.now();
        let changes = false;
        let expiredCount = 0;
        
        for (const [userId, userData] of Object.entries(users)) {
            if (userData.configs) {
                const validConfigs = userData.configs.filter(c => c.expiryTime > now);
                const expiredConfigs = userData.configs.filter(c => c.expiryTime <= now);
                expiredCount += expiredConfigs.length;
                
                for (const config of expiredConfigs) {
                    if (config.uuid) {
                        await removeFromXrayConfig(config.uuid);
                    }
                    
                    const configPath = path.join(CONFIGS_DIR, `${config.id}.json`);
                    try {
                        await fs.unlink(configPath);
                    } catch (error) {
                        console.error('Error deleting expired config file:', error);
                    }
                }
                
                if (validConfigs.length !== userData.configs.length) {
                    userData.configs = validConfigs;
                    changes = true;
                }
            }
        }
        
        if (changes) {
            await fs.writeFile(DATA_FILE, JSON.stringify(users, null, 2));
        }
        
        return expiredCount;
    } catch (error) {
        console.error('Error cleaning up expired configs:', error);
        return 0;
    }
}

// Setup bot commands
function setupBot() {
    if (!bot) {
        console.error('❌ Bot not initialized!');
        return;
    }

    // Bot commands with rich formatting
    bot.start(async (ctx) => {
        const userId = ctx.from.id;
        const user = ctx.from;
        
        const welcomeMessage = `
<b>🌟 Welcome to VPN Bot!</b>

<i>Your secure VPN management solution</i>

<b>✨ Features:</b>
🔐 <b>Create VPN</b> - Generate new configurations
📋 <b>Manage Configs</b> - View and copy your links
🗑 <b>Delete Configs</b> - Remove unused connections
⚡ <b>Auto-Expiry</b> - Configs expire automatically

<b>ℹ️ Need help?</b> Use the buttons below to get started.

<b>🔒 Your data is private and secure.</b>
        `;
        
        await ctx.replyWithHTML(welcomeMessage, {
            reply_markup: {
                inline_keyboard: getMainKeyboard(userId)
            }
        });
    });

    // Keyboard builders
    function getMainKeyboard(userId) {
        const isOwner = userId.toString() === OWNER_ID;
        const buttons = [
            [{ text: '🔐 Create VPN', callback_data: 'create_vpn' }],
            [{ text: '📋 My Configs', callback_data: 'list_configs' }],
            [{ text: '🗑 Delete Config', callback_data: 'delete_config' }]
        ];
        
        if (isOwner) {
            buttons.push([{ text: '⚙️ Admin Panel', callback_data: 'admin_panel' }]);
        }
        
        return buttons;
    }

    function getDurationKeyboard() {
        const durations = [
            { label: '3 Hours', value: 3 },
            { label: '7 Hours', value: 7 },
            { label: '10 Hours', value: 10 },
            { label: '12 Hours', value: 12 },
            { label: '15 Hours', value: 15 },
            { label: '18 Hours', value: 18 },
            { label: '20 Hours', value: 20 },
            { label: '24 Hours', value: 24 }
        ];
        
        const buttons = durations.map(d => ({
            text: d.label,
            callback_data: `duration_${d.value}`
        }));
        
        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
        }
        
        rows.push([{ text: '🔙 Back', callback_data: 'back_to_menu' }]);
        
        return rows;
    }

    function getConfigListKeyboard(configs) {
        const buttons = configs.map(c => {
            const remaining = Math.ceil((c.expiryTime - Date.now()) / (1000 * 60 * 60));
            return {
                text: `⏱ ${c.duration}h (${remaining}h left)`,
                callback_data: `view_config_${c.id}`
            };
        });
        
        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
        }
        
        rows.push([{ text: '🔙 Back', callback_data: 'back_to_menu' }]);
        
        return rows;
    }

    function getDeleteKeyboard(configs) {
        const buttons = configs.map(c => ({
            text: `Delete ${c.duration}h`,
            callback_data: `delete_confirm_${c.id}`
        }));
        
        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
        }
        
        rows.push([{ text: '🔙 Back', callback_data: 'back_to_menu' }]);
        
        return rows;
    }

    function getAdminKeyboard() {
        return [
            [{ text: '🔄 Restart Xray', callback_data: 'admin_restart' }],
            [{ text: '⏹ Stop Xray', callback_data: 'admin_stop' }],
            [{ text: '▶️ Start Xray', callback_data: 'admin_start' }],
            [{ text: '📊 Xray Status', callback_data: 'admin_status' }],
            [{ text: '🧹 Clean Expired', callback_data: 'admin_cleanup' }],
            [{ text: '📈 System Stats', callback_data: 'admin_stats' }],
            [{ text: '🔙 Back', callback_data: 'back_to_menu' }]
        ];
    }

    // Handle callback queries
    bot.action('create_vpn', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.editMessageText(`
<b>⏱ Select Duration</b>

<i>Choose how long you want your VPN:</i>

<b>Available options:</b>
🟢 <b>3h</b> - Quick connection
🟡 <b>12h</b> - Half day
🔴 <b>24h</b> - Full day

<code>Click a button below to create your VPN.</code>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getDurationKeyboard()
            }
        });
    });

    bot.action(/^duration_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const duration = parseInt(ctx.match[1]);
        const userId = ctx.from.id;
        const user = ctx.from;
        
        const activeConfigs = await getActiveConfigs(userId);
        if (activeConfigs.length >= 5) {
            await ctx.answerCbQuery('Maximum 5 VPN connections allowed!');
            return;
        }
        
        await ctx.editMessageText(`
<b>⏳ Creating Your VPN...</b>

<i>Generating secure configuration</i>

<b>🔒 This may take a few moments...</b>
        `, { parse_mode: 'HTML' });
        
        try {
            const config = await generateVPNConfig(userId, duration);
            await saveVPNConfig(userId, config);
            
            const messageData = formatVPNMessage(config, user);
            await ctx.editMessageText(messageData.text, {
                parse_mode: messageData.parse_mode,
                reply_markup: messageData.reply_markup
            });
        } catch (error) {
            await ctx.editMessageText(`
<b>❌ VPN Creation Failed</b>

<i>An error occurred:</i>
<code>${error.message}</code>

<b>Please try again later.</b>
            `, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_menu' }]]
                }
            });
        }
    });

    bot.action('list_configs', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const configs = await getActiveConfigs(userId);
        
        const messageData = formatConfigList(configs);
        
        await ctx.editMessageText(messageData.text, {
            parse_mode: messageData.parse_mode,
            reply_markup: {
                inline_keyboard: configs.length > 0 ? getConfigListKeyboard(configs) : [[{ text: '🔙 Back', callback_data: 'back_to_menu' }]]
            }
        });
    });

    bot.action(/^view_config_(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const configId = ctx.match[1];
        const userId = ctx.from.id;
        const user = ctx.from;
        
        const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
        try {
            const data = await fs.readFile(configPath, 'utf8');
            const config = JSON.parse(data);
            
            const messageData = formatVPNMessage(config, user);
            await ctx.editMessageText(messageData.text, {
                parse_mode: messageData.parse_mode,
                reply_markup: messageData.reply_markup
            });
        } catch (error) {
            await ctx.editMessageText(`
<b>❌ Config Not Found</b>

<i>The requested configuration could not be found.</i>
            `, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_menu' }]]
                }
            });
        }
    });

    bot.action(/^copy_(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const configId = ctx.match[1];
        const userId = ctx.from.id;
        
        const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
        try {
            const data = await fs.readFile(configPath, 'utf8');
            const config = JSON.parse(data);
            
            await ctx.replyWithHTML(`
<b>📋 Copy this link:</b>

<code>${config.config.vless}</code>

<i>Tap and hold to copy</i>
            `);
            
            const user = ctx.from;
            const messageData = formatVPNMessage(config, user);
            await ctx.editMessageText(messageData.text, {
                parse_mode: messageData.parse_mode,
                reply_markup: messageData.reply_markup
            });
        } catch (error) {
            await ctx.replyWithHTML(`
<b>❌ Config Not Found</b>
            `);
        }
    });

    bot.action('delete_config', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const configs = await getActiveConfigs(userId);
        
        if (configs.length === 0) {
            await ctx.editMessageText(`
<b>❌ No Configs to Delete</b>

<i>You don't have any active configurations.</i>
            `, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_menu' }]]
                }
            });
            return;
        }
        
        let message = `
<b>🗑 Delete Config</b>

<i>Select a configuration to delete:</i>

⚠️ <b>Warning:</b> This action cannot be undone.
        `;
        
        await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getDeleteKeyboard(configs)
            }
        });
    });

    bot.action(/^delete_confirm_(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const configId = ctx.match[1];
        const userId = ctx.from.id;
        
        await deleteUserConfig(userId, configId);
        
        await ctx.editMessageText(`
✅ <b>Config Deleted</b>

<i>The configuration has been removed successfully.</i>

<b>🔒 Your VPN is now disconnected.</b>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_menu' }]]
            }
        });
    });

    bot.action('back_to_menu', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        const message = `
<b>🌟 Main Menu</b>

<i>What would you like to do?</i>

<b>🔐 Create VPN</b> - Get a new connection
<b>📋 My Configs</b> - View your connections
<b>🗑 Delete Config</b> - Remove a connection
        `;
        
        await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getMainKeyboard(userId)
            }
        });
    });

    // Admin actions
    bot.action('admin_panel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) {
            await ctx.answerCbQuery('Unauthorized!');
            return;
        }
        
        await ctx.editMessageText(`
<b>⚙️ Admin Panel</b>

<i>System management options:</i>

<b>🔄 Restart Xray</b> - Restart the VPN service
<b>⏹ Stop Xray</b> - Stop the VPN service
<b>▶️ Start Xray</b> - Start the VPN service
<b>📊 Xray Status</b> - Check service status
<b>🧹 Clean Expired</b> - Remove old configs
<b>📈 System Stats</b> - View system info

<code>Select an option below</code>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getAdminKeyboard()
            }
        });
    });

    bot.action('admin_restart', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) return;
        
        await ctx.editMessageText(`
<b>🔄 Restarting Xray...</b>

<i>Please wait...</i>
        `, { parse_mode: 'HTML' });
        
        await restartXray();
        
        const status = await getXrayStatus();
        await ctx.editMessageText(`
${status.running ? '✅' : '❌'} <b>Xray Restart ${status.running ? 'Successful' : 'Failed'}</b>

<i>Status: ${status.running ? '🟢 Running' : '🔴 Stopped'}</i>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getAdminKeyboard()
            }
        });
    });

    bot.action('admin_stop', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) return;
        
        await ctx.editMessageText(`
<b>⏹ Stopping Xray...</b>

<i>Please wait...</i>
        `, { parse_mode: 'HTML' });
        
        await stopXray();
        
        await ctx.editMessageText(`
✅ <b>Xray Stopped Successfully</b>

<i>Status: 🔴 Stopped</i>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getAdminKeyboard()
            }
        });
    });

    bot.action('admin_start', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) return;
        
        await ctx.editMessageText(`
<b>▶️ Starting Xray...</b>

<i>Please wait...</i>
        `, { parse_mode: 'HTML' });
        
        await startXray();
        
        const status = await getXrayStatus();
        await ctx.editMessageText(`
${status.running ? '✅' : '❌'} <b>Xray Start ${status.running ? 'Successful' : 'Failed'}</b>

<i>Status: ${status.running ? '🟢 Running' : '🔴 Stopped'}</i>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getAdminKeyboard()
            }
        });
    });

    bot.action('admin_status', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) return;
        
        const status = await getXrayStatus();
        const statusText = status.running ? '🟢 Running' : '🔴 Stopped';
        
        await ctx.editMessageText(`
<b>📊 Xray Status</b>

<b>Status:</b> ${statusText}
<b>PID:</b> <code>${status.pid || 'N/A'}</code>
<b>Restarts:</b> <code>${status.restarts}</code>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getAdminKeyboard()
            }
        });
    });

    bot.action('admin_cleanup', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) return;
        
        await ctx.editMessageText(`
<b>🧹 Cleaning Expired Configs...</b>

<i>Please wait...</i>
        `, { parse_mode: 'HTML' });
        
        const count = await cleanupExpiredConfigs();
        
        await ctx.editMessageText(`
<b>✅ Cleanup Complete</b>

<i>Removed ${count} expired configuration(s).</i>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getAdminKeyboard()
            }
        });
    });

    bot.action('admin_stats', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) return;
        
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        let totalConfigs = 0;
        try {
            const data = await fs.readFile(DATA_FILE, 'utf8');
            const users = JSON.parse(data);
            for (const userData of Object.values(users)) {
                if (userData.configs) {
                    totalConfigs += userData.configs.filter(c => c.expiryTime > Date.now()).length;
                }
            }
        } catch (error) {}
        
        await ctx.editMessageText(`
<b>📈 System Statistics</b>

<b>Memory:</b> <code>${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB</code>
<b>Uptime:</b> <code>${Math.floor(uptime / 60)} minutes</code>
<b>Active Configs:</b> <code>${totalConfigs}</code>
<b>Platform:</b> <code>${process.platform}</code>
<b>Node Version:</b> <code>${process.version}</code>
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getAdminKeyboard()
            }
        });
    });

    // Error handling
    bot.catch((err, ctx) => {
        console.error('Error:', err);
        ctx.reply(`
<b>❌ An Error Occurred</b>

<i>Please try again or contact support.</i>

<code>${err.message}</code>
        `, { parse_mode: 'HTML' });
    });
}

// Start cleanup process
function startCleanupScheduler() {
    setInterval(async () => {
        await cleanupExpiredConfigs();
    }, 60 * 60 * 1000);
    
    setTimeout(async () => {
        await cleanupExpiredConfigs();
    }, 5000);
}

// Start Xray monitor
function startXrayMonitor() {
    setInterval(async () => {
        const status = await getXrayStatus();
        if (!status.running && xrayRestartCount < 10) {
            console.log('Xray down, restarting...');
            await startXray();
        }
    }, 30000);
}

// Ensure directories exist
async function ensureDirectories() {
    try {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
        await fs.mkdir(CONFIGS_DIR, { recursive: true });
        await fs.mkdir(XRAY_DIR, { recursive: true });
        
        try {
            await fs.access(DATA_FILE);
        } catch {
            await fs.writeFile(DATA_FILE, JSON.stringify({}, null, 2));
        }
    } catch (error) {
        console.error('Error creating directories:', error);
    }
}

// Start the bot
async function startBot() {
    try {
        // First check if db.json exists and load config
        let configLoaded = await loadConfig();
        
        if (!configLoaded) {
            // Try to create default config
            await createDefaultConfig();
            console.log('❌ Please edit db.json with your bot token and other settings, then restart.');
            process.exit(1);
        }
        
        // Now initialize bot with the loaded token
        bot = new Telegraf(BOT_TOKEN);
        
        // Setup all bot commands and handlers
        setupBot();
        
        await ensureDirectories();
        await bot.launch();
        console.log('🤖 Bot started!');
        
        console.log('🔄 Starting Xray...');
        await startXray();
        
        startCleanupScheduler();
        startXrayMonitor();
        
        console.log('📊 Memory: ' + Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB');
        
        await notifyOwner('✅ Bot started successfully!\nXray auto-started.');
        
        process.once('SIGINT', async () => {
            console.log('Shutting down...');
            await stopXray();
            bot.stop('SIGINT');
            process.exit(0);
        });
        
        process.once('SIGTERM', async () => {
            console.log('Shutting down...');
            await stopXray();
            bot.stop('SIGTERM');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Start the bot
startBot();
