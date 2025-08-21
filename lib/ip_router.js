import { HangupError, TimeoutError, ExitError } from './errors.js';
import Call from './call.js';
import { Router } from 'express';
import EventEmitter from 'events';
import colors from 'colors';
import globalDefaults from './defaults.js';
import ms from 'ms';
import { parse as parseStack } from 'stack-trace';

function ipRouter(options = {}) {
    const ops = {
        printLog: options.printLog,
        timeout: options.timeout, // שניות או ms string – יומר בתוך call
        uncaughtErrorHandler: options.uncaughtErrorHandler || null,
        defaults: options.defaults || {}
    };

    if (options.uncaughtErrorsHandler) {
        throw new Error('ipRouter: uncaughtErrorsHandler is renamed to uncaughtErrorHandler');
    }

    if (typeof ops.timeout !== 'undefined' && !ms(ops.timeout) && isNaN(Number(ops.timeout))) {
        throw new Error('ipRouter: timeout must be a valid ms string or number (seconds)');
    }

    if (ops.defaults.id_list_message?.prependToNextAction) {
        throw new Error('ipRouter: prependToNextAction is not supported with the new JSON API');
    }

    let mergedDefaults = {
        printLog: ops.printLog ?? globalDefaults.printLog,
        removeInvalidChars: ops.defaults?.removeInvalidChars ?? globalDefaults.removeInvalidChars,
        read: {
            timeout: ops.timeout ?? globalDefaults.read.timeout,
            tap: {
                ...globalDefaults.read.tap,
                ...ops.defaults.read?.tap
            },
            stt: {
                ...globalDefaults.read.stt,
                ...ops.defaults.read?.stt
            },
            record: {
                ...globalDefaults.read.record,
                ...ops.defaults.read?.record
            }
        },
        simpleMenu: {
            ...globalDefaults.simpleMenu,
            ...ops.defaults.simpleMenu
        },
        id_list_message: {
            ...globalDefaults.id_list_message,
            ...ops.defaults.id_list_message
        }
    };

    const eventsEmitter = new EventEmitter();
    const expressRouter = Router();
    const activeCalls = {};

    function logger(callId, msg, color = 'blue') {
        if (!mergedDefaults.printLog) return;
        console.log(colors[color](`[${callId}]: ${msg}`));
    }

    function deleteCall(callId) {
        delete activeCalls[callId];
    }

    async function makeNewCall(fn, callId, call, res) {
        try {
            await fn(call);
            if (!res.headersSent) {
                const response = currentCall.modules?.[currentCall.modules.length - 1] ?? {};
                res.json(response);
        }
            deleteCall(callId);
            logger(callId, '🆗 the function is done');
        } catch (error) {
            deleteCall(callId);

            const [trace] = parseStack(error);
            const errorPath = trace ? `(${trace.getFileName()}:${trace.getLineNumber()}:${trace.getColumnNumber()})` : '';

            if (error instanceof HangupError) {
                logger(callId, '👋 the call was hangup by the caller');
            } else if (error instanceof TimeoutError) {
                logger(callId, `💣 timeout for receiving a response from the caller (after ${ops.timeout ?? mergedDefaults.read.timeout}s)`);
            } else if (error instanceof ExitError) {
                logger(callId, `👋 the call was exited from the flow ${errorPath} ${error.context ? `(by ${error.context?.caller} to ${error.context?.target})` : ''}`);
            } else {
                if (ops.uncaughtErrorHandler) {
                    logger(callId, `💥 Uncaught error. applying uncaughtErrorHandler ${errorPath}`, 'red');
                    try {
                        await ops.uncaughtErrorHandler(error, call);
                    } catch (err) {
                        const [trace2] = parseStack(err);
                        const errorPath2 = trace2 ? `${trace2.getFileName()}:${trace2.getLineNumber()}:${trace2.getColumnNumber()}` : '';
                        if (err instanceof ExitError) {
                            console.log(`👋 the call was exited from the flow ${errorPath2} ${err.context ? `(by ${err.context?.caller} to ${err.context?.target})` : ''}`);
                        } else {
                            console.error('💥 Error in uncaughtErrorHandler! process is crashing');
                            throw err;
                        }
                    }
                } else {
                    logger(callId, `💥 Uncaught error ${errorPath}: ${error.message}`, 'red');
                    throw error;
                }
            }
        }
    }

    function attachRoute(method, path, fn) {
        expressRouter[method](path, async (req, res) => {
            const values = req.method === 'POST' ? req.body : req.query;
            const callId = values.PBXcallId || values.ApiCallId || values.call_id || 'UNKNOWN';

            let currentCall = activeCalls[callId];
            const isNewCall = !currentCall;

            if (!currentCall) {
                currentCall = new Call(callId, eventsEmitter, mergedDefaults);
                currentCall.setReqValues(req, res);

                if (values.PBXcallStatus === 'HANGUP' || values.hangup === 'yes') {
                    logger(callId, '👋 call is hangup (outside the function)');
                    eventsEmitter.emit('call_hangup', currentCall);
                    return res.json({ message: 'hangup' });
                }
                activeCalls[callId] = currentCall;
                logger(callId, `📞 new call - from ${values.PBXphone || values.ApiPhone || 'AnonymousPhone'}`);
                eventsEmitter.emit('new_call', currentCall);
            } else {
                currentCall.setReqValues(req, res);
            }

            if (isNewCall) {
                await makeNewCall(fn, callId, currentCall, res);
            } else {
                // קריאה חוזרת – שחרור ההמתנה
                eventsEmitter.emit(callId, values.PBXcallStatus === 'HANGUP' || values.hangup === 'yes');
                eventsEmitter.emit(values.PBXcallStatus === 'HANGUP' || values.hangup === 'yes' ? 'call_hangup' : 'call_continue', currentCall);
            }
        });
    }

    const proxyHandler = {
        get(_, key) {
            if (['get', 'post', 'all'].includes(key)) {
                return (path, fn) => attachRoute(key, path, fn);
            } else if (key === 'logger') {
                return logger;
            } else if (key === 'deleteCall') {
                return deleteCall;
            } else if (key === 'activeCalls') {
                return activeCalls;
            } else if (key === 'defaults') {
                return mergedDefaults;
            } else if (key === 'events') {
                return eventsEmitter;
            } else if (key === 'asExpressRouter') {
                return new Proxy(expressRouter, proxyHandler);
            } else if (['use', 'handle', 'set', 'name', 'length', 'caseSensitive', 'stack'].includes(key)) {
                // מיפוי יכולות של express Router כמו קודם
                return expressRouter[key];
            }

            return expressRouter[key];
        },
        set(_, key, value) {
            if (key === 'defaults') {
                mergedDefaults = { ...mergedDefaults, ...value };
            } else {
                throw new Error(`ipRouter: ${key.toString()} is not supported yet [set]`);
            }
            return true;
        }
    };

    return new Proxy(expressRouter, proxyHandler);
}

export default ipRouter;
