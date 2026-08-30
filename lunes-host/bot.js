const { Telegraf } = require('telegraf');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ==================== CONFIGURATION ====================
let CONFIG = {};
let BOT_TOKEN, OWNER_ID, DOMAIN, PORT, PATH, IMAGE_URL;
let CACHED_IMAGE_PATH = null;
let IMAGE_CACHE_CHECKED = false;

// Private mode settings
let PRIVATE_MODE = { enabled: false, allowed_users: [], blocked_users: [] };
let GROUP_SETTINGS = { enabled: true, allowed_groups: [], blocked_groups: [] };
let CHANNEL_SETTINGS = { enabled: true, allowed_channels: [], blocked_channels: [] };
let ADMIN_SETTINGS = {};
let CHAT_CONTROLS = { enabled_chats: [], disabled_chats: [], pending_approvals: [] };

// ==================== NO CACHING - DIRECT FILE ACCESS ====================

// ==================== RESTART DEBOUNCE SYSTEM ====================
let restartTimer = null;
let restartInProgress = false;
let intentionalXrayStop = false;
let pendingXrayRestart = false;
let ownerPendingAction = null;
let restartQueue = [];
let isRestarting = false;
let lastRestartTime = 0;
const MIN_RESTART_INTERVAL = 2000; // 2 seconds minimum
const MAX_RESTART_QUEUE = 5;
const MAX_CPU_PERCENT = 13;
const MAX_RAM_MB = 100;

// ===== NEW: Resource Monitor =====
function checkResourceLimits() {
    const memUsage = process.memoryUsage();
    const memMB = memUsage.heapUsed / 1024 / 1024;
    const cpuUsage = process.cpuUsage();
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Approximate
    
    return {
        memoryOK: memMB < MAX_RAM_MB,
        cpuOK: cpuPercent < MAX_CPU_PERCENT,
        memMB: memMB,
        cpuPercent: cpuPercent
    };
}

