import {
    makeFilesArray,
    buildGetDTMF,
    buildStt,
    buildRecord,
    buildSimpleMenu,
    buildSimpleRouting,
    buildIpRouting,
    buildExtensionChange
} from './response-functions.js';

import { HangupError, TimeoutError, ExitError, CallError } from './errors.js';
import colors from 'colors';
import ms from 'ms';

function shiftDuplicatedValues(values) {
    for (const key of Object.keys(values)) {
        const value = values[key];
        if (Array.isArray(value)) values[key] = value[value.length - 1];
    }
    return values;
}

class Call {
    #eventsEmitter;
    #defaults;
    #valNameIndex;
    #timeoutId;
    #values;

    constructor(callId, eventsEmitter, defaults) {
        this.#eventsEmitter = eventsEmitter;
        this.#defaults = defaults;

        this.callId = callId;
        this.did = '';
        this.phone = '';
        this.real_did = '';
        this.extension = '';

        this.#valNameIndex = 0;
    }

    get values() {
        return this.#values;
    }

    set values(_) {
        throw new CallError({ message: 'call.values is read-only', call: this });
    }

    #logger(msg, color = 'blue') {
        if (!this.#defaults.printLog) return;
        console.log(colors[color](`[${this.callId}]: ${msg}`));
    }

