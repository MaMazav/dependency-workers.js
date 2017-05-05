(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.asyncProxy = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports.SubWorkerEmulationForChrome = require('sub-worker-emulation-for-chrome');
module.exports.AsyncProxyFactory = require('async-proxy-factory');
module.exports.AsyncProxySlave = require('async-proxy-slave');
module.exports.AsyncProxyMaster = require('async-proxy-master');
module.exports.ScriptsToImportPool = require('scripts-to-Import-Pool');

},{"async-proxy-factory":2,"async-proxy-master":3,"async-proxy-slave":4,"scripts-to-Import-Pool":5,"sub-worker-emulation-for-chrome":7}],2:[function(require,module,exports){
'use strict';

var AsyncProxyMaster = require('async-proxy-master');

var AsyncProxyFactory = (function AsyncProxyFactoryClosure() {
    var factorySingleton = {};
	
	factorySingleton.create = function create(scriptsToImport, ctorName, methods, proxyCtor) {
		if ((!scriptsToImport) || !(scriptsToImport.length)) {
			throw 'AsyncProxyFactory error: missing scriptsToImport (2nd argument)';
		}
		if (!methods) {
			throw 'AsyncProxyFactory error: missing methods (3rd argument)';
		}
		
		var ProxyClass = proxyCtor || function() {
			var that = this;
			this.__workerHelperCtorArgs = convertArgs(arguments);
		};
		
		ProxyClass.prototype._getWorkerHelper = function getWorkerHelper() {
			if (!this.__workerHelper) {
				this.__workerHelper = new AsyncProxyMaster(
					scriptsToImport, ctorName, this.__workerHelperCtorArgs || []);
			}
			
			return this.__workerHelper;
		};
		
		for (var methodName in methods) {
			generateMethod(ProxyClass, methodName, methods[methodName] || []);
		}
		
		return ProxyClass;
	};
	
	function generateMethod(ProxyClass, methodName, methodArgsDescription) {
		if (typeof methodArgsDescription === 'function') {
			ProxyClass.prototype[methodName] = methodArgsDescription;
			return;
		}
		
		var methodOptions = methodArgsDescription[0] || {};
		ProxyClass.prototype[methodName] = function generatedFunction() {
			var workerHelper = this._getWorkerHelper();
			var argsToSend = [];
			for (var i = 0; i < arguments.length; ++i) {
				var argDescription = methodArgsDescription[i + 1];
				var argValue = arguments[i];
				
				if (argDescription === 'callback') {
					argsToSend[i] = workerHelper.wrapCallback(argValue);
				} else if (!argDescription) {
					argsToSend[i] = argValue;
				} else {
					throw 'AsyncProxyFactory error: Unrecognized argument ' +
						'description ' + argDescription + ' in argument ' +
						(i + 1) + ' of method ' + methodName;
				}
			}
			return workerHelper.callFunction(
				methodName, argsToSend, methodArgsDescription[0]);
		};
	}
	
	function convertArgs(argsObject) {
		var args = new Array(argsObject.length);
		for (var i = 0; i < argsObject.length; ++i) {
			args[i] = argsObject[i];
		}
		
		return args;
	}
    
    return factorySingleton;
})();

module.exports = AsyncProxyFactory;
},{"async-proxy-master":3}],3:[function(require,module,exports){
'use strict';

/* global Promise: false */

var ScriptsToImportPool = require('scripts-to-import-pool');

var AsyncProxyMaster = (function AsyncProxyMasterClosure() {
    var callId = 0;
    var isGetMasterEntryUrlCalled = false;
    var masterEntryUrl = getBaseUrlFromEntryScript();
    
    function AsyncProxyMaster(scriptsToImport, ctorName, ctorArgs, options) {
        var that = this;
        options = options || {};
        
        that._callbacks = [];
        that._pendingPromiseCalls = [];
        that._subWorkerById = [];
        that._subWorkers = [];
        that._userDataHandler = null;
        that._notReturnedFunctions = 0;
        that._functionsBufferSize = options.functionsBufferSize || 5;
        that._pendingMessages = [];
        
        var scriptName = getScriptName();
        var slaveScriptContentString = mainSlaveScriptContent.toString();
        slaveScriptContentString = slaveScriptContentString.replace(
            'SCRIPT_PLACEHOLDER', scriptName);
        var slaveScriptContentBlob = new Blob(
            ['(', slaveScriptContentString, ')()'],
            { type: 'application/javascript' });
        var slaveScriptUrl = URL.createObjectURL(slaveScriptContentBlob);

        that._worker = new Worker(slaveScriptUrl);
        that._worker.onmessage = onWorkerMessageInternal;

        that._worker.postMessage({
            functionToCall: 'ctor',
            scriptsToImport: scriptsToImport,
            ctorName: ctorName,
            args: ctorArgs,
            callId: ++callId,
            isPromise: false,
            masterEntryUrl: AsyncProxyMaster.getEntryUrl()
        });
        
        function onWorkerMessageInternal(workerEvent) {
            onWorkerMessage(that, workerEvent);
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
        var isReturnPromise = !!options.isReturnPromise;
        var transferablesArg = options.transferables || [];
        var pathsToTransferables =
            options.pathsToTransferablesInPromiseResult;
        
        var localCallId = ++callId;
        var promiseOnMasterSide = null;
        var that = this;
        
        if (isReturnPromise) {
            promiseOnMasterSide = new Promise(function promiseFunc(resolve, reject) {
                that._pendingPromiseCalls[localCallId] = {
                    resolve: resolve,
                    reject: reject
                };
            });
        }
        
        var sendMessageFunction = options.isSendImmediately ?
            sendMessageToSlave: enqueueMessageToSlave;
		
		var transferables;
		if (typeof transferablesArg === 'function') {
			transferables = transferablesArg();
		} else {
			transferables = AsyncProxyMaster._extractTransferables(
				transferablesArg, args);
		}
        
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
            isMultipleTimeCallback: !!options.isMultipleTimeCallback,
            callId: localCallId,
            callbackName: callbackName,
            pathsToTransferables: options.pathsToTransferables
        };
        
        var internalCallbackHandle = {
            isMultipleTimeCallback: !!options.isMultipleTimeCallback,
            callId: localCallId,
            callback: callback,
            pathsToTransferables: options.pathsToTransferables
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
	
	AsyncProxyMaster._extractTransferables = function extractTransferables(
			pathsToTransferables, pathsBase) {
		
        if (pathsToTransferables === undefined) {
            return undefined;
        }
        
        var transferables = new Array(pathsToTransferables.length);
        
        for (var i = 0; i < pathsToTransferables.length; ++i) {
            var path = pathsToTransferables[i];
            var transferable = pathsBase;
            
            for (var j = 0; j < path.length; ++j) {
                var member = path[j];
                transferable = transferable[member];
            }
            
            transferables[i] = transferable;
        }
        
        return transferables;
    };
    
    // Private functions
	
	function getScriptName() {
        var error = new Error();
		return ScriptsToImportPool._getScriptName(error);
	}
    
    function mainSlaveScriptContent() {
		// This function is not run directly: It copied as a string into a blob
		// and run in the Web Worker global scope
		
		/* global importScripts: false */
        importScripts('SCRIPT_PLACEHOLDER');
		/* global asyncProxy: false */
        asyncProxy.AsyncProxySlave._initializeSlave();
    }
    
    function onWorkerMessage(that, workerEvent) {
        var callId = workerEvent.data.callId;
        
        switch (workerEvent.data.type) {
            case 'functionCalled':
                --that._notReturnedFunctions;
                trySendPendingMessages(that);
                break;
            
            case 'promiseResult':
                var promiseToResolve = that._pendingPromiseCalls[callId];
                delete that._pendingPromiseCalls[callId];
                
                var result = workerEvent.data.result;
                promiseToResolve.resolve(result);
                
                break;
            
            case 'promiseFailure':
                var promiseToReject = that._pendingPromiseCalls[callId];
                delete that._pendingPromiseCalls[callId];
                
                var reason = workerEvent.data.reason;
                promiseToReject.reject(reason);
                
                break;
            
            case 'userData':
                if (that._userDataHandler !== null) {
                    that._userDataHandler(workerEvent.data.userData);
                }
                
                break;
            
            case 'callback':
                var callbackHandle = that._callbacks[workerEvent.data.callId];
                if (callbackHandle === undefined) {
                    throw 'Unexpected message from SlaveWorker of callback ID: ' +
                        workerEvent.data.callId + '. Maybe should indicate ' +
                        'isMultipleTimesCallback = true on creation?';
                }
                
                if (!callbackHandle.isMultipleTimeCallback) {
                    that.freeCallback(that._callbacks[workerEvent.data.callId]);
                }
                
                if (callbackHandle.callback !== null) {
                    callbackHandle.callback.apply(null, workerEvent.data.args);
                }
                
                break;
            
            case 'subWorkerCtor':
                var subWorkerCreated = new Worker(workerEvent.data.scriptUrl);
                var id = workerEvent.data.subWorkerId;
                
                that._subWorkerById[id] = subWorkerCreated;
                that._subWorkers.push(subWorkerCreated);
                
                subWorkerCreated.onmessage = function onSubWorkerMessage(subWorkerEvent) {
                    enqueueMessageToSlave(
                        that, subWorkerEvent.ports, /*isFunctionCall=*/false, {
                            functionToCall: 'subWorkerOnMessage',
                            subWorkerId: id,
                            data: subWorkerEvent.data
                        });
                };
                
                break;
            
            case 'subWorkerPostMessage':
                var subWorkerToPostMessage = that._subWorkerById[workerEvent.data.subWorkerId];
                subWorkerToPostMessage.postMessage(workerEvent.data.data);
                break;
            
            case 'subWorkerTerminate':
                var subWorkerToTerminate = that._subWorkerById[workerEvent.data.subWorkerId];
                subWorkerToTerminate.terminate();
                break;
            
            default:
                throw 'Unknown message from AsyncProxySlave of type: ' +
                    workerEvent.data.type;
        }
    }
    
    function enqueueMessageToSlave(
        that, transferables, isFunctionCall, message) {
        
        if (that._notReturnedFunctions >= that._functionsBufferSize) {
            that._pendingMessages.push({
                transferables: transferables,
                isFunctionCall: isFunctionCall,
                message: message
            });
            return;
        }
        
        sendMessageToSlave(that, transferables, isFunctionCall, message);
    }
        
    function sendMessageToSlave(
        that, transferables, isFunctionCall, message) {
        
        if (isFunctionCall) {
            ++that._notReturnedFunctions;
        }
        
        that._worker.postMessage(message, transferables);
    }
    
    function trySendPendingMessages(that) {
        while (that._notReturnedFunctions < that._functionsBufferSize &&
               that._pendingMessages.length > 0) {
            
            var message = that._pendingMessages.shift();
            sendMessageToSlave(
                that,
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

module.exports = AsyncProxyMaster;
},{"scripts-to-import-pool":6}],4:[function(require,module,exports){
'use strict';

/* global console: false */
/* global self: false */

var AsyncProxyMaster = require('async-proxy-master');
var SubWorkerEmulationForChrome = require('sub-worker-emulation-for-chrome');

var AsyncProxySlave = (function AsyncProxySlaveClosure() {
    var slaveHelperSingleton = {};
    
    var beforeOperationListener = null;
    var slaveSideMainInstance;
    var slaveSideInstanceCreator = defaultInstanceCreator;
    var subWorkerIdToSubWorker = {};
    var ctorName;
    
    slaveHelperSingleton._initializeSlave = function initializeSlave() {
        self.onmessage = onMessage;
    };
    
    slaveHelperSingleton.setSlaveSideCreator = function setSlaveSideCreator(creator) {
        slaveSideInstanceCreator = creator;
    };
    
    slaveHelperSingleton.setBeforeOperationListener =
        function setBeforeOperationListener(listener) {
            beforeOperationListener = listener;
        };
        
    slaveHelperSingleton.sendUserDataToMaster = function sendUserDataToMaster(
        userData) {
        
        self.postMessage({
            type: 'userData',
            userData: userData
        });
    };
    
    slaveHelperSingleton.wrapPromiseFromSlaveSide =
        function wrapPromiseFromSlaveSide(
            callId, promise, pathsToTransferables) {
        
        var promiseThen = promise.then(function sendPromiseToMaster(result) {
            var transferables =
				AsyncProxyMaster._extractTransferables(
					pathsToTransferables, result);
            
            self.postMessage(
                {
                    type: 'promiseResult',
                    callId: callId,
                    result: result
                },
                transferables);
        });
        
        promiseThen['catch'](function sendFailureToMaster(reason) {
            self.postMessage({
                type: 'promiseFailure',
                callId: callId,
                reason: reason
            });
        });
    };
    
    slaveHelperSingleton.wrapCallbackFromSlaveSide =
        function wrapCallbackFromSlaveSide(callbackHandle) {
            
        var isAlreadyCalled = false;
        
        function callbackWrapperFromSlaveSide() {
            if (isAlreadyCalled) {
                throw 'Callback is called twice but isMultipleTimeCallback ' +
                    '= false';
            }
            
            var argumentsAsArray = getArgumentsAsArray(arguments);
            
            if (beforeOperationListener !== null) {
				try {
					beforeOperationListener.call(
						slaveSideMainInstance,
						'callback',
						callbackHandle.callbackName,
						argumentsAsArray);
				} catch (e) {
					console.log('AsyncProxySlave.beforeOperationListener has thrown an exception: ' + e);
				}
            }
            
            var transferables =
				AsyncProxyMaster._extractTransferables(
					callbackHandle.pathsToTransferables, argumentsAsArray);
            
            self.postMessage({
                    type: 'callback',
                    callId: callbackHandle.callId,
                    args: argumentsAsArray
                },
                transferables);
            
            if (!callbackHandle.isMultipleTimeCallback) {
                isAlreadyCalled = true;
            }
        }
        
        return callbackWrapperFromSlaveSide;
    };
    
    function onMessage(event) {
        var functionNameToCall = event.data.functionToCall;
        var args = event.data.args;
        var callId = event.data.callId;
        var isPromise = event.data.isPromise;
        var pathsToTransferablesInPromiseResult =
            event.data.pathsToTransferablesInPromiseResult;
        
        var result = null;
        
        switch (functionNameToCall) {
            case 'ctor':
                AsyncProxyMaster._setEntryUrl(event.data.masterEntryUrl);
                
                var scriptsToImport = event.data.scriptsToImport;
                ctorName = event.data.ctorName;
                
                for (var i = 0; i < scriptsToImport.length; ++i) {
					/* global importScripts: false */
                    importScripts(scriptsToImport[i]);
                }
                
                slaveSideMainInstance = slaveSideInstanceCreator.apply(null, args);

                return;
            
            case 'subWorkerOnMessage':
                var subWorker = subWorkerIdToSubWorker[event.data.subWorkerId];
                var workerEvent = { data: event.data.data };
                
                subWorker.onmessage(workerEvent);
                
                return;
        }
        
        args = new Array(event.data.args.length);
        for (var j = 0; j < event.data.args.length; ++j) {
            var arg = event.data.args[j];
            if (arg !== undefined &&
                arg !== null &&
                arg.isWorkerHelperCallback) {
                
                arg = slaveHelperSingleton.wrapCallbackFromSlaveSide(arg);
            }
            
            args[j] = arg;
        }
        
        var functionContainer = slaveSideMainInstance;
        var functionToCall;
        while (functionContainer) {
            functionToCall = slaveSideMainInstance[functionNameToCall];
            if (functionToCall) {
                break;
            }
			/* jshint proto: true */
            functionContainer = functionContainer.__proto__;
        }
        
        if (!functionToCall) {
            throw 'AsyncProxy error: could not find function ' + functionNameToCall;
        }
        
        var promise = functionToCall.apply(slaveSideMainInstance, args);
        
        if (isPromise) {
            slaveHelperSingleton.wrapPromiseFromSlaveSide(
                callId, promise, pathsToTransferablesInPromiseResult);
        }

        self.postMessage({
            type: 'functionCalled',
            callId: event.data.callId,
            result: result
        });
    }
    
    function defaultInstanceCreator() {
        var instance;
        try {
            var namespacesAndCtorName = ctorName.split('.');
            var member = self;
            for (var i = 0; i < namespacesAndCtorName.length; ++i)
                member = member[namespacesAndCtorName[i]];
            var TypeCtor = member;
            
            var bindArgs = [null].concat(getArgumentsAsArray(arguments));
            instance = new (Function.prototype.bind.apply(TypeCtor, bindArgs))();
        } catch (e) {
            throw new Error('Failed locating class name ' + ctorName + ': ' + e);
        }
        
        return instance;
    }
    
    function getArgumentsAsArray(args) {
        var argumentsAsArray = new Array(args.length);
        for (var i = 0; i < args.length; ++i) {
            argumentsAsArray[i] = args[i];
        }
        
        return argumentsAsArray;
    }
    
    if (self.Worker === undefined) {
        SubWorkerEmulationForChrome.initialize(subWorkerIdToSubWorker);
        self.Worker = SubWorkerEmulationForChrome;
    }
    
    return slaveHelperSingleton;
})();

module.exports = AsyncProxySlave;
},{"async-proxy-master":3,"sub-worker-emulation-for-chrome":7}],5:[function(require,module,exports){
'use strict';

var ScriptsToImportPool = (function ScriptsToImportPoolClosure() {
    function ScriptsToImportPool() {
        var that = this;
        that._scriptsByName = {};
        that._scriptsArray = null;
    }
    
    ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace =
        function addScriptForWorkerImport(errorWithStackTrace) {
        
        var fileName = ScriptsToImportPool._getScriptName(errorWithStackTrace);
        
        if (!this._scriptsByName[fileName]) {
            this._scriptsByName[fileName] = true;
            this._scriptsArray = null;
        }
    };
    
    ScriptsToImportPool.prototype.getScriptsForWorkerImport =
        function getScriptsForWorkerImport() {
        
        if (this._scriptsArray === null) {
            this._scriptsArray = [];
            for (var fileName in this._scriptsByName) {
                this._scriptsArray.push(fileName);
            }
        }
        
        return this._scriptsArray;
    };
    
    ScriptsToImportPool._getScriptName = function getScriptName(errorWithStackTrace) {
        var stack = errorWithStackTrace.stack.trim();
        
        var currentStackFrameRegex = /at (|[^ ]+ \()([^ ]+):\d+:\d+/;
        var source = currentStackFrameRegex.exec(stack);
        if (source && source[2] !== "") {
            return source[2];
        }

        var lastStackFrameRegex = new RegExp(/.+\/(.*?):\d+(:\d+)*$/);
        source = lastStackFrameRegex.exec(stack);
        if (source && source[1] !== "") {
            return source[1];
        }
        
        if (errorWithStackTrace.fileName !== undefined) {
            return errorWithStackTrace.fileName;
        }
        
        throw 'ImageDecoderFramework.js: Could not get current script URL';
    };
    
    return ScriptsToImportPool;
})();

module.exports = ScriptsToImportPool;
},{}],6:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5}],7:[function(require,module,exports){
'use strict';

/* global self: false */

var SubWorkerEmulationForChrome = (function SubWorkerEmulationForChromeClosure() {
    var subWorkerId = 0;
    var subWorkerIdToSubWorker = null;
    
    function SubWorkerEmulationForChrome(scriptUrl) {
        if (subWorkerIdToSubWorker === null) {
            throw 'AsyncProxy internal error: SubWorkerEmulationForChrome ' +
                'not initialized';
        }
        
        var that = this;
        that._subWorkerId = ++subWorkerId;
        subWorkerIdToSubWorker[that._subWorkerId] = that;
        
        self.postMessage({
            type: 'subWorkerCtor',
            subWorkerId: that._subWorkerId,
            scriptUrl: scriptUrl
        });
    }
    
    SubWorkerEmulationForChrome.initialize = function initialize(
        subWorkerIdToSubWorker_) {
        
        subWorkerIdToSubWorker = subWorkerIdToSubWorker_;
    };
    
    SubWorkerEmulationForChrome.prototype.postMessage = function postMessage(
        data, transferables) {
        
        self.postMessage({
            type: 'subWorkerPostMessage',
            subWorkerId: this._subWorkerId,
            data: data
        },
        transferables);
    };
    
    SubWorkerEmulationForChrome.prototype.terminate = function terminate(
        data, transferables) {
        
        self.postMessage({
            type: 'subWorkerTerminate',
            subWorkerId: this._subWorkerId
        },
        transferables);
    };
    
    return SubWorkerEmulationForChrome;
})();

module.exports = SubWorkerEmulationForChrome;
},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXN5bmMtcHJveHktZXhwb3J0cy5qcyIsInNyYy9hc3luYy1wcm94eS1mYWN0b3J5LmpzIiwic3JjL2FzeW5jLXByb3h5LW1hc3Rlci5qcyIsInNyYy9hc3luYy1wcm94eS1zbGF2ZS5qcyIsInNyYy9zY3JpcHRzLXRvLUltcG9ydC1Qb29sLmpzIiwic3JjL3N1Yi13b3JrZXItZW11bGF0aW9uLWZvci1jaHJvbWUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMVVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gcmVxdWlyZSgnc3ViLXdvcmtlci1lbXVsYXRpb24tZm9yLWNocm9tZScpO1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5RmFjdG9yeSA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LWZhY3RvcnknKTtcclxubW9kdWxlLmV4cG9ydHMuQXN5bmNQcm94eVNsYXZlID0gcmVxdWlyZSgnYXN5bmMtcHJveHktc2xhdmUnKTtcclxubW9kdWxlLmV4cG9ydHMuQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG5tb2R1bGUuZXhwb3J0cy5TY3JpcHRzVG9JbXBvcnRQb29sID0gcmVxdWlyZSgnc2NyaXB0cy10by1JbXBvcnQtUG9vbCcpO1xyXG4iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG5cclxudmFyIEFzeW5jUHJveHlGYWN0b3J5ID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlGYWN0b3J5Q2xvc3VyZSgpIHtcclxuICAgIHZhciBmYWN0b3J5U2luZ2xldG9uID0ge307XHJcblx0XHJcblx0ZmFjdG9yeVNpbmdsZXRvbi5jcmVhdGUgPSBmdW5jdGlvbiBjcmVhdGUoc2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgbWV0aG9kcywgcHJveHlDdG9yKSB7XHJcblx0XHRpZiAoKCFzY3JpcHRzVG9JbXBvcnQpIHx8ICEoc2NyaXB0c1RvSW1wb3J0Lmxlbmd0aCkpIHtcclxuXHRcdFx0dGhyb3cgJ0FzeW5jUHJveHlGYWN0b3J5IGVycm9yOiBtaXNzaW5nIHNjcmlwdHNUb0ltcG9ydCAoMm5kIGFyZ3VtZW50KSc7XHJcblx0XHR9XHJcblx0XHRpZiAoIW1ldGhvZHMpIHtcclxuXHRcdFx0dGhyb3cgJ0FzeW5jUHJveHlGYWN0b3J5IGVycm9yOiBtaXNzaW5nIG1ldGhvZHMgKDNyZCBhcmd1bWVudCknO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHR2YXIgUHJveHlDbGFzcyA9IHByb3h5Q3RvciB8fCBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG5cdFx0XHR0aGlzLl9fd29ya2VySGVscGVyQ3RvckFyZ3MgPSBjb252ZXJ0QXJncyhhcmd1bWVudHMpO1xyXG5cdFx0fTtcclxuXHRcdFxyXG5cdFx0UHJveHlDbGFzcy5wcm90b3R5cGUuX2dldFdvcmtlckhlbHBlciA9IGZ1bmN0aW9uIGdldFdvcmtlckhlbHBlcigpIHtcclxuXHRcdFx0aWYgKCF0aGlzLl9fd29ya2VySGVscGVyKSB7XHJcblx0XHRcdFx0dGhpcy5fX3dvcmtlckhlbHBlciA9IG5ldyBBc3luY1Byb3h5TWFzdGVyKFxyXG5cdFx0XHRcdFx0c2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgdGhpcy5fX3dvcmtlckhlbHBlckN0b3JBcmdzIHx8IFtdKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0cmV0dXJuIHRoaXMuX193b3JrZXJIZWxwZXI7XHJcblx0XHR9O1xyXG5cdFx0XHJcblx0XHRmb3IgKHZhciBtZXRob2ROYW1lIGluIG1ldGhvZHMpIHtcclxuXHRcdFx0Z2VuZXJhdGVNZXRob2QoUHJveHlDbGFzcywgbWV0aG9kTmFtZSwgbWV0aG9kc1ttZXRob2ROYW1lXSB8fCBbXSk7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdHJldHVybiBQcm94eUNsYXNzO1xyXG5cdH07XHJcblx0XHJcblx0ZnVuY3Rpb24gZ2VuZXJhdGVNZXRob2QoUHJveHlDbGFzcywgbWV0aG9kTmFtZSwgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uKSB7XHJcblx0XHRpZiAodHlwZW9mIG1ldGhvZEFyZ3NEZXNjcmlwdGlvbiA9PT0gJ2Z1bmN0aW9uJykge1xyXG5cdFx0XHRQcm94eUNsYXNzLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IG1ldGhvZEFyZ3NEZXNjcmlwdGlvbjtcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHR2YXIgbWV0aG9kT3B0aW9ucyA9IG1ldGhvZEFyZ3NEZXNjcmlwdGlvblswXSB8fCB7fTtcclxuXHRcdFByb3h5Q2xhc3MucHJvdG90eXBlW21ldGhvZE5hbWVdID0gZnVuY3Rpb24gZ2VuZXJhdGVkRnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciB3b3JrZXJIZWxwZXIgPSB0aGlzLl9nZXRXb3JrZXJIZWxwZXIoKTtcclxuXHRcdFx0dmFyIGFyZ3NUb1NlbmQgPSBbXTtcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHR2YXIgYXJnRGVzY3JpcHRpb24gPSBtZXRob2RBcmdzRGVzY3JpcHRpb25baSArIDFdO1xyXG5cdFx0XHRcdHZhciBhcmdWYWx1ZSA9IGFyZ3VtZW50c1tpXTtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHRpZiAoYXJnRGVzY3JpcHRpb24gPT09ICdjYWxsYmFjaycpIHtcclxuXHRcdFx0XHRcdGFyZ3NUb1NlbmRbaV0gPSB3b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKGFyZ1ZhbHVlKTtcclxuXHRcdFx0XHR9IGVsc2UgaWYgKCFhcmdEZXNjcmlwdGlvbikge1xyXG5cdFx0XHRcdFx0YXJnc1RvU2VuZFtpXSA9IGFyZ1ZhbHVlO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHR0aHJvdyAnQXN5bmNQcm94eUZhY3RvcnkgZXJyb3I6IFVucmVjb2duaXplZCBhcmd1bWVudCAnICtcclxuXHRcdFx0XHRcdFx0J2Rlc2NyaXB0aW9uICcgKyBhcmdEZXNjcmlwdGlvbiArICcgaW4gYXJndW1lbnQgJyArXHJcblx0XHRcdFx0XHRcdChpICsgMSkgKyAnIG9mIG1ldGhvZCAnICsgbWV0aG9kTmFtZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHdvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oXHJcblx0XHRcdFx0bWV0aG9kTmFtZSwgYXJnc1RvU2VuZCwgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uWzBdKTtcclxuXHRcdH07XHJcblx0fVxyXG5cdFxyXG5cdGZ1bmN0aW9uIGNvbnZlcnRBcmdzKGFyZ3NPYmplY3QpIHtcclxuXHRcdHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3NPYmplY3QubGVuZ3RoKTtcclxuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgYXJnc09iamVjdC5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRhcmdzW2ldID0gYXJnc09iamVjdFtpXTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0cmV0dXJuIGFyZ3M7XHJcblx0fVxyXG4gICAgXHJcbiAgICByZXR1cm4gZmFjdG9yeVNpbmdsZXRvbjtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQXN5bmNQcm94eUZhY3Rvcnk7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgU2NyaXB0c1RvSW1wb3J0UG9vbCA9IHJlcXVpcmUoJ3NjcmlwdHMtdG8taW1wb3J0LXBvb2wnKTtcclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlNYXN0ZXJDbG9zdXJlKCkge1xyXG4gICAgdmFyIGNhbGxJZCA9IDA7XHJcbiAgICB2YXIgaXNHZXRNYXN0ZXJFbnRyeVVybENhbGxlZCA9IGZhbHNlO1xyXG4gICAgdmFyIG1hc3RlckVudHJ5VXJsID0gZ2V0QmFzZVVybEZyb21FbnRyeVNjcmlwdCgpO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBBc3luY1Byb3h5TWFzdGVyKHNjcmlwdHNUb0ltcG9ydCwgY3Rvck5hbWUsIGN0b3JBcmdzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoYXQuX2NhbGxiYWNrcyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHMgPSBbXTtcclxuICAgICAgICB0aGF0Ll9zdWJXb3JrZXJCeUlkID0gW107XHJcbiAgICAgICAgdGhhdC5fc3ViV29ya2VycyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3VzZXJEYXRhSGFuZGxlciA9IG51bGw7XHJcbiAgICAgICAgdGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPSAwO1xyXG4gICAgICAgIHRoYXQuX2Z1bmN0aW9uc0J1ZmZlclNpemUgPSBvcHRpb25zLmZ1bmN0aW9uc0J1ZmZlclNpemUgfHwgNTtcclxuICAgICAgICB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc2NyaXB0TmFtZSA9IGdldFNjcmlwdE5hbWUoKTtcclxuICAgICAgICB2YXIgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nID0gbWFpblNsYXZlU2NyaXB0Q29udGVudC50b1N0cmluZygpO1xyXG4gICAgICAgIHNsYXZlU2NyaXB0Q29udGVudFN0cmluZyA9IHNsYXZlU2NyaXB0Q29udGVudFN0cmluZy5yZXBsYWNlKFxyXG4gICAgICAgICAgICAnU0NSSVBUX1BMQUNFSE9MREVSJywgc2NyaXB0TmFtZSk7XHJcbiAgICAgICAgdmFyIHNsYXZlU2NyaXB0Q29udGVudEJsb2IgPSBuZXcgQmxvYihcclxuICAgICAgICAgICAgWycoJywgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nLCAnKSgpJ10sXHJcbiAgICAgICAgICAgIHsgdHlwZTogJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQnIH0pO1xyXG4gICAgICAgIHZhciBzbGF2ZVNjcmlwdFVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoc2xhdmVTY3JpcHRDb250ZW50QmxvYik7XHJcblxyXG4gICAgICAgIHRoYXQuX3dvcmtlciA9IG5ldyBXb3JrZXIoc2xhdmVTY3JpcHRVcmwpO1xyXG4gICAgICAgIHRoYXQuX3dvcmtlci5vbm1lc3NhZ2UgPSBvbldvcmtlck1lc3NhZ2VJbnRlcm5hbDtcclxuXHJcbiAgICAgICAgdGhhdC5fd29ya2VyLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGw6ICdjdG9yJyxcclxuICAgICAgICAgICAgc2NyaXB0c1RvSW1wb3J0OiBzY3JpcHRzVG9JbXBvcnQsXHJcbiAgICAgICAgICAgIGN0b3JOYW1lOiBjdG9yTmFtZSxcclxuICAgICAgICAgICAgYXJnczogY3RvckFyZ3MsXHJcbiAgICAgICAgICAgIGNhbGxJZDogKytjYWxsSWQsXHJcbiAgICAgICAgICAgIGlzUHJvbWlzZTogZmFsc2UsXHJcbiAgICAgICAgICAgIG1hc3RlckVudHJ5VXJsOiBBc3luY1Byb3h5TWFzdGVyLmdldEVudHJ5VXJsKClcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbldvcmtlck1lc3NhZ2VJbnRlcm5hbCh3b3JrZXJFdmVudCkge1xyXG4gICAgICAgICAgICBvbldvcmtlck1lc3NhZ2UodGhhdCwgd29ya2VyRXZlbnQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUuc2V0VXNlckRhdGFIYW5kbGVyID0gZnVuY3Rpb24gc2V0VXNlckRhdGFIYW5kbGVyKHVzZXJEYXRhSGFuZGxlcikge1xyXG4gICAgICAgIHRoaXMuX3VzZXJEYXRhSGFuZGxlciA9IHVzZXJEYXRhSGFuZGxlcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIEFzeW5jUHJveHlNYXN0ZXIucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZSgpIHtcclxuICAgICAgICB0aGlzLl93b3JrZXIudGVybWluYXRlKCk7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl9zdWJXb3JrZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3N1YldvcmtlcnNbaV0udGVybWluYXRlKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUuY2FsbEZ1bmN0aW9uID0gZnVuY3Rpb24gY2FsbEZ1bmN0aW9uKGZ1bmN0aW9uVG9DYWxsLCBhcmdzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgdmFyIGlzUmV0dXJuUHJvbWlzZSA9ICEhb3B0aW9ucy5pc1JldHVyblByb21pc2U7XHJcbiAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXNBcmcgPSBvcHRpb25zLnRyYW5zZmVyYWJsZXMgfHwgW107XHJcbiAgICAgICAgdmFyIHBhdGhzVG9UcmFuc2ZlcmFibGVzID1cclxuICAgICAgICAgICAgb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgbG9jYWxDYWxsSWQgPSArK2NhbGxJZDtcclxuICAgICAgICB2YXIgcHJvbWlzZU9uTWFzdGVyU2lkZSA9IG51bGw7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc1JldHVyblByb21pc2UpIHtcclxuICAgICAgICAgICAgcHJvbWlzZU9uTWFzdGVyU2lkZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uIHByb21pc2VGdW5jKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICAgICAgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tsb2NhbENhbGxJZF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZTogcmVzb2x2ZSxcclxuICAgICAgICAgICAgICAgICAgICByZWplY3Q6IHJlamVjdFxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzZW5kTWVzc2FnZUZ1bmN0aW9uID0gb3B0aW9ucy5pc1NlbmRJbW1lZGlhdGVseSA/XHJcbiAgICAgICAgICAgIHNlbmRNZXNzYWdlVG9TbGF2ZTogZW5xdWV1ZU1lc3NhZ2VUb1NsYXZlO1xyXG5cdFx0XHJcblx0XHR2YXIgdHJhbnNmZXJhYmxlcztcclxuXHRcdGlmICh0eXBlb2YgdHJhbnNmZXJhYmxlc0FyZyA9PT0gJ2Z1bmN0aW9uJykge1xyXG5cdFx0XHR0cmFuc2ZlcmFibGVzID0gdHJhbnNmZXJhYmxlc0FyZygpO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0dHJhbnNmZXJhYmxlcyA9IEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG5cdFx0XHRcdHRyYW5zZmVyYWJsZXNBcmcsIGFyZ3MpO1xyXG5cdFx0fVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbmRNZXNzYWdlRnVuY3Rpb24odGhpcywgdHJhbnNmZXJhYmxlcywgLyppc0Z1bmN0aW9uQ2FsbD0qL3RydWUsIHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGw6IGZ1bmN0aW9uVG9DYWxsLFxyXG4gICAgICAgICAgICBhcmdzOiBhcmdzIHx8IFtdLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBpc1Byb21pc2U6IGlzUmV0dXJuUHJvbWlzZSxcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQgOiBwYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc1JldHVyblByb21pc2UpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHByb21pc2VPbk1hc3RlclNpZGU7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUud3JhcENhbGxiYWNrID0gZnVuY3Rpb24gd3JhcENhbGxiYWNrKFxyXG4gICAgICAgIGNhbGxiYWNrLCBjYWxsYmFja05hbWUsIG9wdGlvbnMpIHtcclxuICAgICAgICBcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgbG9jYWxDYWxsSWQgPSArK2NhbGxJZDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgY2FsbGJhY2tIYW5kbGUgPSB7XHJcbiAgICAgICAgICAgIGlzV29ya2VySGVscGVyQ2FsbGJhY2s6IHRydWUsXHJcbiAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6ICEhb3B0aW9ucy5pc011bHRpcGxlVGltZUNhbGxiYWNrLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBjYWxsYmFja05hbWU6IGNhbGxiYWNrTmFtZSxcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXM6IG9wdGlvbnMucGF0aHNUb1RyYW5zZmVyYWJsZXNcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpbnRlcm5hbENhbGxiYWNrSGFuZGxlID0ge1xyXG4gICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiAhIW9wdGlvbnMuaXNNdWx0aXBsZVRpbWVDYWxsYmFjayxcclxuICAgICAgICAgICAgY2FsbElkOiBsb2NhbENhbGxJZCxcclxuICAgICAgICAgICAgY2FsbGJhY2s6IGNhbGxiYWNrLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fY2FsbGJhY2tzW2xvY2FsQ2FsbElkXSA9IGludGVybmFsQ2FsbGJhY2tIYW5kbGU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrSGFuZGxlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUuZnJlZUNhbGxiYWNrID0gZnVuY3Rpb24gZnJlZUNhbGxiYWNrKGNhbGxiYWNrSGFuZGxlKSB7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1tjYWxsYmFja0hhbmRsZS5jYWxsSWRdO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgLy8gU3RhdGljIGZ1bmN0aW9uc1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLmdldEVudHJ5VXJsID0gZnVuY3Rpb24gZ2V0RW50cnlVcmwoKSB7XHJcbiAgICAgICAgaXNHZXRNYXN0ZXJFbnRyeVVybENhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgcmV0dXJuIG1hc3RlckVudHJ5VXJsO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5fc2V0RW50cnlVcmwgPSBmdW5jdGlvbiBzZXRFbnRyeVVybChuZXdVcmwpIHtcclxuICAgICAgICBpZiAobWFzdGVyRW50cnlVcmwgIT09IG5ld1VybCAmJiBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdQcmV2aW91cyB2YWx1ZXMgcmV0dXJuZWQgZnJvbSBnZXRNYXN0ZXJFbnRyeVVybCAnICtcclxuICAgICAgICAgICAgICAgICdpcyB3cm9uZy4gQXZvaWQgY2FsbGluZyBpdCB3aXRoaW4gdGhlIHNsYXZlIGNgdG9yJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIG1hc3RlckVudHJ5VXJsID0gbmV3VXJsO1xyXG4gICAgfTtcclxuXHRcclxuXHRBc3luY1Byb3h5TWFzdGVyLl9leHRyYWN0VHJhbnNmZXJhYmxlcyA9IGZ1bmN0aW9uIGV4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG5cdFx0XHRwYXRoc1RvVHJhbnNmZXJhYmxlcywgcGF0aHNCYXNlKSB7XHJcblx0XHRcclxuICAgICAgICBpZiAocGF0aHNUb1RyYW5zZmVyYWJsZXMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgdHJhbnNmZXJhYmxlcyA9IG5ldyBBcnJheShwYXRoc1RvVHJhbnNmZXJhYmxlcy5sZW5ndGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGF0aHNUb1RyYW5zZmVyYWJsZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdmFyIHBhdGggPSBwYXRoc1RvVHJhbnNmZXJhYmxlc1tpXTtcclxuICAgICAgICAgICAgdmFyIHRyYW5zZmVyYWJsZSA9IHBhdGhzQmFzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgcGF0aC5sZW5ndGg7ICsraikge1xyXG4gICAgICAgICAgICAgICAgdmFyIG1lbWJlciA9IHBhdGhbal07XHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGUgPSB0cmFuc2ZlcmFibGVbbWVtYmVyXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdHJhbnNmZXJhYmxlc1tpXSA9IHRyYW5zZmVyYWJsZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHRyYW5zZmVyYWJsZXM7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLyBQcml2YXRlIGZ1bmN0aW9uc1xyXG5cdFxyXG5cdGZ1bmN0aW9uIGdldFNjcmlwdE5hbWUoKSB7XHJcbiAgICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCk7XHJcblx0XHRyZXR1cm4gU2NyaXB0c1RvSW1wb3J0UG9vbC5fZ2V0U2NyaXB0TmFtZShlcnJvcik7XHJcblx0fVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBtYWluU2xhdmVTY3JpcHRDb250ZW50KCkge1xyXG5cdFx0Ly8gVGhpcyBmdW5jdGlvbiBpcyBub3QgcnVuIGRpcmVjdGx5OiBJdCBjb3BpZWQgYXMgYSBzdHJpbmcgaW50byBhIGJsb2JcclxuXHRcdC8vIGFuZCBydW4gaW4gdGhlIFdlYiBXb3JrZXIgZ2xvYmFsIHNjb3BlXHJcblx0XHRcclxuXHRcdC8qIGdsb2JhbCBpbXBvcnRTY3JpcHRzOiBmYWxzZSAqL1xyXG4gICAgICAgIGltcG9ydFNjcmlwdHMoJ1NDUklQVF9QTEFDRUhPTERFUicpO1xyXG5cdFx0LyogZ2xvYmFsIGFzeW5jUHJveHk6IGZhbHNlICovXHJcbiAgICAgICAgYXN5bmNQcm94eS5Bc3luY1Byb3h5U2xhdmUuX2luaXRpYWxpemVTbGF2ZSgpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBvbldvcmtlck1lc3NhZ2UodGhhdCwgd29ya2VyRXZlbnQpIHtcclxuICAgICAgICB2YXIgY2FsbElkID0gd29ya2VyRXZlbnQuZGF0YS5jYWxsSWQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3dpdGNoICh3b3JrZXJFdmVudC5kYXRhLnR5cGUpIHtcclxuICAgICAgICAgICAgY2FzZSAnZnVuY3Rpb25DYWxsZWQnOlxyXG4gICAgICAgICAgICAgICAgLS10aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucztcclxuICAgICAgICAgICAgICAgIHRyeVNlbmRQZW5kaW5nTWVzc2FnZXModGhhdCk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3Byb21pc2VSZXN1bHQnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHByb21pc2VUb1Jlc29sdmUgPSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gd29ya2VyRXZlbnQuZGF0YS5yZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICBwcm9taXNlVG9SZXNvbHZlLnJlc29sdmUocmVzdWx0KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdwcm9taXNlRmFpbHVyZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgcHJvbWlzZVRvUmVqZWN0ID0gdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHNbY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdmFyIHJlYXNvbiA9IHdvcmtlckV2ZW50LmRhdGEucmVhc29uO1xyXG4gICAgICAgICAgICAgICAgcHJvbWlzZVRvUmVqZWN0LnJlamVjdChyZWFzb24pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3VzZXJEYXRhJzpcclxuICAgICAgICAgICAgICAgIGlmICh0aGF0Ll91c2VyRGF0YUhhbmRsZXIgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0Ll91c2VyRGF0YUhhbmRsZXIod29ya2VyRXZlbnQuZGF0YS51c2VyRGF0YSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAnY2FsbGJhY2snOlxyXG4gICAgICAgICAgICAgICAgdmFyIGNhbGxiYWNrSGFuZGxlID0gdGhhdC5fY2FsbGJhY2tzW3dvcmtlckV2ZW50LmRhdGEuY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIGlmIChjYWxsYmFja0hhbmRsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgbWVzc2FnZSBmcm9tIFNsYXZlV29ya2VyIG9mIGNhbGxiYWNrIElEOiAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgd29ya2VyRXZlbnQuZGF0YS5jYWxsSWQgKyAnLiBNYXliZSBzaG91bGQgaW5kaWNhdGUgJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdpc011bHRpcGxlVGltZXNDYWxsYmFjayA9IHRydWUgb24gY3JlYXRpb24/JztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFjYWxsYmFja0hhbmRsZS5pc011bHRpcGxlVGltZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhhdC5mcmVlQ2FsbGJhY2sodGhhdC5fY2FsbGJhY2tzW3dvcmtlckV2ZW50LmRhdGEuY2FsbElkXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChjYWxsYmFja0hhbmRsZS5jYWxsYmFjayAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrSGFuZGxlLmNhbGxiYWNrLmFwcGx5KG51bGwsIHdvcmtlckV2ZW50LmRhdGEuYXJncyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAnc3ViV29ya2VyQ3Rvcic6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyQ3JlYXRlZCA9IG5ldyBXb3JrZXIod29ya2VyRXZlbnQuZGF0YS5zY3JpcHRVcmwpO1xyXG4gICAgICAgICAgICAgICAgdmFyIGlkID0gd29ya2VyRXZlbnQuZGF0YS5zdWJXb3JrZXJJZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhhdC5fc3ViV29ya2VyQnlJZFtpZF0gPSBzdWJXb3JrZXJDcmVhdGVkO1xyXG4gICAgICAgICAgICAgICAgdGhhdC5fc3ViV29ya2Vycy5wdXNoKHN1YldvcmtlckNyZWF0ZWQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXJDcmVhdGVkLm9ubWVzc2FnZSA9IGZ1bmN0aW9uIG9uU3ViV29ya2VyTWVzc2FnZShzdWJXb3JrZXJFdmVudCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGVucXVldWVNZXNzYWdlVG9TbGF2ZShcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhhdCwgc3ViV29ya2VyRXZlbnQucG9ydHMsIC8qaXNGdW5jdGlvbkNhbGw9Ki9mYWxzZSwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGw6ICdzdWJXb3JrZXJPbk1lc3NhZ2UnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3ViV29ya2VySWQ6IGlkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogc3ViV29ya2VyRXZlbnQuZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAnc3ViV29ya2VyUG9zdE1lc3NhZ2UnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHN1YldvcmtlclRvUG9zdE1lc3NhZ2UgPSB0aGF0Ll9zdWJXb3JrZXJCeUlkW3dvcmtlckV2ZW50LmRhdGEuc3ViV29ya2VySWRdO1xyXG4gICAgICAgICAgICAgICAgc3ViV29ya2VyVG9Qb3N0TWVzc2FnZS5wb3N0TWVzc2FnZSh3b3JrZXJFdmVudC5kYXRhLmRhdGEpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJUZXJtaW5hdGUnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHN1YldvcmtlclRvVGVybWluYXRlID0gdGhhdC5fc3ViV29ya2VyQnlJZFt3b3JrZXJFdmVudC5kYXRhLnN1YldvcmtlcklkXTtcclxuICAgICAgICAgICAgICAgIHN1YldvcmtlclRvVGVybWluYXRlLnRlcm1pbmF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ1Vua25vd24gbWVzc2FnZSBmcm9tIEFzeW5jUHJveHlTbGF2ZSBvZiB0eXBlOiAnICtcclxuICAgICAgICAgICAgICAgICAgICB3b3JrZXJFdmVudC5kYXRhLnR5cGU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBlbnF1ZXVlTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgdGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPj0gdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSkge1xyXG4gICAgICAgICAgICB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAgICAgaXNGdW5jdGlvbkNhbGw6IGlzRnVuY3Rpb25DYWxsLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogbWVzc2FnZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzZW5kTWVzc2FnZVRvU2xhdmUodGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gICAgICAgIFxyXG4gICAgZnVuY3Rpb24gc2VuZE1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgIHRoYXQsIHRyYW5zZmVyYWJsZXMsIGlzRnVuY3Rpb25DYWxsLCBtZXNzYWdlKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzRnVuY3Rpb25DYWxsKSB7XHJcbiAgICAgICAgICAgICsrdGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnM7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoYXQuX3dvcmtlci5wb3N0TWVzc2FnZShtZXNzYWdlLCB0cmFuc2ZlcmFibGVzKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gdHJ5U2VuZFBlbmRpbmdNZXNzYWdlcyh0aGF0KSB7XHJcbiAgICAgICAgd2hpbGUgKHRoYXQuX25vdFJldHVybmVkRnVuY3Rpb25zIDwgdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSAmJlxyXG4gICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIG1lc3NhZ2UgPSB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMuc2hpZnQoKTtcclxuICAgICAgICAgICAgc2VuZE1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgICAgICAgICAgdGhhdCxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UudHJhbnNmZXJhYmxlcyxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UuaXNGdW5jdGlvbkNhbGwsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlLm1lc3NhZ2UpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZ2V0QmFzZVVybEZyb21FbnRyeVNjcmlwdCgpIHtcclxuICAgICAgICB2YXIgYmFzZVVybCA9IGxvY2F0aW9uLmhyZWY7XHJcbiAgICAgICAgdmFyIGVuZE9mUGF0aCA9IGJhc2VVcmwubGFzdEluZGV4T2YoJy8nKTtcclxuICAgICAgICBpZiAoZW5kT2ZQYXRoID49IDApIHtcclxuICAgICAgICAgICAgYmFzZVVybCA9IGJhc2VVcmwuc3Vic3RyaW5nKDAsIGVuZE9mUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBiYXNlVXJsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gQXN5bmNQcm94eU1hc3RlcjtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQXN5bmNQcm94eU1hc3RlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcblxyXG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG52YXIgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gcmVxdWlyZSgnc3ViLXdvcmtlci1lbXVsYXRpb24tZm9yLWNocm9tZScpO1xyXG5cclxudmFyIEFzeW5jUHJveHlTbGF2ZSA9IChmdW5jdGlvbiBBc3luY1Byb3h5U2xhdmVDbG9zdXJlKCkge1xyXG4gICAgdmFyIHNsYXZlSGVscGVyU2luZ2xldG9uID0ge307XHJcbiAgICBcclxuICAgIHZhciBiZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9IG51bGw7XHJcbiAgICB2YXIgc2xhdmVTaWRlTWFpbkluc3RhbmNlO1xyXG4gICAgdmFyIHNsYXZlU2lkZUluc3RhbmNlQ3JlYXRvciA9IGRlZmF1bHRJbnN0YW5jZUNyZWF0b3I7XHJcbiAgICB2YXIgc3ViV29ya2VySWRUb1N1YldvcmtlciA9IHt9O1xyXG4gICAgdmFyIGN0b3JOYW1lO1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5faW5pdGlhbGl6ZVNsYXZlID0gZnVuY3Rpb24gaW5pdGlhbGl6ZVNsYXZlKCkge1xyXG4gICAgICAgIHNlbGYub25tZXNzYWdlID0gb25NZXNzYWdlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24uc2V0U2xhdmVTaWRlQ3JlYXRvciA9IGZ1bmN0aW9uIHNldFNsYXZlU2lkZUNyZWF0b3IoY3JlYXRvcikge1xyXG4gICAgICAgIHNsYXZlU2lkZUluc3RhbmNlQ3JlYXRvciA9IGNyZWF0b3I7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZXRCZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9XHJcbiAgICAgICAgZnVuY3Rpb24gc2V0QmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcclxuICAgICAgICAgICAgYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgPSBsaXN0ZW5lcjtcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24uc2VuZFVzZXJEYXRhVG9NYXN0ZXIgPSBmdW5jdGlvbiBzZW5kVXNlckRhdGFUb01hc3RlcihcclxuICAgICAgICB1c2VyRGF0YSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAndXNlckRhdGEnLFxyXG4gICAgICAgICAgICB1c2VyRGF0YTogdXNlckRhdGFcclxuICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBQcm9taXNlRnJvbVNsYXZlU2lkZSA9XHJcbiAgICAgICAgZnVuY3Rpb24gd3JhcFByb21pc2VGcm9tU2xhdmVTaWRlKFxyXG4gICAgICAgICAgICBjYWxsSWQsIHByb21pc2UsIHBhdGhzVG9UcmFuc2ZlcmFibGVzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHByb21pc2VUaGVuID0gcHJvbWlzZS50aGVuKGZ1bmN0aW9uIHNlbmRQcm9taXNlVG9NYXN0ZXIocmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID1cclxuXHRcdFx0XHRBc3luY1Byb3h5TWFzdGVyLl9leHRyYWN0VHJhbnNmZXJhYmxlcyhcclxuXHRcdFx0XHRcdHBhdGhzVG9UcmFuc2ZlcmFibGVzLCByZXN1bHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZShcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAncHJvbWlzZVJlc3VsdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbElkOiBjYWxsSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiByZXN1bHRcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBwcm9taXNlVGhlblsnY2F0Y2gnXShmdW5jdGlvbiBzZW5kRmFpbHVyZVRvTWFzdGVyKHJlYXNvbikge1xyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgICAgIHR5cGU6ICdwcm9taXNlRmFpbHVyZScsXHJcbiAgICAgICAgICAgICAgICBjYWxsSWQ6IGNhbGxJZCxcclxuICAgICAgICAgICAgICAgIHJlYXNvbjogcmVhc29uXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24ud3JhcENhbGxiYWNrRnJvbVNsYXZlU2lkZSA9XHJcbiAgICAgICAgZnVuY3Rpb24gd3JhcENhbGxiYWNrRnJvbVNsYXZlU2lkZShjYWxsYmFja0hhbmRsZSkge1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB2YXIgaXNBbHJlYWR5Q2FsbGVkID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gY2FsbGJhY2tXcmFwcGVyRnJvbVNsYXZlU2lkZSgpIHtcclxuICAgICAgICAgICAgaWYgKGlzQWxyZWFkeUNhbGxlZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ0NhbGxiYWNrIGlzIGNhbGxlZCB0d2ljZSBidXQgaXNNdWx0aXBsZVRpbWVDYWxsYmFjayAnICtcclxuICAgICAgICAgICAgICAgICAgICAnPSBmYWxzZSc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBhcmd1bWVudHNBc0FycmF5ID0gZ2V0QXJndW1lbnRzQXNBcnJheShhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyICE9PSBudWxsKSB7XHJcblx0XHRcdFx0dHJ5IHtcclxuXHRcdFx0XHRcdGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyLmNhbGwoXHJcblx0XHRcdFx0XHRcdHNsYXZlU2lkZU1haW5JbnN0YW5jZSxcclxuXHRcdFx0XHRcdFx0J2NhbGxiYWNrJyxcclxuXHRcdFx0XHRcdFx0Y2FsbGJhY2tIYW5kbGUuY2FsbGJhY2tOYW1lLFxyXG5cdFx0XHRcdFx0XHRhcmd1bWVudHNBc0FycmF5KTtcclxuXHRcdFx0XHR9IGNhdGNoIChlKSB7XHJcblx0XHRcdFx0XHRjb25zb2xlLmxvZygnQXN5bmNQcm94eVNsYXZlLmJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyIGhhcyB0aHJvd24gYW4gZXhjZXB0aW9uOiAnICsgZSk7XHJcblx0XHRcdFx0fVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgdHJhbnNmZXJhYmxlcyA9XHJcblx0XHRcdFx0QXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdFx0XHRjYWxsYmFja0hhbmRsZS5wYXRoc1RvVHJhbnNmZXJhYmxlcywgYXJndW1lbnRzQXNBcnJheSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnY2FsbGJhY2snLFxyXG4gICAgICAgICAgICAgICAgICAgIGNhbGxJZDogY2FsbGJhY2tIYW5kbGUuY2FsbElkLFxyXG4gICAgICAgICAgICAgICAgICAgIGFyZ3M6IGFyZ3VtZW50c0FzQXJyYXlcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghY2FsbGJhY2tIYW5kbGUuaXNNdWx0aXBsZVRpbWVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAgICAgaXNBbHJlYWR5Q2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gY2FsbGJhY2tXcmFwcGVyRnJvbVNsYXZlU2lkZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG9uTWVzc2FnZShldmVudCkge1xyXG4gICAgICAgIHZhciBmdW5jdGlvbk5hbWVUb0NhbGwgPSBldmVudC5kYXRhLmZ1bmN0aW9uVG9DYWxsO1xyXG4gICAgICAgIHZhciBhcmdzID0gZXZlbnQuZGF0YS5hcmdzO1xyXG4gICAgICAgIHZhciBjYWxsSWQgPSBldmVudC5kYXRhLmNhbGxJZDtcclxuICAgICAgICB2YXIgaXNQcm9taXNlID0gZXZlbnQuZGF0YS5pc1Byb21pc2U7XHJcbiAgICAgICAgdmFyIHBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0ID1cclxuICAgICAgICAgICAgZXZlbnQuZGF0YS5wYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgcmVzdWx0ID0gbnVsbDtcclxuICAgICAgICBcclxuICAgICAgICBzd2l0Y2ggKGZ1bmN0aW9uTmFtZVRvQ2FsbCkge1xyXG4gICAgICAgICAgICBjYXNlICdjdG9yJzpcclxuICAgICAgICAgICAgICAgIEFzeW5jUHJveHlNYXN0ZXIuX3NldEVudHJ5VXJsKGV2ZW50LmRhdGEubWFzdGVyRW50cnlVcmwpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgc2NyaXB0c1RvSW1wb3J0ID0gZXZlbnQuZGF0YS5zY3JpcHRzVG9JbXBvcnQ7XHJcbiAgICAgICAgICAgICAgICBjdG9yTmFtZSA9IGV2ZW50LmRhdGEuY3Rvck5hbWU7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2NyaXB0c1RvSW1wb3J0Lmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0XHQvKiBnbG9iYWwgaW1wb3J0U2NyaXB0czogZmFsc2UgKi9cclxuICAgICAgICAgICAgICAgICAgICBpbXBvcnRTY3JpcHRzKHNjcmlwdHNUb0ltcG9ydFtpXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHNsYXZlU2lkZU1haW5JbnN0YW5jZSA9IHNsYXZlU2lkZUluc3RhbmNlQ3JlYXRvci5hcHBseShudWxsLCBhcmdzKTtcclxuXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJPbk1lc3NhZ2UnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHN1YldvcmtlciA9IHN1YldvcmtlcklkVG9TdWJXb3JrZXJbZXZlbnQuZGF0YS5zdWJXb3JrZXJJZF07XHJcbiAgICAgICAgICAgICAgICB2YXIgd29ya2VyRXZlbnQgPSB7IGRhdGE6IGV2ZW50LmRhdGEuZGF0YSB9O1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXIub25tZXNzYWdlKHdvcmtlckV2ZW50KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBhcmdzID0gbmV3IEFycmF5KGV2ZW50LmRhdGEuYXJncy5sZW5ndGgpO1xyXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZXZlbnQuZGF0YS5hcmdzLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgIHZhciBhcmcgPSBldmVudC5kYXRhLmFyZ3Nbal07XHJcbiAgICAgICAgICAgIGlmIChhcmcgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICAgICAgICAgICAgYXJnICE9PSBudWxsICYmXHJcbiAgICAgICAgICAgICAgICBhcmcuaXNXb3JrZXJIZWxwZXJDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBhcmcgPSBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlKGFyZyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGFyZ3Nbal0gPSBhcmc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBmdW5jdGlvbkNvbnRhaW5lciA9IHNsYXZlU2lkZU1haW5JbnN0YW5jZTtcclxuICAgICAgICB2YXIgZnVuY3Rpb25Ub0NhbGw7XHJcbiAgICAgICAgd2hpbGUgKGZ1bmN0aW9uQ29udGFpbmVyKSB7XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uVG9DYWxsID0gc2xhdmVTaWRlTWFpbkluc3RhbmNlW2Z1bmN0aW9uTmFtZVRvQ2FsbF07XHJcbiAgICAgICAgICAgIGlmIChmdW5jdGlvblRvQ2FsbCkge1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuXHRcdFx0LyoganNoaW50IHByb3RvOiB0cnVlICovXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uQ29udGFpbmVyID0gZnVuY3Rpb25Db250YWluZXIuX19wcm90b19fO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWZ1bmN0aW9uVG9DYWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5IGVycm9yOiBjb3VsZCBub3QgZmluZCBmdW5jdGlvbiAnICsgZnVuY3Rpb25OYW1lVG9DYWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgcHJvbWlzZSA9IGZ1bmN0aW9uVG9DYWxsLmFwcGx5KHNsYXZlU2lkZU1haW5JbnN0YW5jZSwgYXJncyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUHJvbWlzZSkge1xyXG4gICAgICAgICAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwUHJvbWlzZUZyb21TbGF2ZVNpZGUoXHJcbiAgICAgICAgICAgICAgICBjYWxsSWQsIHByb21pc2UsIHBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnZnVuY3Rpb25DYWxsZWQnLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGV2ZW50LmRhdGEuY2FsbElkLFxyXG4gICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBkZWZhdWx0SW5zdGFuY2VDcmVhdG9yKCkge1xyXG4gICAgICAgIHZhciBpbnN0YW5jZTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB2YXIgbmFtZXNwYWNlc0FuZEN0b3JOYW1lID0gY3Rvck5hbWUuc3BsaXQoJy4nKTtcclxuICAgICAgICAgICAgdmFyIG1lbWJlciA9IHNlbGY7XHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbmFtZXNwYWNlc0FuZEN0b3JOYW1lLmxlbmd0aDsgKytpKVxyXG4gICAgICAgICAgICAgICAgbWVtYmVyID0gbWVtYmVyW25hbWVzcGFjZXNBbmRDdG9yTmFtZVtpXV07XHJcbiAgICAgICAgICAgIHZhciBUeXBlQ3RvciA9IG1lbWJlcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBiaW5kQXJncyA9IFtudWxsXS5jb25jYXQoZ2V0QXJndW1lbnRzQXNBcnJheShhcmd1bWVudHMpKTtcclxuICAgICAgICAgICAgaW5zdGFuY2UgPSBuZXcgKEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLmFwcGx5KFR5cGVDdG9yLCBiaW5kQXJncykpKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCBsb2NhdGluZyBjbGFzcyBuYW1lICcgKyBjdG9yTmFtZSArICc6ICcgKyBlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3MpIHtcclxuICAgICAgICB2YXIgYXJndW1lbnRzQXNBcnJheSA9IG5ldyBBcnJheShhcmdzLmxlbmd0aCk7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIGFyZ3VtZW50c0FzQXJyYXlbaV0gPSBhcmdzW2ldO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gYXJndW1lbnRzQXNBcnJheTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuV29ya2VyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUuaW5pdGlhbGl6ZShzdWJXb3JrZXJJZFRvU3ViV29ya2VyKTtcclxuICAgICAgICBzZWxmLldvcmtlciA9IFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHNsYXZlSGVscGVyU2luZ2xldG9uO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5U2xhdmU7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFNjcmlwdHNUb0ltcG9ydFBvb2wgPSAoZnVuY3Rpb24gU2NyaXB0c1RvSW1wb3J0UG9vbENsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBTY3JpcHRzVG9JbXBvcnRQb29sKCkge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll9zY3JpcHRzQnlOYW1lID0ge307XHJcbiAgICAgICAgdGhhdC5fc2NyaXB0c0FycmF5ID0gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgU2NyaXB0c1RvSW1wb3J0UG9vbC5wcm90b3R5cGUuYWRkU2NyaXB0RnJvbUVycm9yV2l0aFN0YWNrVHJhY2UgPVxyXG4gICAgICAgIGZ1bmN0aW9uIGFkZFNjcmlwdEZvcldvcmtlckltcG9ydChlcnJvcldpdGhTdGFja1RyYWNlKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGZpbGVOYW1lID0gU2NyaXB0c1RvSW1wb3J0UG9vbC5fZ2V0U2NyaXB0TmFtZShlcnJvcldpdGhTdGFja1RyYWNlKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX3NjcmlwdHNCeU5hbWVbZmlsZU5hbWVdKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNCeU5hbWVbZmlsZU5hbWVdID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0FycmF5ID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY3JpcHRzVG9JbXBvcnRQb29sLnByb3RvdHlwZS5nZXRTY3JpcHRzRm9yV29ya2VySW1wb3J0ID1cclxuICAgICAgICBmdW5jdGlvbiBnZXRTY3JpcHRzRm9yV29ya2VySW1wb3J0KCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zY3JpcHRzQXJyYXkgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0FycmF5ID0gW107XHJcbiAgICAgICAgICAgIGZvciAodmFyIGZpbGVOYW1lIGluIHRoaXMuX3NjcmlwdHNCeU5hbWUpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNBcnJheS5wdXNoKGZpbGVOYW1lKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdGhpcy5fc2NyaXB0c0FycmF5O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NyaXB0c1RvSW1wb3J0UG9vbC5fZ2V0U2NyaXB0TmFtZSA9IGZ1bmN0aW9uIGdldFNjcmlwdE5hbWUoZXJyb3JXaXRoU3RhY2tUcmFjZSkge1xyXG4gICAgICAgIHZhciBzdGFjayA9IGVycm9yV2l0aFN0YWNrVHJhY2Uuc3RhY2sudHJpbSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBjdXJyZW50U3RhY2tGcmFtZVJlZ2V4ID0gL2F0ICh8W14gXSsgXFwoKShbXiBdKyk6XFxkKzpcXGQrLztcclxuICAgICAgICB2YXIgc291cmNlID0gY3VycmVudFN0YWNrRnJhbWVSZWdleC5leGVjKHN0YWNrKTtcclxuICAgICAgICBpZiAoc291cmNlICYmIHNvdXJjZVsyXSAhPT0gXCJcIikge1xyXG4gICAgICAgICAgICByZXR1cm4gc291cmNlWzJdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIGxhc3RTdGFja0ZyYW1lUmVnZXggPSBuZXcgUmVnRXhwKC8uK1xcLyguKj8pOlxcZCsoOlxcZCspKiQvKTtcclxuICAgICAgICBzb3VyY2UgPSBsYXN0U3RhY2tGcmFtZVJlZ2V4LmV4ZWMoc3RhY2spO1xyXG4gICAgICAgIGlmIChzb3VyY2UgJiYgc291cmNlWzFdICE9PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBzb3VyY2VbMV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChlcnJvcldpdGhTdGFja1RyYWNlLmZpbGVOYW1lICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGVycm9yV2l0aFN0YWNrVHJhY2UuZmlsZU5hbWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRocm93ICdJbWFnZURlY29kZXJGcmFtZXdvcmsuanM6IENvdWxkIG5vdCBnZXQgY3VycmVudCBzY3JpcHQgVVJMJztcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTY3JpcHRzVG9JbXBvcnRQb29sO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY3JpcHRzVG9JbXBvcnRQb29sOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG5cclxudmFyIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSA9IChmdW5jdGlvbiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWVDbG9zdXJlKCkge1xyXG4gICAgdmFyIHN1YldvcmtlcklkID0gMDtcclxuICAgIHZhciBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0gbnVsbDtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lKHNjcmlwdFVybCkge1xyXG4gICAgICAgIGlmIChzdWJXb3JrZXJJZFRvU3ViV29ya2VyID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5IGludGVybmFsIGVycm9yOiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgJyArXHJcbiAgICAgICAgICAgICAgICAnbm90IGluaXRpYWxpemVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3N1YldvcmtlcklkID0gKytzdWJXb3JrZXJJZDtcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyW3RoYXQuX3N1YldvcmtlcklkXSA9IHRoYXQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWJXb3JrZXJDdG9yJyxcclxuICAgICAgICAgICAgc3ViV29ya2VySWQ6IHRoYXQuX3N1YldvcmtlcklkLFxyXG4gICAgICAgICAgICBzY3JpcHRVcmw6IHNjcmlwdFVybFxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uIGluaXRpYWxpemUoXHJcbiAgICAgICAgc3ViV29ya2VySWRUb1N1Yldvcmtlcl8pIHtcclxuICAgICAgICBcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0gc3ViV29ya2VySWRUb1N1Yldvcmtlcl87XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUucHJvdG90eXBlLnBvc3RNZXNzYWdlID0gZnVuY3Rpb24gcG9zdE1lc3NhZ2UoXHJcbiAgICAgICAgZGF0YSwgdHJhbnNmZXJhYmxlcykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnc3ViV29ya2VyUG9zdE1lc3NhZ2UnLFxyXG4gICAgICAgICAgICBzdWJXb3JrZXJJZDogdGhpcy5fc3ViV29ya2VySWQsXHJcbiAgICAgICAgICAgIGRhdGE6IGRhdGFcclxuICAgICAgICB9LFxyXG4gICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoXHJcbiAgICAgICAgZGF0YSwgdHJhbnNmZXJhYmxlcykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnc3ViV29ya2VyVGVybWluYXRlJyxcclxuICAgICAgICAgICAgc3ViV29ya2VySWQ6IHRoaXMuX3N1YldvcmtlcklkXHJcbiAgICAgICAgfSxcclxuICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWU7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZTsiXX0=