async function waitForResources() {
    let attempts = 0;
    while (attempts < 30) { // Max 30 seconds wait
        const status = checkResourceLimits();
        if (status.memoryOK && status.cpuOK) {
            return true;
        }
        console.log(`⏳ Waiting for resources... CPU: ${status.cpuPercent.toFixed(1)}%, RAM: ${status.memMB.toFixed(1)}MB`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
    }
    return false;
}

// ==================== LOAD CONFIGURATION ====================
async function loadConfig() {
    try {
        const configData = await fsPromises.readFile(path.join(__dirname, 'db.json'), 'utf8');
        CONFIG = JSON.parse(configData);
        
        BOT_TOKEN = CONFIG.bot_token;
        OWNER_ID = CONFIG.owner_id;
        DOMAIN = CONFIG.domain;
        PORT = CONFIG.port;
        PATH = CONFIG.path || '/kudda-vpn';
        IMAGE_URL = CONFIG.image_url || '';
        VLESS_HOST = CONFIG.vless_host || 'm.zoom.us';
        
        // Load private mode settings
        PRIVATE_MODE = CONFIG.private_mode || { enabled: false, allowed_users: [], blocked_users: [] };
        GROUP_SETTINGS = CONFIG.group_settings || { enabled: true, allowed_groups: [], blocked_groups: [] };
        CHANNEL_SETTINGS = CONFIG.channel_settings || { enabled: true, allowed_channels: [], blocked_channels: [] };
        ADMIN_SETTINGS = CONFIG.admin_settings || { enable_button: 'enable', disable_button: 'disable', require_admin_approval: true, auto_enable_new_groups: false };
        CHAT_CONTROLS = CONFIG.chat_controls || { enabled_chats: [], disabled_chats: [], pending_approvals: [] };
        
        console.log('✅ Configuration loaded from db.json');
        console.log(`📡 Domain: ${DOMAIN}`);
        console.log(`🔌 Port: ${PORT}`);
        console.log(`🛤️ Path: ${PATH}`);
        console.log(`🖼️ Image URL: ${IMAGE_URL || 'Not set'}`);
        console.log(`🤖 Bot Token: ${BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
        console.log(`🔒 Private Mode: ${PRIVATE_MODE.enabled ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`👥 Group Settings: ${GROUP_SETTINGS.enabled ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`📢 Channel Settings: ${CHANNEL_SETTINGS.enabled ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`🌐 VLESS Host: ${VLESS_HOST}`);
        
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

// ==================== HELPER: ESCAPE HTML ====================
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==================== HELPER: ATOMIC JSON WRITE ====================
async function writeJsonAtomic(filePath, data) {
    const tempPath = `${filePath}.tmp`;
    
    const json = JSON.stringify(data, null, 2);
    
    // Validate before writing
    JSON.parse(json);
    
    await fsPromises.writeFile(tempPath, json, 'utf8');
    await fsPromises.rename(tempPath, filePath);
}

async function readJsonSafe(filePath, fallback = null) {
    try {
        const data = await fsPromises.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading JSON ${filePath}:`, error.message);
        return fallback;
    }
}

// ==================== HELPER: NOTIFY USER ====================
async function notifyUser(userId, message) {
    try {
        if (!bot) return false;
        
        await bot.telegram.sendMessage(userId, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        
        return true;
    } catch (error) {
        console.error(`Failed to notify user ${userId}:`, error.message);
        return false;
    }
}

// ==================== VALIDATE XRAY CONFIG ====================
async function validateXrayConfig(configPath) {
    return new Promise((resolve) => {
        const testProcess = spawn(XRAY_BINARY, ['test', '-c', configPath]);
        
        let errorOutput = '';
        let output = '';
        
        testProcess.stdout.on('data', data => {
            output += data.toString();
        });
        
        testProcess.stderr.on('data', data => {
            errorOutput += data.toString();
        });
        
        testProcess.on('exit', code => {
            if (code === 0) {
                resolve({ valid: true, output: output });
            } else {
                resolve({ valid: false, error: errorOutput || output });
            }
        });
        
        testProcess.on('error', (err) => {
            resolve({ valid: false, error: err.message });
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            testProcess.kill();
            resolve({ valid: false, error: 'Validation timeout' });
        }, 10000);
    });
}

// ==================== CHECK PERMISSIONS - FIXED ====================
function isChatEnabled(chatId) {
    const chatIdStr = chatId.toString();
    // If chat is explicitly disabled, return false
    if (CHAT_CONTROLS.disabled_chats.includes(chatIdStr)) {
        return false;
    }
    // If enabled_chats is not empty, only allow those chats
    if (CHAT_CONTROLS.enabled_chats.length > 0) {
        return CHAT_CONTROLS.enabled_chats.includes(chatIdStr);
    }
    return true;
}

function isPrivateUserAllowed(userId) {
    const userIdStr = userId.toString();
    
    // BLOCKED USERS ARE ALWAYS BLOCKED - FIXED: Check this FIRST
    if (PRIVATE_MODE.blocked_users.includes(userIdStr)) {
        return false;
    }
    
    // If private mode is disabled, allow all (except blocked users)
    if (!PRIVATE_MODE.enabled) {
        return true;
    }
    
    // If private mode is enabled, only allow allowed users
    if (PRIVATE_MODE.allowed_users.length > 0) {
        return PRIVATE_MODE.allowed_users.includes(userIdStr);
    }
    
    // If private mode enabled but allowed list empty, block everyone (except owner)
    return false;
}

function isGroupAllowed(chatId) {
    const chatIdStr = chatId.toString();
    
    // If group settings disabled, block all groups
    if (!GROUP_SETTINGS.enabled) {
        return false;
    }
    
    // Check if group is blocked
    if (GROUP_SETTINGS.blocked_groups.includes(chatIdStr)) {
        return false;
    }
    
    // If allowed_groups is not empty, only allow those groups
    if (GROUP_SETTINGS.allowed_groups.length > 0) {
        return GROUP_SETTINGS.allowed_groups.includes(chatIdStr);
    }
    
    return true;
}

function isChannelAllowed(chatId) {
    const chatIdStr = chatId.toString();
    
    // If channel settings disabled, block all channels
    if (!CHANNEL_SETTINGS.enabled) {
        return false;
    }
    
    // Check if channel is blocked
    if (CHANNEL_SETTINGS.blocked_channels.includes(chatIdStr)) {
        return false;
    }
    
    // If allowed_channels is not empty, only allow those channels
    if (CHANNEL_SETTINGS.allowed_channels.length > 0) {
        return CHANNEL_SETTINGS.allowed_channels.includes(chatIdStr);
    }
    
    return true;
}

// ==================== COMPREHENSIVE PERMISSION CHECK - FIXED ====================
async function checkPermissions(ctx) {
    // Skip if no chat or from
    if (!ctx.chat || !ctx.from) return true;
    
    const chatType = ctx.chat.type;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const isOwner = userId.toString() === OWNER_ID;
    
    // Owner always has access to everything
    if (isOwner) return true;
    
    // ----- CHECK BLOCKED USERS FIRST (MOST IMPORTANT) -----
    // Blocked users cannot do ANYTHING in ANY chat
    if (PRIVATE_MODE.blocked_users.includes(userId.toString())) {
        try {
            await ctx.reply(`
<b>🚫 Bot Access Denied</b>

<blockquote><i>ඔබට මෙම Bot එක භාවිතා කිරීමට දැනට අවසර නොමැත.
වැඩි විස්තර හෝ අවහිර කිරීම ඉවත් කිරීම සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
            `, { parse_mode: 'HTML' });
        } catch (e) {
            // User has blocked the bot or cannot receive messages
            // Just log and continue
            console.log(`🔇 Cannot send message to blocked user ${userId}: ${e.message}`);
        }
        return false;
    }
    
    // ----- CHECK PRIVATE CHAT -----
    if (chatType === 'private') {
        // If private mode is enabled, check if user is allowed
        if (PRIVATE_MODE.enabled) {
            if (!PRIVATE_MODE.allowed_users.includes(userId.toString())) {
                try {
                    await ctx.reply(`
<b>⛔ පුද්ගලික ප්‍රවේශ මාදිලිය</b>

<blockquote><i>මෙම සේවාව දැනට Private Mode තුළ ක්‍රියාත්මක වේ.
ඔබට මෙය භාවිතා කිරීමට අවසර ලබා දී නොමැත.</i></blockquote>

<b>🎓 KUDDA EDUCATION VPN</b>
<blockquote><i>මෙය පාසල් සිසුන් සහ අධ්‍යාපනය හදාරන සියලු දෙනා සඳහා නිර්මාණය කරන ලද නොමිලේ VPN සේවාවකි.</i></blockquote>
<a href="https://t.me/FreeEduVPN">FREE EDU VPN GROUP</a>

<b>📌 අවසර ලබා ගැනීමට සම්බන්ධ වන්න:</b>
<a href="https://t.me/mataberiyo">Contact Admin</a>
                    `, { parse_mode: 'HTML' });
                } catch (e) {
                    // User blocked the bot
                    console.log(`🔇 Cannot send private mode message to user ${userId}: ${e.message}`);
                }
                return false;
            }
        }
        return true;
    }

// ----- CHECK GROUP -----
    if (chatType === 'group' || chatType === 'supergroup') {
        // Check group settings
        if (!GROUP_SETTINGS.enabled) {
            try {
                await ctx.reply(`
<b>🚫 Groups Disabled</b>

<blockquote><i>කණ්ඩායම් ප්‍රවේශය දැනට පරිපාලක විසින් සීමා කර ඇත.
මෙම පහසුකම භාවිතා කිරීමට අවසර ලබා ගැනීමට Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 සහාය සඳහා:</b>
<a href="https://t.me/mataberiyo">Contact Admin</a>
                `, { parse_mode: 'HTML' });
            } catch (e) { console.log(`[Bot Kicked/Blocked] Cannot send to ${chatId}`); }
            return false;
        }
        
        // Check if group is blocked
        if (GROUP_SETTINGS.blocked_groups.includes(chatId.toString())) {
            try {
                await ctx.reply(`
<b>🚫 Group Blocked</b>

<blockquote><i>මෙම කණ්ඩායමට ප්‍රවේශය පරිපාලක විසින් අවහිර කර ඇත.
වැඩි විස්තර හෝ සහාය සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
                `, { parse_mode: 'HTML' });
            } catch (e) { console.log(`[Bot Kicked/Blocked] Cannot send to ${chatId}`); }
            return false;
        }
        
        // Check if group is in allowed list (if list is not empty)
        if (GROUP_SETTINGS.allowed_groups.length > 0 && 
            !GROUP_SETTINGS.allowed_groups.includes(chatId.toString())) {
            try {
                await ctx.reply(`
<b>🚫 Group Access Denied</b>

<blockquote><i>මෙම කණ්ඩායමට භාවිතා කිරීමේ අවසර ලබා දී නොමැත.
අවසර ලබා ගැනීම සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
                `, { parse_mode: 'HTML' });
            } catch (e) { console.log(`[Bot Kicked/Blocked] Cannot send to ${chatId}`); }
            return false;
        }
        
        // Check chat control (enabled/disabled)
        if (!isChatEnabled(chatId)) {
            try {
                await ctx.reply(`
<b>🚫 Chat Access Disabled</b>

<blockquote><i>මෙම සංවාදය පරිපාලක විසින් අක්‍රිය කර ඇත.
වැඩි විස්තර හෝ සහාය සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
                `, { parse_mode: 'HTML' });
            } catch (e) { console.log(`[Bot Kicked/Blocked] Cannot send to ${chatId}`); }
            return false;
        }
        
        // Check pending approvals
        if (CHAT_CONTROLS.pending_approvals.includes(chatId.toString())) {
            try {
                await ctx.reply(`
<b>⏳ Approval Pending</b>

<blockquote><i>මෙම චැට් එක භාවිතා කිරීමට පෙර පරිපාලක අනුමැතිය අවශ්‍ය වේ.
කරුණාකර Admin අනුමැතිය ලබා දෙන තුරු රැඳී සිටින්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
                `, { parse_mode: 'HTML' });
            } catch (e) { console.log(`[Bot Kicked/Blocked] Cannot send to ${chatId}`); }
            return false;
        }
        
        return true;
    }
    
    // ----- CHECK CHANNEL -----
    if (chatType === 'channel') {
        if (!CHANNEL_SETTINGS.enabled) {
            try {
                await ctx.reply(`
<b>🚫 Channels Disabled</b>

<blockquote><i>මෙම චැනල් පහසුකම දැනට පරිපාලක විසින් අක්‍රිය කර ඇත.
ප්‍රවේශය නැවත ලබා ගැනීමට Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>
                `, { parse_mode: 'HTML' });
            } catch (e) {}
            return false;
        }
        
        if (CHANNEL_SETTINGS.blocked_channels.includes(chatId.toString())) {
            try {
                await ctx.reply(`
<b>🚫 Channel Blocked</b>

<blockquote><i>මෙම චැනලයට ප්‍රවේශය පරිපාලක විසින් අවහිර කර ඇත.
වැඩි විස්තර සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>
                `, { parse_mode: 'HTML' });
            } catch (e) {}
            return false;
        }
        
        if (CHANNEL_SETTINGS.allowed_channels.length > 0 && 
            !CHANNEL_SETTINGS.allowed_channels.includes(chatId.toString())) {
            try {
                await ctx.reply(`
<b>🚫 Channel Access Denied</b>

<blockquote><i>මෙම චැනලයට භාවිතා කිරීමේ අවසර ලබා දී නොමැත.
අවසර ලබා ගැනීම සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>
                `, { parse_mode: 'HTML' });
            } catch (e) {}
            return false;
        }
        
        if (!isChatEnabled(chatId)) {
            try {
                await ctx.reply(`
<b>🚫 Channel Disabled</b>

<blockquote><i>මෙම චැනලය දැනට පරිපාලක විසින් අක්‍රිය කර ඇත.
නැවත ප්‍රවේශය ලබා ගැනීම සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>
                `, { parse_mode: 'HTML' });
            } catch (e) {}
            return false;
        }
        
        if (CHAT_CONTROLS.pending_approvals.includes(chatId.toString())) {
            try {
                await ctx.reply(`
<b>⏳ Channel Approval Pending</b>

<blockquote><i>මෙම චැනලය භාවිතා කිරීමට පෙර පරිපාලක අනුමැතිය අවශ්‍ය වේ.
කරුණාකර Admin අනුමැතිය ලැබෙන තුරු රැඳී සිටින්න.</i></blockquote>
                `, { parse_mode: 'HTML' });
            } catch (e) {}
            return false;
        }
        
        return true;
    }
    
    // Default: allow other chat types
    return true;
}

async function checkAndEnableChat(ctx) {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const userId = ctx.from.id;
    const isOwner = userId.toString() === OWNER_ID;
    
    // If owner, always allow
    if (isOwner) return true;
    
    // Check if chat is already enabled
    if (CHAT_CONTROLS.enabled_chats.includes(chatId.toString())) {
        return true;
    }
    
    // Check if chat is disabled
    if (CHAT_CONTROLS.disabled_chats.includes(chatId.toString())) {
        try {
            await ctx.reply(`
<b>🚫 චැට් ප්‍රවේශය අවහිර කර ඇත</b>

<blockquote><i>මෙම සංවාදය පරිපාලක විසින් තාවකාලිකව අක්‍රිය කර ඇත.
ප්‍රවේශය නැවත ලබා ගැනීම සඳහා පරිපාලක සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 සහාය සඳහා:</b>
<a href="https://t.me/mataberiyo">Contact Admin</a>
            `, { parse_mode: 'HTML' });
        } catch (e) {}
        return false;
    }
    
    // For groups and channels, check if admin approval is required
    if ((chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') && 
        ADMIN_SETTINGS.require_admin_approval) {
        
        // Check if already pending
        if (CHAT_CONTROLS.pending_approvals.includes(chatId.toString())) {
            await ctx.reply(`
<b>⏳ Chat Approval Pending</b>

<blockquote><i>මෙම චැට් එක භාවිතා කිරීමට පෙර පරිපාලක අනුමැතිය අවශ්‍ය වේ.
කරුණාකර Admin අනුමැතිය ලැබෙන තුරු රැඳී සිටින්න.</i></blockquote>

<b>📩 සහාය සඳහා:</b>
<a href="https://t.me/mataberiyo">Admin</a>
            `, { parse_mode: 'HTML' });
            return false;
        }
        
        // Add to pending approvals
        CHAT_CONTROLS.pending_approvals.push(chatId.toString());
        await updateDbConfig();
        
        // Notify owner
        await notifyOwner(`
🆕 <b>New Chat Request</b>

<b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>
<b>Type:</b> <code>${escapeHtml(chatType)}</code>
<b>Title:</b> <code>${escapeHtml(ctx.chat.title || 'Private')}</code>
<b>User:</b> <code>${escapeHtml(ctx.from.username || ctx.from.first_name)}</code>

Use <code>/enable ${chatId}</code> or <code>/disable ${chatId}</code> to manage.
        `);
        
        await ctx.reply(`
<b>⏳ Approval Request Sent</b>

<blockquote><i>ඔබගේ ප්‍රවේශ ඉල්ලීම Admin වෙත සාර්ථකව යවා ඇත.
අනුමැතිය ලැබුණු පසු ඔබට දැනුම් දීමක් ලැබෙනු ඇත.</i></blockquote>

<b>📌 කරුණාකර රැඳී සිටින්න.</b>
        `, { parse_mode: 'HTML' });
        return false;
    }
    
    // Auto-enable if configured
    if (ADMIN_SETTINGS.auto_enable_new_groups) {
        CHAT_CONTROLS.enabled_chats.push(chatId.toString());
        await updateDbConfig();
        return true;
    }
    
    // If no rules match, default to allowed
    return true;
}

// ==================== UPDATE DB CONFIG ====================
async function updateDbConfig() {
    try {
        CONFIG.private_mode = PRIVATE_MODE;
        CONFIG.group_settings = GROUP_SETTINGS;
        CONFIG.channel_settings = CHANNEL_SETTINGS;
        CONFIG.admin_settings = ADMIN_SETTINGS;
        CONFIG.chat_controls = CHAT_CONTROLS;
        
        await writeJsonAtomic(path.join(__dirname, 'db.json'), CONFIG);
        return true;
    } catch (error) {
        console.error('Error updating db.json:', error);
        return false;
    }
}

// ==================== IMAGE DOWNLOADER ====================

async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const dataDir = path.join(__dirname, 'data');
        const tempPath = path.join(dataDir, 'cached_image.png');

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const client = url.startsWith('https://') ? https : http;

        const request = client.get(url, (response) => {

            // Handle redirects
            if ([301, 302, 307, 308].includes(response.statusCode)) {
                const redirectUrl = response.headers.location;

                response.resume();

                if (!redirectUrl) {
                    reject(new Error('Redirect URL not found'));
                    return;
                }

                return downloadImage(redirectUrl)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                response.resume();

                reject(
                    new Error(
                        `Failed to download image: HTTP ${response.statusCode}`
                    )
                );

                return;
            }

            const fileStream = fs.createWriteStream(tempPath);

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close(() => {
                    resolve(tempPath);
                });
            });

            fileStream.on('error', (err) => {
                fileStream.destroy();
                fs.unlink(tempPath, () => {});
                reject(err);
            });

            response.on('error', (err) => {
                fileStream.destroy();
                fs.unlink(tempPath, () => {});
                reject(err);
            });
        });

        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Image download timeout'));
        });

        request.on('error', reject);
    });
}


async function getCachedImage() {

    // No URL configured
    if (!IMAGE_URL) {
        console.log('⚠️ IMAGE_URL is not configured');
        return null;
    }

    // Already loaded during this runtime
    if (CACHED_IMAGE_PATH && IMAGE_CACHE_CHECKED) {
        return CACHED_IMAGE_PATH;
    }

    const dataDir = path.join(__dirname, 'data');
    const cachePath = path.join(dataDir, 'cached_image.png');

    try {
        await fsPromises.mkdir(dataDir, {
            recursive: true
        });

        // Check disk cache
        await fsPromises.access(cachePath);

        CACHED_IMAGE_PATH = cachePath;
        IMAGE_CACHE_CHECKED = true;

        console.log('✅ Using cached image');

        return cachePath;

    } catch (error) {

        console.log('📥 Downloading image...');

        try {
            const downloaded = await downloadImage(IMAGE_URL);

            CACHED_IMAGE_PATH = downloaded;
            IMAGE_CACHE_CHECKED = true;

            console.log('✅ Image downloaded and cached');

            return downloaded;

        } catch (error) {

            CACHED_IMAGE_PATH = null;
            IMAGE_CACHE_CHECKED = false;

            console.error(
                '❌ Failed to download image:',
                error.message
            );

            return null;
        }
    }
}

// ==================== SAFE EDIT TEXT ====================
async function editTextSafe(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
    try {
        let messageId = null;
        let isPhoto = false;
        
        // Try to get from callback_query first
        if (ctx.update?.callback_query) {
            const cb = ctx.update.callback_query;
            messageId = cb.message?.message_id;
            isPhoto = !!cb.message?.photo;
        }
        
        // If not found, try from message
        if (!messageId && ctx.message) {
            messageId = ctx.message.message_id;
            isPhoto = !!ctx.message.photo;
        }
        
        // If still not found
        if (!messageId) {
            messageId = ctx.message?.message_id || ctx.update?.callback_query?.message?.message_id;
            isPhoto = ctx.update?.callback_query?.message?.photo || ctx.message?.photo;
        }
        
        if (!messageId) {
            await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
            return true;
        }
        
        // If it's a photo message, use editMessageCaption
        if (isPhoto) {
            try {
                await ctx.editMessageCaption(text, {
                    parse_mode: parse_mode,
                    reply_markup: replyMarkup
                });
                return true;
            } catch (captionError) {
                // If caption edit fails, try text edit
                try {
                    await ctx.editMessageText(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (textError) {
                    // If both fail, send new message
                    await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                    return false;
                }
            }
        } else {
            // Text message - use editMessageText
            try {
                await ctx.editMessageText(text, {
                    parse_mode: parse_mode,
                    reply_markup: replyMarkup
                });
                return true;
            } catch (error) {
                // If edit fails, send new message
                await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                return false;
            }
        }
    } catch (error) {
        console.error('editTextSafe error:', error);
        try {
            await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        } catch (fallbackError) {
            console.error('Fallback failed:', fallbackError);
        }
        return false;
    }
}

// ==================== FIX: CHECK CAPTION LENGTH ====================
function isCaptionTooLong(text) {
    // Telegram caption limit is 1024 characters for photos
    return text.length > 1024;
}

// ==================== FIX: SEND LONG MESSAGE AS TEXT ====================
async function sendLongMessage(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
    // If text is short enough, send with image
    if (!isCaptionTooLong(text) || !await getCachedImage()) {
        const imagePath = await getCachedImage();
        if (imagePath) {
            try {
                await ctx.replyWithPhoto(
                    { source: imagePath },
                    {
                        caption: text,
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    }
                );
                return true;
            } catch (error) {
                console.error('Error sending with image:', error);
            }
        }
    }
    
    // If caption is too long OR image failed, send as text message
    try {
        await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        return true;
    } catch (error) {
        console.error('Error sending text message:', error);
        return false;
    }
}

// ==================== FIX: editWithImage WITH LENGTH CHECK ====================
async function editWithImage(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const imagePath = await getCachedImage();
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
    // ✅ FIX: Check if caption is too long
    const captionTooLong = isCaptionTooLong(text);
    
    try {
        // Get chatId and messageId safely
        let chatId = null;
        let messageId = null;
        let isPhoto = false;
        
        if (ctx.update?.callback_query) {
            const cb = ctx.update.callback_query;
            messageId = cb.message?.message_id;
            chatId = cb.message?.chat?.id;
            isPhoto = !!cb.message?.photo;
        }
        
        if (!messageId && ctx.message) {
            messageId = ctx.message.message_id;
            chatId = ctx.message.chat?.id;
            isPhoto = !!ctx.message.photo;
        }
        
        if (!messageId) {
            messageId = ctx.message?.message_id || ctx.update?.callback_query?.message?.message_id;
            chatId = ctx.chat?.id || ctx.from?.id;
            isPhoto = ctx.update?.callback_query?.message?.photo || ctx.message?.photo;
        }
        
        // If caption is too long, send as text instead
        if (captionTooLong) {
            if (messageId && chatId) {
                try {
                    await ctx.editMessageText(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (editError) {
                    // If can't edit, send new text message
                    await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                    return true;
                }
            } else {
                await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                return true;
            }
        }
        
        // Caption is short enough, try with image
        if (!messageId || !chatId) {
            if (imagePath) {
                await ctx.replyWithPhoto(
                    { source: imagePath },
                    {
                        caption: text,
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    }
                );
            } else {
                await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
            }
            return true;
        }
        
        if (isPhoto) {
            try {
                await ctx.editMessageCaption(text, {
                    parse_mode: parse_mode,
                    reply_markup: replyMarkup
                });
                return true;
            } catch (captionError) {
                try {
                    await ctx.editMessageText(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (textError) {
                    if (imagePath) {
                        await ctx.replyWithPhoto(
                            { source: imagePath },
                            {
                                caption: text,
                                parse_mode: parse_mode,
                                reply_markup: replyMarkup
                            }
                        );
                    } else {
                        await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                    }
                    return false;
                }
            }
        } else {
            if (imagePath) {
                try {
                    await ctx.editMessageCaption(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (captionError) {
                    try {
                        await ctx.editMessageText(text, {
                            parse_mode: parse_mode,
                            reply_markup: replyMarkup
                        });
                        return true;
                    } catch (textError) {
                        await ctx.replyWithPhoto(
                            { source: imagePath },
                            {
                                caption: text,
                                parse_mode: parse_mode,
                                reply_markup: replyMarkup
                            }
                        );
                        return false;
                    }
                }
            } else {
                try {
                    await ctx.editMessageText(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (error) {
                    await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                    return false;
                }
            }
        }
    } catch (error) {
        console.error('EditWithImage error:', error);
        try {
            await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
        }
        return false;
    }
}

// ==================== FIX: sendWithImage WITH LENGTH CHECK ====================
async function sendWithImage(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const imagePath = await getCachedImage();
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
    // ✅ FIX: Check if caption is too long
    const captionTooLong = isCaptionTooLong(text);
    
    // If caption is too long, send as text message without image
    if (captionTooLong || !imagePath) {
        try {
            await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
            return true;
        } catch (error) {
            console.error('Error sending text:', error);
            return false;
        }
    }
    
    // Caption is short enough, send with image
    try {
        await ctx.replyWithPhoto(
            { source: imagePath },
            {
                caption: text,
                parse_mode: parse_mode,
                reply_markup: replyMarkup
            }
        );
        return true;
    } catch (error) {
        console.error('Error sending with image:', error);
        try {
            await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
            return true;
        } catch (textError) {
            console.error('Fallback text error:', textError);
            return false;
        }
    }
}

// ==================== FIX: sendWithImageAndDelete WITH LENGTH CHECK ====================
async function sendWithImageAndDelete(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const imagePath = await getCachedImage();
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
    // ✅ FIX: Check if caption is too long
    const captionTooLong = isCaptionTooLong(text);
    
    if (captionTooLong || !imagePath) {
        try {
            return await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        } catch (error) {
            console.error('Error sending text:', error);
            return null;
        }
    }
    
    try {
        return await ctx.replyWithPhoto(
            { source: imagePath },
            {
                caption: text,
                parse_mode: parse_mode,
                reply_markup: replyMarkup
            }
        );
    } catch (error) {
        console.error('Error sending with image:', error);
        try {
            return await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        } catch (textError) {
            console.error('Fallback text error:', textError);
            return null;
        }
    }
}

// ==================== FILE PATHS ====================
const DATA_FILE = path.join(__dirname, 'data', 'users.json');
const CONFIGS_DIR = path.join(__dirname, 'data', 'configs');
const XRAY_DIR = path.join(__dirname, 'xy');
const XRAY_BINARY = path.join(XRAY_DIR, 'xy');
const XRAY_CONFIG = path.join(XRAY_DIR, 'config.json');

// ==================== GLOBALS ====================
let bot = null;
let xrayProcess = null;
let isXrayRunning = false;
let xrayRestartCount = 0;
let VLESS_HOST = 'm.zoom.us';

// ==================== XRAY MANAGEMENT ====================
async function getXrayConfigSettings() {
    try {
        const configData = await fsPromises.readFile(XRAY_CONFIG, 'utf8');
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

async function checkXrayBinary() {
    try {
        await fsPromises.access(XRAY_BINARY);
        return true;
    } catch {
        return false;
    }
}

// ===== IMPROVED: Scheduled Restart with Queue =====
function scheduleXrayRestart(reason = 'config changed', immediate = true) {
    // Add to queue
    restartQueue.push({
        reason: reason,
        timestamp: Date.now()
    });
    
    // Limit queue size
    if (restartQueue.length > MAX_RESTART_QUEUE) {
        restartQueue.shift();
    }
    
    // If already restarting, just mark pending
    if (restartInProgress) {
        pendingXrayRestart = true;
        console.log(`⏳ Xray restart already in progress, queued: ${reason}`);
        return;
    }
    
    // Clear existing timer
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    
    // Immediate or delayed restart
    const delay = immediate ? 500 : 3000; // 500ms for immediate, 3s for delayed
    
    restartTimer = setTimeout(async () => {
        restartTimer = null;
        
        if (restartInProgress) {
            pendingXrayRestart = true;
            return;
        }
        
        // Check if we have queued restarts
        if (restartQueue.length === 0) {
            return;
        }
        
        // Check resource limits before restart
        const resourcesOK = await waitForResources();
        if (!resourcesOK) {
            console.log('⚠️ Resources not available, retrying in 5 seconds...');
            setTimeout(() => {
                scheduleXrayRestart('resource retry', true);
            }, 5000);
            return;
        }
        
        restartInProgress = true;
        pendingXrayRestart = false;
        
        try {
            const queueReasons = restartQueue.map(q => q.reason).join(', ');
            console.log(`🔄 Xray restarting: ${queueReasons}`);
            
            // Kill existing process gently
            if (xrayProcess) {
                try {
                    xrayProcess.kill('SIGTERM');
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (xrayProcess) {
                        xrayProcess.kill('SIGKILL');
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                } catch (e) {
                    console.log('Process kill error:', e.message);
                }
                xrayProcess = null;
                isXrayRunning = false;
            }
            
            // Clear queue
            restartQueue = [];
            
            // Start Xray
            const started = await startXray();
            
            if (started) {
                console.log('✅ Xray restarted successfully');
                lastRestartTime = Date.now();
            } else {
                console.log('❌ Xray restart failed, will retry...');
                // Retry after 5 seconds
                setTimeout(() => {
                    scheduleXrayRestart('retry after failure', true);
                }, 5000);
            }
            
        } catch (error) {
            console.error('Xray restart failed:', error);
            // Retry after 5 seconds
            setTimeout(() => {
                scheduleXrayRestart('retry after error', true);
            }, 5000);
        } finally {
            restartInProgress = false;
            
            // Check if there are pending restarts
            if (pendingXrayRestart || restartQueue.length > 0) {
                pendingXrayRestart = false;
                scheduleXrayRestart('pending queue', true);
            }
        }
    }, delay);
}

// ==================== CHECK XRAY PERMISSIONS ====================
async function checkXrayPermissions() {
    try {
        // Check if binary exists
        await fsPromises.access(XRAY_BINARY, fs.constants.F_OK);
        
        // Check if binary is executable
        try {
            await fsPromises.access(XRAY_BINARY, fs.constants.X_OK);
            return { exists: true, executable: true };
        } catch {
            // Not executable - try to fix
            console.log('⚠️ Xray binary is not executable. Attempting to fix...');
            try {
                // Try to make it executable using chmod
                const { exec } = require('child_process');
                await new Promise((resolve, reject) => {
                    exec(`chmod +x "${XRAY_BINARY}"`, (error, stdout, stderr) => {
                        if (error) {
                            console.error('chmod error:', error);
                            reject(error);
                        } else {
                            console.log('✅ Xray binary made executable');
                            resolve();
                        }
                    });
                });
                
                // Check again
                await fsPromises.access(XRAY_BINARY, fs.constants.X_OK);
                return { exists: true, executable: true };
            } catch (chmodError) {
                console.error('Failed to make Xray executable:', chmodError);
                return { exists: true, executable: false };
            }
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { exists: false, executable: false };
        }
        console.error('Error checking Xray permissions:', error);
        return { exists: false, executable: false };
    }
}

// ===== IMPROVED: startXray with resource limits =====
async function startXray() {
    try {
        // Check resources before starting
        const resourcesOK = await waitForResources();
        if (!resourcesOK) {
            console.log('⚠️ Resources not available for Xray start, will retry...');
            setTimeout(() => startXray(), 5000);
            return false;
        }
        
        // Check binary permissions first
        const permCheck = await checkXrayPermissions();
        
        if (!permCheck.exists) {
            console.error('Xray binary not found at:', XRAY_BINARY);
            await notifyOwner(`❌ Xray binary not found at:\n<code>${XRAY_BINARY}</code>\n\nPlease ensure Xray is installed correctly.`);
            return false;
        }
        
        if (!permCheck.executable) {
            console.error('Xray binary is not executable!');
            await notifyOwner(`❌ Xray binary is not executable:\n<code>${XRAY_BINARY}</code>\n\nPlease run: <code>chmod +x ${XRAY_BINARY}</code>`);
            return false;
        }

        try {
            await fsPromises.access(XRAY_CONFIG);
        } catch {
            console.error('Xray config not found!');
            await notifyOwner(`❌ Xray config not found at:\n<code>${XRAY_CONFIG}</code>`);
            return false;
        }

        intentionalXrayStop = false;

        if (xrayProcess) {
            try {
                xrayProcess.kill();
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error('Error killing existing process:', error);
            }
        }

        const args = ['run', '-c', XRAY_CONFIG];
        xrayProcess = spawn(XRAY_BINARY, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        isXrayRunning = true;

        // Minimal logging to save resources
        xrayProcess.stdout.on('data', () => {
            // Ignore stdout to save CPU
        });

        xrayProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
                console.error(`[XRAY ERR]: ${msg.slice(0, 200)}`);
            }
        });

        xrayProcess.on('error', (error) => {
            console.error('Xray process error:', error);
            isXrayRunning = false;
            
            if (error.code === 'EACCES') {
                console.error('Permission denied! Trying to fix...');
                try {
                    const { exec } = require('child_process');
                    exec(`chmod +x "${XRAY_BINARY}"`, async (chmodError) => {
                        if (!chmodError) {
                            console.log('✅ Fixed permissions, restarting Xray...');
                            setTimeout(() => startXray(), 1000);
                        }
                    });
                } catch (fixError) {
                    console.error('Failed to fix permissions:', fixError);
                }
            }
        });

        xrayProcess.on('exit', (code) => {
            console.log(`Xray exited with code: ${code}`);
            isXrayRunning = false;
            
            if (code !== 0 && code !== null && !intentionalXrayStop) {
                // Auto-restart on crash with backoff
                const now = Date.now();
                const timeSinceLastRestart = now - lastRestartTime;
                
                if (timeSinceLastRestart > 300000) {
                    xrayRestartCount = 0;
                }
                
                xrayRestartCount++;
                lastRestartTime = now;
                
                const backoffDelay = Math.min(30000, xrayRestartCount * 3000);
                
                console.log(`Xray crashed, restarting in ${backoffDelay/1000}s (attempt ${xrayRestartCount})`);
                
                setTimeout(async () => {
                    if (xrayRestartCount < 10 && !intentionalXrayStop) {
                        await startXray();
                    } else if (xrayRestartCount >= 10) {
                        console.error('Xray restart limit reached!');
                        notifyOwner('⚠️ Xray restart limit reached! Manual intervention required.');
                    }
                }, backoffDelay);
            }
            
            // Reset restart count after successful long run
            setTimeout(() => {
                if (isXrayRunning) {
                    xrayRestartCount = 0;
                }
            }, 60000);
        });

        console.log('✅ Xray started!');
        return true;
    } catch (error) {
        console.error('Error starting Xray:', error);
        return false;
    }
}

// ===== IMPROVED: stopXray =====
async function stopXray(manual = true) {
    try {
        if (manual) {
            intentionalXrayStop = true;
            // Clear restart queue
            restartQueue = [];
            if (restartTimer) {
                clearTimeout(restartTimer);
                restartTimer = null;
            }
        }
        
        if (xrayProcess) {
            xrayProcess.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            if (xrayProcess) {
                xrayProcess.kill('SIGKILL');
            }
            
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

// ===== IMPROVED: restartXray =====
async function restartXray() {
    // Use the scheduled restart system
    scheduleXrayRestart('manual restart', true);
    return true;
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

// ==================== USER DATA MANAGEMENT ====================
// DIRECT FILE ACCESS - NO CACHING
async function getUserData(userId) {
    try {
        const data = await fsPromises.readFile(DATA_FILE, 'utf8');
        const users = JSON.parse(data);
        return users[userId] || null;
    } catch (error) {
        console.error('Error reading user data:', error);
        return null;
    }
}

async function saveUserData(userId, userData) {
    try {
        const data = await fsPromises.readFile(DATA_FILE, 'utf8');
        const users = JSON.parse(data);
        users[userId] = userData;
        await writeJsonAtomic(DATA_FILE, users);
        return true;
    } catch (error) {
        console.error('Error saving user data:', error);
        return false;
    }
}

// ==================== LOADING BAR FUNCTIONS ====================
function createLoadingBar(percentage, emoji = '🟩') {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    const bar = emoji.repeat(filled) + '⬜'.repeat(empty);
    return `┃${bar}┃ ${percentage}%`;
}

function createProgressBar(remaining, total) {
    const percentage = Math.min(100, Math.round((remaining / total) * 100));
    const filled = Math.min(10, Math.round((remaining / total) * 10));
    const empty = 10 - filled;
    const bar = '🟩'.repeat(filled) + '⬜'.repeat(empty);
    return `┃${bar}┃ ${remaining}h/${total}h (${percentage}%)`;
}

// ==================== FORMAT FUNCTIONS ====================
function formatVPNMessage(config, user) {
    const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
    const expiryDate = new Date(config.expiryTime);
    const progressBar = createProgressBar(remaining, config.duration);
    
    // දින ගණන ගණනය කරන්න
    let durationDisplay = `${config.duration}h`;
    if (config.duration >= 24) {
        const days = Math.floor(config.duration / 24);
        const hours = config.duration % 24;
        durationDisplay = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }

    let text = `
<b>🔐 VPN Configuration Created</b>

<blockquote><b>👤 User:</b> <code>${escapeHtml(user.first_name || user.username || user.id)}</code>
<b>🆔 ID:</b> <code>${escapeHtml(config.id)}</code>
<b>⏱ Duration:</b> <code>${escapeHtml(durationDisplay)}</code>
<b>⏰ Expires (SL):</b> <code>${expiryDate.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</code>
<b>⏳ Remaining:</b> <code>${escapeHtml(remaining)}h</code></blockquote>

<code><b>📊 Status:</b>
${progressBar}</code>

<i>📋 Vless Config එක පිටපත් කිරීමට "Copy Link" ඔබන්න</i>
<i>📱 ඔබගේ VPN Client එකෙන් Scan කිරීමට "Get QR Code" ඔබන්න</i>
    `;

    const buttons = [
        [
            { text: '📋 Copy Link', callback_data: `copy_${config.id}` },
            { text: '📱 Get QR Code', callback_data: `qr_${config.id}` }
        ],
        [
            { text: '🔙 Back to Menu', callback_data: 'back_to_menu' }
        ]
    ];

    return { text, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };
}

// ==================== CONFIG PAGINATION ====================
let configPagination = {};

function getConfigPage(userId, page = 0) {
    if (!configPagination[userId]) {
        configPagination[userId] = { page: 0 };
    }
    configPagination[userId].page = page;
    return configPagination[userId].page;
}

function formatConfigList(configs, userId, page = 0) {
    if (configs.length === 0) {
        return {
            text: `
<b>📋 සක්‍රීය VPN Configurations නොමැත</b>

<i>ඔබට දැනට කිසිදු සක්‍රීය VPN Configuration එකක් නොමැත.</i>

<b>💡 උපදෙස:</b> ආරම්භ කිරීමට <b>🔰 Create Your Own VPN</b> Button එක භාවිතා කරන්න.`,
            parse_mode: 'HTML',
            keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]
        };
    }

    // Pagination settings
    const itemsPerPage = 3; // Each page shows 3 configs
    const totalPages = Math.ceil(configs.length / itemsPerPage);
    
    // Ensure page is within bounds
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;
    
    // Get current page configs
    const start = page * itemsPerPage;
    const end = Math.min(start + itemsPerPage, configs.length);
    const pageConfigs = configs.slice(start, end);
    
    // Save current page for user
    if (!configPagination[userId]) {
        configPagination[userId] = {};
    }
    configPagination[userId].page = page;
    configPagination[userId].totalPages = totalPages;
    configPagination[userId].configs = configs;

    let message = `
<b>📋 Your Active Configurations</b>

<i>Page ${page + 1} of ${totalPages} (${configs.length} total)</i>

━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    for (const config of pageConfigs) {
        const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
        const bar = createProgressBar(remaining, config.duration);
        const expiryDate = new Date(config.expiryTime);

        message += `
<blockquote><b>🔹 ${config.duration}h VPN</b>
${bar}
<b>ID:</b> <code>${escapeHtml(config.id)}</code>
<b>Expires (SL):</b> <code>${expiryDate.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</code>
<b>⌛ ${remaining}h remaining</b></blockquote>\n`;
    }
    
    // Build navigation buttons
    const navButtons = [];
    
    // Back button
    if (page > 0) {
        navButtons.push({ text: '⬅️ Back', callback_data: `config_page_${page - 1}` });
    }
    
    // Page indicator
    navButtons.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' });
    
    // Next button
    if (page < totalPages - 1) {
        navButtons.push({ text: 'Next ➡️', callback_data: `config_page_${page + 1}` });
    }
    
    // Build keyboard
    const keyboard = [];
    
    // View buttons - 3 per row
    const viewButtons = pageConfigs.map(c => ({
        text: `👁️ ${c.duration}h`,
        callback_data: `view_config_${c.id}`
    }));

    for (let i = 0; i < viewButtons.length; i += 3) {
        const row = [];
        for (let j = i; j < Math.min(i + 3, viewButtons.length); j++) {
            row.push(viewButtons[j]);
        }
        keyboard.push(row);
    }
    
    // Add navigation row if there are multiple pages
    if (navButtons.length > 1) {
        keyboard.push(navButtons);
    }
    
    // Add main menu button
    keyboard.push([{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]);
    
    return { 
        text: message, 
        parse_mode: 'HTML',
        keyboard: keyboard
    };
}

function formatConfigView(config, user) {
    const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
    const expiryDate = new Date(config.expiryTime);
    const progressBar = createProgressBar(remaining, config.duration);

    // දින ගණන ගණනය කරන්න
    let durationDisplay = `${config.duration}h`;
    if (config.duration >= 24) {
        const days = Math.floor(config.duration / 24);
        const hours = config.duration % 24;
        durationDisplay = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
    
    let text = `
<b>🔐 VPN Configuration</b>

<blockquote><b>👤 User:</b> <code>${escapeHtml(user.first_name || user.username || user.id)}</code>
<b>🆔 ID:</b> <code>${escapeHtml(config.id)}</code>
<b>⏱ Duration:</b> <code>${escapeHtml(durationDisplay)}</code>
<b>⏰ Expires (SL):</b> <code>${expiryDate.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</code>
<b>⏳ Remaining:</b> <code>${escapeHtml(remaining)}h</code></blockquote>

<code><b>📊 Status:</b>
${progressBar}</code>

<i>📋 Vless Config එක පිටපත් කිරීමට "Copy Link" ඔබන්න</i>
<i>📱 ඔබගේ VPN Client එකෙන් Scan කිරීමට "Get QR Code" ඔබන්න</i>
    `;

    const buttons = [
        [
            { text: '📋 Copy Link', callback_data: `copy_${config.id}` },
            { text: '📱 Get QR Code', callback_data: `qr_${config.id}` }
        ],
        [
            { text: '🔙 Back to Configs', callback_data: 'list_configs' },
            { text: '🏠 Main Menu', callback_data: 'back_to_menu' }
        ]
    ];

    return { text, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };
}

// ==================== VPN CONFIG GENERATION ====================
async function generateVPNConfig(userId, duration) {
    const configId = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const expiryTime = now + (duration * 60 * 60 * 1000);
    
    const uuid = crypto.randomUUID();
    
    const xraySettings = await getXrayConfigSettings();
    const domain = DOMAIN;
    const port = xraySettings.port || PORT || 10808;
    const path = xraySettings.path || PATH || '/kudda-vpn';
    const host = VLESS_HOST || 'm.zoom.us';
    
    const vlessLink = `vless://${uuid}@${domain}:${port}?encryption=none&security=none&type=ws&host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}#VPN-${duration}h`;
    
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
                path: path,
                host: host
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
        await writeJsonAtomic(configPath, config);
        
        return true;
    } catch (error) {
        console.error('Error saving VPN config:', error);
        return false;
    }
}

// ==================== UPDATE XRAY CONFIG - IMPROVED with Immediate Restart ====================
async function updateXrayConfig(userId, newConfig) {
    try {
        const xrayConfig = await readJsonSafe(XRAY_CONFIG, null);
        
        if (!xrayConfig) {
            throw new Error('Invalid or missing Xray config');
        }
        
        if (!Array.isArray(xrayConfig.inbounds) || xrayConfig.inbounds.length === 0) {
            throw new Error('No inbound found in Xray config');
        }
        
        const inbound = xrayConfig.inbounds[0];
        
        if (!inbound.settings) {
            inbound.settings = {};
        }
        
        if (!Array.isArray(inbound.settings.clients)) {
            inbound.settings.clients = [];
        }
        
        const uuid = newConfig.config.details.uuid;
        
        const alreadyExists = inbound.settings.clients.some(client => client.id === uuid);
        
        if (!alreadyExists) {
            inbound.settings.clients.push({
                id: uuid,
                email: `user_${userId}_${newConfig.id}`
            });
        }
        
        if (!inbound.settings.decryption) {
            inbound.settings.decryption = 'none';
        }
        
        await writeJsonAtomic(XRAY_CONFIG, xrayConfig);
        
        // ===== IMMEDIATE RESTART - NO DELAY =====
        // This is the key change - immediate restart with queue management
        console.log(`🔄 Immediate Xray restart for new client: ${uuid}`);
        scheduleXrayRestart('new client added', true); // immediate = true
        
        return true;
    } catch (error) {
        console.error('Error updating Xray config:', error);
        throw error;
    }
}

// ===== IMPROVED: removeFromXrayConfig =====
async function removeFromXrayConfig(uuid) {
    try {
        const xrayConfig = await readJsonSafe(XRAY_CONFIG, null);
        
        if (!xrayConfig) return false;
        
        if (!Array.isArray(xrayConfig.inbounds) || xrayConfig.inbounds.length === 0) {
            return false;
        }
        
        const inbound = xrayConfig.inbounds[0];
        
        if (!inbound.settings || !Array.isArray(inbound.settings.clients)) {
            return false;
        }
        
        const beforeCount = inbound.settings.clients.length;
        
        inbound.settings.clients = inbound.settings.clients.filter(client => client.id !== uuid);
        
        if (beforeCount !== inbound.settings.clients.length) {
            await writeJsonAtomic(XRAY_CONFIG, xrayConfig);
            scheduleXrayRestart('client removed', true);
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error removing from Xray config:', error);
        return false;
    }
}

// ===== IMPROVED: removeMultipleFromXrayConfig =====
async function removeMultipleFromXrayConfig(uuids = []) {
    if (!uuids.length) return false;
    
    try {
        const xrayConfig = await readJsonSafe(XRAY_CONFIG, null);
        
        if (!xrayConfig) return false;
        
        if (!Array.isArray(xrayConfig.inbounds) || xrayConfig.inbounds.length === 0) {
            return false;
        }
        
        const inbound = xrayConfig.inbounds[0];
        
        if (!inbound.settings || !Array.isArray(inbound.settings.clients)) {
            return false;
        }
        
        const uuidSet = new Set(uuids);
        
        const beforeCount = inbound.settings.clients.length;
        
        inbound.settings.clients = inbound.settings.clients.filter(client => {
            return !uuidSet.has(client.id);
        });
        
        const afterCount = inbound.settings.clients.length;
        
        if (beforeCount !== afterCount) {
            await writeJsonAtomic(XRAY_CONFIG, xrayConfig);
            scheduleXrayRestart('expired clients removed', true);
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error removing multiple clients from Xray config:', error);
        return false;
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
                    const data = await fsPromises.readFile(configPath, 'utf8');
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
            await fsPromises.unlink(configPath);
        } catch (error) {
            console.error('Error deleting config file:', error);
        }
        
        return true;
    } catch (error) {
        console.error('Error deleting config:', error);
        return false;
    }
}

// ==================== CLEANUP EXPIRED CONFIGS - IMPROVED ====================
async function cleanupExpiredConfigs() {
    try {
        const users = await readJsonSafe(DATA_FILE, {});
        const now = Date.now();
        
        let changes = false;
        let expiredCount = 0;
        const expiredUuids = [];
        
        for (const [userId, userData] of Object.entries(users)) {
            if (!Array.isArray(userData.configs)) continue;
            
            const validConfigs = [];
            const expiredConfigs = [];
            
            for (const config of userData.configs) {
                if (config.expiryTime > now) {
                    validConfigs.push(config);
                } else {
                    expiredConfigs.push(config);
                }
            }
            
            if (expiredConfigs.length > 0) {
                expiredCount += expiredConfigs.length;
                changes = true;
                
                for (const config of expiredConfigs) {
                    if (config.uuid) {
                        expiredUuids.push(config.uuid);
                    }
                    
                    const configPath = path.join(CONFIGS_DIR, `${config.id}.json`);
                    
                    try {
                        await fsPromises.unlink(configPath);
                    } catch (error) {
                        if (error.code !== 'ENOENT') {
                            console.error('Error deleting expired config file:', error);
                        }
                    }
                    
                    // Send expiry notification to user
                    await notifyUser(userId, `
<b>⏰ VPN Expired</b>

<blockquote>
ඔබගේ VPN Configuration එක කල් ඉකුත් වී ඇත.

<b>Config ID:</b> <code>${escapeHtml(config.id)}</code>
<b>Duration:</b> <code>${escapeHtml(config.duration)}h</code>
</blockquote>

නව VPN එකක් අවශ්‍ය නම් Bot එකෙන් නැවත Create කරන්න.
`);
                }
                
                userData.configs = validConfigs;
            }
        }
        
        if (expiredUuids.length > 0) {
            await removeMultipleFromXrayConfig(expiredUuids);
        }
        
        if (changes) {
            await writeJsonAtomic(DATA_FILE, users);
        }
        
        return expiredCount;
    } catch (error) {
        console.error('Error cleaning up expired configs:', error);
        return 0;
    }
}

// ==================== KEYBOARD BUILDERS ====================
function getMainKeyboard(userId) {
    const isOwner = userId.toString() === OWNER_ID;
    const buttons = [
        [{ text: '🔰 Create Your Own VPN 🔰', callback_data: 'create_vpn' }],
        [
            { text: '📋 My Configs', callback_data: 'list_configs' },
            { text: '🗑 Delete Config', callback_data: 'delete_config' }
        ],
        [
            { text: 'K', url: 'https://t.me/mataberiyo' },
            { text: 'U', url: 'https://t.me/mataberiyo' },
            { text: 'D', url: 'https://t.me/mataberiyo' },
            { text: 'D', url: 'https://t.me/mataberiyo' },
            { text: 'A', url: 'https://t.me/mataberiyo' }
        ],
        [{ text: '🙏 ඛන්ති පරමං තපෝ තිතික්ඛා 🌺', callback_data: 'Study' }]
    ];
    
    if (isOwner) {
        buttons.push([{ text: '⚙️ Admin Panel', callback_data: 'admin_panel' }]);
        buttons.push([{ text: '📖 Inline Help', callback_data: 'inline_help_menu' }]);
    }
    
    return buttons;
}

function getDurationKeyboard(isOwner = false) {
    const durations = [
        { label: '🕐 3 Hours', value: 3 },
        { label: '🕖 7 Hours', value: 7 },
        { label: '🕙 10 Hours', value: 10 },
        { label: '🕛 12 Hours', value: 12 },
        { label: '🕒 15 Hours', value: 15 },
        { label: '🕕 18 Hours', value: 18 },
        { label: '🕗 20 Hours', value: 20 },
        { label: '🕛 24 Hours', value: 24 },
        // දින විකල්ප (පැය වලට හරවනවා)
        { label: '📅 3 Days (72h)', value: 72 },
        { label: '📅 5 Days (120h)', value: 120 },
        { label: '📅 7 Days (168h)', value: 168 }
    ];
    
    const buttons = durations.map(d => ({
        text: d.label,
        callback_data: `duration_${d.value}`
    }));
    
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    
    if (isOwner) {
        rows.push([
            { text: '⚡ Custom Minutes', callback_data: 'admin_custom_minutes' },
            { text: '⚡ Custom Hours', callback_data: 'admin_custom_hours' },
            { text: '⚡ Custom Days', callback_data: 'admin_custom_days' }
        ]);
    }
    
    rows.push([{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]);
    
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
    
    rows.push([{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]);
    
    return rows;
}

function getDeleteKeyboard(configs) {
    const buttons = configs.map(c => ({
        text: `🗑 Delete ${c.duration}h`,
        callback_data: `delete_confirm_${c.id}`
    }));
    
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    
    rows.push([{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]);
    
    return rows;
}

function getAdminKeyboard() {
    return [
        [{ text: '📊 Xray Status', callback_data: 'admin_status' }],
        [   { text: '🔄 Restart Xray', callback_data: 'admin_restart' },
            { text: '⏹ Stop Xray', callback_data: 'admin_stop' },
            { text: '▶️ Start Xray', callback_data: 'admin_start' }
        ],
        [   { text: '🧹 Clean Expired', callback_data: 'admin_cleanup' },
            { text: '📈 System Stats', callback_data: 'admin_stats' }
        ],
        [],
        [   { text: '🔒 Private Mode', callback_data: 'admin_private_mode' },
            { text: '👥 Group Settings', callback_data: 'admin_group_settings' }
        ],
        [],
        [
            { text: '📢 Channel Settings', callback_data: 'admin_channel_settings' },
            { text: '👤 User Management', callback_data: 'admin_user_management' }
        ],
        [{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]
    ];
}

function getPrivateModeKeyboard() {
    return [
        [
            { text: PRIVATE_MODE.enabled ? '❌ Disable Private Mode' : '✅ Enable Private Mode', 
              callback_data: 'admin_toggle_private' }
        ],
        [
            { text: '➕ Add Allowed User', callback_data: 'admin_add_allowed_user' },
            { text: '➖ Remove Allowed User', callback_data: 'admin_remove_allowed_user' }
        ],
        [
            { text: '🚫 Add Blocked User', callback_data: 'admin_add_blocked_user' },
            { text: '✅ Remove Blocked User', callback_data: 'admin_remove_blocked_user' }
        ],
        [
            { text: '📋 View Allowed Users', callback_data: 'admin_view_allowed_users' },
            { text: '📋 View Blocked Users', callback_data: 'admin_view_blocked_users' }
        ],
        [{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]
    ];
}

function getGroupSettingsKeyboard() {
    return [
        [
            { text: GROUP_SETTINGS.enabled ? '❌ Disable Groups' : '✅ Enable Groups', 
              callback_data: 'admin_toggle_groups' }
        ],
        [
            { text: '➕ Add Allowed Group', callback_data: 'admin_add_allowed_group' },
            { text: '➖ Remove Allowed Group', callback_data: 'admin_remove_allowed_group' }
        ],
        [
            { text: '🚫 Add Blocked Group', callback_data: 'admin_add_blocked_group' },
            { text: '✅ Remove Blocked Group', callback_data: 'admin_remove_blocked_group' }
        ],
        [
            { text: '📋 View Allowed Groups', callback_data: 'admin_view_allowed_groups' },
            { text: '📋 View Blocked Groups', callback_data: 'admin_view_blocked_groups' }
        ],
        [
            { text: '🔄 Auto-Enable New Groups', callback_data: 'admin_toggle_auto_enable' },
            { text: '📌 Pending Approvals', callback_data: 'admin_view_pending' }
        ],
        [{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]
    ];
}

function getChannelSettingsKeyboard() {
    return [
        [
            { text: CHANNEL_SETTINGS.enabled ? '❌ Disable Channels' : '✅ Enable Channels', 
              callback_data: 'admin_toggle_channels' }
        ],
        [
            { text: '➕ Add Allowed Channel', callback_data: 'admin_add_allowed_channel' },
            { text: '➖ Remove Allowed Channel', callback_data: 'admin_remove_allowed_channel' }
        ],
        [
            { text: '🚫 Add Blocked Channel', callback_data: 'admin_add_blocked_channel' },
            { text: '✅ Remove Blocked Channel', callback_data: 'admin_remove_blocked_channel' }
        ],
        [
            { text: '📋 View Allowed Channels', callback_data: 'admin_view_allowed_channels' },
            { text: '📋 View Blocked Channels', callback_data: 'admin_view_blocked_channels' }
        ],
        [{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]
    ];
}

function getUserManagementKeyboard() {
    return [
        [{ text: '📊 View All Users', callback_data: 'admin_view_all_users' }],
        [{ text: '📊 View User Stats', callback_data: 'admin_user_stats' }],
        [{ text: '🔍 Find User', callback_data: 'admin_find_user' }],
        [{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]
    ];
}

const studyTips = [
    "📖 අද ඉගෙනගන්න දේ අදම අවසන් කරන්න. කල් දාන්න එපා.",
    "⏰ දවසේ පැය 1ක් අලුත් දෙයක් ඉගෙනීමට වෙන් කරන්න.",
    "💪 පොඩි පියවරවල් වලින් පටන් ගත්තත් සාර්ථකත්වයට යන්න පුළුවන්.",
    "🧠 නැවත නැවත පුනරීක්ෂණය කිරීම මතක ශක්තිය වැඩි කරයි.",
    "🚀 ඊයේ ඔබට වඩා අද හොඳ වෙන්න උත්සාහ කරන්න.",
    "🎯 ඔබගේ ඉලක්කය මත අවධානය තබාගෙන ඉදිරියට යන්න.",
    "📝 පාඩම් කරන විට සටහන් ගැනීම වැදගත්.",
    "🔁 දිනපතා පැය 1/2ක් පෙර පාඩම් නැවත කියවන්න.",
    "🎧 අවධානය වෙනතකට යවන දේ අයින් කරන්න (ගෙදර, දුරකථනය).",
    "🧘 ඉගෙනීමට පෙර මිනිත්තු 5ක් හුස්ම ගන්න. සිත පැහැදිලි කරන්න.",
    "📅 සතිපතා ඉගෙනුම් සැලැස්මක් හදාගන්න.",
    "⏳ විවේකයක් නැතුව පැය 2කට වඩා පාඩම් නොකරන්න.",
    "🍎 හොඳ කෑම, නින්ද, ව්යායාමය ඉගෙනීමට උපකාරී වේ.",
    "💡 අමාරු කරුණු මුලින්ම ඉගෙනගන්න.",
    "📚 පොත් පමණක් නොව වීඩියෝ, පොඩ්කාස්ට් වලින්ද ඉගෙනගන්න.",
    "👨‍🏫 අනුන්ට උගන්වන්න. එය ඔබගේ දැනුම තවත් තහවුරු කරයි.",
    "✍️ ඔබ ඉගෙනගත් දේ ලියා තබන්න. එය මතක රඳවා ගැනීමට උපකාරී වේ.",
    "🔍 වැරදි වලින් ඉගෙනගන්න. ඒවා ඔබගේ දුර්වලතා පෙන්වයි.",
    "🏆 කුඩා ජයග්රහණ සමරන්න. එය අභිප්රේරණය වැඩි කරයි.",
    "🧩 දිගු පාඩම් කොටස් කුඩා කොටස් වලට බෙදන්න.",
    "📌 වැදගත් කරුණු උද්දීපනය කරන්න (හයිලයිට් කරන්න).",
    "🗣️ හයියෙන් කියවීම මතක තබා ගැනීමට උපකාරී වේ.",
    "🕒 ඔබට හොඳම ඉගෙනීමට වේලාව හඳුනාගන්න (උදේ / රෑ).",
    "🎯 පැයක් ඇතුලත ඉටු කළ හැකි කුඩා ඉලක්ක තබාගන්න.",
    "📱 ඉගෙනුම් යෙදුම් (apps) භාවිතා කරන්න.",
    "📖 පාඩම් කිරීමට පෙර අරමුණු 3ක් ලියා තබන්න.",
    "🤝 අනෙකුත් සිසුන් සමඟ සාකච්ඡා කරන්න.",
    "📊 ප්රස්ථාර, රූප සටහන්, මනස් සිතියම් භාවිතා කරන්න.",
    "⏱️ එක් විෂයයක් සඳහා වෙන් කරන කාලය සීමා කරන්න.",
    "🏠 නිස්කලංක, පිරිසිදු පරිසරයක් තෝරාගන්න.",
    "📝 දිනපොතක් ලියන්න. අද ඉගෙනගත් දේ එහි සටහන් කරන්න.",
    "🔗 දැනටමත් දන්නා දේ සමඟ අලුත් දේ සම්බන්ධ කරන්න.",
    "🧠 උපායශීලී කණ්ඩායම් (mnemonics) භාවිතා කරන්න.",
    "💬 ඉගෙන ගත් දේ ගැන යමෙකුට පැහැදිලි කරන්න.",
    "📈 දියුණුව නිරීක්ෂණය කරන්න (track කරන්න).",
    "🎓 පන්තියේදී සක්රීයව සහභාගී වන්න.",
    "📚 පාඩම් කරන එකම ක්රමයට ඇලී නොසිටින්න. ක්රම වෙනස් කරන්න.",
    "💤 ඉගෙනීම අතරතුර කෙටි විවේකයක් ගන්න (Pomodoro).",
    "🎵 සැහැල්ලු සංගීතය හෝ ස්වභාවික ශබ්ද ඇසීමෙන් අවධානය වැඩි විය හැක.",
    "📝 පාඩම් කිරීමට පෙර ඔබ දන්නා දේ ලියන්න, පසුව ඉගෙනගත් දේ එකතු කරන්න.",
    "🧩 ගැටළු විසඳීමේ ප්රශ්න (problem-solving) වැඩිපුර කරන්න.",
    "📆 අවසාන විභාගයට පෙර දින 7කට පෙර පුනරීක්ෂණය ආරම්භ කරන්න.",
    "👀 ඉගෙනීමට පෙර ඇස් පියාගෙන ඉලක්කය හිතේ මවා ගන්න.",
    "📖 පිටපත් කිරීමේ ක්රමය භාවිතා කරන්න (ලියන්න, කියවන්න, නැවත ලියන්න).",
    "🧘 ඉගෙනීම අතරතුර ඉරියව්ව නිවැරදිව තබා ගන්න.",
    "🥤 ප්රමාණවත් තරම් ජලය පානය කරන්න. මොළයට ජලය අවශ්යයි.",
    "🏃 දිනපතා මිනිත්තු 15ක් ව්යායාම කරන්න. මොළයේ රුධිර සංසරණය වැඩි කරයි.",
    "📌 එක් එක් පාඩම අවසානයේ කරුණු 5ක සාරාංශයක් ලියන්න.",
    "🔁 සති අන්තයේ සතියේ ඉගෙනගත් සියල්ල නැවත කියවන්න.",
    "🌙 රාත්රියේ නින්දට පෙර ඉගෙනගත් වැදගත් කරුණු හිතට ගන්න.",
    "📖 එක පොතක් පමණක් නොව විවිධ පොත් පත් වලින් කියවන්න.",
    "💡 දුෂ්කර ප්රශ්න වලට මුහුණ දෙන්න, පැන නොයන්න.",
    "📱 ඉගෙනීමේදී දුරකථනය නිහඬ කරන්න හෝ වෙනත් කාමරයක තබන්න.",
    "🖊️ වර්ණවත් පෑන්, ස්ටිකර් භාවිතා කර සටහන් ආකර්ශනීය කරන්න.",
    "🤔 ප්රශ්න අසන්න. හොඳ ප්රශ්න හොඳ ඉගෙනීමක ලකුණකි.",
    "📰 දෛනික පුවත් හෝ ලිපි කියවීම නව වචන මාලාව වැඩි කරයි.",
    "👥 අධ්යයන කණ්ඩායමකට සම්බන්ධ වන්න.",
    "🎯 දිනපතා ඉගෙනුම් ඉලක්ක 3ක් තබා ගන්න.",
    "📈 දියුණුව වාර්තා කිරීමට ග්රැෆ් එකක් හෝ චාට් එකක් අඳින්න.",
    "💬 ඔබ ඉගෙනගත් දේ ගැන සමාජ මාධ්යවල හෝ බ්ලොගයක පළ කරන්න.",
    "📚 පාඩම් කාලසටහනක් සාදා එය අනුගමනය කරන්න.",
    "⏰ සෑම පැයකට විනාඩි 5ක විවේකයක් ගන්න.",
    "💡 ඉගෙනීම ක්රීඩාවක් ලෙස සලකන්න. ලකුණු ලබා ගැනීමට උත්සාහ කරන්න.",
    "🔄 දුෂ්කර කරුණු කිහිප වතාවක් නැවත කියවන්න.",
    "🎤 ඔබම කැමරාවකට හෝ දර්පණයකට ඉගෙනගත් දේ පැහැදිලි කරන්න.",
    "🧠 මතකයට ගැනීමට කතාන්දර (stories) බවට පත් කරන්න.",
    "📋 පාඩම ආරම්භයේදී සහ අවසානයේ ප්රශ්න පත්රයක් හදාගෙන පිළිතුරු දෙන්න.",
    "🔦 අවධානය වෙනතකට යන සෑම අවස්ථාවකම, එය හඳුනාගෙන නැවත පාඩමට එන්න.",
    "🛠️ ඉගෙනීමට විවිධ මෙවලම් භාවිතා කරන්න (flashcards, quizzes, etc).",
    "🌳 එළිමහනේ හෝ ස්වභාවික ආලෝකය ඇති ස්ථානයක ඉගෙනීමට උත්සාහ කරන්න.",
    "📅 දිනපතා එකම වේලාවට පාඩම් කිරීම පුරුද්දක් කරගන්න.",
    "📚 පෙර විභාග ප්රශ්න පත්ර විසඳන්න.",
    "🧩 ඉගෙනීම විනෝදජනක කිරීමට හාස්යය හෝ උපමා භාවිතා කරන්න.",
    "🏅 දින 7ක් පාඩම් කිරීමෙන් පසු කුඩා තෑග්ගක් දෙන්න.",
    "📖 පාඩම් කිරීමට පෙර පරිච්ඡේදයේ මාතෘකා සහ උපමාතෘකා කියවන්න.",
    "⏳ එක් දිනක් තුළ එක් විෂයකට වඩා ඉගෙන ගන්න.",
    "💬 ගුරුවරුන්ගෙන් සහ මිතුරන්ගෙන් ප්රතිපෝෂණ ලබා ගන්න.",
    "🧹 පාඩම් කරන ප්රදේශය පිරිසිදුව හා පිළිවෙලට තබා ගන්න.",
    "📌 ඉගෙනීමට පෙර 'මම මෙය ඉගෙන ගත යුත්තේ ඇයි?' කියා ඔබෙන්ම අසන්න.",
    "🌙 රාත්රියේ පාඩම් කරනවා නම්, ආලෝකය හොඳින් තබා ගන්න.",
    "📱 ඔබගේ දුරකථනයේ ඉගෙනුම් යෙදුම් පමණක් තබා ගන්න.",
    "🔄 විවිධ ක්රම භාවිතා කරමින් එකම පාඩම නැවත නැවත කරන්න.",
    "💡 ඉගෙනීම අතරතුර කෝපි හෝ තේ පානය කරන්න (ප්රමාණවත්).",
    "📊 ඔබගේ කාලය වැය වන ආකාරය විශ්ලේෂණය කර අනවශ්ය දේ අයින් කරන්න.",
    "🎓 ඉගෙනීමේ අරමුණ සිහිපත් කරන්න. එය ඔබව අභිප්රේරණය කරයි.",
    "🧠 මතකය වැඩි කිරීමට හරස් පද (crossword) හෝ ප්රහේලිකා විසඳන්න.",
    "📝 ඉගෙනගත් දේ තමන්ගේම වචන වලින් ලියන්න.",
    "🔍 ඉගෙනීමට පෙර ඔබ නොදන්නා දේ ලැයිස්තුවක් සාදන්න.",
    "📚 පුස්තකාලයට හෝ නිස්කලංක අවන්හලකට ගොස් ඉගෙන ගන්න.",
    "🛌 පාඩම් කිරීමට පෙර හොඳින් නිදාගන්න (පැය 7-8).",
    "📅 සෑම සතියකම එක් දිනක් සියලුම පාඩම් නැවත කියවන්න.",
    "🎯 දිගු කාලීන හා කෙටි කාලීන ඉලක්ක දෙකම තබා ගන්න.",
    "📊 ප්රගතිය දැකීමට දිනපතා 'අද මම ඉගෙන ගත් දේ' ලියන්න.",
    "💬 ඔබට වඩා දන්නා කෙනෙකුගෙන් උපකාර ඉල්ලන්න.",
    "🧩 දුෂ්කර පාඩම් වලට පෙර පහසු පාඩම් වලින් පටන් ගන්න.",
    "⏰ සෑම පැය 1.5 කට වරක් විනාඩි 10-15 විවේකයක් ගන්න.",
    "📖 පාඩම් කරන විට ප්රශ්න ලියා තබා පසුව පිළිතුරු සොයන්න.",
    "🎨 වර්ණ, රූප, සිතියම් භාවිතා කරමින් දෘශ්යමය ඉගෙනීම කරන්න.",
    "📢 ඔබ ඉගෙනගත් දේ ගැන අනුන්ට කියන්න. එය ඔබගේ විශ්වාසය වැඩි කරයි.",
    "🌟 අවසාන වශයෙන්, ඔබටම කරුණාවන්ත වන්න. ඉගෙනීම ගමනක් මිස තරඟයක් නොවේ."
];

// ==================== BOT SETUP ====================
function setupBot() {
    if (!bot) {
        console.error('❌ Bot not initialized!');
        return;
    }

    // ========== MIDDLEWARE: CHECK PERMISSIONS - FIXED ==========
    bot.use(async (ctx, next) => {
        try {
            // Skip callback queries - they're handled by the action handlers
            if (ctx.updateType === 'callback_query') {
                // Still check permissions for callback queries
                const allowed = await checkPermissions(ctx);
                if (!allowed) {
                    await ctx.answerCbQuery('⛔ You are not authorized to use this bot.');
                    return;
                }
                return next();
            }
            
            // For regular messages and other updates
            const allowed = await checkPermissions(ctx);
            if (!allowed) {
                // Don't continue if not allowed
                return;
            }
            
            return next();
        } catch (error) {
            console.error('Middleware error:', error);
            return next();
        }
    });

    // ========== STUDY TIPS ==========
    bot.action('Study', async (ctx) => {
        const randomTip = studyTips[Math.floor(Math.random() * studyTips.length)];

        await ctx.answerCbQuery(
            `💡 අද දවසේ උපදෙස\n\n${randomTip}`,
            { show_alert: true }
        );
    });

    // ========== START COMMAND ==========
    bot.start(async (ctx) => {
        const userId = ctx.from.id;
        
        const welcomeText = `
<b>👋 KUDDA EDUCATION VPN BOT වෙට සාදරයෙන් පිළිගනිමු!</b>

මෙය නොමිලේ High-Speed VPN ගිණුම් සාදාගැනීමට හා සරල System එකක් සහිත Bot කෙනෙකි.

━━━━━━━━━━━━━━━━━━━━━━
🔰පාසල් සිසුන්ට සහ අනෙකුත් අධ්‍යාපනය හදාරන පිරිස් වෙත සාදන ලද්දකි. එමෙන්ම පහත සදහන් වෙබ් පිටු බාවිතා කිරීම වලක්වා ඇත. 
<blockquote>🛑 Games & Gaming Services
🛑 Social Media
🛑 Entertainment / Streaming
🛑 Adult Content
🛑 Gambling / Betting
🛑 High Bandwidth Downloads
🛑 Crypto / Mining</blockquote>
━━━━━━━━━━━━━━━━━━━━━━

👑 Owner: <a href="https://t.me/mataberiyo">Mayantha</a>
        `;
        
        await sendWithImage(ctx, welcomeText, getMainKeyboard(userId));
    });


    

// ==================== INLINE MODE HANDLER ====================

    // ========== INLINE HELP MENU BUTTON HANDLER ==========
    bot.action('inline_help_menu', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        // Check if user is owner
        if (userId.toString() !== OWNER_ID) {
            await ctx.answerCbQuery('⛔ Unauthorized!');
            return;
        }
        
        const botUsername = ctx.botInfo.username;
        
        // SHORTENED TEXT - Under 1024 characters
        const text = `
<b>📖 Inline Mode Guide</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>⚡ Quick VPN:</b>
<code>@${botUsername} 1h</code> <code>@${botUsername} 3h</code>
<code>@${botUsername} 6h</code> <code>@${botUsername} 12h</code>
<code>@${botUsername} 1d</code> <code>@${botUsername} 7d</code>

<b>📋 Commands:</b>
<code>list</code> - Your configs
<code>copy {id}</code> - Copy link
<code>qr {id}</code> - QR code
<code>delete {id}</code> - Delete

<b>👤 User:</b>
<code>get {user_id}</code> - Get configs
<code>create {user_id} 1d</code> - Create for user

<b>⚙️ Core:</b>
<code>start</code> <code>stop</code> <code>restart</code>
<code>status</code> <code>users</code> <code>stats</code>
<code>clean</code> <code>info</code>

━━━━━━━━━━━━━━━━━━━━━━
💡 Type <code>@${botUsername}</code> in any chat!
📌 Admin-only for security

<b>Click a button below to try!</b>
        `;
        
        const buttons = [
            // Labels with noop
            [{ text: '⚡ QUICK VPN', callback_data: 'noop' }],
            [
                { text: '⚡ 1 Hour', switch_inline_query_current_chat: '1h' },
                { text: '⚡ 3 Hours', switch_inline_query_current_chat: '3h' },
                { text: '⚡ 6 Hours', switch_inline_query_current_chat: '6h' }
            ],
            [
                { text: '📅 1 Day', switch_inline_query_current_chat: '1d' },
                { text: '📅 3 Days', switch_inline_query_current_chat: '3d' },
                { text: '📅 7 Days', switch_inline_query_current_chat: '7d' }
            ],
            [{ text: '📋 MANAGEMENT', callback_data: 'noop' }],
            [
                { text: '👥 Users', switch_inline_query_current_chat: 'users' },
                { text: '📋 List', switch_inline_query_current_chat: 'list' },
            ],
            [
                { text: '👤 Get User', switch_inline_query_current_chat: 'get ' },
                { text: '👤 Create User', switch_inline_query_current_chat: 'create ' },
                { text: '🗑 Delete', switch_inline_query_current_chat: 'delete ' }
            ],
            [
                { text: '📋 Copy', switch_inline_query_current_chat: 'copy ' },
                { text: '📱 QR', switch_inline_query_current_chat: 'qr ' }
            ],
            [{ text: '⚙️ SYSTEM', callback_data: 'noop' }],
            [
                { text: '📊 Status', switch_inline_query_current_chat: 'status' },
                { text: '📈 Stats', switch_inline_query_current_chat: 'stats' },
                { text: '🧹 Clean', switch_inline_query_current_chat: 'clean' }
            ],
            [
                { text: '▶️ Start', switch_inline_query_current_chat: 'start' },
                { text: '⏹ Stop', switch_inline_query_current_chat: 'stop' },
                { text: '🔄 Restart', switch_inline_query_current_chat: 'restart' }
            ],
            [
                { text: 'ℹ️ Info', switch_inline_query_current_chat: 'info' },
                { text: '📖 Inline Help', switch_inline_query_current_chat: 'help' }
            ],
            [
                { text: '🔙 Back to Menu', callback_data: 'back_to_menu' }
            ]
        ];
        
        await editWithImage(ctx, text, buttons);
    });

    // ========== NO-OP HANDLER FOR LABELS ==========
    bot.action('noop', async (ctx) => {
        await ctx.answerCbQuery(); // Just acknowledge, does nothing
    });


// Inline Mode එක Handle කරන තැන
bot.on('inline_query', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const isOwner = userId === OWNER_ID;
        
        // Admin පමණක් Inline Mode භාවිතා කළ හැක
        if (!isOwner) {
            return ctx.answerInlineQuery([], {
                switch_pm_text: '⛔ Access Denied - Only Admin can use this feature',
                switch_pm_parameter: 'access_denied'
            });
        }

        const query = ctx.inlineQuery.query.trim();
        const botUsername = ctx.botInfo.username;
        
        // ========== QUICK VPN PRESETS ==========
        const presets = {
            '1h': 1,
            '2h': 2,
            '3h': 3,
            '4h': 4,
            '6h': 6,
            '8h': 8,
            '12h': 12,
            '18h': 18,
            '24h': 24,
            '1d': 24,
            '2d': 48,
            '3d': 72,
            '5d': 120,
            '7d': 168,
            '10d': 240,
            '14d': 336,
            '30m': 0.5,
            '45m': 0.75,
            '90m': 1.5,
            '120m': 2
        };

        // Check if query matches a preset (only if no other command matches)
        if (presets[query] !== undefined && 
            !query.toLowerCase().startsWith('get ') && 
            !query.toLowerCase().startsWith('create ') && 
            !query.toLowerCase().startsWith('delete ') && 
            !query.toLowerCase().startsWith('copy ') && 
            !query.toLowerCase().startsWith('qr ') &&
            query.toLowerCase() !== 'list' &&
            query.toLowerCase() !== 'help' &&
            query.toLowerCase() !== 'info' &&
            query.toLowerCase() !== 'about' &&
            query.toLowerCase() !== 'status' &&
            query.toLowerCase() !== 'stats' &&
            query.toLowerCase() !== 'clean' &&
            query.toLowerCase() !== 'cleanup' &&
            query.toLowerCase() !== 'start' &&
            query.toLowerCase() !== 'stop' &&
            query.toLowerCase() !== 'restart' &&
            query.toLowerCase() !== 'users' &&
            query.toLowerCase() !== 'listusers') {
            
            const duration = presets[query];
            const config = await generateVPNConfig(userId, duration);
            await saveVPNConfig(userId, config);

            const expiryDate = new Date(config.expiryTime);
            const timeDisplay = query;

            const progressBar = '🟩'.repeat(10);

            return ctx.answerInlineQuery([{
                type: 'article',
                id: `quick_${config.id}`,
                title: `⚡ Quick VPN (${timeDisplay})`,
                description: `Expires: ${expiryDate.toLocaleString()}`,
                input_message_content: {
                    message_text: `
<b>⚡ Quick VPN Configuration</b>

<blockquote><b>Duration:</b> ${timeDisplay}
<b>Expires:</b> ${expiryDate.toLocaleString()}
<b>ID:</b> <code>${config.id}</code>
<b>┃${progressBar}┃ 100%</b></blockquote>

<code>${config.config.vless}</code>

<i>📋 Click "Copy Link" below to copy</i>`,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                },
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📋 Copy Link', switch_inline_query_current_chat: `copy ${config.id}` },
                            { text: '📱 QR Code', switch_inline_query_current_chat: `qr ${config.id}` }
                        ],
                        [{ text: '🔄 More Options', switch_inline_query_current_chat: 'help' }]
                    ]
                }
            }]);
        }

        // ========== COPY COMMAND ==========
        if (query.toLowerCase().startsWith('copy ')) {
            const configId = query.substring(5).trim();
            const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
            
            try {
                const data = await fsPromises.readFile(configPath, 'utf8');
                const config = JSON.parse(data);
                
                if (config.userId !== userId && !isOwner) {
                    return ctx.answerInlineQuery([{
                        type: 'article',
                        id: 'unauthorized',
                        title: '⛔ Unauthorized',
                        input_message_content: {
                            message_text: '⛔ You do not have permission to copy this config.',
                            parse_mode: 'HTML'
                        },
                        description: 'Access denied'
                    }]);
                }

                return ctx.answerInlineQuery([{
                    type: 'article',
                    id: 'copied',
                    title: '✅ Config Copied',
                    input_message_content: {
                        message_text: `
<b>📋 VPN Configuration</b>

<code>${config.config.vless}</code>

<i>✅ Copy this link and paste in your VPN client</i>`,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    },
                    description: 'Copy the VPN link',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📱 QR Code', switch_inline_query_current_chat: `qr ${configId}` }],
                            [{ text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }]
                        ]
                    }
                }]);
            } catch (error) {
                return ctx.answerInlineQuery([{
                    type: 'article',
                    id: 'not_found',
                    title: '❌ Config Not Found',
                    input_message_content: {
                        message_text: `❌ Configuration not found with ID: <code>${configId}</code>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Config not found'
                }]);
            }
        }

        // ========== QR CODE COMMAND ==========
        if (query.toLowerCase().startsWith('qr ')) {
            const configId = query.substring(3).trim();
            const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
            
            try {
                const data = await fsPromises.readFile(configPath, 'utf8');
                const config = JSON.parse(data);
                
                if (config.userId !== userId && !isOwner) {
                    return ctx.answerInlineQuery([{
                        type: 'article',
                        id: 'unauthorized',
                        title: '⛔ Unauthorized',
                        input_message_content: {
                            message_text: '⛔ You do not have permission to view this config.',
                            parse_mode: 'HTML'
                        },
                        description: 'Access denied'
                    }]);
                }

                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(config.config.vless)}`;

                return ctx.answerInlineQuery([{
                    type: 'photo',
                    id: `qr_${config.id}`,
                    photo_url: qrUrl,
                    thumb_url: qrUrl,
                    title: '📱 QR Code',
                    description: 'Scan to connect',
                    caption: `
<b>📱 VPN QR Code</b>

<blockquote><b>Config ID:</b> <code>${config.id}</code>
<b>Expires:</b> <code>${new Date(config.expiryTime).toLocaleString()}</code></blockquote>

<i>📸 Scan this QR code with your VPN client</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 Copy Link', switch_inline_query_current_chat: `copy ${config.id}` }],
                            [{ text: '🔄 More Options', switch_inline_query_current_chat: 'help' }]
                        ]
                    }
                }]);
            } catch (error) {
                return ctx.answerInlineQuery([{
                    type: 'article',
                    id: 'not_found',
                    title: '❌ Config Not Found',
                    input_message_content: {
                        message_text: `❌ Configuration not found with ID: <code>${configId}</code>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Config not found'
                }]);
            }
        }

        // ========== INFO/ABOUT COMMAND ==========
        if (query.toLowerCase() === 'info' || query.toLowerCase() === 'about') {
            const status = await getXrayStatus();
            
            let totalUsers = 0;
            let totalConfigs = 0;
            try {
                const data = await fsPromises.readFile(DATA_FILE, 'utf8');
                const users = JSON.parse(data);
                totalUsers = Object.keys(users).length;
                for (const userData of Object.values(users)) {
                    if (userData.configs) {
                        totalConfigs += userData.configs.filter(c => c.expiryTime > Date.now()).length;
                    }
                }
            } catch (error) {}

            return ctx.answerInlineQuery([{
                type: 'article',
                id: 'info',
                title: 'ℹ️ Bot Information',
                input_message_content: {
                    message_text: `
<b>ℹ️ VPN Bot Information</b>

━━━━━━━━━━━━━━━━━━━━━━
<blockquote><b>🤖 Bot:</b> KUDDA VPN Bot
<b>👑 Owner:</b> <a href="https://t.me/mataberiyo">Mayantha</a>
<b>📡 Status:</b> ${status.running ? '🟢 Online' : '🔴 Offline'}
<b>🔒 Mode:</b> ${PRIVATE_MODE.enabled ? '🟢 Private' : '🟢 Public'}
<b>👥 Users:</b> <code>${totalUsers}</code>
<b>📋 Active Configs:</b> <code>${totalConfigs}</code></blockquote>

━━━━━━━━━━━━━━━━━━━━━━
<blockquote><b>📋 Quick Commands:</b>
• <code>1h, 2h, 3h, 6h, 12h, 24h</code> - Quick VPN
• <code>1d, 2d, 3d, 7d</code> - Day VPN
• <code>list</code> - Your configs
• <code>get &lt;user_id&gt;</code> - User configs
• <code>copy &lt;id&gt;</code> - Copy config
• <code>qr &lt;id&gt;</code> - QR code
• <code>delete &lt;id&gt;</code> - Delete config
• <code>help</code> - Full help</blockquote>

━━━━━━━━━━━━━━━━━━━━━━
<i>💡 Type <code>@${botUsername}</code> followed by a command</i>`,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                },
                description: 'Bot information and commands',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📖 Help', switch_inline_query_current_chat: 'help' }],
                        [
                            { text: '⚡ 1h', switch_inline_query_current_chat: '1h' },
                            { text: '⚡ 12h', switch_inline_query_current_chat: '12h' },
                            { text: '⚡ 1d', switch_inline_query_current_chat: '1d' }
                        ],
                        [
                            { text: '📋 List', switch_inline_query_current_chat: 'list' },
                            { text: '📊 Status', switch_inline_query_current_chat: 'status' }
                        ]
                    ]
                }
            }]);
        }

        // ========== ENHANCED HELP WITH BUTTONS ==========
        if (!query || query.toLowerCase() === 'help' || query.toLowerCase() === '?') {
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'help',
                    title: '📖 Inline Mode Help',
                    input_message_content: {
                        message_text: 
`<b>🔐 VLESS Config Generator - Inline Mode</b>

━━━━━━━━━━━━━━━━━━━━━━
<blockquote><b>⚡ Quick VPN:</b>
<code>1h</code> <code>2h</code> <code>3h</code> <code>6h</code>
<code>12h</code> <code>24h</code> <code>1d</code> <code>7d</code></blockquote>

<blockquote><b>📋 Manage Configs:</b>
• <code>list</code> - View your configs
• <code>copy {id}</code> - Copy VPN link
• <code>qr {id}</code> - Get QR code
• <code>delete {id}</code> - Delete config</blockquote>

<blockquote><b>👤 User Management:</b>
• <code>get {user_id}</code> - Get configs for a user
• <code>create {user_id} 1d</code> - Create config for a user</blockquote>

<blockquote><b>⚙️ Core Commands:</b>
• <code>start</code> - Start Xray Core
• <code>stop</code> - Stop Xray Core
• <code>restart</code> - Restart Xray Core
• <code>status</code> - Core Status
• <code>users</code> - List all users
• <code>stats</code> - System stats
• <code>clean</code> - Clean expired configs</blockquote>

━━━━━━━━━━━━━━━━━━━━━━
<i>💡 Click a button below to execute command</i>`,
                        parse_mode: 'HTML'
                    },
                    description: 'All available commands',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⚡ QUICK VPN', callback_data: 'noop' }],
                            [
                                { text: '⚡ 1 Hour', switch_inline_query_current_chat: '1h' },
                                { text: '⚡ 3 Hours', switch_inline_query_current_chat: '3h' },
                                { text: '⚡ 6 Hours', switch_inline_query_current_chat: '6h' }
                            ],
                            [
                                { text: '📅 1 Day', switch_inline_query_current_chat: '1d' },
                                { text: '📅 3 Days', switch_inline_query_current_chat: '3d' },
                                { text: '📅 7 Days', switch_inline_query_current_chat: '7d' }
                            ],
                            [{ text: '📋 MANAGEMENT', callback_data: 'noop' }],
                            [
                                { text: '👥 Users', switch_inline_query_current_chat: 'users' },
                                { text: '📋 List', switch_inline_query_current_chat: 'list' },
                            ],
                            [
                                { text: '👤 Get User', switch_inline_query_current_chat: 'get ' },
                                { text: '👤 Create User', switch_inline_query_current_chat: 'create ' },
                                { text: '🗑 Delete', switch_inline_query_current_chat: 'delete ' }
                            ],
                            [
                                { text: '📋 Copy', switch_inline_query_current_chat: 'copy ' },
                                { text: '📱 QR', switch_inline_query_current_chat: 'qr ' }
                            ],
                            [{ text: '⚙️ SYSTEM', callback_data: 'noop' }],
                            [
                                { text: '📊 Status', switch_inline_query_current_chat: 'status' },
                                { text: '📈 Stats', switch_inline_query_current_chat: 'stats' },
                                { text: '🧹 Clean', switch_inline_query_current_chat: 'clean' }
                            ],
                            [
                                { text: '▶️ Start', switch_inline_query_current_chat: 'start' },
                                { text: '⏹ Stop', switch_inline_query_current_chat: 'stop' },
                                { text: '🔄 Restart', switch_inline_query_current_chat: 'restart' }
                            ],
                            [
                                { text: 'ℹ️ Info', switch_inline_query_current_chat: 'info' },
                                { text: '📖 Inline Help', switch_inline_query_current_chat: 'help' }
                            ],
                            [
                                { text: '🔙 Back to Menu', callback_data: 'back_to_menu' }
                            ]
                        ]
                    }
                }
            ]);
        }

        // ========== SUPPORT MULTIPLE FORMATS ==========
        let days = 0, hours = 0, minutes = 0;
        let matched = false;
        
        const patterns = [
            { regex: /(\d+)\s*d/i, type: 'days' },
            { regex: /(\d+)\s*h/i, type: 'hours' },
            { regex: /(\d+)\s*m/i, type: 'minutes' },
            { regex: /d\s*(\d+)/i, type: 'days' },
            { regex: /h\s*(\d+)/i, type: 'hours' },
            { regex: /m\s*(\d+)/i, type: 'minutes' }
        ];
        
        for (const pattern of patterns) {
            const match = query.match(pattern.regex);
            if (match) {
                const value = parseInt(match[1]);
                if (pattern.type === 'days') {
                    days = Math.max(days, value);
                    matched = true;
                } else if (pattern.type === 'hours') {
                    hours = Math.max(hours, value);
                    matched = true;
                } else if (pattern.type === 'minutes') {
                    minutes = Math.max(minutes, value);
                    matched = true;
                }
            }
        }
        
        if (!matched) {
            const numMatch = query.match(/^(\d+)$/);
            if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num <= 24) {
                    hours = num;
                } else {
                    days = Math.floor(num / 24);
                    hours = num % 24;
                }
                matched = true;
            }
        }

        // ========== GET USER CONFIGS BY USER ID ==========
        if (query.toLowerCase().startsWith('get ')) {
            const targetUserId = query.substring(4).trim();
            
            if (!targetUserId || isNaN(targetUserId)) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'invalid_id',
                        title: '❌ Invalid User ID',
                        input_message_content: {
                            message_text: 
`<b>❌ Invalid User ID</b>

<blockquote>Please provide a valid User ID.

<b>Usage:</b>
<code>get 123456789</code></blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Invalid user ID format'
                    }
                ]);
            }
            
            try {
                const userData = await getUserData(targetUserId);
                
                if (!userData || !userData.configs || userData.configs.length === 0) {
                    return ctx.answerInlineQuery([
                        {
                            type: 'article',
                            id: 'no_user_configs',
                            title: '📭 No Configs Found',
                            input_message_content: {
                                message_text: 
`<b>📭 No Configurations Found</b>

<blockquote>User ID: <code>${targetUserId}</code>

This user has no active VPN configurations.</blockquote>`,
                                parse_mode: 'HTML'
                            },
                            description: 'User has no configs'
                        }
                    ]);
                }
                
                const now = Date.now();
                const activeConfigs = userData.configs.filter(c => c.expiryTime > now);
                
                if (activeConfigs.length === 0) {
                    return ctx.answerInlineQuery([
                        {
                            type: 'article',
                            id: 'no_active_configs',
                            title: '📭 No Active Configs',
                            input_message_content: {
                                message_text: 
`<b>📭 No Active Configurations</b>

<blockquote>User ID: <code>${targetUserId}</code>

All configurations have expired.</blockquote>`,
                                parse_mode: 'HTML'
                            },
                            description: 'All configs expired'
                        }
                    ]);
                }
                
                let userDisplayName = 'Unknown User';
                let userUsername = '';
                try {
                    const user = await ctx.telegram.getChat(parseInt(targetUserId));
                    const firstName = user.first_name || 'Unknown';
                    const lastName = user.last_name || '';
                    userDisplayName = `${firstName} ${lastName}`.trim() || 'Unknown User';
                    userUsername = user.username ? `@${user.username}` : '';
                } catch (error) {
                    userDisplayName = `User ${targetUserId}`;
                }
                
                let configList = `<b>📋 VPN Configurations for User</b>\n\n`;
                configList += `<blockquote><b>👤 User:</b> ${userDisplayName}`;
                if (userUsername) configList += ` (${userUsername})`;
                configList += `\n<b>🆔 User ID:</b> <code>${targetUserId}</code>`;
                configList += `\n<b>📊 Active Configs:</b> <code>${activeConfigs.length}</code></blockquote>\n\n`;
                configList += `<b>━━━━━━━━━━━━━━━━━━━━━━</b>\n\n`;
                
                for (let i = 0; i < activeConfigs.length; i++) {
                    const config = activeConfigs[i];
                    const remaining = Math.ceil((config.expiryTime - now) / (1000 * 60 * 60));
                    const expiryDate = new Date(config.expiryTime);
                    
                    const configPath = path.join(CONFIGS_DIR, `${config.id}.json`);
                    let fullConfig = null;
                    try {
                        const data = await fsPromises.readFile(configPath, 'utf8');
                        fullConfig = JSON.parse(data);
                    } catch (error) {
                        continue;
                    }
                    
                    if (!fullConfig) continue;
                    
                    const total = config.duration || 24;
                    const percent = Math.min(100, Math.round((remaining / total) * 100));
                    const filled = Math.round(percent / 10);
                    const empty = 10 - filled;
                    const bar = '🟩'.repeat(filled) + '⬜'.repeat(empty);
                    
                    configList += `<b>🔹 Config ${i + 1} - ${remaining}h/${total}h (${percent}%)</b>\n`;
                    configList += `┃${bar}┃ \n`;
                    configList += `<blockquote><b>ID:</b> <code>${config.id}</code>\n`;
                    configList += `<b>Expires:</b> <code>${expiryDate.toLocaleString()}</code></blockquote>\n`;
                    configList += `<code>${fullConfig.config.vless}</code>\n\n`;
                }
                
                configList += `<i>🔰 Use <code>delete &lt;id&gt;</code> to remove a config</i>`;

                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'user_configs',
                        title: `📋 ${activeConfigs.length} Configs for ${targetUserId}`,
                        description: `${activeConfigs.length} active configurations`,
                        input_message_content: {
                            message_text: configList,
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        },
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '🔄 Generate New for User', switch_inline_query_current_chat: `create ${targetUserId}` },
                                    { text: '📋 Copy Config', switch_inline_query_current_chat: `copy ` }
                                ],
                                [
                                    { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                                ]
                            ]
                        }
                    }
                ]);
                
            } catch (error) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'error',
                        title: '❌ Error',
                        input_message_content: {
                            message_text: 
`<b>❌ Error Getting Configs</b>

<blockquote>${error.message || 'Please try again later.'}</blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Error occurred'
                    }
                ]);
            }
        }

        // ========== CREATE CONFIG FOR SPECIFIC USER ==========
        if (query.toLowerCase().startsWith('create ')) {
            const targetUserId = query.substring(7).trim();
            
            if (!targetUserId || isNaN(targetUserId)) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'invalid_id',
                        title: '❌ Invalid User ID',
                        input_message_content: {
                            message_text: 
`<b>❌ Invalid User ID</b>

<blockquote>Please provide a valid User ID.

<b>Usage:</b>
<code>create 123456789 1d</code></blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Invalid user ID format'
                    }
                ]);
            }
            
            const parts = query.split(' ');
            if (parts.length < 3) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'missing_time',
                        title: '❌ Missing Time Format',
                        input_message_content: {
                            message_text: 
`<b>❌ Missing Time Format</b>

<blockquote>Please specify the duration.

<b>Usage:</b>
<code>create ${targetUserId} 1d</code>
<code>create ${targetUserId} 2h</code>
<code>create ${targetUserId} 30m</code></blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Time format required'
                    }
                ]);
            }
            
            const timeQuery = parts.slice(2).join(' ');
            
            let days = 0, hours = 0, minutes = 0;
            
            const dMatch = timeQuery.match(/d\s*(\d+)/i);
            const hMatch = timeQuery.match(/h\s*(\d+)/i);
            const mMatch = timeQuery.match(/m\s*(\d+)/i);
            
            if (dMatch) days = parseInt(dMatch[1]);
            if (hMatch) hours = parseInt(hMatch[1]);
            if (mMatch) minutes = parseInt(mMatch[1]);
            
            if (days === 0 && hours === 0 && minutes === 0) {
                const numMatch = timeQuery.match(/^(\d+)$/);
                if (numMatch) {
                    const num = parseInt(numMatch[1]);
                    if (num <= 24) {
                        hours = num;
                    } else {
                        days = Math.floor(num / 24);
                        hours = num % 24;
                    }
                } else {
                    return ctx.answerInlineQuery([
                        {
                            type: 'article',
                            id: 'invalid_time',
                            title: '❌ Invalid Time Format',
                            input_message_content: {
                                message_text: 
`<b>❌ Invalid Time Format</b>

<blockquote><b>Examples:</b>
<code>create ${targetUserId} 1d</code>
<code>create ${targetUserId} 2h</code>
<code>create ${targetUserId} 1d2h30m</code></blockquote>`,
                                parse_mode: 'HTML'
                            },
                            description: 'Invalid time format'
                        }
                    ]);
                }
            }
            
            let targetUserData = await getUserData(targetUserId);
            if (!targetUserData) {
                targetUserData = { configs: [] };
                await saveUserData(targetUserId, targetUserData);
            }
            
            const totalMinutes = days * 24 * 60 + hours * 60 + minutes;
            const durationHours = Math.ceil(totalMinutes / 60);
            
            const config = await generateVPNConfig(targetUserId, durationHours);
            await saveVPNConfig(targetUserId, config);
            
            let userDisplayName = 'Unknown User';
            let userUsername = '';
            try {
                const user = await ctx.telegram.getChat(parseInt(targetUserId));
                const firstName = user.first_name || 'Unknown';
                const lastName = user.last_name || '';
                userDisplayName = `${firstName} ${lastName}`.trim() || 'Unknown User';
                userUsername = user.username ? `@${user.username}` : '';
            } catch (error) {}
            
            let timeStr = '';
            if (days > 0) timeStr += `${days}d `;
            if (hours > 0) timeStr += `${hours}h `;
            if (minutes > 0) timeStr += `${minutes}m `;
            timeStr = timeStr.trim() || '0m';
            
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'config_created',
                    title: '✅ Config Created',
                    input_message_content: {
                        message_text: 
`<b>✅ VPN Config Created Successfully</b>

<blockquote><b>👤 User:</b> ${userDisplayName}${userUsername ? ` (${userUsername})` : ''}
<b>🆔 User ID:</b> <code>${targetUserId}</code>
<b>⏱ Duration:</b> ${timeStr}
<b>🆔 Config ID:</b> <code>${config.id}</code>
<b>📅 Expires:</b> <code>${new Date(config.expiryTime).toLocaleString()}</code></blockquote>

<code>${config.config.vless}</code>

<b>📱 Use this link in your VPN client.</b>`,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    },
                    description: `Config created for ${targetUserId}`,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📋 Get User Configs', switch_inline_query_current_chat: `get ${targetUserId}` },
                                { text: '📋 Copy Config', switch_inline_query_current_chat: `copy ${config.id}` }
                            ],
                            [
                                { text: '📱 QR Code', switch_inline_query_current_chat: `qr ${config.id}` },
                                { text: '🔄 Create Another', switch_inline_query_current_chat: `create ${targetUserId}` }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        // ========== LIST CONFIGS ==========
        if (query.toLowerCase() === 'list') {
            const configs = await getActiveConfigs(userId);
            
            if (configs.length === 0) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'no_configs',
                        title: '📭 No Active Configs',
                        input_message_content: {
                            message_text: 
`<b>📭 No Active Configurations</b>

<blockquote>You don't have any active VPN configurations.

Use <code>1d</code>, <code>2h</code>, <code>30m</code> to create one.</blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'You have no active VPN configs',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '⚡ 1 Hour', switch_inline_query_current_chat: '1h' },
                                    { text: '⚡ 12 Hours', switch_inline_query_current_chat: '12h' }
                                ],
                                [
                                    { text: '📅 1 Day', switch_inline_query_current_chat: '1d' },
                                    { text: '📅 7 Days', switch_inline_query_current_chat: '7d' }
                                ],
                                [
                                    { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                                ]
                            ]
                        }
                    }
                ]);
            }
            
            let userInfo = '';
            try {
                const user = await ctx.telegram.getChat(userId);
                const firstName = user.first_name || 'Unknown';
                const lastName = user.last_name || '';
                const username = user.username ? `@${user.username}` : 'No username';
                const fullName = `${firstName} ${lastName}`.trim() || 'Unknown User';
                
                userInfo = `<b>👤 User:</b> ${fullName} (${username})\n`;
                userInfo += `<b>🆔 User ID:</b> <code>${userId}</code>`;
            } catch (error) {
                userInfo = `<b>🆔 User ID:</b> <code>${userId}</code>`;
            }
            
            let configList = `<b>📋 Your Active Configurations (${configs.length})</b>\n\n`;
            configList += `<blockquote>${userInfo}</blockquote>\n\n`;
            
            for (let i = 0; i < configs.length; i++) {
                const config = configs[i];
                const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
                const expiryDate = new Date(config.expiryTime);
                
                const total = config.duration || 24;
                const percent = Math.min(100, Math.round((remaining / total) * 100));
                const filled = Math.round(percent / 10);
                const empty = 10 - filled;
                const bar = '🟩'.repeat(filled) + '⬜'.repeat(empty);
                
                configList += `<b>🔹 Config ${i + 1} - ${remaining}h/${total}h (${percent}%)</b>\n`;
                configList += `┃${bar}┃ \n`;
                configList += `<b>ID:</b> <code>${config.id}</code>\n`;
                configList += `<b>Expires:</b> <code>${expiryDate.toLocaleString()}</code>\n`;
                configList += `<b>Remaining:</b> <code>${remaining}h</code>\n\n`;
            }
            
            configList += `<i>🔰 Use <code>delete &lt;id&gt;</code> to remove a config</i>`;

            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'config_list',
                    title: `📋 Configs (${configs.length})`,
                    description: `${configs.length} active configurations`,
                    input_message_content: {
                        message_text: configList,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    },
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📋 Copy Config', switch_inline_query_current_chat: 'copy ' },
                                { text: '📱 QR Code', switch_inline_query_current_chat: 'qr ' }
                            ],
                            [
                                { text: '🔄 Generate New', switch_inline_query_current_chat: '' },
                                { text: '🗑 Delete Config', switch_inline_query_current_chat: 'delete ' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }
                
        // ========== DELETE CONFIG ==========
        if (query.toLowerCase().startsWith('delete ')) {
            const id = query.substring(7).trim();
            
            if (!id) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'delete_help',
                        title: '🗑 Delete Config',
                        input_message_content: {
                            message_text: 
`<b>🗑 Delete Configuration</b>

<blockquote>Please provide a Config ID to delete.

<b>Usage:</b>
<code>delete &lt;config_id&gt;</code>

Use <code>list</code> to see your configs.</blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'How to delete a config',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📋 List Configs', switch_inline_query_current_chat: 'list' },
                                    { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                                ]
                            ]
                        }
                    }
                ]);
            }
            
            const userData = await getUserData(userId);
            
            if (!userData || !userData.configs) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'delete_fail',
                        title: '❌ Config Not Found',
                        input_message_content: {
                            message_text: `<b>❌ Config Not Found</b>\n\n<blockquote>No config found with ID: <code>${id}</code></blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Config not found'
                    }
                ]);
            }
            
            const config = userData.configs.find(c => c.id === id);
            
            if (!config) {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'delete_fail',
                        title: '❌ Config Not Found',
                        input_message_content: {
                            message_text: `<b>❌ Config Not Found</b>\n\n<blockquote>No config found with ID: <code>${id}</code></blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Config not found'
                    }
                ]);
            }
            
            await deleteUserConfig(userId, id);
            
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'delete_success',
                    title: '✅ Config Deleted',
                    input_message_content: {
                        message_text: 
`<b>✅ Config Deleted Successfully</b>

<blockquote>Config ID: <code>${id}</code>
Duration: ${config.duration}h

Your VPN has been disconnected.</blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'VPN config deleted',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📋 List Configs', switch_inline_query_current_chat: 'list' },
                                { text: '🔄 Generate New', switch_inline_query_current_chat: '' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }
        
        // ========== CORE MANAGEMENT ==========
        if (query.toLowerCase() === 'start') {
            await startXray();
            const status = await getXrayStatus();
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'core_start',
                    title: '✅ Xray Started',
                    input_message_content: {
                        message_text: 
`<b>✅ Xray Core Started</b>

<blockquote><b>Status:</b> ${status.running ? '🟢 Running' : '🔴 Stopped'}
<b>PID:</b> <code>${status.pid || 'N/A'}</code>

Xray service has been started successfully.</blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Xray service started',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📊 Status', switch_inline_query_current_chat: 'status' },
                                { text: '⏹ Stop', switch_inline_query_current_chat: 'stop' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        if (query.toLowerCase() === 'stop') {
            await stopXray(true);
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'core_stop',
                    title: '⏹ Xray Stopped',
                    input_message_content: {
                        message_text: 
`<b>⏹ Xray Core Stopped</b>

<blockquote>Xray service has been stopped successfully.

Use <code>start</code> to start it again.</blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Xray service stopped',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '▶️ Start', switch_inline_query_current_chat: 'start' },
                                { text: '📊 Status', switch_inline_query_current_chat: 'status' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        if (query.toLowerCase() === 'restart') {
            await restartXray();
            const status = await getXrayStatus();
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'core_restart',
                    title: '🔄 Xray Restarted',
                    input_message_content: {
                        message_text: 
`<b>🔄 Xray Core Restarted</b>

<blockquote><b>Status:</b> ${status.running ? '🟢 Running' : '🔴 Stopped'}
<b>PID:</b> <code>${status.pid || 'N/A'}</code>
<b>Restarts:</b> <code>${status.restarts}</code>

Xray has been restarted successfully.</blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Xray service restarted',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📊 Status', switch_inline_query_current_chat: 'status' },
                                { text: '⏹ Stop', switch_inline_query_current_chat: 'stop' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        if (query.toLowerCase() === 'status') {
            const status = await getXrayStatus();
            const memUsage = process.memoryUsage();
            const uptime = process.uptime();
            
            let totalUsers = 0;
            let totalConfigs = 0;
            try {
                const data = await fsPromises.readFile(DATA_FILE, 'utf8');
                const users = JSON.parse(data);
                totalUsers = Object.keys(users).length;
                for (const userData of Object.values(users)) {
                    if (userData.configs) {
                        totalConfigs += userData.configs.filter(c => c.expiryTime > Date.now()).length;
                    }
                }
            } catch (error) {}

            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'core_status',
                    title: '📊 System Status',
                    input_message_content: {
                        message_text: 
`<b>📊 System Status</b>

<blockquote><b>Xray Core:</b>
<b>Status:</b> ${status.running ? '🟢 Running' : '🔴 Stopped'}
<b>PID:</b> <code>${status.pid || 'N/A'}</code>
<b>Restarts:</b> <code>${status.restarts}</code>

<b>System:</b>
<b>Memory:</b> <code>${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB</code>
<b>Uptime:</b> <code>${Math.floor(uptime / 60)} min</code>
<b>Users:</b> <code>${totalUsers}</code>
<b>Active Configs:</b> <code>${totalConfigs}</code>

<b>Settings:</b>
<b>Private Mode:</b> ${PRIVATE_MODE.enabled ? '🟢 On' : '🔴 Off'}
<b>Groups:</b> ${GROUP_SETTINGS.enabled ? '🟢 Enabled' : '🔴 Disabled'}</blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Full system status',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔄 Restart', switch_inline_query_current_chat: 'restart' },
                                { text: '📈 Stats', switch_inline_query_current_chat: 'stats' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        // ========== CLEAN EXPIRED ==========
        if (query.toLowerCase() === 'clean' || query.toLowerCase() === 'cleanup') {
            const count = await cleanupExpiredConfigs();
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'cleanup',
                    title: '🧹 Cleaned Expired',
                    input_message_content: {
                        message_text: 
`<b>🧹 Cleanup Complete</b>

<blockquote>Removed <code>${count}</code> expired configuration(s).

System is now clean.</blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Removed expired configs',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📊 Status', switch_inline_query_current_chat: 'status' },
                                { text: '📈 Stats', switch_inline_query_current_chat: 'stats' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        // ========== STATS ==========
        if (query.toLowerCase() === 'stats') {
            let totalUsers = 0;
            let totalConfigs = 0;
            let expiredConfigs = 0;
            const now = Date.now();
            
            try {
                const data = await fsPromises.readFile(DATA_FILE, 'utf8');
                const users = JSON.parse(data);
                totalUsers = Object.keys(users).length;
                for (const userData of Object.values(users)) {
                    if (userData.configs) {
                        for (const config of userData.configs) {
                            if (config.expiryTime > now) {
                                totalConfigs++;
                            } else {
                                expiredConfigs++;
                            }
                        }
                    }
                }
            } catch (error) {}

            const memUsage = process.memoryUsage();
            const uptime = process.uptime();

            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'stats',
                    title: '📈 Detailed Stats',
                    input_message_content: {
                        message_text: 
`<b>📈 Detailed Statistics</b>

<blockquote><b>Users:</b>
<b>Total Users:</b> <code>${totalUsers}</code>
<b>Active Configs:</b> <code>${totalConfigs}</code>
<b>Expired Configs:</b> <code>${expiredConfigs}</code>

<b>System:</b>
<b>Memory:</b> <code>${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB</code>
<b>Uptime:</b> <code>${Math.floor(uptime / 60)} min</code>
<b>Platform:</b> <code>${process.platform}</code>
<b>Node:</b> <code>${process.version}</code>

<b>Settings:</b>
<b>Private Mode:</b> ${PRIVATE_MODE.enabled ? '🟢 On' : '🔴 Off'}
<b>Allowed Users:</b> <code>${PRIVATE_MODE.allowed_users.length}</code>
<b>Blocked Users:</b> <code>${PRIVATE_MODE.blocked_users.length}</code></blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Full system statistics',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📊 Status', switch_inline_query_current_chat: 'status' },
                                { text: '🧹 Clean', switch_inline_query_current_chat: 'clean' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        // ========== LIST USERS ==========
        if (query.toLowerCase() === 'users' || query.toLowerCase() === 'listusers' || query.toLowerCase().startsWith('users ') || query.toLowerCase().startsWith('listusers ')) {
            try {
                // First, read data file (this is fast)
                const data = await fsPromises.readFile(DATA_FILE, 'utf8');
                const users = JSON.parse(data);
                const userKeys = Object.keys(users);
                
                if (userKeys.length === 0) {
                    return ctx.answerInlineQuery([
                        {
                    type: 'article',
                    id: 'no_users',
                    title: '📭 No Users Found',
                    input_message_content: {
                        message_text: 
`<b>📭 No Users Found</b>

<blockquote>No users have used the bot yet.</blockquote>`,
                                parse_mode: 'HTML'
                            },
                            description: 'No users registered'
                        }
                    ]);
                }

                // ========== PAGINATION SETUP ==========
                const USERS_PER_PAGE = 10;
                const totalPages = Math.ceil(userKeys.length / USERS_PER_PAGE);
                
                // Get page from query (e.g., "users 2" -> page 1)
                let page = 0;
                
                // ✅ FIX: Better parsing for "users 1", "users 2", etc.
                const queryLower = query.toLowerCase();
                if (queryLower.startsWith('users ') || queryLower.startsWith('listusers ')) {
                    const parts = queryLower.split(' ');
                    if (parts.length > 1) {
                        const pageNum = parseInt(parts[1]);
                        if (!isNaN(pageNum) && pageNum >= 0) {
                            page = pageNum;
                            // Ensure page is within bounds
                            if (page >= totalPages) page = totalPages - 1;
                            if (page < 0) page = 0;
                        }
                    }
                }
                
                const startIndex = page * USERS_PER_PAGE;
                const endIndex = Math.min(startIndex + USERS_PER_PAGE, userKeys.length);
                const pageUsers = userKeys.slice(startIndex, endIndex);
                
                // ========== GET USER INFO FROM XRAY CONFIG (FASTER) ==========
                const userInfoMap = {};
                let xrayData = null;
                try {
                    xrayData = await readJsonSafe(XRAY_CONFIG, null);
                } catch (e) {}
                
                // Build a map of user IDs to names from Xray config
                if (xrayData && xrayData.inbounds) {
                    for (const inbound of xrayData.inbounds) {
                        if (inbound.settings && inbound.settings.clients) {
                            for (const client of inbound.settings.clients) {
                                if (client.email && client.email.includes('user_')) {
                                    const emailParts = client.email.split('_');
                                    if (emailParts.length >= 2) {
                                        const uid = emailParts[1];
                                        const name = emailParts.slice(2).join('_') || 'Unknown';
                                        if (!userInfoMap[uid]) {
                                            userInfoMap[uid] = { fullName: name, username: '' };
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Try to get usernames from Telegram (only for current page users, with timeout)
                for (const uid of pageUsers) {
                    if (!userInfoMap[uid]) {
                        try {
                            const user = await Promise.race([
                                ctx.telegram.getChat(parseInt(uid)),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
                            ]);
                            const firstName = user.first_name || 'Unknown';
                            const lastName = user.last_name || '';
                            const fullName = `${firstName} ${lastName}`.trim() || 'Unknown User';
                            const username = user.username ? `@${user.username}` : '';
                            
                            userInfoMap[uid] = {
                                fullName: fullName,
                                username: username
                            };
                        } catch (error) {
                            if (!userInfoMap[uid]) {
                                userInfoMap[uid] = {
                                    fullName: 'Unknown User',
                                    username: ''
                                };
                            }
                        }
                    }
                }
                
                // ========== BUILD USER LIST ==========
                let userList = `<b>📋 Registered Users (${userKeys.length})</b>\n`;
                userList += `<i>Page ${page + 1}/${totalPages}</i>\n\n`;
                
                let userCount = 0;
                for (const uid of pageUsers) {
                    const userData = users[uid];
                    const configs = userData.configs || [];
                    const active = configs.filter(c => c.expiryTime > Date.now());
                    
                    const info = userInfoMap[uid] || { fullName: 'Unknown User', username: '' };
                    const displayName = info.fullName;
                    const username = info.username;
                    
                    let userLine = `<code>${uid}</code> - ${displayName}`;
                    if (username) {
                        userLine += ` (${username})`;
                    }
                    userLine += ` VPNs: <b>${active.length}</b>`;
                    
                    userList += `${userLine}\n`;
                    userCount++;
                }
                
                userList += `\n<i>💡 Use <code>get &lt;user_id&gt;</code> to view configs</i>`;
                
                // ========== BUILD INLINE KEYBOARD ==========
                const inlineKeyboard = [];
                
                // Navigation row
                const navRow = [];
                if (totalPages > 1) {
                    if (page > 0) {
                        navRow.push({ 
                            text: '◀️ Previous', 
                            switch_inline_query_current_chat: `users ${page - 1}` 
                        });
                    }
                    
                    navRow.push({ 
                        text: `📄 ${page + 1}/${totalPages}`, 
                        switch_inline_query_current_chat: 'users' 
                    });
                    
                    if (page < totalPages - 1) {
                        navRow.push({ 
                            text: 'Next ▶️', 
                            switch_inline_query_current_chat: `users ${page + 1}` 
                        });
                    }
                }
                if (navRow.length > 0) {
                    inlineKeyboard.push(navRow);
                }
                
                // Quick navigation for many pages
                if (totalPages > 5) {
                    const quickNav = [];
                    if (page > 2) quickNav.push({ text: '⏮️ First', switch_inline_query_current_chat: 'users 0' });
                    if (page < totalPages - 3) quickNav.push({ text: '⏭️ Last', switch_inline_query_current_chat: `users ${totalPages - 1}` });
                    if (quickNav.length > 0) inlineKeyboard.push(quickNav);
                }
                
                // Action buttons
                inlineKeyboard.push([
                    { text: '👤 Get User', switch_inline_query_current_chat: 'get ' },
                    { text: '👤 Create User', switch_inline_query_current_chat: 'create ' }
                ]);
                inlineKeyboard.push([
                    { text: '📋 List Configs', switch_inline_query_current_chat: 'list' },
                    { text: '📊 Status', switch_inline_query_current_chat: 'status' }
                ]);
                inlineKeyboard.push([
                    { text: '📈 Stats', switch_inline_query_current_chat: 'stats' },
                    { text: '🧹 Clean', switch_inline_query_current_chat: 'clean' }
                ]);
                inlineKeyboard.push([
                    { text: '🔙 Back to Menu', switch_inline_query_current_chat: 'help' }
                ]);

                // ========== ANSWER INLINE QUERY ==========
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: `user_list_page_${page}`,
                        title: `👥 Users (${userKeys.length}) - Page ${page + 1}/${totalPages}`,
                        input_message_content: {
                            message_text: userList,
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        },
                        description: `Showing ${startIndex + 1}-${Math.min(endIndex, userKeys.length)} of ${userKeys.length} users`,
                        reply_markup: {
                            inline_keyboard: inlineKeyboard
                        }
                    }
                ]);
                
            } catch (error) {
                console.error('Error in LIST USERS:', error);
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'error',
                        title: '❌ Error',
                        input_message_content: {
                            message_text: 
        `<b>❌ Error loading users</b>

        <blockquote>${error.message || 'Unknown error'}</blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Error occurred'
                    }
                ]);
            }
        }
        
        // ========== CHECK IF WE HAVE TIME VALUES ==========
        if (days === 0 && hours === 0 && minutes === 0) {
            const numMatch = query.match(/^(\d+)$/);
            if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num <= 24) {
                    hours = num;
                } else {
                    days = Math.floor(num / 24);
                    hours = num % 24;
                }
            } else {
                return ctx.answerInlineQuery([
                    {
                        type: 'article',
                        id: 'error',
                        title: '❌ Invalid Format',
                        input_message_content: {
                            message_text: 
`<b>❌ Invalid Format!</b>

<blockquote><b>✅ Supported Formats:</b>
<code>1d</code> or <code>d 1</code> - 1 day
<code>2h</code> or <code>h 2</code> - 2 hours
<code>30m</code> or <code>m 30</code> - 30 minutes
<code>1d2h30m</code> - 1d 2h 30m
<code>24</code> - 24 hours
<code>168</code> - 168 hours (7 days)

<b>⚙️ Commands:</b>
<code>help</code> - Show all commands
<code>list</code> - List all active configs
<code>users</code> - List all users
<code>status</code> - System status
<code>start</code> - Start Xray
<code>stop</code> - Stop Xray
<code>restart</code> - Restart Xray
<code>stats</code> - Detailed stats
<code>clean</code> - Clean expired
<code>info</code> - Bot information</blockquote>`,
                            parse_mode: 'HTML'
                        },
                        description: 'Invalid command format',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '❓ Help', switch_inline_query_current_chat: 'help' },
                                    { text: '📋 List', switch_inline_query_current_chat: 'list' }
                                ],
                                [
                                    { text: 'ℹ️ Info', switch_inline_query_current_chat: 'info' }
                                ]
                            ]
                        }
                    }
                ]);
            }
        }

        // ========== CHECK DURATION LIMIT ==========
        const totalHours = days * 24 + hours + (minutes / 60);
        const maxDuration = CONFIG.user_limits?.max_duration_hours || 24;
        
        if (totalHours > maxDuration * 30 && !isOwner) {
            return ctx.answerInlineQuery([
                {
                    type: 'article',
                    id: 'error',
                    title: '❌ Duration Too Long',
                    input_message_content: {
                        message_text: 
`<b>❌ Duration Too Long!</b>

<blockquote>Maximum duration is ${maxDuration} hours.
You requested: ${Math.round(totalHours)} hours

Please use a shorter duration.</blockquote>`,
                        parse_mode: 'HTML'
                    },
                    description: 'Duration exceeds limit',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '⏱ 1 Day', switch_inline_query_current_chat: '1d' },
                                { text: '⏱ 12 Hours', switch_inline_query_current_chat: '12h' }
                            ],
                            [
                                { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                            ]
                        ]
                    }
                }
            ]);
        }

        // ========== GENERATE CONFIG ==========
        const now = new Date();
        const expiryDate = new Date(now.getTime() + 
            days * 24 * 60 * 60 * 1000 + 
            hours * 60 * 60 * 1000 + 
            minutes * 60 * 1000
        );

        const totalMinutes = days * 24 * 60 + hours * 60 + minutes;
        const durationHours = Math.ceil(totalMinutes / 60);
        
        const config = await generateVPNConfig(userId, durationHours);
        await saveVPNConfig(userId, config);

        let timeStr = '';
        if (days > 0) timeStr += `${days}d `;
        if (hours > 0) timeStr += `${hours}h `;
        if (minutes > 0) timeStr += `${minutes}m `;
        timeStr = timeStr.trim() || '0m';

        const progressBar = '🟩'.repeat(10);

        const result = {
            type: 'article',
            id: config.id,
            title: `🔑 VLESS Config (${timeStr})`,
            description: `Expires: ${expiryDate.toLocaleString()}`,
            input_message_content: {
                message_text: 
`<b>🔐 VLESS VPN Configuration</b>

<blockquote><b>ID:</b> <code>${config.id}</code>
<b>Status:</b> ✅ Generated successfully
<b>Expires:</b> 🕐 ${expiryDate.toLocaleString()}
<b>Remaining:</b> ${timeStr}
<b>┃${progressBar}┃ 100%</b></blockquote>

<code>${config.config.vless}</code>

<b>📱 How to use:</b>
1. Copy the URL above
2. Open your V2RayNG/Nekoha/Other client
3. Import the configuration
4. Connect and enjoy! 🚀`,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            },
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📋 Copy Link', switch_inline_query_current_chat: `copy ${config.id}` },
                        { text: '📱 QR Code', switch_inline_query_current_chat: `qr ${config.id}` }
                    ],
                    [
                        { text: '🔄 Generate New', switch_inline_query_current_chat: '' },
                        { text: '📋 List Configs', switch_inline_query_current_chat: 'list' }
                    ],
                    [
                        { text: '🔙 Back to Help', switch_inline_query_current_chat: 'help' }
                    ]
                ]
            }
        };

        ctx.answerInlineQuery([result], {
            cache_time: 0,
            is_personal: true
        });
        
    } catch (error) {
        console.error('Inline query error:', error);
        ctx.answerInlineQuery([
            {
                type: 'article',
                id: 'error',
                title: '❌ Error',
                input_message_content: {
                    message_text: `<b>❌ An error occurred</b>\n\n<blockquote>${error.message || 'Please try again later.'}</blockquote>`,
                    parse_mode: 'HTML'
                },
                description: 'Error generating config'
            }
        ]);
    }
});

