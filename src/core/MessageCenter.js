/**
 * ============================================================================
 * MikeyTV - Message Center
 * ============================================================================
 * Keeps the admin messages received from the Jellyfin server, shows them as a
 * toast without taking focus or pausing playback, and sends replies through
 * the MikeyTV Messaging server plugin.
 *
 * Why the plugin: Jellyfin has no reply channel. A normal user cannot message
 * another user's session without EnableRemoteControlOfOtherUsers.
 * ============================================================================
 */

import { eventBus } from './EventBus.js';
import { api } from '../api/ApiClient.js';
import { storage } from '../utils/StorageService.js';
import { toast } from '../ui/Toast.js';
import { i18n } from '../utils/i18n.js';
import { logger } from '../utils/Logger.js';

const log = logger.create('MessageCenter');

export const MESSAGE_ICON =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

export const MESSAGE_STORAGE_KEY = 'mikeytv:messages';
export const MAX_STORED_MESSAGES = 20;
export const MAX_REPLY_LENGTH = 200;
const MIN_TOAST_MS = 12000;
const MAX_TOAST_MS = 30000;

/**
 * Toast time on screen. The dashboard always asks for 5 seconds, which is too
 * short to read a message and react on a TV, so that request acts as a minimum
 * only: longer messages stay longer, up to 30 seconds.
 * @param {string|number} requestedMs - TimeoutMs (the server sends a string)
 * @param {string} text - Message text
 * @returns {number} Milliseconds
 */
export function getToastDuration(requestedMs, text) {
    const requested = parseInt(requestedMs, 10) || 0;
    const byLength = 6000 + String(text || '').length * 60;
    return Math.min(MAX_TOAST_MS, Math.max(MIN_TOAST_MS, requested, byLength));
}

class MessageCenter {
    constructor() {
        this._messages = [];
        this._nextId = 1;
        this._replySupport = null;
        this._toastEl = null;
        this._onShortcut = this._onShortcut.bind(this);
    }

    init() {
        this._load();
        // Messages and the plugin check belong to the signed-in session.
        eventBus.on('auth:logout', () => this.clear());
        eventBus.on('auth:login', () => {
            this._replySupport = null;
        });
        window.addEventListener('keydown', this._onShortcut, true);
        this._changed();
    }

    /** @returns {Array<Object>} Messages, newest first */
    getMessages() {
        return this._messages.slice();
    }

    getUnreadCount() {
        return this._messages.filter((m) => !m.read).length;
    }

    hasMessages() {
        return this._messages.length > 0;
    }

    /**
     * Handle a DisplayMessage command from the server.
     * @param {Object} args - { Header, Text, TimeoutMs }
     */
    receive(args) {
        if (!args) return;
        const header = args.Header || '';
        const text = args.Text || '';
        if (!header && !text) return;

        const message = {
            id: `${Date.now()}-${this._nextId++}`,
            header,
            text,
            receivedAt: Date.now(),
            read: false,
            reply: null
        };
        this._messages.unshift(message);
        this._messages.length = Math.min(this._messages.length, MAX_STORED_MESSAGES);
        this._save();
        this._changed();
        this._showToast(message, args.TimeoutMs);
        // Find out early, so the panel never has to wait when it opens.
        this.checkReplySupport();
    }

    markAllRead() {
        let changed = false;
        this._messages.forEach((m) => {
            if (!m.read) {
                m.read = true;
                changed = true;
            }
        });
        if (changed) {
            this._save();
            this._changed();
        }
    }

    clear() {
        this._messages = [];
        this._replySupport = null;
        storage.removeItem(MESSAGE_STORAGE_KEY);
        this._changed();
    }

    /**
     * Whether the server has the reply plugin. A server or another plugin can
     * answer unknown paths with HTML, so only an explicit enabled:true counts.
     * Failures are not cached, so a later check can succeed.
     * @returns {Promise<boolean>}
     */
    async checkReplySupport() {
        if (this._replySupport === true) return true;
        try {
            const status = await api.get('/MikeyTV/Messages/Status', {}, { silent: true, warnOnError: true });
            this._replySupport = !!status && status.enabled === true;
        } catch (err) {
            log.debug('Reply plugin not available:', err?.message || err);
            this._replySupport = false;
        }
        return this._replySupport;
    }

    /**
     * Send a reply to the admin. Throws if it fails, so the panel can keep the
     * text and offer another try.
     * @param {string} messageId
     * @param {string} text
     * @returns {Promise<void>}
     */
    async sendReply(messageId, text) {
        const reply = String(text || '')
            .trim()
            .slice(0, MAX_REPLY_LENGTH);
        if (!reply) throw new Error('Reply is empty');
        const message = this._messages.find((m) => m.id === messageId);
        await api.post('/MikeyTV/Messages/Reply', {
            Text: reply,
            OriginalText: message ? message.text : ''
        });
        if (message) {
            message.reply = reply;
            message.read = true;
            this._save();
            this._changed();
        }
    }

    _showToast(message, requestedMs) {
        const line = message.header ? `${message.header}: ${message.text}` : message.text;
        const el = toast.show(line, getToastDuration(requestedMs, message.text));
        this._toastEl = el;
        if (!el) return;

        const hint = document.createElement('span');
        hint.className = 'message-toast-hint';
        hint.textContent = i18n.t('MessageReplyHint') || 'Select here or use the message icon to reply';
        el.classList.add('message-toast');
        el.appendChild(hint);
        // Pointer and touch only. The toast never takes remote focus.
        el.addEventListener('click', () => eventBus.emit('messages:open'));
    }

    _isToastVisible() {
        return !!(this._toastEl && this._toastEl.parentNode);
    }

    /**
     * Optional shortcuts while a message toast is on screen: Blue on remotes
     * that have it, unless the user has mapped Blue to something else, and Menu
     * where the platform passes that key to the app.
     */
    _onShortcut(e) {
        if (!this._isToastVisible()) return;
        const isBlue = e.keyCode === 406 && (storage.getItem('pref:remoteBlueAction') || 'none') === 'none';
        const isMenu = e.keyCode === 82 || e.key === 'ContextMenu';
        if (!isBlue && !isMenu) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        eventBus.emit('messages:open');
    }

    _load() {
        try {
            const saved = JSON.parse(storage.getItem(MESSAGE_STORAGE_KEY) || '[]');
            this._messages = Array.isArray(saved) ? saved.slice(0, MAX_STORED_MESSAGES) : [];
        } catch (err) {
            this._messages = [];
        }
    }

    _save() {
        try {
            storage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(this._messages));
        } catch (err) {
            log.warn('Could not save messages:', err);
        }
    }

    _changed() {
        eventBus.emit('messages:changed');
        syncMessageIndicators();
    }
}

/**
 * Show the sidebar and player message buttons only when there are messages,
 * and put the unread dot on them. Hidden OSD buttons also leave the D-pad path.
 */
export function syncMessageIndicators() {
    if (typeof document === 'undefined') return;
    const visible = messageCenter.hasMessages();
    const unread = messageCenter.getUnreadCount() > 0;
    document.querySelectorAll('[data-message-indicator]').forEach((btn) => {
        btn.classList.toggle('hidden', !visible);
        if (visible) btn.style.display = '';
        btn.setAttribute('tabindex', visible ? '0' : '-1');
        btn.classList.toggle('has-unread-messages', unread);
    });
}

export const messageCenter = new MessageCenter();
