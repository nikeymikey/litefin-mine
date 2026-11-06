/**
 * ============================================================================
 * MikeyTV - Message Panel
 * ============================================================================
 * Small side panel for reading and replying to admin messages. Playback keeps
 * running behind it.
 *
 * Keys: FocusManager is suspended during playback and the OSD has its own key
 * handling, so neither can drive this panel in every state. While it is open
 * it takes keys at window capture, before the platform adapters on document
 * see them, and moves its own focus marker. Nothing underneath reacts and
 * nothing underneath loses its focus.
 * ============================================================================
 */

import '../styles/messages.css';

import { eventBus } from '../core/EventBus.js';
import { messageCenter, MAX_REPLY_LENGTH } from '../core/MessageCenter.js';
import { i18n } from '../utils/i18n.js';
import { logger } from '../utils/Logger.js';

const log = logger.create('MessagePanel');

const BACK_KEYS = [461, 10009, 27, 4];
// A bridged Back from native Android can follow the keydown for the same press.
const BACK_GUARD_MS = 400;

const t = (key, fallback) => {
    const value = i18n.t(key);
    return value && value !== key ? value : fallback;
};

class MessagePanel {
    constructor() {
        this.isVisible = false;
        this._el = null;
        this._focusables = [];
        this._index = 0;
        this._openedAt = 0;
        this._closedAt = 0;
        this._sending = false;
        this._onKey = this._onKey.bind(this);
    }

    init() {
        eventBus.on('messages:open', () => this.open());
    }

    async open() {
        if (this.isVisible) return;
        this.isVisible = true;
        this._openedAt = Date.now();

        this._el = document.createElement('aside');
        this._el.className = 'message-panel';
        this._el.setAttribute('role', 'dialog');
        this._el.setAttribute('aria-label', t('Messages', 'Messages'));
        document.body.appendChild(this._el);

        window.addEventListener('keydown', this._onKey, true);
        window.addEventListener('keyup', this._onKey, true);

        const canReply = await messageCenter.checkReplySupport();
        if (!this.isVisible) return;
        this._render(canReply);
        messageCenter.markAllRead();
    }

    close() {
        if (!this.isVisible) return;
        this.isVisible = false;
        this._closedAt = Date.now();
        window.removeEventListener('keydown', this._onKey, true);
        window.removeEventListener('keyup', this._onKey, true);
        const input = this._el && this._el.querySelector('input');
        if (input) input.blur();
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
        this._el = null;
        this._focusables = [];
    }

    /**
     * Back from App's central key:back handler. True means Back was used here.
     * @returns {boolean}
     */
    handleBack() {
        if (this.isVisible) {
            this.close();
            return true;
        }
        return Date.now() - this._closedAt < BACK_GUARD_MS;
    }

    _render(canReply) {
        const messages = messageCenter.getMessages();
        const newest = messages[0];
        const el = this._el;
        el.innerHTML = '';

        const title = document.createElement('h2');
        title.className = 'message-panel-title';
        title.textContent = t('Messages', 'Messages');
        el.appendChild(title);

        const list = document.createElement('div');
        list.className = 'message-panel-list';
        messages.slice(0, 5).forEach((m, i) => list.appendChild(this._renderMessage(m, i === 0)));
        el.appendChild(list);

        this._status = document.createElement('p');
        this._status.className = 'message-panel-status';
        this._status.setAttribute('aria-live', 'polite');
        el.appendChild(this._status);

        const actions = document.createElement('div');
        actions.className = 'message-panel-actions';
        el.appendChild(actions);
        this._focusables = [];

        if (canReply && newest) {
            [
                t('MessageQuickGotIt', 'Got it'),
                t('MessageQuickThanks', 'Thanks'),
                t('MessageQuickNotNow', 'Not now')
            ].forEach((label) => {
                const btn = this._button(label, () => this._send(newest.id, label));
                actions.appendChild(btn);
            });

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'message-panel-input';
            input.maxLength = MAX_REPLY_LENGTH;
            input.placeholder = t('MessageTypeReply', 'Type a reply');
            input.addEventListener('click', () => this._setFocus(this._focusables.indexOf(input)));
            actions.appendChild(input);
            this._focusables.push(input);
            this._input = input;
            this._replyTarget = newest.id;
        } else if (!canReply) {
            this._status.textContent = t(
                'MessageRepliesUnavailable',
                'Replies need the MikeyTV Messaging plugin on the server.'
            );
        }

        actions.appendChild(this._button(t('ButtonClose', 'Close'), () => this.close()));
        this._setFocus(0);
    }