// ==================== SWITCH PM HANDLER ====================
// bot.on('callback_query', async (ctx) => {
//     try {
//         const data = ctx.callbackQuery.data;
        
//         if (data.startsWith('copy_')) {
//             return;
//         }
        
//         if (data.startsWith('qr_')) {
//             return;
//         }
        
//         if (data.startsWith('delete_confirm_')) {
//             return;
//         }
        
//     } catch (error) {
//         console.error('Callback query error:', error);
//     }
// }, 1);


bot.on('callback_query', async (ctx, next) => {
    try {
        const data = ctx.callbackQuery.data;
        
        // Special handlers for specific actions
        if (data.startsWith('copy_') || data.startsWith('qr_') || data.startsWith('delete_confirm_')) {
            // Handle these specific actions here or let them pass through
            return next(); // Let other handlers process them
        }
        
        // For all other callback queries, let the action handlers process them
        return next();
        
    } catch (error) {
        console.error('Callback query error:', error);
        return next();
    }
});



// ==================== INLINE MODE HELP COMMAND ====================
bot.command('inlinehelp', async (ctx) => {
    const userId = ctx.from.id.toString();
    const isOwner = userId === OWNER_ID;
    
    if (!isOwner) {
        return ctx.reply('⛔ Access Denied. Only admin can use this feature.');
    }
    
    await ctx.replyWithHTML(`
<b>📖 Inline Mode Help</b>

━━━━━━━━━━━━━━━━━━━━━━
<blockquote>You can use the bot in inline mode by typing:
<code>@${ctx.botInfo.username} &lt;command&gt;</code></blockquote>

<blockquote><b>⚡ Quick VPN:</b>
<code>1h</code> <code>2h</code> <code>3h</code> <code>6h</code>
<code>12h</code> <code>24h</code> <code>1d</code> <code>7d</code></blockquote>

<blockquote><b>📋 Manage Configs:</b>
<code>list</code> - View your configs
<code>copy {id}</code> - Copy VPN link
<code>qr {id}</code> - Get QR code
<code>delete {id}</code> - Delete config</blockquote>

<blockquote><b>👤 User Management:</b>
<code>get 123456789</code> - Get configs for a user
<code>create 123456789 1d</code> - Create config for a user</blockquote>

<blockquote><b>⚙️ Core Commands:</b>
<code>start</code> - Start Xray
<code>stop</code> - Stop Xray
<code>restart</code> - Restart Xray
<code>status</code> - System status
<code>users</code> - List all users
<code>stats</code> - Detailed stats
<code>clean</code> - Clean expired
<code>info</code> - Bot information</blockquote>

━━━━━━━━━━━━━━━━━━━━━━
<b>💡 Click "Inline Mode Help" button below to open inline mode!</b>
    `);
});



