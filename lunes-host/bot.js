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

// Private mode settings
let PRIVATE_MODE = { enabled: false, allowed_users: [], blocked_users: [] };
let GROUP_SETTINGS = { enabled: true, allowed_groups: [], blocked_groups: [] };
let CHANNEL_SETTINGS = { enabled: true, allowed_channels: [], blocked_channels: [] };
let ADMIN_SETTINGS = {};
let CHAT_CONTROLS = { enabled_chats: [], disabled_chats: [], pending_approvals: [] };

// ==================== NO CACHING - DIRECT FILE ACCESS ====================

// Load configuration from db.json
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
            // User might not be able to receive messages
        }
        return false;
    }
    
    // ----- CHECK PRIVATE CHAT -----
    if (chatType === 'private') {
        // If private mode is enabled, check if user is allowed
        if (PRIVATE_MODE.enabled) {
            if (!PRIVATE_MODE.allowed_users.includes(userId.toString())) {
                await ctx.reply(`
<b>⛔ පුද්ගලික ප්‍රවේශ මාදිලිය</b>

<blockquote><i>මෙම සේවාව දැනට Private Mode තුළ ක්‍රියාත්මක වේ.
ඔබට මෙය භාවිතා කිරීමට අවසර ලබා දී නොමැත.</i></blockquote>

<b>📌 අවසර ලබා ගැනීමට සම්බන්ධ වන්න:</b>
<a href="https://t.me/mataberiyo">Contact Admin</a>
                `, { parse_mode: 'HTML' });
                return false;
            }
        }
        // If private mode disabled, all non-blocked users can use private chat
        return true;
    }
    
    // ----- CHECK GROUP -----
    if (chatType === 'group' || chatType === 'supergroup') {
        // Check group settings
        if (!GROUP_SETTINGS.enabled) {
            await ctx.reply(`
<b>🚫 Groups Disabled</b>

<blockquote><i>කණ්ඩායම් ප්‍රවේශය දැනට පරිපාලක විසින් සීමා කර ඇත.
මෙම පහසුකම භාවිතා කිරීමට අවසර ලබා ගැනීමට Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 සහාය සඳහා:</b>
<a href="https://t.me/mataberiyo">Contact Admin</a>
            `, { parse_mode: 'HTML' });
            return false;
        }
        
        // Check if group is blocked
        if (GROUP_SETTINGS.blocked_groups.includes(chatId.toString())) {
            await ctx.reply(`
<b>🚫 Group Blocked</b>

<blockquote><i>මෙම කණ්ඩායමට ප්‍රවේශය පරිපාලක විසින් අවහිර කර ඇත.
වැඩි විස්තර හෝ සහාය සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
            `, { parse_mode: 'HTML' });
            return false;
        }
        
        // Check if group is in allowed list (if list is not empty)
        if (GROUP_SETTINGS.allowed_groups.length > 0 && 
            !GROUP_SETTINGS.allowed_groups.includes(chatId.toString())) {
            await ctx.reply(`
<b>🚫 Group Access Denied</b>

<blockquote><i>මෙම කණ්ඩායමට භාවිතා කිරීමේ අවසර ලබා දී නොමැත.
අවසර ලබා ගැනීම සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
            `, { parse_mode: 'HTML' });
            return false;
        }
        
        // Check chat control (enabled/disabled)
        if (!isChatEnabled(chatId)) {
            await ctx.reply(`
<b>🚫 Chat Access Disabled</b>

<blockquote><i>මෙම සංවාදය පරිපාලක විසින් අක්‍රිය කර ඇත.
වැඩි විස්තර හෝ සහාය සඳහා Admin සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
            `, { parse_mode: 'HTML' });
            return false;
        }
        
        // Check pending approvals
        if (CHAT_CONTROLS.pending_approvals.includes(chatId.toString())) {
            await ctx.reply(`
<b>⏳ Approval Pending</b>

<blockquote><i>මෙම චැට් එක භාවිතා කිරීමට පෙර පරිපාලක අනුමැතිය අවශ්‍ය වේ.
කරුණාකර Admin අනුමැතිය ලබා දෙන තුරු රැඳී සිටින්න.</i></blockquote>

<b>📩 Contact:</b>
<a href="https://t.me/mataberiyo">Admin</a>
            `, { parse_mode: 'HTML' });
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
        await ctx.reply(`
<b>🚫 චැට් ප්‍රවේශය අවහිර කර ඇත</b>

<blockquote><i>මෙම සංවාදය පරිපාලක විසින් තාවකාලිකව අක්‍රිය කර ඇත.
ප්‍රවේශය නැවත ලබා ගැනීම සඳහා පරිපාලක සමඟ සම්බන්ධ වන්න.</i></blockquote>

<b>📩 සහාය සඳහා:</b>
<a href="https://t.me/mataberiyo">Contact Admin</a>
        `, { parse_mode: 'HTML' });
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

<b>Chat ID:</b> <code>${chatId}</code>
<b>Type:</b> <code>${chatType}</code>
<b>Title:</b> <code>${ctx.chat.title || 'Private'}</code>
<b>User:</b> <code>${ctx.from.username || ctx.from.first_name}</code>

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
        
        await fsPromises.writeFile(
            path.join(__dirname, 'db.json'),
            JSON.stringify(CONFIG, null, 2)
        );
        return true;
    } catch (error) {
        console.error('Error updating db.json:', error);
        return false;
    }
}

