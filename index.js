const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

const client = new Client({
    authStrategy: new LocalAuth(),
    takeoverOnConflict: true,
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// ─── QR & Ready ───────────────────────────────────────────────────────────────

client.on('qr', async (qr) => {
    try {
        const imagePath = './whatsapp-qr.png';
        await QRCode.toFile(imagePath, qr, { width: 300 });
        const form = new FormData();
        form.append('chat_id', TG_CHAT_ID);
        form.append('photo', fs.createReadStream(imagePath));
        form.append('caption', '📸 *WhatsApp Radar system requested login!*');

        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
        console.log('🚀 QR sent to Telegram.');
    } catch (err) {
        console.error('QR Error:', err.message);
    }
});

client.on('ready', () => {
    console.log('🛡️ WhatsApp Radar is active!');
    if (fs.existsSync('./whatsapp-qr.png')) fs.unlinkSync('./whatsapp-qr.png');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a whatsapp-web.js mimetype string to a file extension.
 */
function getExtension(mimetype) {
    const map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/3gpp': '3gp',
        'video/quicktime': 'mov',
    };
    return map[mimetype] || mimetype.split('/')[1] || 'bin';
}

/**
 * Sends a file buffer to Telegram as a photo or document.
 * Uses sendPhoto for images, sendVideo for videos, sendDocument as fallback.
 */
async function sendMediaToTelegram(filePath, mimetype, caption) {
    const form = new FormData();
    form.append('chat_id', TG_CHAT_ID);
    form.append('caption', caption, { contentType: 'text/plain' });
    form.append('parse_mode', 'Markdown');

    let endpoint;
    if (mimetype.startsWith('image/')) {
        form.append('photo', fs.createReadStream(filePath));
        endpoint = 'sendPhoto';
    } else if (mimetype.startsWith('video/')) {
        form.append('video', fs.createReadStream(filePath));
        endpoint = 'sendVideo';
    } else {
        form.append('document', fs.createReadStream(filePath));
        endpoint = 'sendDocument';
    }

    await axios.post(
        `https://api.telegram.org/bot${TG_TOKEN}/${endpoint}`,
        form,
        { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity }
    );
}

// ─── View-Once Interceptor ────────────────────────────────────────────────────

client.on('message', async (msg) => {
    // Only care about view-once messages that have media
    if (!msg.isViewOnce || !msg.hasMedia) return;

    let contact;
    try {
        contact = await msg.getContact();
    } catch {
        contact = { pushname: 'Unknown', number: '?' };
    }

    const senderName = contact.pushname || contact.name || 'Unknown';
    const senderNumber = contact.number || msg.from;
    const chat = await msg.getChat();
    const chatName = chat.isGroup ? chat.name : 'Private Chat';
    const timeStr = new Date().toLocaleString();

    console.log(`👁️ View-once media received from ${senderName} (${senderNumber})`);

    let media;
    try {
        media = await msg.downloadMedia();
    } catch (err) {
        console.error('❌ Failed to download view-once media:', err.message);
        return;
    }

    if (!media || !media.data) {
        console.warn('⚠️ Media is empty or unavailable.');
        return;
    }

    // Write to a temp file
    const ext = getExtension(media.mimetype);
    const tempPath = `./viewonce_${msg.id.id}.${ext}`;

    try {
        fs.writeFileSync(tempPath, Buffer.from(media.data, 'base64'));

        const caption =
            `👁️ *View-Once Media Intercepted!*\n` +
            `👤 *Sender:* ${senderName}\n` +
            `📞 *Number:* ${senderNumber}\n` +
            `💬 *Chat:* ${chatName}\n` +
            `🕒 *Time:* ${timeStr}`;

        await sendMediaToTelegram(tempPath, media.mimetype, caption);
        console.log('🚀 View-once media forwarded to Telegram.');
    } catch (err) {
        console.error('❌ Failed to send to Telegram:', err.message);
    } finally {
        // Always clean up the temp file
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
});

// ─── Error handling ───────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => console.log('⚠️ Error:', reason));

client.initialize();