// ==================== INLINE MODE STATUS COMMAND ====================
bot.command('inlinestatus', async (ctx) => {
    const userId = ctx.from.id.toString();
    const isOwner = userId === OWNER_ID;
    
    if (!isOwner) {
        return ctx.reply('⛔ Access Denied. Only admin can use this feature.');
    }
    
    const activeConfigs = await getActiveConfigs(userId);
    
    let text = `
<b>📊 Inline Mode Status</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>Status:</b> ${PRIVATE_MODE.enabled ? '🟢 Private Mode On' : '🟢 Public Mode'}
<b>Your Active Configs:</b> <code>${activeConfigs.length}</code>
<b>Bot Username:</b> <code>@${ctx.botInfo.username}</code>
━━━━━━━━━━━━━━━━━━━━━━

<b>⚡ Quick Commands:</b>
<code>@${ctx.botInfo.username} 1h</code> - 1 Hour VPN
<code>@${ctx.botInfo.username} 12h</code> - 12 Hour VPN
<code>@${ctx.botInfo.username} 1d</code> - 1 Day VPN
<code>@${ctx.botInfo.username} 7d</code> - 7 Day VPN

<b>📋 Management:</b>
<code>@${ctx.botInfo.username} list</code> - View configs
<code>@${ctx.botInfo.username} copy {id}</code> - Copy config
<code>@${ctx.botInfo.username} qr {id}</code> - Get QR code
<code>@${ctx.botInfo.username} delete {id}</code> - Delete config

<b>👤 User Management:</b>
<code>@${ctx.botInfo.username} get {user_id}</code> - Get user configs
<code>@${ctx.botInfo.username} create {user_id} 1d</code> - Create for user

<b>⚙️ Core:</b>
<code>@${ctx.botInfo.username} status</code> - System status
<code>@${ctx.botInfo.username} stats</code> - Detailed stats
<code>@${ctx.botInfo.username} clean</code> - Clean expired
<code>@${ctx.botInfo.username} users</code> - List all users
<code>@${ctx.botInfo.username} info</code> - Bot info

<b>💡 Type <code>@${ctx.botInfo.username}</code> followed by a command in any chat!</b>
    `;
    
    await ctx.replyWithHTML(text);
});










    // ========== HELP COMMAND ==========
    bot.help(async (ctx) => {
        const userId = ctx.from.id;
        const isOwner = userId.toString() === OWNER_ID;
        
        let helpText = `
<b>📚 Help & Commands</b>

<blockquote>━━━━━━━━━━━━━━━━━━━━━━
<b>🔰 /start</b> - Start the bot
<b>🔐 Create VPN</b> - Create a new VPN connection
<b>📋 My Configs</b> - View your VPN configs
<b>🗑 Delete Config</b> - Delete a VPN config
<b>🙏 Study Tips</b> - Get daily study motivation
━━━━━━━━━━━━━━━━━━━━━━</blockquote>

<b>📌 Private Mode:</b> ${PRIVATE_MODE.enabled ? '🟢 Enabled' : '🔴 Disabled'}
<b>📌 Groups:</b> ${GROUP_SETTINGS.enabled ? '🟢 Enabled' : '🔴 Disabled'}
<b>📌 Channels:</b> ${CHANNEL_SETTINGS.enabled ? '🟢 Enabled' : '🔴 Disabled'}
        `;
        
        if (isOwner) {
            helpText += `
━━━━━━━━━━━━━━━━━━━━━━
<b>⚙️ Admin Commands:</b>
<code>/enable {chat_id}</code> - Enable a chat
<code>/disable {chat_id}</code> - Disable a chat
<code>/pending</code> - View pending approvals
<code>/allow {user_id}</code> - Allow a private user
<code>/block {user_id}</code> - Block a private user
<code>/status</code> - View bot status
            `;
        }
        
        await sendWithImage(ctx, helpText, getMainKeyboard(userId));
    });

    // ========== ADMIN COMMANDS ==========
    bot.command('enable', async (ctx) => {
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('Usage: /enable {chat_id}');
            return;
        }
        
        const chatId = args[1];
        if (!CHAT_CONTROLS.enabled_chats.includes(chatId)) {
            CHAT_CONTROLS.enabled_chats.push(chatId);
        }
        CHAT_CONTROLS.disabled_chats = CHAT_CONTROLS.disabled_chats.filter(id => id !== chatId);
        CHAT_CONTROLS.pending_approvals = CHAT_CONTROLS.pending_approvals.filter(id => id !== chatId);
        
        await updateDbConfig();
        await ctx.reply(`✅ Chat ${chatId} has been enabled.`);
        
        // Try to notify the chat
        try {
            await ctx.telegram.sendMessage(chatId, `
<b>✅ Chat Enabled</b>

<i>This chat has been enabled by the administrator.</i>

<b>🎉 You can now use the bot!</b>
            `, { parse_mode: 'HTML' });
        } catch (error) {
            console.log('Could not notify chat:', error.message);
        }
    });

    bot.command('disable', async (ctx) => {
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('Usage: /disable {chat_id}');
            return;
        }
        
        const chatId = args[1];
        if (!CHAT_CONTROLS.disabled_chats.includes(chatId)) {
            CHAT_CONTROLS.disabled_chats.push(chatId);
        }
        CHAT_CONTROLS.enabled_chats = CHAT_CONTROLS.enabled_chats.filter(id => id !== chatId);
        CHAT_CONTROLS.pending_approvals = CHAT_CONTROLS.pending_approvals.filter(id => id !== chatId);
        
        await updateDbConfig();
        await ctx.reply(`✅ Chat ${chatId} has been disabled.`);
        
        // Try to notify the chat
        try {
            await ctx.telegram.sendMessage(chatId, `
<b>⛔ Chat Disabled</b>

<i>This chat has been disabled by the administrator.</i>
            `, { parse_mode: 'HTML' });
        } catch (error) {
            console.log('Could not notify chat:', error.message);
        }
    });

    bot.command('pending', async (ctx) => {
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (CHAT_CONTROLS.pending_approvals.length === 0) {
            await ctx.reply('📋 No pending approvals.');
            return;
        }
        
        let text = '📋 <b>Pending Approvals</b>\n\n';
        for (const chatId of CHAT_CONTROLS.pending_approvals) {
            text += `• <code>${escapeHtml(chatId)}</code>\n`;
        }
        text += '\nUse <code>/enable {chat_id}</code> or <code>/disable {chat_id}</code>';
        
        await ctx.replyWithHTML(text);
    });

    bot.command('allow', async (ctx) => {
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('Usage: /allow {user_id}');
            return;
        }
        
        const userIdToAllow = args[1];
        if (!PRIVATE_MODE.allowed_users.includes(userIdToAllow)) {
            PRIVATE_MODE.allowed_users.push(userIdToAllow);
        }
        PRIVATE_MODE.blocked_users = PRIVATE_MODE.blocked_users.filter(id => id !== userIdToAllow);
        
        await updateDbConfig();
        await ctx.reply(`✅ User ${userIdToAllow} has been allowed.`);
    });

    bot.command('block', async (ctx) => {
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('Usage: /block {user_id}');
            return;
        }
        
        const userIdToBlock = args[1];
        if (!PRIVATE_MODE.blocked_users.includes(userIdToBlock)) {
            PRIVATE_MODE.blocked_users.push(userIdToBlock);
        }
        PRIVATE_MODE.allowed_users = PRIVATE_MODE.allowed_users.filter(id => id !== userIdToBlock);
        
        await updateDbConfig();
        await ctx.reply(`✅ User ${userIdToBlock} has been blocked.`);
    });

    bot.command('status', async (ctx) => {
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const xrayStatus = await getXrayStatus();
        let totalUsers = 0;
        let totalConfigs = 0;
        
        try {
            const data = await fsPromises.readFile(DATA_FILE, 'utf8');
            const users = JSON.parse(data);
            totalUsers = Object.keys(users).length;
            for (const userData of Object.values(users)) {
                if (userData.configs) {
                    totalConfigs += userData.configs.filter(c => c.expiryTime > Date.now()).length;
                }
            }
        } catch (error) {}
        
        const statusText = `
<b>📊 Bot Status</b>

<blockquote>━━━━━━━━━━━━━━━━━━━━━━
<b>Xray:</b> ${xrayStatus.running ? '🟢 Running' : '🔴 Stopped'}
<b>PID:</b> <code>${xrayStatus.pid || 'N/A'}</code>
<b>Restarts:</b> <code>${xrayStatus.restarts}</code>
━━━━━━━━━━━━━━━━━━━━━━
<b>Total Users:</b> <code>${totalUsers}</code>
<b>Active Configs:</b> <code>${totalConfigs}</code>
━━━━━━━━━━━━━━━━━━━━━━
<b>Private Mode:</b> ${PRIVATE_MODE.enabled ? '🟢 On' : '🔴 Off'}
<b>Allowed Users:</b> <code>${PRIVATE_MODE.allowed_users.length}</code>
<b>Blocked Users:</b> <code>${PRIVATE_MODE.blocked_users.length}</code>
━━━━━━━━━━━━━━━━━━━━━━
<b>Groups:</b> ${GROUP_SETTINGS.enabled ? '🟢 On' : '🔴 Off'}
<b>Allowed Groups:</b> <code>${GROUP_SETTINGS.allowed_groups.length}</code>
<b>Blocked Groups:</b> <code>${GROUP_SETTINGS.blocked_groups.length}</code>
━━━━━━━━━━━━━━━━━━━━━━
<b>Channels:</b> ${CHANNEL_SETTINGS.enabled ? '🟢 On' : '🔴 Off'}
<b>Allowed Channels:</b> <code>${CHANNEL_SETTINGS.allowed_channels.length}</code>
<b>Blocked Channels:</b> <code>${CHANNEL_SETTINGS.blocked_channels.length}</code>
━━━━━━━━━━━━━━━━━━━━━━
<b>Enabled Chats:</b> <code>${CHAT_CONTROLS.enabled_chats.length}</code>
<b>Disabled Chats:</b> <code>${CHAT_CONTROLS.disabled_chats.length}</code>
<b>Pending Approvals:</b> <code>${CHAT_CONTROLS.pending_approvals.length}</code>
━━━━━━━━━━━━━━━━━━━━━━</blockquote>
        `;
        
        await ctx.replyWithHTML(statusText);
    });

    // ========== CREATE VPN ==========
    bot.action('create_vpn', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const isOwner = userId.toString() === OWNER_ID;
        
        if (!isOwner) {
            const activeConfigs = await getActiveConfigs(userId);
            const maxConfigs = CONFIG.user_limits?.max_configs_per_user || 5;
            if (activeConfigs.length >= maxConfigs) {
                await ctx.answerCbQuery(`❌ Maximum ${maxConfigs} VPN connections allowed!`);
                return;
            }
        }
        
        const text = `
<b>⏱ Select Duration</b>

VPN එක සැකසීමට අවශ්‍ය කාලය තොරන්න.${isOwner ? '\n⚡ <b>Admin Options:</b>\nYou have custom duration options available!' : ''}

📌 Available කාල පරාසයන් පහත පරිදි වේ.
        `;
        
        await editWithImage(ctx, text, getDurationKeyboard(isOwner));
    });

    // ========== DURATION HANDLERS ==========
    bot.action(/^duration_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery('🔄 Creating your VPN...');
        const duration = parseInt(ctx.match[1]);
        const userId = ctx.from.id;
        const user = ctx.from;
        const isOwner = userId.toString() === OWNER_ID;
        
        if (!isOwner) {
            const activeConfigs = await getActiveConfigs(userId);
            const maxConfigs = CONFIG.user_limits?.max_configs_per_user || 5;
            if (activeConfigs.length >= maxConfigs) {
                await ctx.answerCbQuery(`❌ VPN limit reached!`);
                return;
            }
        }
        
        // Show loading - REDUCED ARTIFICIAL DELAYS
        const loadingText1 = `
<b>⏳ Creating Your VPN...</b>

<i>Generating secure configuration</i>

<b>📊 Progress:</b>
${createLoadingBar(50, '🟩')}

<i>Please wait...</i>
        `;
        await editTextSafe(ctx, loadingText1);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const loadingText2 = `
<b>⏳ Creating Your VPN...</b>

<i>Generating secure configuration</i>

<b>📊 Progress:</b>
${createLoadingBar(100, '🟩')}

<b>✅ Finalizing configuration...</b>
        `;
        await editTextSafe(ctx, loadingText2);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
            const config = await generateVPNConfig(userId, duration);
            
            let saved = false;
            let retries = 3;
            let lastError = null;
            
            while (!saved && retries > 0) {
                try {
                    saved = await saveVPNConfig(userId, config);
                    if (!saved) throw new Error('Failed to save config');
                } catch (error) {
                    lastError = error;
                    retries--;
                    console.log(`Save retry ${3 - retries}: ${error.message}`);
                    
                    try {
                        const backupPath = path.join(CONFIGS_DIR, `backup_${config.id}.json`);
                        await writeJsonAtomic(backupPath, config);
                        console.log('Config saved to backup file');
                    } catch (backupError) {
                        console.error('Failed to save backup:', backupError);
                    }
                    
                    if (retries > 0) await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            if (!saved) {
                throw new Error(`Failed to save config: ${lastError?.message || 'Unknown error'}`);
            }
            
            const messageData = formatVPNMessage(config, user);
            await editWithImage(ctx, messageData.text, messageData.reply_markup.inline_keyboard);
            
        } catch (error) {
            console.error('VPN Creation Error:', error);
            const errorText = `
<blockquote><b>📛 මොකක් හරි system එකේ අව්ලක් වගේ.</b></blockquote>

━━━━━━━━━━━━━━━━━━━━━━
<i>💡 නැවත උත්සහ කරලත් Fail උවහොත් ඇඩ්මින් සම්බන්ද කරගන්න.</i>
<i>අපේ බොසා :</i> <a href="https://t.me/mataberiyo">Mayantha</a>
━━━━━━━━━━━━━━━━━━━━━━
            `;
            await editWithImage(ctx, errorText, [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]);
        }
    });

    // ========== ADMIN CUSTOM DURATIONS ==========
    bot.action('admin_custom_minutes', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'custom_minutes';
        
        const text = `
<b>⚡ Custom Minutes</b>

<blockquote><i>VPN එක සඳහා අවශ්‍ය මිනිත්තු ගණන ඇතුළත් කරන්න:</i>
<code>උදාහරණය: 30, 45, 60, 90, 120</code>
<b>⚠️ සටහන:</b> මිනිත්තු ගණන පැය වලට පරිවර්තනය කරනු ලැබේ.</blockquote>

<i>🔰 කරුණාකර මිනිත්තු ගණන ටයිප් කරන්න.</i>
        `;
        await editWithImage(ctx, text, [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]);
    });

    bot.action('admin_custom_hours', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'custom_hours';
        
        const text = `
<b>⚡ Custom Hours</b>

<blockquote><i>VPN එක සඳහා අවශ්‍ය පැය ගණන ඇතුළත් කරන්න:</i>
<code>උදාහරණය: 1, 2, 4, 6, 8, 10, 12, 24, 48, 72</code>
<b>⚠️ සටහන:</b> පැය ගණන ඍජුවම භාවිතා වේ.</blockquote>

<i>🔰 කරුණාකර පැය ගණන ටයිප් කරන්න.</i>
        `;
        await editWithImage(ctx, text, [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]);
    });

    bot.action('admin_custom_days', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'custom_days';
        
        const text = `
<b>⚡ Custom Days</b>

<blockquote><i>VPN එක සඳහා අවශ්‍ය දින ගණන ඇතුළත් කරන්න:</i>
<code>උදාහරණය: 1, 2, 3, 5, 7, 10, 14, 30</code>
<b>⚠️ සටහන:</b> දින ගණන පැය වලට පරිවර්තනය කරනු ලැබේ (1 day = 24 hours).</blockquote>

<i>🔰 කරුණාකර දින ගණන ටයිප් කරන්න.</i>
        `;
        await editWithImage(ctx, text, [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]);
    });
    

    // ========== TEXT HANDLER FOR CUSTOM DURATIONS ==========
    bot.on('text', async (ctx) => {
        try {
            const text = ctx.message.text;
            const userId = ctx.from.id;
            const user = ctx.from;
            
            if (userId.toString() !== OWNER_ID) return;
            
            const num = parseInt(text);
            if (isNaN(num) || num <= 0) return;

            // Determine duration type based on pending action
            let duration;
            let action = ownerPendingAction;
            ownerPendingAction = null;
            
            if (action === 'custom_minutes') {
                duration = Math.ceil(num / 60);
                if (duration < 1) duration = 1;
            } else if (action === 'custom_hours') {
                duration = num;
            } else if (action === 'custom_days') {
                duration = num * 24;
            } else {
                // Auto-detect
                if (num <= 60) {
                    duration = Math.ceil(num / 60);
                    if (duration < 1) duration = 1;
                } else if (num <= 168) {
                    duration = num;
                } else {
                    duration = num * 24;
                }
            }
            
            const config = await generateVPNConfig(userId, duration);
            await saveVPNConfig(userId, config);
            
            const messageData = formatVPNMessage(config, user);
            await sendWithImage(ctx, messageData.text, messageData.reply_markup.inline_keyboard);
            
        } catch (error) {
            console.error('Custom duration error:', error);
        }
    });

    // // ========== LIST CONFIGS ==========
    // bot.action('list_configs', async (ctx) => {
    //     await ctx.answerCbQuery();
    //     const userId = ctx.from.id;
    //     const configs = await getActiveConfigs(userId);
        
    //     const messageData = formatConfigList(configs, userId);
    //     const keyboard = configs.length > 0 ? getConfigListKeyboard(configs) : [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]];
        
    //     await editWithImage(ctx, messageData.text, keyboard);
    // });

    // ========== LIST CONFIGS ==========
    bot.action('list_configs', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const configs = await getActiveConfigs(userId);
        
        // Reset pagination for this user
        if (configPagination[userId]) {
            configPagination[userId].page = 0;
        }
        
        const result = formatConfigList(configs, userId, 0);
        const keyboard = result.keyboard || [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]];
        
        await editWithImage(ctx, result.text, keyboard);
    });

    // ========== CONFIG PAGE NAVIGATION ==========
    bot.action(/^config_page_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const page = parseInt(ctx.match[1]);
        
        // Get cached configs for this user
        let configs = [];
        if (configPagination[userId] && configPagination[userId].configs) {
            configs = configPagination[userId].configs;
        } else {
            // If not cached, fetch again
            configs = await getActiveConfigs(userId);
        }
        
        const result = formatConfigList(configs, userId, page);
        const keyboard = result.keyboard || [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]];
        
        await editWithImage(ctx, result.text, keyboard);
    });

    // ========== VIEW CONFIG ==========
    bot.action(/^view_config_(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const configId = ctx.match[1];
        const userId = ctx.from.id;
        const user = ctx.from;
        
        const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
        try {
            const data = await fsPromises.readFile(configPath, 'utf8');
            const config = JSON.parse(data);
            
            if (config.userId !== userId && userId.toString() !== OWNER_ID) {
                await ctx.answerCbQuery('❌ Unauthorized!');
                return;
            }
            
            const messageData = formatConfigView(config, user);
            await editWithImage(ctx, messageData.text, messageData.reply_markup.inline_keyboard);
        } catch (error) {
            const errorText = `
<b>❌ Config Not Found</b>

<i>The requested configuration could not be found.</i>
            `;
            await editWithImage(ctx, errorText, [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]);
        }
    });

    // ========== COPY LINK ==========
    bot.action(/^copy_(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery('📋 Link copied!');
        const configId = ctx.match[1];
        const userId = ctx.from.id;
        
        const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
        try {
            const data = await fsPromises.readFile(configPath, 'utf8');
            const config = JSON.parse(data);
            
            if (config.userId !== userId && userId.toString() !== OWNER_ID) {
                await ctx.answerCbQuery('❌ Unauthorized!');
                return;
            }
            
            const copyText = `
<b>📋 Copy this link:</b>

<blockquote><code>${config.config.vless}</code></blockquote>

<i>Tap and hold to copy the link</i>
            `;
            
            const buttons = [
                [{ text: '🔙 Back to Config', callback_data: `view_config_${configId}` }],
                [{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]
            ];
            
            await sendWithImage(ctx, copyText, buttons);
            
        } catch (error) {
            await sendWithImage(ctx, `<b>❌ Config Not Found</b>`);
        }
    });

    // ========== QR CODE ==========
    bot.action(/^qr_(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery('📱 Generating QR Code...');
        const configId = ctx.match[1];
        const userId = ctx.from.id;
        
        const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
        try {
            const data = await fsPromises.readFile(configPath, 'utf8');
            const config = JSON.parse(data);
            
            if (config.userId !== userId && userId.toString() !== OWNER_ID) {
                await ctx.answerCbQuery('❌ Unauthorized!');
                return;
            }
            
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(config.config.vless)}`;
            
            const qrText = `
<b>📱 VPN QR Code</b>

<i>✨ QR Code එක Scan කර භාවිතා කරන්න</i>

<blockquote>🔐 මෙම QR Code එක ඔබගේ දුරකථනයෙන් හෝ ඔබ භාවිතා කරන අදාල device එකකින් පමණක් Scan කර සම්බන්ධ වන්න.\n
⚠️ ආරක්ෂාව සඳහා මෙම QR Code එක වෙනත් පුද්ගලයින් සමඟ Share කිරීමෙන් වළකින්න.\n
🛡️ ඔබගේ VPN Connection එක ආරක්ෂිතව තබාගන්න.</blockquote>

<i>The QR code contains your full VPN configuration.</i>
            `;
            
            const buttons = [
                [{ text: '🔙 Back to Config', callback_data: `view_config_${configId}` }],
                [{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]
            ];
            
            await ctx.replyWithPhoto(qrUrl, {
                caption: qrText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
            
        } catch (error) {
            await sendWithImage(ctx, `
<b>❌ Failed to generate QR Code</b>

<i>Error:</i> <code>${escapeHtml(error.message)}</code>
            `);
        }
    });

    // ========== DELETE CONFIG ==========
    bot.action('delete_config', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const configs = await getActiveConfigs(userId);
        
        if (configs.length === 0) {
            const text = `
<b>❌ No Configs to Delete</b>

<i>You don't have any active configurations.</i>
            `;
            await editWithImage(ctx, text, [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]);
            return;
        }
        
        const text = `
🗑 <b>VPN Config මකා දැමීම</b>

📋 මකා දැමීමට අවශ්‍ය Configuration එක තෝරන්න:

⚠️ <b>අවවාදයයි:</b> මෙම ක්‍රියාව සිදු කළ පසු නැවත වෙනස් කළ නොහැක.
`;

        await editWithImage(ctx, text, getDeleteKeyboard(configs));
    });

    bot.action(/^delete_confirm_(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery('🗑 Config එක මකා දමමින්...');

        const configId = ctx.match[1];
        const userId = ctx.from.id;

        // USING editTextSafe INSTEAD OF replyWithHTML
        const loadingText = `
🗑 <b>VPN Config මකා දමමින්...</b>

⏳ කරුණාකර මොහොතක් රැඳී සිටින්න...

${createLoadingBar(50, '🟩')}
        `;
        await editTextSafe(ctx, loadingText);
        
        const success = await deleteUserConfig(userId, configId);
        
        if (success) {
            const text = `
✅ <b>Config Deleted</b>

<blockquote><i>ඔබගේ අදාල VPN ගොනුව සාර්ථකව අපගේ දත්ත සමුදායෙන් ඉවත් කර ඇත.</i></blockquote>

<b>🔒 Your VPN is now disconnected.</b>

${createLoadingBar(100, '🟩')}
            `;
            
            const buttons = [
                [{ text: '📋 My Configs', callback_data: 'list_configs' }],
                [{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]
            ];
            
            await editWithImage(ctx, text, buttons);
        } else {
            const text = `
<b>❌ Failed to Delete Config</b>

<i>An error occurred while deleting the configuration.</i>

<b>💡 Please try again later.</b>
            `;
            await editWithImage(ctx, text, [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]]);
        }
    });

    // ========== BACK TO MENU ==========
    bot.action('back_to_menu', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        const text = `
📋 <b>Main Menu</b>
 `;
        await editWithImage(ctx, text, getMainKeyboard(userId));
    });

    // ========== ADMIN PANEL ==========
    bot.action('admin_panel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        
        if (userId.toString() !== OWNER_ID) {
            await ctx.answerCbQuery('❌ Unauthorized!');
            return;
        }
        
        const text = `
⚙️ <b>පරිපාලක පැනලය (Admin Panel)</b>

━━━━━━━━━━━━━━━━━━━━━━
<i>🛠️ පද්ධති කළමනාකරණ විකල්ප</i>
━━━━━━━━━━━━━━━━━━━━━━

<blockquote>
🔄 <b>Restart Xray</b> - VPN සේවාව නැවත ආරම්භ කරන්න
⏹ <b>Stop Xray</b> - VPN සේවාව නවත්වන්න
▶️ <b>Start Xray</b> - VPN සේවාව ආරම්භ කරන්න
📊 <b>Xray Status</b> - සේවා තත්ත්වය පරීක්ෂා කරන්න
🧹 <b>Clean Expired</b> - කල් ඉකුත් වූ Config ඉවත් කරන්න
📈 <b>System Stats</b> - Server තොරතුරු බලන්න
🔒 <b>Private Mode</b> - Private User කළමනාකරණය කරන්න
👥 <b>Group Settings</b> - Group ප්‍රවේශය කළමනාකරණය කරන්න
📢 <b>Channel Settings</b> - Channel ප්‍රවේශය කළමනාකරණය කරන්න
👤 <b>User Management</b> - User ගිණුම් කළමනාකරණය කරන්න
</blockquote>

━━━━━━━━━━━━━━━━━━━━━━

<code>♻️ අවශ්‍ය ක්‍රියාව තෝරා පද්ධතිය කළමනාකරණය කරන්න.</code>
        `;
        await editWithImage(ctx, text, getAdminKeyboard());
    });

    // ========== ADMIN: PRIVATE MODE ==========
    bot.action('admin_private_mode', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const text = `
🔒 <b>Private Mode Settings</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>Status:</b> ${PRIVATE_MODE.enabled ? '🟢 Enabled' : '🔴 Disabled'}
<b>Allowed Users:</b> <code>${PRIVATE_MODE.allowed_users.length}</code>
<b>Blocked Users:</b> <code>${PRIVATE_MODE.blocked_users.length}</code>
━━━━━━━━━━━━━━━━━━━━━━

<blockquote><b>📌 මෙය ක්‍රියා කරන ආකාරය:</b>
• Enabled කළ විට, අවසර ලබා දී ඇති Users පමණක් Bot එක භාවිතා කළ හැක.
• Block කර ඇති Users හට සෑම විටම ප්‍රවේශය ප්‍රතික්ෂේප වේ.
• Allowed List එක හිස් නම්, සියලුම Users සඳහා ප්‍රවේශය ලබා දේ.
• Owner හට Settings කුමක් වුවත් සෑම විටම ප්‍රවේශය හිමි වේ.</blockquote>

<i>Use the buttons below to manage private mode.</i>
        `;
        await editWithImage(ctx, text, getPrivateModeKeyboard());
    });

    bot.action('admin_toggle_private', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        PRIVATE_MODE.enabled = !PRIVATE_MODE.enabled;
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Private mode ${PRIVATE_MODE.enabled ? 'enabled' : 'disabled'}!`);
        
        const text = `
🔒 <b>Private Mode ${PRIVATE_MODE.enabled ? 'Enabled' : 'Disabled'}</b>

<i>Private mode has been ${PRIVATE_MODE.enabled ? 'enabled' : 'disabled'}.</i>

${PRIVATE_MODE.enabled ? '⚠️ Only allowed users can use the bot.' : '✅ All users can use the bot.'}
        `;
        await editWithImage(ctx, text, getPrivateModeKeyboard());
    });

    // ========== ADMIN: GROUP SETTINGS ==========
    bot.action('admin_group_settings', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const text = `
👥 <b>Group Settings</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>Status:</b> ${GROUP_SETTINGS.enabled ? '🟢 Enabled' : '🔴 Disabled'}
<b>Allowed Groups:</b> <code>${GROUP_SETTINGS.allowed_groups.length}</code>
<b>Blocked Groups:</b> <code>${GROUP_SETTINGS.blocked_groups.length}</code>
<b>Auto-Enable:</b> ${ADMIN_SETTINGS.auto_enable_new_groups ? '🟢 On' : '🔴 Off'}
<b>Pending Approvals:</b> <code>${CHAT_CONTROLS.pending_approvals.length}</code>
━━━━━━━━━━━━━━━━━━━━━━

<blockquote><b>📌 මෙය ක්‍රියා කරන ආකාරය:</b>
• Enabled කළ විට, නියමයන්ට අනුව Groups වලට Bot එක භාවිතා කළ හැක.
• Block කර ඇති Groups හට සෑම විටම ප්‍රවේශය ප්‍රතික්ෂේප වේ.
• Allowed List එක හිස් නම්, සියලුම Groups සඳහා ප්‍රවේශය ලබා දේ.
• Auto-enable: නව Groups ස්වයංක්‍රීයව Enable කරනු ලැබේ.</blockquote>

<i>Use the buttons below to manage group settings.</i>
        `;
        await editWithImage(ctx, text, getGroupSettingsKeyboard());
    });

    bot.action('admin_toggle_groups', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        GROUP_SETTINGS.enabled = !GROUP_SETTINGS.enabled;
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Groups ${GROUP_SETTINGS.enabled ? 'enabled' : 'disabled'}!`);
        
        const text = `
👥 <b>Groups ${GROUP_SETTINGS.enabled ? 'Enabled' : 'Disabled'}</b>

<i>Group access has been ${GROUP_SETTINGS.enabled ? 'enabled' : 'disabled'}.</i>

${GROUP_SETTINGS.enabled ? '✅ Groups can use the bot.' : '❌ Groups cannot use the bot.'}
        `;
        await editWithImage(ctx, text, getGroupSettingsKeyboard());
    });

    bot.action('admin_toggle_auto_enable', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ADMIN_SETTINGS.auto_enable_new_groups = !ADMIN_SETTINGS.auto_enable_new_groups;
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Auto-enable ${ADMIN_SETTINGS.auto_enable_new_groups ? 'enabled' : 'disabled'}!`);
        
        const text = `
🔄 <b>Auto-Enable ${ADMIN_SETTINGS.auto_enable_new_groups ? 'Enabled' : 'Disabled'}</b>

<i>New groups will ${ADMIN_SETTINGS.auto_enable_new_groups ? 'automatically' : 'not'} be enabled.</i>

${ADMIN_SETTINGS.auto_enable_new_groups ? '✅ New groups can use the bot immediately.' : '❌ New groups require admin approval.'}
        `;
        await editWithImage(ctx, text, getGroupSettingsKeyboard());
    });

    bot.action('admin_view_pending', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (CHAT_CONTROLS.pending_approvals.length === 0) {
            await ctx.answerCbQuery('No pending approvals!');
            await editWithImage(ctx, `
📋 <b>Pending Approvals</b>

<i>No pending approvals.</i>
            `, getGroupSettingsKeyboard());
            return;
        }
        
        let text = '📋 <b>Pending Approvals</b>\n\n';
        for (const chatId of CHAT_CONTROLS.pending_approvals) {
            text += `• <code>${escapeHtml(chatId)}</code>\n`;
        }
        text += '\nUse <code>/enable {chat_id}</code> or <code>/disable {chat_id}</code>';
        
        await editWithImage(ctx, text, getGroupSettingsKeyboard());
    });

    // ========== ADMIN: CHANNEL SETTINGS ==========
    bot.action('admin_channel_settings', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const text = `
📢 <b>Channel Settings</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>Status:</b> ${CHANNEL_SETTINGS.enabled ? '🟢 Enabled' : '🔴 Disabled'}
<b>Allowed Channels:</b> <code>${CHANNEL_SETTINGS.allowed_channels.length}</code>
<b>Blocked Channels:</b> <code>${CHANNEL_SETTINGS.blocked_channels.length}</code>
━━━━━━━━━━━━━━━━━━━━━━

<blockquote><b>📌 මෙය ක්‍රියා කරන ආකාරය:</b>
• Enabled කළ විට, නියමයන්ට අනුව Channels වලට Bot එක භාවිතා කළ හැක.
• Block කර ඇති Channels හට සෑම විටම ප්‍රවේශය ප්‍රතික්ෂේප වේ.
• Allowed List එක හිස් නම්, සියලුම Channels සඳහා ප්‍රවේශය ලබා දේ.</blockquote>

<i>Use the buttons below to manage channel settings.</i>
        `;
        await editWithImage(ctx, text, getChannelSettingsKeyboard());
    });

    bot.action('admin_toggle_channels', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        CHANNEL_SETTINGS.enabled = !CHANNEL_SETTINGS.enabled;
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Channels ${CHANNEL_SETTINGS.enabled ? 'enabled' : 'disabled'}!`);
        
        const text = `
📢 <b>Channels ${CHANNEL_SETTINGS.enabled ? 'Enabled' : 'Disabled'}</b>

<i>Channel access has been ${CHANNEL_SETTINGS.enabled ? 'enabled' : 'disabled'}.</i>

${CHANNEL_SETTINGS.enabled ? '✅ Channels can use the bot.' : '❌ Channels cannot use the bot.'}
        `;
        await editWithImage(ctx, text, getChannelSettingsKeyboard());
    });

    // ========== ADMIN: USER MANAGEMENT ==========
    bot.action('admin_user_management', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const text = `
👤 <b>User Management</b>

<i>Manage bot users and view statistics.</i>

📌 <b>Available Actions:</b>
• View all users
• View user statistics
• Find a specific user
        `;
        await editWithImage(ctx, text, getUserManagementKeyboard());
    });

    bot.action('admin_view_all_users', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        try {
            const data = await fsPromises.readFile(DATA_FILE, 'utf8');
            const users = JSON.parse(data);
            const userKeys = Object.keys(users);
            
            if (userKeys.length === 0) {
                await editWithImage(ctx, `
<b>📊 All Users</b>

<i>No users found.</i>
                `, getUserManagementKeyboard());
                return;
            }
            
            let text = `<b>📊 All Users (${userKeys.length})</b>\n\n`;
            for (const uid of userKeys) {
                const userData = users[uid];
                const configCount = userData.configs ? userData.configs.filter(c => c.expiryTime > Date.now()).length : 0;
                text += `• <code>${escapeHtml(uid)}</code> - ${configCount} configs\n`;
            }
            
            await editWithImage(ctx, text, getUserManagementKeyboard());
        } catch (error) {
            await editWithImage(ctx, `
<b>❌ Error reading users</b>

<i>${escapeHtml(error.message)}</i>
            `, getUserManagementKeyboard());
        }
    });

    bot.action('admin_user_stats', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        try {
            const data = await fsPromises.readFile(DATA_FILE, 'utf8');
            const users = JSON.parse(data);
            
            let totalUsers = Object.keys(users).length;
            let totalConfigs = 0;
            let expiredConfigs = 0;
            let now = Date.now();
            
            for (const userData of Object.values(users)) {
                if (userData.configs) {
                    for (const config of userData.configs) {
                        if (config.expiryTime > now) {
                            totalConfigs++;
                        } else {
                            expiredConfigs++;
                        }
                    }
                }
            }
            
            const text = `
<b>📊 User Statistics</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>Total Users:</b> <code>${totalUsers}</code>
<b>Active Configs:</b> <code>${totalConfigs}</code>
<b>Expired Configs:</b> <code>${expiredConfigs}</code>
<b>Total Configs:</b> <code>${totalConfigs + expiredConfigs}</code>
━━━━━━━━━━━━━━━━━━━━━━
<b>Private Mode:</b> ${PRIVATE_MODE.enabled ? '🟢 On' : '🔴 Off'}
<b>Allowed Users:</b> <code>${PRIVATE_MODE.allowed_users.length}</code>
<b>Blocked Users:</b> <code>${PRIVATE_MODE.blocked_users.length}</code>
━━━━━━━━━━━━━━━━━━━━━━
            `;
            await editWithImage(ctx, text, getUserManagementKeyboard());
        } catch (error) {
            await editWithImage(ctx, `
<b>❌ Error reading stats</b>

<i>${escapeHtml(error.message)}</i>
            `, getUserManagementKeyboard());
        }
    });

    // ========== ADMIN: ADD/REMOVE ALLOWED USERS ==========
    bot.action('admin_add_allowed_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'add_allowed_user';
        
        await editWithImage(ctx, `
➕ <b>Add Allowed User</b>

<i>Send the user ID to allow:</i>
<code>Example: 123456789</code>

<b>📌 You can also use:</b> <code>/allow {user_id}</code>
        `, [[{ text: '🔙 Back to Private Mode', callback_data: 'admin_private_mode' }]]);
    });

    bot.action('admin_remove_allowed_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (PRIVATE_MODE.allowed_users.length === 0) {
            await ctx.answerCbQuery('No allowed users to remove!');
            return;
        }
        
        const buttons = PRIVATE_MODE.allowed_users.map(uid => [
            { text: `Remove ${uid}`, callback_data: `admin_remove_allowed_${uid}` }
        ]);
        buttons.push([{ text: '🔙 Back to Private Mode', callback_data: 'admin_private_mode' }]);
        
        await editWithImage(ctx, `
➖ <b>Remove Allowed User</b>

<i>Select a user to remove from allowed list:</i>
        `, buttons);
    });

    bot.action(/^admin_remove_allowed_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const uid = ctx.match[1];
        PRIVATE_MODE.allowed_users = PRIVATE_MODE.allowed_users.filter(id => id !== uid);
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Removed ${uid} from allowed list!`);
        await editWithImage(ctx, `
✅ <b>User Removed</b>

<i>User <code>${escapeHtml(uid)}</code> has been removed from allowed list.</i>
        `, getPrivateModeKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE BLOCKED USERS ==========
    bot.action('admin_add_blocked_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'add_blocked_user';
        
        await editWithImage(ctx, `
🚫 <b>Add Blocked User</b>

<i>Send the user ID to block:</i>
<code>Example: 123456789</code>

<b>📌 You can also use:</b> <code>/block {user_id}</code>
        `, [[{ text: '🔙 Back to Private Mode', callback_data: 'admin_private_mode' }]]);
    });

    bot.action('admin_remove_blocked_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (PRIVATE_MODE.blocked_users.length === 0) {
            await ctx.answerCbQuery('No blocked users to remove!');
            return;
        }
        
        const buttons = PRIVATE_MODE.blocked_users.map(uid => [
            { text: `Unblock ${uid}`, callback_data: `admin_unblock_${uid}` }
        ]);
        buttons.push([{ text: '🔙 Back to Private Mode', callback_data: 'admin_private_mode' }]);
        
        await editWithImage(ctx, `
✅ <b>Remove Blocked User</b>

<i>Select a user to unblock:</i>
        `, buttons);
    });

    bot.action(/^admin_unblock_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const uid = ctx.match[1];
        PRIVATE_MODE.blocked_users = PRIVATE_MODE.blocked_users.filter(id => id !== uid);
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Unblocked ${uid}!`);
        await editWithImage(ctx, `
✅ <b>User Unblocked</b>

<i>User <code>${escapeHtml(uid)}</code> has been unblocked.</i>
        `, getPrivateModeKeyboard());
    });

    // ========== ADMIN: VIEW ALLOWED/BLOCKED USERS ==========
    bot.action('admin_view_allowed_users', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (PRIVATE_MODE.allowed_users.length === 0) {
            await ctx.answerCbQuery('No allowed users!');
            await editWithImage(ctx, `
📋 <b>Allowed Users</b>

<i>No users in allowed list.</i>
            `, getPrivateModeKeyboard());
            return;
        }
        
        let text = '📋 <b>Allowed Users</b>\n\n';
        for (const uid of PRIVATE_MODE.allowed_users) {
            text += `• <code>${escapeHtml(uid)}</code>\n`;
        }
        
        await editWithImage(ctx, text, getPrivateModeKeyboard());
    });

    bot.action('admin_view_blocked_users', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (PRIVATE_MODE.blocked_users.length === 0) {
            await ctx.answerCbQuery('No blocked users!');
            await editWithImage(ctx, `
📋 <b>Blocked Users</b>

<i>No users in blocked list.</i>
            `, getPrivateModeKeyboard());
            return;
        }
        
        let text = '📋 <b>Blocked Users</b>\n\n';
        for (const uid of PRIVATE_MODE.blocked_users) {
            text += `• <code>${escapeHtml(uid)}</code>\n`;
        }
        
        await editWithImage(ctx, text, getPrivateModeKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE ALLOWED GROUPS ==========
    bot.action('admin_add_allowed_group', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'add_allowed_group';
        
        await editWithImage(ctx, `
➕ <b>Add Allowed Group</b>

<i>Send the group ID to allow:</i>
<code>Example: -100123456789</code>

<b>📌 You can also use:</b> <code>/enable {group_id}</code>
        `, [[{ text: '🔙 Back to Group Settings', callback_data: 'admin_group_settings' }]]);
    });

    bot.action('admin_remove_allowed_group', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (GROUP_SETTINGS.allowed_groups.length === 0) {
            await ctx.answerCbQuery('No allowed groups to remove!');
            return;
        }
        
        const buttons = GROUP_SETTINGS.allowed_groups.map(gid => [
            { text: `Remove ${gid}`, callback_data: `admin_remove_allowed_group_${gid}` }
        ]);
        buttons.push([{ text: '🔙 Back to Group Settings', callback_data: 'admin_group_settings' }]);
        
        await editWithImage(ctx, `
➖ <b>Remove Allowed Group</b>

<i>Select a group to remove from allowed list:</i>
        `, buttons);
    });

    bot.action(/^admin_remove_allowed_group_(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const gid = ctx.match[1];
        GROUP_SETTINGS.allowed_groups = GROUP_SETTINGS.allowed_groups.filter(id => id !== gid);
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Removed ${gid} from allowed groups!`);
        await editWithImage(ctx, `
✅ <b>Group Removed</b>

<i>Group <code>${escapeHtml(gid)}</code> has been removed from allowed list.</i>
        `, getGroupSettingsKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE BLOCKED GROUPS ==========
    bot.action('admin_add_blocked_group', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'add_blocked_group';
        
        await editWithImage(ctx, `
🚫 <b>Add Blocked Group</b>

<i>Send the group ID to block:</i>
<code>Example: -100123456789</code>

<b>📌 You can also use:</b> <code>/disable {group_id}</code>
        `, [[{ text: '🔙 Back to Group Settings', callback_data: 'admin_group_settings' }]]);
    });

    bot.action('admin_remove_blocked_group', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (GROUP_SETTINGS.blocked_groups.length === 0) {
            await ctx.answerCbQuery('No blocked groups to remove!');
            return;
        }
        
        const buttons = GROUP_SETTINGS.blocked_groups.map(gid => [
            { text: `Unblock ${gid}`, callback_data: `admin_unblock_group_${gid}` }
        ]);
        buttons.push([{ text: '🔙 Back to Group Settings', callback_data: 'admin_group_settings' }]);
        
        await editWithImage(ctx, `
✅ <b>Remove Blocked Group</b>

<i>Select a group to unblock:</i>
        `, buttons);
    });

    bot.action(/^admin_unblock_group_(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const gid = ctx.match[1];
        GROUP_SETTINGS.blocked_groups = GROUP_SETTINGS.blocked_groups.filter(id => id !== gid);
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Unblocked ${gid}!`);
        await editWithImage(ctx, `
✅ <b>Group Unblocked</b>

<i>Group <code>${escapeHtml(gid)}</code> has been unblocked.</i>
        `, getGroupSettingsKeyboard());
    });

    // ========== ADMIN: VIEW ALLOWED/BLOCKED GROUPS ==========
    bot.action('admin_view_allowed_groups', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (GROUP_SETTINGS.allowed_groups.length === 0) {
            await ctx.answerCbQuery('No allowed groups!');
            await editWithImage(ctx, `
📋 <b>Allowed Groups</b>

<i>No groups in allowed list.</i>
            `, getGroupSettingsKeyboard());
            return;
        }
        
        let text = '📋 <b>Allowed Groups</b>\n\n';
        for (const gid of GROUP_SETTINGS.allowed_groups) {
            text += `• <code>${escapeHtml(gid)}</code>\n`;
        }
        
        await editWithImage(ctx, text, getGroupSettingsKeyboard());
    });

    bot.action('admin_view_blocked_groups', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (GROUP_SETTINGS.blocked_groups.length === 0) {
            await ctx.answerCbQuery('No blocked groups!');
            await editWithImage(ctx, `
📋 <b>Blocked Groups</b>

<i>No groups in blocked list.</i>
            `, getGroupSettingsKeyboard());
            return;
        }
        
        let text = '📋 <b>Blocked Groups</b>\n\n';
        for (const gid of GROUP_SETTINGS.blocked_groups) {
            text += `• <code>${escapeHtml(gid)}</code>\n`;
        }
        
        await editWithImage(ctx, text, getGroupSettingsKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE ALLOWED CHANNELS ==========
    bot.action('admin_add_allowed_channel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'add_allowed_channel';
        
        await editWithImage(ctx, `
➕ <b>Add Allowed Channel</b>

<i>Send the channel ID to allow:</i>
<code>Example: -100123456789</code>
        `, [[{ text: '🔙 Back to Channel Settings', callback_data: 'admin_channel_settings' }]]);
    });

    bot.action('admin_remove_allowed_channel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (CHANNEL_SETTINGS.allowed_channels.length === 0) {
            await ctx.answerCbQuery('No allowed channels to remove!');
            return;
        }
        
        const buttons = CHANNEL_SETTINGS.allowed_channels.map(cid => [
            { text: `Remove ${cid}`, callback_data: `admin_remove_allowed_channel_${cid}` }
        ]);
        buttons.push([{ text: '🔙 Back to Channel Settings', callback_data: 'admin_channel_settings' }]);
        
        await editWithImage(ctx, `
➖ <b>Remove Allowed Channel</b>

<i>Select a channel to remove from allowed list:</i>
        `, buttons);
    });

    bot.action(/^admin_remove_allowed_channel_(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const cid = ctx.match[1];
        CHANNEL_SETTINGS.allowed_channels = CHANNEL_SETTINGS.allowed_channels.filter(id => id !== cid);
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Removed ${cid} from allowed channels!`);
        await editWithImage(ctx, `
✅ <b>Channel Removed</b>

<i>Channel <code>${escapeHtml(cid)}</code> has been removed from allowed list.</i>
        `, getChannelSettingsKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE BLOCKED CHANNELS ==========
    bot.action('admin_add_blocked_channel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'add_blocked_channel';
        
        await editWithImage(ctx, `
🚫 <b>Add Blocked Channel</b>

<i>Send the channel ID to block:</i>
<code>Example: -100123456789</code>
        `, [[{ text: '🔙 Back to Channel Settings', callback_data: 'admin_channel_settings' }]]);
    });

    bot.action('admin_remove_blocked_channel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (CHANNEL_SETTINGS.blocked_channels.length === 0) {
            await ctx.answerCbQuery('No blocked channels to remove!');
            return;
        }
        
        const buttons = CHANNEL_SETTINGS.blocked_channels.map(cid => [
            { text: `Unblock ${cid}`, callback_data: `admin_unblock_channel_${cid}` }
        ]);
        buttons.push([{ text: '🔙 Back to Channel Settings', callback_data: 'admin_channel_settings' }]);
        
        await editWithImage(ctx, `
✅ <b>Remove Blocked Channel</b>

<i>Select a channel to unblock:</i>
        `, buttons);
    });

    bot.action(/^admin_unblock_channel_(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const cid = ctx.match[1];
        CHANNEL_SETTINGS.blocked_channels = CHANNEL_SETTINGS.blocked_channels.filter(id => id !== cid);
        await updateDbConfig();
        
        await ctx.answerCbQuery(`Unblocked ${cid}!`);
        await editWithImage(ctx, `
✅ <b>Channel Unblocked</b>

<i>Channel <code>${escapeHtml(cid)}</code> has been unblocked.</i>
        `, getChannelSettingsKeyboard());
    });

    // ========== ADMIN: VIEW ALLOWED/BLOCKED CHANNELS ==========
    bot.action('admin_view_allowed_channels', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (CHANNEL_SETTINGS.allowed_channels.length === 0) {
            await ctx.answerCbQuery('No allowed channels!');
            await editWithImage(ctx, `
📋 <b>Allowed Channels</b>

<i>No channels in allowed list.</i>
            `, getChannelSettingsKeyboard());
            return;
        }
        
        let text = '📋 <b>Allowed Channels</b>\n\n';
        for (const cid of CHANNEL_SETTINGS.allowed_channels) {
            text += `• <code>${escapeHtml(cid)}</code>\n`;
        }
        
        await editWithImage(ctx, text, getChannelSettingsKeyboard());
    });

    bot.action('admin_view_blocked_channels', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        if (CHANNEL_SETTINGS.blocked_channels.length === 0) {
            await ctx.answerCbQuery('No blocked channels!');
            await editWithImage(ctx, `
📋 <b>Blocked Channels</b>

<i>No channels in blocked list.</i>
            `, getChannelSettingsKeyboard());
            return;
        }
        
        let text = '📋 <b>Blocked Channels</b>\n\n';
        for (const cid of CHANNEL_SETTINGS.blocked_channels) {
            text += `• <code>${escapeHtml(cid)}</code>\n`;
        }
        
        await editWithImage(ctx, text, getChannelSettingsKeyboard());
    });

    // ========== ADMIN: FIND USER ==========
    bot.action('admin_find_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        ownerPendingAction = 'find_user';
        
        await editWithImage(ctx, `
🔍 <b>Find User</b>

<i>Send the user ID to find:</i>
<code>Example: 123456789</code>
        `, [[{ text: '🔙 Back to User Management', callback_data: 'admin_user_management' }]]);
    });

    // ========== MAIN TEXT HANDLER FOR ADMIN ACTIONS ==========
    // This is the main text handler that handles ownerPendingAction
    // Also handles custom duration input
    // The previous bot.on('text') is merged into this one

    // ========== ADMIN: XRAY COMMANDS ==========
    bot.action('admin_restart', async (ctx) => {
        await ctx.answerCbQuery('🔄 Restarting Xray...');
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editTextSafe(ctx, `
<b>🔄 Restarting Xray...</b>

<i>Please wait...</i>

${createLoadingBar(30, '🟩')}
        `);
        
        await restartXray();
        
        await editTextSafe(ctx, `
<b>🔄 Restarting Xray...</b>

<i>Please wait...</i>

${createLoadingBar(70, '🟩')}
        `);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const status = await getXrayStatus();
        const text = `
${status.running ? '✅' : '❌'} <b>Xray Restart ${status.running ? 'Successful' : 'Failed'}</b>

<i>Status: ${status.running ? '🟢 Running' : '🔴 Stopped'}</i>

${createLoadingBar(100, '🟩')}
        `;
        await editWithImage(ctx, text, getAdminKeyboard());
    });

    bot.action('admin_stop', async (ctx) => {
        await ctx.answerCbQuery('⏹ Stopping Xray...');
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editTextSafe(ctx, `
<b>⏹ Stopping Xray...</b>

<i>Please wait...</i>

${createLoadingBar(50, '🟩')}
        `);
        
        await stopXray(true);
        
        const text = `
✅ <b>Xray Stopped Successfully</b>

<i>Status: 🔴 Stopped</i>

${createLoadingBar(100, '🟩')}
        `;
        await editWithImage(ctx, text, getAdminKeyboard());
    });

    bot.action('admin_start', async (ctx) => {
        await ctx.answerCbQuery('▶️ Starting Xray...');
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editTextSafe(ctx, `
<b>▶️ Starting Xray...</b>

<i>Please wait...</i>

${createLoadingBar(50, '🟩')}
        `);
        
        await startXray();
        
        const status = await getXrayStatus();
        const text = `
${status.running ? '✅' : '❌'} <b>Xray Start ${status.running ? 'Successful' : 'Failed'}</b>

<i>Status: ${status.running ? '🟢 Running' : '🔴 Stopped'}</i>

${createLoadingBar(100, '🟩')}
        `;
        await editWithImage(ctx, text, getAdminKeyboard());
    });

    bot.action('admin_status', async (ctx) => {
        await ctx.answerCbQuery('📊 Getting status...');
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const status = await getXrayStatus();
        const statusText = status.running ? '🟢 Running' : '🔴 Stopped';
        
        const text = `
<b>📊 Xray Status</b>

<blockquote>━━━━━━━━━━━━━━━━━━━━━━
<b>Status:</b> ${statusText}
<b>PID:</b> <code>${status.pid || 'N/A'}</code>
<b>Restarts:</b> <code>${status.restarts}</code>
<b>Uptime:</b> <code>${status.running ? 'Active' : 'Inactive'}</code>
━━━━━━━━━━━━━━━━━━━━━━</blockquote>
        `;
        await editWithImage(ctx, text, getAdminKeyboard());
    });

    bot.action('admin_cleanup', async (ctx) => {
        await ctx.answerCbQuery('🧹 Cleaning expired configs...');
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editTextSafe(ctx, `
<b>🧹 Cleaning Expired Configs...</b>

<i>Please wait...</i>

${createLoadingBar(30, '🟩')}
        `);
        
        const count = await cleanupExpiredConfigs();
        
        const text = `
<b>✅ Cleanup Complete</b>

<i>Removed ${count} expired configuration(s).</i>

${createLoadingBar(100, '🟩')}
        `;
        await editWithImage(ctx, text, getAdminKeyboard());
    });

    bot.action('admin_stats', async (ctx) => {
        await ctx.answerCbQuery('📈 Getting stats...');
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        let totalConfigs = 0;
        try {
            const data = await fsPromises.readFile(DATA_FILE, 'utf8');
            const users = JSON.parse(data);
            for (const userData of Object.values(users)) {
                if (userData.configs) {
                    totalConfigs += userData.configs.filter(c => c.expiryTime > Date.now()).length;
                }
            }
        } catch (error) {}
        
        const text = `
<b>📈 System Statistics</b>

<blockquote>━━━━━━━━━━━━━━━━━━━━━━
<b>Memory:</b> <code>${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB</code>
<b>Uptime:</b> <code>${Math.floor(uptime / 60)} minutes</code>
<b>Active Configs:</b> <code>${totalConfigs}</code>
<b>Platform:</b> <code>${process.platform}</code>
<b>Node Version:</b> <code>${process.version}</code>
━━━━━━━━━━━━━━━━━━━━━━</blockquote>
        `;
        await editWithImage(ctx, text, getAdminKeyboard());
    });

    // ========== MAIN TEXT HANDLER ==========
    bot.on('text', async (ctx) => {
        try {
            const text = ctx.message.text;
            const userId = ctx.from.id;
            const user = ctx.from;
            
            // Only process if user is owner
            if (userId.toString() !== OWNER_ID) return;
            
            // Check for pending admin action
            if (ownerPendingAction) {
                const input = text.trim();
                
                switch (ownerPendingAction) {
                    case 'add_allowed_user':
                        if (!PRIVATE_MODE.allowed_users.includes(input)) {
                            PRIVATE_MODE.allowed_users.push(input);
                            PRIVATE_MODE.blocked_users = PRIVATE_MODE.blocked_users.filter(id => id !== input);
                            await updateDbConfig();
                            await ctx.reply(`✅ User ${input} has been added to allowed list.`);
                        } else {
                            await ctx.reply(`ℹ️ User ${input} is already in allowed list.`);
                        }
                        break;
                        
                    case 'add_blocked_user':
                        if (!PRIVATE_MODE.blocked_users.includes(input)) {
                            PRIVATE_MODE.blocked_users.push(input);
                            PRIVATE_MODE.allowed_users = PRIVATE_MODE.allowed_users.filter(id => id !== input);
                            await updateDbConfig();
                            await ctx.reply(`✅ User ${input} has been added to blocked list.`);
                        } else {
                            await ctx.reply(`ℹ️ User ${input} is already in blocked list.`);
                        }
                        break;
                        
                    case 'add_allowed_group':
                        if (!GROUP_SETTINGS.allowed_groups.includes(input)) {
                            GROUP_SETTINGS.allowed_groups.push(input);
                            GROUP_SETTINGS.blocked_groups = GROUP_SETTINGS.blocked_groups.filter(id => id !== input);
                            await updateDbConfig();
                            await ctx.reply(`✅ Group ${input} has been added to allowed list.`);
                        } else {
                            await ctx.reply(`ℹ️ Group ${input} is already in allowed list.`);
                        }
                        break;
                        
                    case 'add_blocked_group':
                        if (!GROUP_SETTINGS.blocked_groups.includes(input)) {
                            GROUP_SETTINGS.blocked_groups.push(input);
                            GROUP_SETTINGS.allowed_groups = GROUP_SETTINGS.allowed_groups.filter(id => id !== input);
                            await updateDbConfig();
                            await ctx.reply(`✅ Group ${input} has been added to blocked list.`);
                        } else {
                            await ctx.reply(`ℹ️ Group ${input} is already in blocked list.`);
                        }
                        break;
                        
                    case 'add_allowed_channel':
                        if (!CHANNEL_SETTINGS.allowed_channels.includes(input)) {
                            CHANNEL_SETTINGS.allowed_channels.push(input);
                            CHANNEL_SETTINGS.blocked_channels = CHANNEL_SETTINGS.blocked_channels.filter(id => id !== input);
                            await updateDbConfig();
                            await ctx.reply(`✅ Channel ${input} has been added to allowed list.`);
                        } else {
                            await ctx.reply(`ℹ️ Channel ${input} is already in allowed list.`);
                        }
                        break;
                        
                    case 'add_blocked_channel':
                        if (!CHANNEL_SETTINGS.blocked_channels.includes(input)) {
                            CHANNEL_SETTINGS.blocked_channels.push(input);
                            CHANNEL_SETTINGS.allowed_channels = CHANNEL_SETTINGS.allowed_channels.filter(id => id !== input);
                            await updateDbConfig();
                            await ctx.reply(`✅ Channel ${input} has been added to blocked list.`);
                        } else {
                            await ctx.reply(`ℹ️ Channel ${input} is already in blocked list.`);
                        }
                        break;
                        
                    case 'find_user':
                        try {
                            const uid = input.trim();
                            const userData = await getUserData(uid);
                            
                            if (!userData) {
                                await ctx.replyWithHTML(`
🔍 <b>User Not Found</b>

<i>No user found with ID: <code>${escapeHtml(uid)}</code></i>
                                `);
                            } else {
                                const configCount = userData.configs ? userData.configs.filter(c => c.expiryTime > Date.now()).length : 0;
                                const totalConfigs = userData.configs ? userData.configs.length : 0;
                                
                                await ctx.replyWithHTML(`
🔍 <b>User Found</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>User ID:</b> <code>${escapeHtml(uid)}</code>
<b>Active Configs:</b> <code>${configCount}</code>
<b>Total Configs:</b> <code>${totalConfigs}</code>
━━━━━━━━━━━━━━━━━━━━━━

<b>Configs:</b>
${userData.configs ? userData.configs.map(c => 
    `• ${c.duration}h (${c.expiryTime > Date.now() ? '🟢 Active' : '🔴 Expired'})`
).join('\n') : 'No configs'}
                                `);
                            }
                        } catch (error) {
                            await ctx.replyWithHTML(`
<b>❌ Error finding user</b>

<i>${escapeHtml(error.message)}</i>
                            `);
                        }
                        break;
                        
                    case 'custom_minutes':
                    case 'custom_hours':
                    case 'custom_days':
                        // Handle custom duration - already handled above
                        // This is a fallback
                        const num = parseInt(input);
                        if (!isNaN(num) && num > 0) {
                            let duration;
                            if (ownerPendingAction === 'custom_minutes') {
                                duration = Math.ceil(num / 60);
                                if (duration < 1) duration = 1;
                            } else if (ownerPendingAction === 'custom_hours') {
                                duration = num;
                            } else if (ownerPendingAction === 'custom_days') {
                                duration = num * 24;
                            }
                            
                            const config = await generateVPNConfig(userId, duration);
                            await saveVPNConfig(userId, config);
                            
                            const messageData = formatVPNMessage(config, user);
                            await sendWithImage(ctx, messageData.text, messageData.reply_markup.inline_keyboard);
                        }
                        break;
                }
                
                ownerPendingAction = null;
                return;
            }
            
            // If no pending action, check if it's a number for custom duration
            const num = parseInt(text);
            if (!isNaN(num) && num > 0) {
                // Auto-detect duration type
                let duration;
                if (num <= 60) {
                    duration = Math.ceil(num / 60);
                    if (duration < 1) duration = 1;
                } else if (num <= 168) {
                    duration = num;
                } else {
                    duration = num * 24;
                }
                
                const config = await generateVPNConfig(userId, duration);
                await saveVPNConfig(userId, config);
                
                const messageData = formatVPNMessage(config, user);
                await sendWithImage(ctx, messageData.text, messageData.reply_markup.inline_keyboard);
            }
            
        } catch (error) {
            console.error('Text handler error:', error);
        }
    });

    // ========== ERROR HANDLING ==========
    bot.catch((err, ctx) => {
        console.error('Bot Error:', err);
        ctx.reply(`
<blockquote><b>📛 මොකක් හරි system එකේ අව්ලක් වගේ.</b></blockquote>

━━━━━━━━━━━━━━━━━━━━━━
<i>නැවත උත්සහ කරලත් Fail උවහොත් ඇඩ්මින් සම්බන්ද කරගන්න.</i>
<i>අපේ බොසා :</i> <a href="https://t.me/mataberiyo">Mayantha</a>
━━━━━━━━━━━━━━━━━━━━━━
        `, { parse_mode: 'HTML' });
    });
}