    /** === API חדש – פעולת קריאה כללית שמחזירה מודול JSON אחד בכל פעם === */
    async read(messages, mode = 'tap', options = {}) {
        if (!Array.isArray(messages)) {
            throw new CallError({ message: `messages must be array, got ${typeof messages}`, call: this });
        }
        if (!['tap', 'stt', 'record'].includes(mode)) {
            throw new CallError({ message: `mode must be 'tap'|'stt'|'record'`, call: this });
        }

        /** שמות ישנים -> חדשים (שגיאה כדי לעדכן בקוד המשתמש) */
        const deprecates = [
            ['play_ok_mode', 'confirmType'],
            ['read_none', 'allow_empty'],
            ['read_none_var', 'empty_val'],
            ['block_change_type_lang', 'block_change_keyboard'],
            ['min', 'min (use tap.min)'],
            ['max', 'max (use tap.max)'],
            ['block_zero', 'skipKey / enabledKeys'],
            ['block_asterisk', 'skipKey / enabledKeys'],
            ['record_ok', 'confirm'],
            ['record_hangup', 'save_on_hangup (not used in new API record)'],
            ['record_attach', 'append_to_existing_file (not used in new API record)'],
            ['allow_typing', 'confirmType'],
            ['use_records_engine', 'campaignBilling'],
            ['lenght_min', 'min'],
            ['length_min', 'min'],
            ['lenght_max', 'max'],
            ['length_max', 'max']
        ];
        for (const [oldName, newName] of deprecates) {
            if (typeof options[oldName] !== 'undefined') {
                throw new CallError({ message: `read option '${oldName}' is deprecated, use '${newName}'`, call: this });
            }
        }

        // קבצים/טקסטים להשמעה
        const files = makeFilesArray(
            messages,
            { removeInvalidChars: options.removeInvalidChars ?? this.#defaults.removeInvalidChars },
            this
        );

        // בניית מודול לפי מצב
        let moduleObj;
        if (mode === 'tap') {
            const tapOps = {
                ...this.#defaults.read.tap,
                ...options,
                timeout: options.timeout ?? this.#defaults.read.timeout ?? this.#defaults.read.tap.timeout
            };
            // שמירה על שם הערך
            tapOps.valName = tapOps.valName || `val_${++this.#valNameIndex}`;
            moduleObj = buildGetDTMF(files, tapOps, this);
        } else if (mode === 'stt') {
            const sttOps = { ...this.#defaults.read.stt, ...options };
            sttOps.valName = sttOps.valName || `val_${++this.#valNameIndex}`;
            moduleObj = buildStt(files, sttOps, this);
        } else if (mode === 'record') {
            const recOps = { ...this.#defaults.read.record, ...options };
            recOps.valName = recOps.valName || `val_${++this.#valNameIndex}`;
            moduleObj = buildRecord(files, recOps, this);
        }

        // שליחת המודול ללקוח
        this.send(moduleObj);

        // המתנה לערך מהמערכת (או ניתוק/טיימאאוט)
        await this.blockRunningUntilNextRequest(options.timeout ?? this.#defaults.read.timeout);

        const valName = moduleObj.name;
        const value = this.#values[valName];
        if (options.allow_empty && String(value) === String(options.empty_val)) {
            return options.empty_val;
        }
        return value;
    }

    /** שליחת מודול תפריט */
    id_list_message(messages, options = {}) {
        const files = makeFilesArray(
            messages,
            { removeInvalidChars: options.removeInvalidChars ?? this.#defaults.id_list_message.removeInvalidChars ?? this.#defaults.removeInvalidChars },
            this
        );
        const menuOps = { ...this.#defaults.simpleMenu, ...options };
        const moduleObj = buildSimpleMenu(files, menuOps, this);
        this.send(moduleObj);

        // אם יש extensionChange – מיד יוצאים (כמו redirect)
        if (moduleObj.extensionChange) {
            throw new ExitError(this, {
                target: moduleObj.extensionChange,
                caller: 'simpleMenu'
            });
        }
    }

    simpleRouting(options = {}) {
        const moduleObj = buildSimpleRouting(options, this);
        this.send(moduleObj);
    }

    ipRouting(options = {}) {
        const moduleObj = buildIpRouting(options, this);
        this.send(moduleObj);
    }

    go_to_folder(target) {
        /** במודל החדש זה extensionChange */
        const moduleObj = buildExtensionChange(
            target?.startsWith('/') || target === '..' || target === '.'
                ? { extensionPathChange: target }
                : { extensionIdChange: target },
            this
        );
        this.send(moduleObj);
        throw new ExitError(this, { target, caller: 'extensionChange' });
    }

    restart_ext() {
        const currentFolder = this.extension;
        return this.go_to_folder(`/${currentFolder}`);
    }

    hangup() {
        return this.go_to_folder('hangup');
    }

    /** שליחה ללקוח – תמיד JSON לפי ה־API החדש */
    send(data) {
        this.res.json(data);
    }

    setReqValues(req, res) {
        this.req = req;
        this.res = res;

        const raw = shiftDuplicatedValues(req.method === 'POST' ? req.body : req.query);

        /** תמיכה בשמות הפרמטרים החדשים (PBX*) + תאימות לאחור ל־ApiPhone וכו' */
        this.#values = raw;

        // מזהי PBX לפי התיעוד החדש
        this.phone = raw.PBXphone || raw.ApiPhone || '';
        this.callId = raw.PBXcallId || raw.ApiCallId || this.callId;
        this.did = raw.PBXdid || raw.ApiDID || '';
        this.real_did = raw.PBXdid || '';
        this.extension = raw.PBXextensionId || raw.folder || raw.PBXextensionPath || '';

        // לוגי בסיס
        if (raw.PBXcallStatus === 'HANGUP' || raw.hangup === 'yes') {
            this.#logger('call hangup received');
        }
    }

    /** המתנה לאירוע הבא או טיימאאוט */
    async blockRunningUntilNextRequest(timeout) {
        const t = typeof timeout === 'string' ? ms(timeout) : (Number(timeout) * 1000 || 0);
        if (!t) return;

        await new Promise((resolve, reject) => {
            this.#timeoutId = setTimeout(() => reject(new TimeoutError(this)), t);
            this.#eventsEmitter.once(this.callId, (isHangup) => {
                clearTimeout(this.#timeoutId);
                if (isHangup) return reject(new HangupError(this));
                resolve();
            });
        });
    }

    /** מאפיינים לא נתמכים (תאימות לאחור) */
    get query() { throw new CallError({ message: 'call.query is deprecated, use call.values instead', call: this }); }
    get body() { throw new CallError({ message: 'call.body is deprecated, use call.values instead', call: this }); }
    get params() { throw new CallError({ message: 'call.params is deprecated, use call.req.params instead', call: this }); }
}

export default Call;