    _renderMessage(message, isNewest) {
        const item = document.createElement('div');
        item.className = isNewest ? 'message-panel-item is-newest' : 'message-panel-item';

        const header = document.createElement('div');
        header.className = 'message-panel-header';
        header.textContent = message.header;
        item.appendChild(header);

        // textContent throughout: message text comes from the server.
        const text = document.createElement('div');
        text.className = 'message-panel-text';
        text.textContent = message.text;
        item.appendChild(text);

        if (message.reply) {
            const reply = document.createElement('div');
            reply.className = 'message-panel-reply';
            reply.textContent = `${t('MessageYouReplied', 'You replied')}: ${message.reply}`;
            item.appendChild(reply);
        }
        return item;
    }

    _button(label, action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'message-panel-btn';
        btn.textContent = label;
        btn.tabIndex = -1;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            action();
        });
        this._focusables.push(btn);
        return btn;
    }

    _setFocus(index) {
        const count = this._focusables.length;
        if (!count) return;
        this._index = (index + count) % count;
        this._focusables.forEach((node, i) => node.classList.toggle('is-focused', i === this._index));
        const target = this._focusables[this._index];
        // Real DOM focus only for the input, which opens the on-screen keyboard
        // when the user presses OK on it rather than as they pass over it.
        if (target.tagName !== 'INPUT' && document.activeElement === this._input && this._input) {
            this._input.blur();
        }
        if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
    }

    async _send(messageId, text) {
        if (this._sending || !String(text || '').trim()) return;
        this._sending = true;
        this._status.textContent = t('MessageSending', 'Sending…');
        try {
            await messageCenter.sendReply(messageId, text);
            this._status.textContent = t('MessageSent', 'Reply sent');
            setTimeout(() => this.close(), 1200);
        } catch (err) {
            log.warn('Reply failed:', err?.message || err);
            this._status.textContent = t('MessageSendFailed', "Couldn't send. Try again.");
        } finally {
            this._sending = false;
        }
    }

    _onKey(e) {
        const inputFocused = this._input && document.activeElement === this._input;
        const key = e.keyCode;
        const isBack = BACK_KEYS.includes(key) || e.key === 'GoBack' || e.key === 'BrowserBack' || (key === 8 && !inputFocused);

        // Nothing underneath sees any key while the panel is open. Typing still
        // reaches the input because the default action is left alone for it.
        e.stopImmediatePropagation();

        const isTextKey = inputFocused && !isBack && key !== 13 && key !== 38 && key !== 40;
        if (isTextKey) return;
        e.preventDefault();
        if (e.type !== 'keydown') return;

        if (isBack) {
            this.close();
            return;
        }
        if (key === 38 || key === 37) {
            this._setFocus(this._index - 1);
        } else if (key === 40 || key === 39) {
            this._setFocus(this._index + 1);
        } else if (key === 13) {
            // Ignore the held OK that opened the panel.
            if (e.repeat || Date.now() - this._openedAt < 250) return;
            this._activate(inputFocused);
        }
    }

    _activate(inputFocused) {
        const target = this._focusables[this._index];
        if (!target) return;
        if (target.tagName === 'INPUT') {
            if (inputFocused) {
                this._send(this._replyTarget, target.value);
            } else {
                target.focus();
            }
        } else {
            target.click();
        }
    }
}

export const messagePanel = new MessagePanel();