// ==================== CLEANUP SCHEDULER - Optimized ====================
function startCleanupScheduler() {
    // Run every 2 hours instead of 1 hour (saves CPU)
    let cleanupCount = 0;
    
    setInterval(async () => {
        cleanupCount++;
        
        // Only run cleanup every 2 hours
        if (cleanupCount % 2 === 0) {
            await cleanupExpiredConfigs();
        }
        
        if (cleanupCount > 10) cleanupCount = 0;
    }, 60 * 60 * 1000); // Check every hour, cleanup every 2 hours
    
    // Run once on startup (delayed)
    setTimeout(async () => {
        await cleanupExpiredConfigs();
    }, 10000); // Delay 10 seconds to let system stabilize
}

// ==================== XRAY MONITOR - Optimized ====================
function startXrayMonitor() {
    // Check every 60 seconds (saves CPU)
    let checkCount = 0;
    
    setInterval(async () => {
        checkCount++;
        
        // Only do full check every 2 minutes, quick check in between
        if (checkCount % 2 === 0) {
            if (intentionalXrayStop) return;
            
            // Quick check: just see if process exists
            if (!xrayProcess || xrayProcess.killed) {
                isXrayRunning = false;
            }
            
            if (!isXrayRunning && xrayRestartCount < 10 && !intentionalXrayStop) {
                console.log('⚠️ Xray not running, restarting...');
                await startXray();
            }
        }
        
        // Reset counter to avoid overflow
        if (checkCount > 100) checkCount = 0;
        
    }, 60000); // Check every 60 seconds
}

