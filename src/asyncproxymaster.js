'use strict';

var AsyncProxyMaster = (function AsyncProxyMasterClosure() {
    var callId = 0;
    var isGetMasterEntryUrlCalled = false;
    var masterEntryUrl = getBaseUrlFromEntryScript();
    
    function AsyncProxyMaster(scriptsToImport, ctorName, ctorArgs, options) {
        var self = this;
        options = options || {};
        
        var slaveScriptContentString = mainSlaveScriptContent.toString();
        var scriptUrl = getScriptName();
        slaveScriptContentString = slaveScriptContentString.replace(
            'SCRIPT_PLACEHOLDER', scriptUrl);
        var slaveScriptContentBlob = new Blob(
            ['(', slaveScriptContentString, ')()'],
            { type: 'application/javascript' });
        var slaveScriptUrl = URL.createObjectURL(slaveScriptContentBlob);
        
        this._callbacks = [];
        this._pendingPromiseCalls = [];
        this._subWorkerById = [];
        this._subWorkers = [];
        this._worker = new Worker(slaveScriptUrl);
        this._worker.onmessage = onWorkerMessageInternal;
        this._userDataHandler = null;
        this._notReturnedFunctions = 0;
        this._functionsBufferSize = options['functionsBufferSize'] || 5;
        this._pendingMessages = [];
        
        this._worker.postMessage({
            functionToCall: 'ctor',
            scriptsToImport: scriptsToImport,
            ctorName: ctorName,
            args: ctorArgs,
            callId: ++callId,
            isPromise: false,
            masterEntryUrl: AsyncProxyMaster.getEntryUrl()
        });
        
        function onWorkerMessageInternal(workerEvent) {
            onWorkerMessage(self, workerEvent);
        }
    }
    
    AsyncProxyMaster.prototype.setUserDataHandler = function setUserDataHandler(userDataHandler) {
        this._userDataHandler = userDataHandler;
    };
    
    AsyncProxyMaster.prototype.terminate = function terminate() {
        this._worker.terminate();
        for (var i = 0; i < this._subWorkers.length; ++i) {
            this._subWorkers[i].terminate();
        }
    };
    
    AsyncProxyMaster.prototype.callFunction = function callFunction(functionToCall, args, options) {
        options = options || {};
        var isReturnPromise = !!options['isReturnPromise'];
        var transferables = options['transferables'];
        var pathsToTransferables =
            options['pathsToTransferablesInPromiseResult'];
        
        var localCallId = ++callId;
        var promiseOnMasterSide = null;
        var self = this;
        
        if (isReturnPromise) {
            promiseOnMasterSide = new Promise(function promiseFunc(resolve, reject) {
                self._pendingPromiseCalls[localCallId] = {
                    resolve: resolve,
                    reject: reject
                };
            });
        }
        
        var sendMessageFunction = options['isSendImmediately'] ?
            sendMessageToSlave: enqueueMessageToSlave;
        
        sendMessageFunction(this, transferables, /*isFunctionCall=*/true, {
            functionToCall: functionToCall,
            args: args || [],
            callId: localCallId,
            isPromise: isReturnPromise,
            pathsToTransferablesInPromiseResult : pathsToTransferables
        });
        
        if (isReturnPromise) {
            return promiseOnMasterSide;
        }
    };
    
    AsyncProxyMaster.prototype.wrapCallback = function wrapCallback(
        callback, callbackName, options) {
        
        options = options || {};
        var localCallId = ++callId;
        
        var callbackHandle = {
            isWorkerHelperCallback: true,
            isMultipleTimeCallback: !!options['isMultipleTimeCallback'],
            callId: localCallId,
            callbackName: callbackName,
            pathsToTransferables: options['pathsToTransferables']
        };
        
        var internalCallbackHandle = {
            isMultipleTimeCallback: !!options['isMultipleTimeCallback'],
            callId: localCallId,
            callback: callback,
            pathsToTransferables: options['pathsToTransferables']
        };
        
        this._callbacks[localCallId] = internalCallbackHandle;
        
        return callbackHandle;
    };
    
    AsyncProxyMaster.prototype.freeCallback = function freeCallback(callbackHandle) {
        delete this._callbacks[callbackHandle.callId];
    };
    
    // Static functions
    
    AsyncProxyMaster.getEntryUrl = function getEntryUrl() {
        isGetMasterEntryUrlCalled = true;
        return masterEntryUrl;
    };
    
    AsyncProxyMaster._setEntryUrl = function setEntryUrl(newUrl) {
        if (masterEntryUrl !== newUrl && isGetMasterEntryUrlCalled) {
            throw 'Previous values returned from getMasterEntryUrl ' +
                'is wrong. Avoid calling it within the slave c`tor';
        }

        masterEntryUrl = newUrl;
    };
    
    // Private functions
    
    function mainSlaveScriptContent() {
        importScripts('SCRIPT_PLACEHOLDER');
        AsyncProxySlave._initializeSlave();
    }
    
    function getScriptName() {
        var error = new Error();
        
        var lastStackFrameRegex = new RegExp(/.+\/(.*?):\d+(:\d+)*$/)
        var source = lastStackFrameRegex.exec(error.stack.trim());
        if (source && source[1] !== "") {
            return source[1];
        }
        
        var callee = arguments.callee.name;
        var currentStackFrameRegex = new RegExp(callee + ' \\((.+?):\\d+:\\d+\\)');
        source = currentStackFrameRegex.exec(error.stack.trim())
        if (source && source[1] !== "") {
            return source[1];
        }

        if (error.fileName != undefined) {
            return error.fileName;
        }
        
        throw 'AsyncProxy.js: Could not get current script URL';
    }

    function onWorkerMessage(self, workerEvent) {
        var callId = workerEvent.data.callId;
        
        switch (workerEvent.data.type) {
            case 'functionCalled':
                --self._notReturnedFunctions;
                trySendPendingMessages(self);
                break;
            
            case 'promiseResult':
                var promiseData = self._pendingPromiseCalls[callId];
                delete self._pendingPromiseCalls[callId];
                
                var result = workerEvent.data.result;
                promiseData.resolve(result);
                
                break;
            
            case 'promiseFailure':
                var promiseData = self._pendingPromiseCalls[callId];
                delete self._pendingPromiseCalls[callId];
                
                var reason = workerEvent.data.reason;
                promiseData.reject(reason);
                
                break;
            
            case 'userData':
                if (self._userDataHandler !== null) {
                    self._userDataHandler(workerEvent.data.userData);
                }
                
                break;
            
            case 'callback':
                var callbackHandle = self._callbacks[workerEvent.data.callId];
                if (callbackHandle === undefined) {
                    throw 'Unexpected message from SlaveWorker of callback ID: ' +
                        workerEvent.data.callId + '. Maybe should indicate ' +
                        'isMultipleTimesCallback = true on creation?';
                }
                
                if (!callbackHandle.isMultipleTimeCallback) {
                    self.freeCallback(self._callbacks[workerEvent.data.callId]);
                }
                
                if (callbackHandle.callback !== null) {
                    callbackHandle.callback.apply(null, workerEvent.data.args);
                }
                
                break;
            
            case 'subWorkerCtor':
                var subWorker = new Worker(workerEvent.data.scriptUrl);
                var id = workerEvent.data.subWorkerId;
                
                self._subWorkerById[id] = subWorker;
                self._subWorkers.push(subWorker);
                
                subWorker.onmessage = function onSubWorkerMessage(subWorkerEvent) {
                    enqueueMessageToSlave(
                        self, subWorkerEvent.ports, /*isFunctionCall=*/false, {
                            functionToCall: 'subWorkerOnMessage',
                            subWorkerId: id,
                            data: subWorkerEvent.data
                        });
                };
                
                break;
            
            case 'subWorkerPostMessage':
                var subWorker = self._subWorkerById[workerEvent.data.subWorkerId];
                subWorker.postMessage(workerEvent.data.data);
                break;
            
            case 'subWorkerTerminate':
                var subWorker = self._subWorkerById[workerEvent.data.subWorkerId];
                subWorker.terminate();
                break;
            
            default:
                throw 'Unknown message from AsyncProxySlave of type: ' +
                    workerEvent.data.type;
        }
    }
    
    function enqueueMessageToSlave(
        self, transferables, isFunctionCall, message) {
        
        if (self._notReturnedFunctions >= self._functionsBufferSize) {
            self._pendingMessages.push({
                transferables: transferables,
                isFunctionCall: isFunctionCall,
                message: message
            });
            return;
        }
        
        sendMessageToSlave(self, transferables, isFunctionCall, message);
    }
        
    function sendMessageToSlave(
        self, transferables, isFunctionCall, message) {
        
        if (isFunctionCall) {
            ++self._notReturnedFunctions;
        }
        
        self._worker.postMessage(message, transferables);
    }
    
    function trySendPendingMessages(self) {
        while (self._notReturnedFunctions < self._functionsBufferSize &&
               self._pendingMessages.length > 0) {
            
            var message = self._pendingMessages.shift();
            sendMessageToSlave(
                self,
                message.transferables,
                message.isFunctionCall,
                message.message);
        }
    }
    
    function getBaseUrlFromEntryScript() {
        var baseUrl = location.href;
        var endOfPath = baseUrl.lastIndexOf('/');
        if (endOfPath >= 0) {
            baseUrl = baseUrl.substring(0, endOfPath);
        }
        
        return baseUrl;
    }
    
    return AsyncProxyMaster;
})();