import { CallError } from './errors.js';
import colors from 'colors';

/** טיפוסי ערכים שנשתמש בהם בתוך items של files */
const dataTypes = {
    fileId: 'fileId',
    extensionId: 'extensionId',
    extensionPath: 'extensionPath',
    text: 'text',
    number: 'number',
    digits: 'digits',
    system_message: 'system_message' // במידה ואתה עובד עם מזהי מערכת פנימיים משלך
};

/** ניקוי תווים לא חוקיים לטקסטים (TTS/text) לפי הצורך */
function validateCharsForTTS(text, call) {
    const invalidCharsRgx = /[.\-"'&|]/g;
    const invalidCharsMatched = String(text).match(invalidCharsRgx);
    if (invalidCharsMatched) {
        throw new CallError({
            message: `message '${text}' has invalid chars for Yemot TTS: ${colors.red(invalidCharsMatched.join(', '))}`,
            call
        });
    }
}

/**
 * המרה של מערך הודעות/פריטים למערך files של ה־API החדש.
 * תומך באלמנטים מסוגים: text/number/digits או קבצי שמע לפי fileId/extensionId/extensionPath.
 * @param {Array} messages [{ type: 'text'|'number'|'digits'|'file', data: string|number, activatedKeys?: string, ... }]
 * @param {Object} options { removeInvalidChars?: boolean }
 */
export function makeFilesArray(messages, options = {}, call) {
    if (!Array.isArray(messages)) {
        throw new CallError({ message: `messages must be array, got ${typeof messages}`, call });
    }

    const files = [];

    for (const msg of messages) {
        if (typeof msg?.data === 'undefined') {
            throw new CallError({ message: 'message data is required, got undefined', call });
        }

        if (['number', 'digits'].includes(msg.type) && Number.isInteger(msg.data)) {
            // ok
        } else if (typeof msg.data !== 'string') {
            throw new CallError({ message: `message data must be string/number, got ${typeof msg.data}`, call });
        }

        /** בניית אובייקט file לפי הטיפוס */
        switch (msg.type) {
            case 'file': {
                const entry = {};
                if (msg.fileId || msg.data) entry.fileId = String(msg.fileId ?? msg.data);
                if (msg.extensionId) entry.extensionId = String(msg.extensionId);
                if (msg.extensionPath) entry.extensionPath = String(msg.extensionPath);
                if (!entry.fileId && !entry.extensionPath) {
                    throw new CallError({ message: `file message must include fileId or extensionPath`, call });
                }
                files.push(entry);
                break;
            }
            case 'text': {
                const text = String(msg.data);
                if (options.removeInvalidChars) validateCharsForTTS(text, call);
                files.push({ text });
                break;
            }
            case 'number': {
                const n = Number(msg.data);
                if (!Number.isFinite(n)) throw new CallError({ message: `number message must be numeric`, call });
                files.push({ number: n });
                break;
            }
            case 'digits': {
                const d = String(msg.data);
                if (!/^\d+$/.test(d)) throw new CallError({ message: `digits message must contain only digits`, call });
                files.push({ digits: d });
                break;
            }
            case 'system_message': {
                files.push({ system_message: String(msg.data) });
                break;
            }
            default:
                throw new CallError({ message: `unsupported message type '${msg.type}'`, call });
        }
    }

    return files;
}

/** getDTMF – בניית אובייקט מודול */
export function buildGetDTMF(files, options, call) {
    const name = options?.val_name || options?.valName;
    const max = options?.max_digits ?? '';
    const min = options?.min_digits ?? 1;
    const timeout = options?.sec_wait ?? 7;
    const confirmType = options?.typing_playback_mode ?? 'digits';
    const setMusic = options?.set_music ? 'yes' : 'no';

    return {
        type: 'getDTMF',
        name,
        max,
        min,
        timeout,
        skipKey: options?.skipKey || '',
        skipValue: options?.skipValue || '',
        confirmType, // "number" | "digits" | "no"
        setMusic,
        files
    };
}

/** record – בניית אובייקט מודול */
export function buildRecord(files, options, call) {
    const name = options?.val_name || options?.valName;
    return {
        type: 'record',
        name,
        max: options?.max ?? options?.max_length ?? '',
        min: options?.min ?? options?.min_length ?? '',
        confirm: options?.confirm ?? (options?.no_confirm_menu ? 'no' : 'confirmOnly'),
        fileName: options?.fileName ?? options?.file_name ?? '',
        saveFolder: options?.saveFolder ?? options?.path ?? '',
        files
    };
}

/** stt – בניית אובייקט מודול */
export function buildStt(files, options, call) {
    const name = options?.val_name || options?.valName;
    return {
        type: 'stt',
        name,
        max: options?.max ?? '',
        min: options?.min ?? '',
        fileName: options?.fileName ?? '',
        saveFolder: options?.saveFolder ?? '',
        campaignBilling: options?.campaignBilling ?? '',
        files
    };
}

/** simpleMenu – בניית אובייקט מודול */
export function buildSimpleMenu(files, options, call) {
    return {
        type: 'simpleMenu',
        name: options?.val_name  || options?.valName,
        times: options?.times ?? 1,
        timeout: options?.timeout ?? 5,
        enabledKeys: options?.enabledKeys ?? '1,2,3,4,5,6,7,8,9,0,#,*',
        setMusic: options?.setMusic ?? 'no',
        errorReturn: options?.errorReturn ?? 'ERROR',
        extensionChange: options?.extensionChange ?? '',
        files
    };
}

/** simpleRouting */
export function buildSimpleRouting(options, call) {
    if (!options?.dialPhone) {
        throw new CallError({ message: `simpleRouting requires dialPhone`, call });
    }
    return {
        type: 'simpleRouting',
        name: options?.name ?? 'dial',
        dialPhone: String(options.dialPhone),
        displayNumber: options?.displayNumber ?? '',
        addDigits: options?.addDigits ?? '',
        routingMusic: options?.routingMusic ?? 'no',
        ringSec: options?.ringSec ?? '',
        limit: options?.limit ?? '',
        campaignBilling: options?.campaignBilling ?? ''
    };
}

/** ipRouting */
export function buildIpRouting(options, call) {
    if (!options?.dialPhone || !options?.dialIP) {
        throw new CallError({ message: `ipRouting requires dialPhone and dialIP`, call });
    }
    return {
        type: 'ipRouting',
        name: options?.name ?? 'dial',
        dialPhone: String(options.dialPhone),
        dialIP: String(options.dialIP),
        displayNumber: options?.displayNumber ?? '',
        routingMusic: options?.routingMusic ?? 'no',
        ringSec: options?.ringSec ?? '',
        limit: options?.limit ?? ''
    };
}

/** extensionChange */
export function buildExtensionChange(options, call) {
    if (!options?.extensionIdChange && !options?.extensionPathChange) {
        throw new CallError({ message: `extensionChange requires extensionIdChange or extensionPathChange`, call });
    }
    return {
        type: 'extensionChange',
        extensionIdChange: options?.extensionIdChange ?? '',
        extensionPathChange: options?.extensionPathChange ?? ''
    };
}