// ==================== DIRECTORY SETUP ====================
async function ensureDirectories() {
    try {
        await fsPromises.mkdir(path.join(__dirname, 'data'), { recursive: true });
        await fsPromises.mkdir(CONFIGS_DIR, { recursive: true });
        await fsPromises.mkdir(XRAY_DIR, { recursive: true });
        
        try {
            await fsPromises.access(DATA_FILE);
        } catch {
            await writeJsonAtomic(DATA_FILE, {});
        }
    } catch (error) {
        console.error('Error creating directories:', error);
    }
}

// ==================== MEMORY MONITOR ====================
function startMemoryMonitor() {
    setInterval(() => {
        const mem = process.memoryUsage();
        const memMB = mem.heapUsed / 1024 / 1024;
        
        if (memMB > MAX_RAM_MB) {
            console.log(`⚠️ Memory high: ${memMB.toFixed(1)}MB / ${MAX_RAM_MB}MB`);
            
            // Force garbage collection if memory is too high
            if (global.gc) {
                console.log('🔄 Running garbage collection...');
                global.gc();
            }
            
            // Log warning
            console.log(`💾 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
        }
    }, 30000); // Check every 30 seconds
}

// ==================== START BOT - Updated ====================
async function startBot() {
    try {
        let configLoaded = await loadConfig();
        
        if (!configLoaded) {
            // Create default config...
            const defaultConfig = {
                "bot_token": "YOUR_BOT_TOKEN_HERE",
                "owner_id": "YOUR_TELEGRAM_USER_ID",
                "domain": "your-domain.com",
                "port": 10808,
                "path": "/kudda-vpn",
                "image_url": "",
                "vless_host": "m.zoom.us",
                "private_mode": { "enabled": false, "allowed_users": [], "blocked_users": [] },
                "group_settings": { "enabled": true, "allowed_groups": [], "blocked_groups": [] },
                "channel_settings": { "enabled": true, "allowed_channels": [], "blocked_channels": [] },
                "admin_settings": { 
                    "enable_button": "enable", 
                    "disable_button": "disable", 
                    "require_admin_approval": true, 
                    "auto_enable_new_groups": false 
                },
                "user_limits": { "max_configs_per_user": 5, "max_duration_hours": 24, "min_duration_hours": 1 },
                "features": { "allow_qr_codes": true, "allow_link_copy": true, "show_progress_bars": true, "enable_study_tips": true },
                "chat_controls": { "enabled_chats": [], "disabled_chats": [], "pending_approvals": [] }
            };
            
            await writeJsonAtomic(
                path.join(__dirname, 'db.json'),
                defaultConfig
            );
            console.log('📝 Created default db.json. Please edit it with your values!');
            console.log('❌ Please edit db.json with your settings, then restart.');
            process.exit(1);
        }
        
        if (IMAGE_URL) {
            console.log('📥 Downloading image on startup...');
            await getCachedImage();
        }
        
        console.log('🤖 Bot started!');
        console.log('🔄 Starting Xray...');
        await startXray();

        bot = new Telegraf(BOT_TOKEN);
        setupBot();
        await ensureDirectories();
        await bot.launch();
        
        startCleanupScheduler();
        startXrayMonitor();
        startMemoryMonitor(); 
        
        console.log('📊 Memory: ' + Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB');
        
        // Memory usage log every 5 minutes
        setInterval(() => {
            const mem = process.memoryUsage();
            const memMB = mem.heapUsed / 1024 / 1024;
            console.log(`💾 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
            
            if (memMB > MAX_RAM_MB) {
                console.log(`⚠️ Memory warning: ${memMB.toFixed(1)}MB > ${MAX_RAM_MB}MB`);
            }
        }, 5 * 60 * 1000);
        
        await notifyOwner('✅ Bot started successfully!\nXray auto-started.\n\n🔄 Immediate restart enabled for new configs\n🧹 Auto-cleanup enabled (2 hours)\n💾 Memory limit: 100MB');
        
        process.once('SIGINT', async () => {
            console.log('Shutting down...');
            await stopXray(true);
            bot.stop('SIGINT');
            process.exit(0);
        });
        
        process.once('SIGTERM', async () => {
            console.log('Shutting down...');
            await stopXray(true);
            bot.stop('SIGTERM');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();