// ==================== IMAGE DOWNLOADER ====================
// Image is downloaded once and saved to disk, not kept in memory
async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const tempPath = path.join(__dirname, 'data', 'cached_image.png');
        
        if (!fs.existsSync(path.join(__dirname, 'data'))) {
            fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        }
        
        client.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download image: ${response.statusCode}`));
                return;
            }
            
            const fileStream = fs.createWriteStream(tempPath);
            response.pipe(fileStream);
            
            fileStream.on('finish', () => {
                fileStream.close();
                resolve(tempPath);
            });
            
            fileStream.on('error', (err) => {
                fs.unlink(tempPath, () => {});
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function getCachedImage() {
    if (!IMAGE_URL) return null;
    
    const cachePath = path.join(__dirname, 'data', 'cached_image.png');
    
    try {
        await fsPromises.access(cachePath);
        // console.log('✅ Using cached image');
        return cachePath;
    } catch {
        console.log('📥 Downloading image from GitHub...');
        try {
            const downloaded = await downloadImage(IMAGE_URL);
            console.log('✅ Image downloaded and cached');
            CACHED_IMAGE_PATH = downloaded;
            return downloaded;
        } catch (error) {
            console.error('❌ Failed to download image:', error.message);
            return null;
        }
    }
}

// ==================== SAFE EDIT TEXT (FIXES THE ERROR) ====================
// This function safely edits a message regardless of whether it's text or photo
async function editTextSafe(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
    try {
        const messageId = ctx.message?.message_id || ctx.update?.callback_query?.message?.message_id;
        const isPhoto = ctx.update?.callback_query?.message?.photo || ctx.message?.photo;
        
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
                console.log('Caption edit failed, trying text edit:', captionError.message);
                try {
                    await ctx.editMessageText(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (textError) {
                    console.log('Text edit also failed:', textError.message);
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
                console.log('Edit text failed, sending new message:', error.message);
                await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                return false;
            }
        }
    } catch (error) {
        console.error('editTextSafe error:', error);
        await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        return false;
    }
}

// ==================== IN-PLACE EDIT WITH IMAGE ====================
// TRUE IN-PLACE EDITING - NO DELETE, NO NEW MESSAGE
// Uses editMessageCaption() for photos and editMessageText() for text messages
async function editWithImage(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const imagePath = await getCachedImage();
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
    try {
        // Try to get the current message type
        const chatId = ctx.chat.id;
        const messageId = ctx.message?.message_id || ctx.update?.callback_query?.message?.message_id;
        const isPhoto = ctx.update?.callback_query?.message?.photo || ctx.message?.photo;
        
        if (!messageId) {
            // No message to edit, send new one
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
        
        // If original message is a photo, use editMessageCaption
        if (isPhoto) {
            try {
                await ctx.editMessageCaption(text, {
                    parse_mode: parse_mode,
                    reply_markup: replyMarkup
                });
                return true;
            } catch (captionError) {
                console.log('Caption edit failed:', captionError.message);
                // Fallback: try text edit
                try {
                    await ctx.editMessageText(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (textError) {
                    console.log('Text edit also failed:', textError.message);
                    // Send new message
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
            // Text message - use editMessageText
            if (imagePath) {
                try {
                    // Try caption edit first (in case it's a photo)
                    await ctx.editMessageCaption(text, {
                        parse_mode: parse_mode,
                        reply_markup: replyMarkup
                    });
                    return true;
                } catch (captionError) {
                    // Fallback to text edit
                    try {
                        await ctx.editMessageText(text, {
                            parse_mode: parse_mode,
                            reply_markup: replyMarkup
                        });
                        return true;
                    } catch (textError) {
                        console.log('Edit text failed, sending new message:', textError.message);
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
                    console.log('Edit text failed, sending new message:', error.message);
                    await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
                    return false;
                }
            }
        }
    } catch (error) {
        console.error('EditWithImage error:', error);
        // Fallback: send new message
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

// ==================== SEND WITH IMAGE ====================
async function sendWithImage(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const imagePath = await getCachedImage();
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    
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
            await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
            return false;
        }
    } else {
        await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        return false;
    }
}

// ==================== SEND WITH IMAGE AND DELETE OLD ====================
async function sendWithImageAndDelete(ctx, text, keyboard = null, parse_mode = 'HTML') {
    const imagePath = await getCachedImage();
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;
    let sentMessage = null;
    
    if (imagePath) {
        try {
            sentMessage = await ctx.replyWithPhoto(
                { source: imagePath },
                {
                    caption: text,
                    parse_mode: parse_mode,
                    reply_markup: replyMarkup
                }
            );
            return sentMessage;
        } catch (error) {
            console.error('Error sending with image:', error);
            sentMessage = await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
            return sentMessage;
        }
    } else {
        sentMessage = await ctx.replyWithHTML(text, { reply_markup: replyMarkup });
        return sentMessage;
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
let lastRestartTime = Date.now();

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

async function startXray() {
    try {
        if (!await checkXrayBinary()) {
            console.error('Xray binary not found!');
            return false;
        }

        try {
            await fsPromises.access(XRAY_CONFIG);
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
        await fsPromises.writeFile(DATA_FILE, JSON.stringify(users, null, 2));
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
    
    let text = `
<b>🔐 VPN Configuration Created</b>

<blockquote><b>👤 User:</b> <code>${user.first_name || user.username || user.id}</code>
<b>🆔 ID:</b> <code>${config.id}</code>
<b>⏱ Duration:</b> <code>${config.duration}h</code>
<b>⏰ Expires (SL):</b> <code>${expiryDate.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</code>
<b>⏳ Remaining:</b> <code>${remaining}h</code></blockquote>

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

function formatConfigList(configs, userId) {
    if (configs.length === 0) {
        return {
            text: `
<b>📋 සක්‍රීය VPN Configurations නොමැත</b>

<i>ඔබට දැනට කිසිදු සක්‍රීය VPN Configuration එකක් නොමැත.</i>

<b>💡 උපදෙස:</b> ආරම්භ කිරීමට <b>🔰 Create Your Own VPN</b> Button එක භාවිතා කරන්න.`,
            parse_mode: 'HTML'
        };
    }

    let message = `
<b>📋 Your Active Configurations</b>

<i>Here are your current VPN connections:</i>\n\n`;
    
    for (const config of configs) {
        const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
        const bar = createProgressBar(remaining, config.duration);
        const expiryDate = new Date(config.expiryTime);

        message += `
<blockquote><b>🔹 ${config.duration}h VPN</b>
${bar}
<b>ID:</b> <code>${config.id}</code>
<b>Expires (SL):</b> <code>${expiryDate.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</code>
<b>⌛ ${remaining}h remaining</b></blockquote>\n`;

    }
    
    return { text: message, parse_mode: 'HTML' };
}

function formatConfigView(config, user) {
    const remaining = Math.ceil((config.expiryTime - Date.now()) / (1000 * 60 * 60));
    const expiryDate = new Date(config.expiryTime);
    const progressBar = createProgressBar(remaining, config.duration);
    
    let text = `
<b>🔐 VPN Configuration</b>

<blockquote><b>👤 User:</b> <code>${user.first_name || user.username || user.id}</code>
<b>🆔 ID:</b> <code>${config.id}</code>
<b>⏱ Duration:</b> <code>${config.duration}h</code>
<b>⏰ Expires (SL):</b> <code>${expiryDate.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</code>
<b>⏳ Remaining:</b> <code>${remaining}h</code></blockquote>

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
        await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));
        
        return true;
    } catch (error) {
        console.error('Error saving VPN config:', error);
        return false;
    }
}

async function updateXrayConfig(userId, newConfig) {
    try {
        const configData = await fsPromises.readFile(XRAY_CONFIG, 'utf8');
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
            
            await fsPromises.writeFile(XRAY_CONFIG, JSON.stringify(xrayConfig, null, 2));
            
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

async function removeFromXrayConfig(uuid) {
    try {
        const configData = await fsPromises.readFile(XRAY_CONFIG, 'utf8');
        const xrayConfig = JSON.parse(configData);
        
        if (xrayConfig.inbounds && xrayConfig.inbounds.length > 0) {
            const inbound = xrayConfig.inbounds[0];
            if (inbound.settings.clients) {
                inbound.settings.clients = inbound.settings.clients.filter(
                    client => client.id !== uuid
                );
                
                await fsPromises.writeFile(XRAY_CONFIG, JSON.stringify(xrayConfig, null, 2));
                await restartXray();
            }
        }
    } catch (error) {
        console.error('Error removing from Xray config:', error);
    }
}

// ==================== CLEANUP ====================
async function cleanupExpiredConfigs() {
    try {
        const data = await fsPromises.readFile(DATA_FILE, 'utf8');
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
                        await fsPromises.unlink(configPath);
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
            await fsPromises.writeFile(DATA_FILE, JSON.stringify(users, null, 2));
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
            { text: 'A', url: 'https://t.me/mataberiyo' },
        ],
        [{ text: '🙏 ඛන්ති පරමං තපෝ තිතික්ඛා 🌺', callback_data: 'Study' }]
    ];
    
    if (isOwner) {
        buttons.push([{ text: '⚙️ Admin Panel', callback_data: 'admin_panel' }]);
    }
    
    return buttons;
}

function getDurationKeyboard(isOwner = false) {
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
        [{ text: '📢 Channel Settings', callback_data: 'admin_channel_settings' },
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
            text += `• <code>${chatId}</code>\n`;
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
        
        // Show loading - USING editTextSafe INSTEAD OF ctx.editMessageText
        const loadingText1 = `
<b>⏳ Creating Your VPN...</b>

<i>Generating secure configuration</i>

<b>📊 Progress:</b>
${createLoadingBar(25, '🟩')}

<b>🔒 Setting up encryption...</b>
        `;
        await editTextSafe(ctx, loadingText1);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const loadingText2 = `
<b>⏳ Creating Your VPN...</b>

<i>Generating secure configuration</i>

<b>📊 Progress:</b>
${createLoadingBar(50, '🟩')}

<b>🔑 Generating UUID...</b>
        `;
        await editTextSafe(ctx, loadingText2);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const loadingText3 = `
<b>⏳ Creating Your VPN...</b>

<i>Generating secure configuration</i>

<b>📊 Progress:</b>
${createLoadingBar(75, '🟩')}

<b>🌐 Configuring network settings...</b>
        `;
        await editTextSafe(ctx, loadingText3);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const loadingText4 = `
<b>⏳ Creating Your VPN...</b>

<i>Generating secure configuration</i>

<b>📊 Progress:</b>
${createLoadingBar(100, '🟩')}

<b>✅ Finalizing configuration...</b>
        `;
        await editTextSafe(ctx, loadingText4);
        
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
                        await fsPromises.writeFile(backupPath, JSON.stringify(config, null, 2));
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

            // Determine duration type based on number
            let duration;
            
            if (num <= 60) {
                // Minutes
                duration = Math.ceil(num / 60);
                if (duration < 1) duration = 1;
            } else if (num <= 168) {
                // Hours
                duration = num;
            } else {
                // Days
                duration = num * 24;
            }
            
            const config = await generateVPNConfig(userId, duration);
            await saveVPNConfig(userId, config);
            
            const messageData = formatVPNMessage(config, user);
            await sendWithImage(ctx, messageData.text, messageData.reply_markup.inline_keyboard);
            
        } catch (error) {
            console.error('Custom duration error:', error);
        }
    });

    // ========== LIST CONFIGS ==========
    bot.action('list_configs', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const configs = await getActiveConfigs(userId);
        
        const messageData = formatConfigList(configs, userId);
        const keyboard = configs.length > 0 ? getConfigListKeyboard(configs) : [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]];
        
        await editWithImage(ctx, messageData.text, keyboard);
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

<i>Error:</i> <code>${error.message}</code>
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

<blockquote><<b>📌 මෙය ක්‍රියා කරන ආකාරය:</b>
• Enabled කළ විට, නියමයන්ට අනුව Groups වලට Bot එක භාවිතා කළ හැක.
• Block කර ඇති Groups හට සෑම විටම ප්‍රවේශය ප්‍රතික්ෂේප වේ.
• Allowed List එක හිස් නම්, සියලුම Groups සඳහා ප්‍රවේශය ලබා දේ.
• Auto-enable: නව Groups ස්වයංක්‍රීයව Enable කරනු ලැබේ.</blockquote><

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
            text += `• <code>${chatId}</code>\n`;
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
                text += `• <code>${uid}</code> - ${configCount} configs\n`;
            }
            
            await editWithImage(ctx, text, getUserManagementKeyboard());
        } catch (error) {
            await editWithImage(ctx, `
<b>❌ Error reading users</b>

<i>${error.message}</i>
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

<i>${error.message}</i>
            `, getUserManagementKeyboard());
        }
    });

    // ========== ADMIN: ADD/REMOVE ALLOWED USERS ==========
    bot.action('admin_add_allowed_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editWithImage(ctx, `
➕ <b>Add Allowed User</b>

<i>Send the user ID to allow:</i>
<code>Example: 123456789</code>

<b>📌 You can also use:</b> <code>/allow {user_id}</code>
        `, [[{ text: '🔙 Back to Private Mode', callback_data: 'admin_private_mode' }]]);
        
        // Wait for user input - using a one-time handler
        const textHandler = async (ctx) => {
            if (ctx.from.id.toString() !== OWNER_ID) return;
            const input = ctx.message.text;
            if (input.startsWith('/')) return;
            
            const userIdToAllow = input.trim();
            if (!PRIVATE_MODE.allowed_users.includes(userIdToAllow)) {
                PRIVATE_MODE.allowed_users.push(userIdToAllow);
                await updateDbConfig();
                await ctx.reply(`✅ User ${userIdToAllow} has been added to allowed list.`);
            } else {
                await ctx.reply(`ℹ️ User ${userIdToAllow} is already in allowed list.`);
            }
            
            // Remove this handler after one use
            bot.off('text', textHandler);
        };
        bot.on('text', textHandler);
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

<i>User <code>${uid}</code> has been removed from allowed list.</i>
        `, getPrivateModeKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE BLOCKED USERS ==========
    bot.action('admin_add_blocked_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editWithImage(ctx, `
🚫 <b>Add Blocked User</b>

<i>Send the user ID to block:</i>
<code>Example: 123456789</code>

<b>📌 You can also use:</b> <code>/block {user_id}</code>
        `, [[{ text: '🔙 Back to Private Mode', callback_data: 'admin_private_mode' }]]);
        
        const textHandler = async (ctx) => {
            if (ctx.from.id.toString() !== OWNER_ID) return;
            const input = ctx.message.text;
            if (input.startsWith('/')) return;
            
            const userIdToBlock = input.trim();
            if (!PRIVATE_MODE.blocked_users.includes(userIdToBlock)) {
                PRIVATE_MODE.blocked_users.push(userIdToBlock);
                await updateDbConfig();
                await ctx.reply(`✅ User ${userIdToBlock} has been added to blocked list.`);
            } else {
                await ctx.reply(`ℹ️ User ${userIdToBlock} is already in blocked list.`);
            }
            
            bot.off('text', textHandler);
        };
        bot.on('text', textHandler);
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

<i>User <code>${uid}</code> has been unblocked.</i>
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
            text += `• <code>${uid}</code>\n`;
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
            text += `• <code>${uid}</code>\n`;
        }
        
        await editWithImage(ctx, text, getPrivateModeKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE ALLOWED GROUPS ==========
    bot.action('admin_add_allowed_group', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editWithImage(ctx, `
➕ <b>Add Allowed Group</b>

<i>Send the group ID to allow:</i>
<code>Example: -100123456789</code>

<b>📌 You can also use:</b> <code>/enable {group_id}</code>
        `, [[{ text: '🔙 Back to Group Settings', callback_data: 'admin_group_settings' }]]);
        
        const textHandler = async (ctx) => {
            if (ctx.from.id.toString() !== OWNER_ID) return;
            const input = ctx.message.text;
            if (input.startsWith('/')) return;
            
            const groupId = input.trim();
            if (!GROUP_SETTINGS.allowed_groups.includes(groupId)) {
                GROUP_SETTINGS.allowed_groups.push(groupId);
                GROUP_SETTINGS.blocked_groups = GROUP_SETTINGS.blocked_groups.filter(id => id !== groupId);
                await updateDbConfig();
                await ctx.reply(`✅ Group ${groupId} has been added to allowed list.`);
            } else {
                await ctx.reply(`ℹ️ Group ${groupId} is already in allowed list.`);
            }
            
            bot.off('text', textHandler);
        };
        bot.on('text', textHandler);
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

<i>Group <code>${gid}</code> has been removed from allowed list.</i>
        `, getGroupSettingsKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE BLOCKED GROUPS ==========
    bot.action('admin_add_blocked_group', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editWithImage(ctx, `
🚫 <b>Add Blocked Group</b>

<i>Send the group ID to block:</i>
<code>Example: -100123456789</code>

<b>📌 You can also use:</b> <code>/disable {group_id}</code>
        `, [[{ text: '🔙 Back to Group Settings', callback_data: 'admin_group_settings' }]]);
        
        const textHandler = async (ctx) => {
            if (ctx.from.id.toString() !== OWNER_ID) return;
            const input = ctx.message.text;
            if (input.startsWith('/')) return;
            
            const groupId = input.trim();
            if (!GROUP_SETTINGS.blocked_groups.includes(groupId)) {
                GROUP_SETTINGS.blocked_groups.push(groupId);
                GROUP_SETTINGS.allowed_groups = GROUP_SETTINGS.allowed_groups.filter(id => id !== groupId);
                await updateDbConfig();
                await ctx.reply(`✅ Group ${groupId} has been added to blocked list.`);
            } else {
                await ctx.reply(`ℹ️ Group ${groupId} is already in blocked list.`);
            }
            
            bot.off('text', textHandler);
        };
        bot.on('text', textHandler);
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

<i>Group <code>${gid}</code> has been unblocked.</i>
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
            text += `• <code>${gid}</code>\n`;
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
            text += `• <code>${gid}</code>\n`;
        }
        
        await editWithImage(ctx, text, getGroupSettingsKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE ALLOWED CHANNELS ==========
    bot.action('admin_add_allowed_channel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editWithImage(ctx, `
➕ <b>Add Allowed Channel</b>

<i>Send the channel ID to allow:</i>
<code>Example: -100123456789</code>
        `, [[{ text: '🔙 Back to Channel Settings', callback_data: 'admin_channel_settings' }]]);
        
        const textHandler = async (ctx) => {
            if (ctx.from.id.toString() !== OWNER_ID) return;
            const input = ctx.message.text;
            if (input.startsWith('/')) return;
            
            const channelId = input.trim();
            if (!CHANNEL_SETTINGS.allowed_channels.includes(channelId)) {
                CHANNEL_SETTINGS.allowed_channels.push(channelId);
                CHANNEL_SETTINGS.blocked_channels = CHANNEL_SETTINGS.blocked_channels.filter(id => id !== channelId);
                await updateDbConfig();
                await ctx.reply(`✅ Channel ${channelId} has been added to allowed list.`);
            } else {
                await ctx.reply(`ℹ️ Channel ${channelId} is already in allowed list.`);
            }
            
            bot.off('text', textHandler);
        };
        bot.on('text', textHandler);
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

<i>Channel <code>${cid}</code> has been removed from allowed list.</i>
        `, getChannelSettingsKeyboard());
    });

    // ========== ADMIN: ADD/REMOVE BLOCKED CHANNELS ==========
    bot.action('admin_add_blocked_channel', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editWithImage(ctx, `
🚫 <b>Add Blocked Channel</b>

<i>Send the channel ID to block:</i>
<code>Example: -100123456789</code>
        `, [[{ text: '🔙 Back to Channel Settings', callback_data: 'admin_channel_settings' }]]);
        
        const textHandler = async (ctx) => {
            if (ctx.from.id.toString() !== OWNER_ID) return;
            const input = ctx.message.text;
            if (input.startsWith('/')) return;
            
            const channelId = input.trim();
            if (!CHANNEL_SETTINGS.blocked_channels.includes(channelId)) {
                CHANNEL_SETTINGS.blocked_channels.push(channelId);
                CHANNEL_SETTINGS.allowed_channels = CHANNEL_SETTINGS.allowed_channels.filter(id => id !== channelId);
                await updateDbConfig();
                await ctx.reply(`✅ Channel ${channelId} has been added to blocked list.`);
            } else {
                await ctx.reply(`ℹ️ Channel ${channelId} is already in blocked list.`);
            }
            
            bot.off('text', textHandler);
        };
        bot.on('text', textHandler);
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

<i>Channel <code>${cid}</code> has been unblocked.</i>
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
            text += `• <code>${cid}</code>\n`;
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
            text += `• <code>${cid}</code>\n`;
        }
        
        await editWithImage(ctx, text, getChannelSettingsKeyboard());
    });

    // ========== ADMIN: FIND USER ==========
    bot.action('admin_find_user', async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        if (userId.toString() !== OWNER_ID) return;
        
        await editWithImage(ctx, `
🔍 <b>Find User</b>

<i>Send the user ID to find:</i>
<code>Example: 123456789</code>
        `, [[{ text: '🔙 Back to User Management', callback_data: 'admin_user_management' }]]);
        
        const textHandler = async (ctx) => {
            if (ctx.from.id.toString() !== OWNER_ID) return;
            const input = ctx.message.text;
            if (input.startsWith('/')) return;
            
            try {
                const uid = input.trim();
                const userData = await getUserData(uid);
                
                if (!userData) {
                    await ctx.replyWithHTML(`
🔍 <b>User Not Found</b>

<i>No user found with ID: <code>${uid}</code></i>
                    `);
                } else {
                    const configCount = userData.configs ? userData.configs.filter(c => c.expiryTime > Date.now()).length : 0;
                    const totalConfigs = userData.configs ? userData.configs.length : 0;
                    
                    await ctx.replyWithHTML(`
🔍 <b>User Found</b>

━━━━━━━━━━━━━━━━━━━━━━
<b>User ID:</b> <code>${uid}</code>
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

<i>${error.message}</i>
                `);
            }
            
            bot.off('text', textHandler);
        };
        bot.on('text', textHandler);
    });

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
        
        await stopXray();
        
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

// ==================== SCHEDULERS ====================
function startCleanupScheduler() {
    setInterval(async () => {
        await cleanupExpiredConfigs();
    }, 60 * 60 * 1000);
    
    setTimeout(async () => {
        await cleanupExpiredConfigs();
    }, 5000);
}

function startXrayMonitor() {
    setInterval(async () => {
        const status = await getXrayStatus();
        if (!status.running && xrayRestartCount < 10) {
            console.log('Xray down, restarting...');
            await startXray();
        }
    }, 30000);
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
            await fsPromises.writeFile(DATA_FILE, JSON.stringify({}, null, 2));
        }
    } catch (error) {
        console.error('Error creating directories:', error);
    }
}

// ==================== START BOT ====================
async function startBot() {
    try {
        let configLoaded = await loadConfig();
        
        if (!configLoaded) {
            // Try to create default config
            const defaultConfig = {
                "bot_token": "YOUR_BOT_TOKEN_HERE",
                "owner_id": "YOUR_TELEGRAM_USER_ID",
                "domain": "your-domain.com",
                "port": 10808,
                "path": "/kudda-vpn",
                "image_url": "",
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
            
            await fsPromises.writeFile(
                path.join(__dirname, 'db.json'),
                JSON.stringify(defaultConfig, null, 2)
            );
            console.log('📝 Created default db.json. Please edit it with your values!');
            console.log('❌ Please edit db.json with your settings, then restart.');
            process.exit(1);
        }
        
        if (IMAGE_URL) {
            console.log('📥 Downloading image on startup...');
            await getCachedImage();
        }
        
        bot = new Telegraf(BOT_TOKEN);
        setupBot();
        await ensureDirectories();
        await bot.launch();
        
        console.log('🤖 Bot started!');
        console.log('🔄 Starting Xray...');
        await startXray();
        
        startCleanupScheduler();
        startXrayMonitor();
        
        console.log('📊 Memory: ' + Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB');
        
        // Memory usage log every 5 minutes
        setInterval(() => {
            const mem = process.memoryUsage();
            console.log(`💾 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
        }, 5 * 60 * 1000);
        
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

startBot();
