(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.asyncProxy = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var SubWorkerEmulationForChrome = require('sub-worker-emulation-for-chrome');
var AsyncProxyFactory = require('async-proxy-factory');
var AsyncProxySlave = require('async-proxy-slave');
var AsyncProxyMaster = require('async-proxy-master');
var ScriptsToImportPool = require('scripts-to-Import-Pool');
var DependencyWorkers = require('dependency-workers');
var DependencyWorkersTaskHandle = require('dependency-workers-task-handle');
var DependencyWorkersTask = require('dependency-workers-task');
var WrapperInputRetreiverBase = require('wrapper-input-retreiver-base');
var SchedulerTask = require('scheduler-task');
var SchedulerWrapperInputRetreiver = require('scheduler-wrapper-input-retreiver');
var SchedulerDependencyWorkers = require('scheduler-dependency-workers');

module.exports.SubWorkerEmulationForChrome = SubWorkerEmulationForChrome;
module.exports.AsyncProxyFactory = AsyncProxyFactory;
module.exports.AsyncProxySlave = AsyncProxySlave;
module.exports.AsyncProxyMaster = AsyncProxyMaster;
module.exports.ScriptsToImportPool = ScriptsToImportPool;
module.exports.DependencyWorkers = DependencyWorkers;
module.exports.DependencyWorkersTaskHandle = DependencyWorkersTaskHandle;
module.exports.DependencyWorkersTask = DependencyWorkersTask;
module.exports.WrapperInputRetreiverBase = WrapperInputRetreiverBase;
module.exports.SchedulerTask = SchedulerTask;
module.exports.SchedulerWrapperInputRetreiver = SchedulerWrapperInputRetreiver;
module.exports.SchedulerDependencyWorkers = SchedulerDependencyWorkers;
},{"async-proxy-factory":2,"async-proxy-master":3,"async-proxy-slave":4,"dependency-workers":8,"dependency-workers-task":7,"dependency-workers-task-handle":6,"scheduler-dependency-workers":12,"scheduler-task":13,"scheduler-wrapper-input-retreiver":14,"scripts-to-Import-Pool":16,"sub-worker-emulation-for-chrome":18,"wrapper-input-retreiver-base":15}],2:[function(require,module,exports){
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
},{"scripts-to-import-pool":17}],4:[function(require,module,exports){
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
},{"async-proxy-master":3,"sub-worker-emulation-for-chrome":18}],5:[function(require,module,exports){
'use strict';

var LinkedList = require('linked-list');
var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTask = require('dependency-workers-task');

var DependencyWorkersInternalContext = (function DependencyWorkersInternalContextClosure() {
	function DependencyWorkersInternalContext() {
        // This class is not exposed outside AsyncProxy, I allowed myself to
        // use public members
        
        this.isTerminated = false;
        this.priority = 0;
        this.lastProcessedData = null;
		this.taskApi = null;
        this.hasProcessedData = false;
        
        this.waitingForWorkerResult = false;
        this.isPendingDataForWorker = false;
        this.pendingDataForWorker = null;
        this.pendingWorkerType = 0;
        
        //this.taskContext = null;
        this.taskHandles = new LinkedList();
        
        this.taskKey = null;
		this._isActualTerminationPending = false;
        this._dependsTasksTerminatedCount = 0;
        this._parentDependencyWorkers = null;
        this._workerInputRetreiver = null;
        this._parentList = null;
        this._parentIterator = null;
        this._dependsTaskHandles = null;
		
		this._dependTaskKeys = [];
		this._dependTaskResults = [];
		this._hasDependTaskData = [];
	}
    
    DependencyWorkersInternalContext.prototype.initialize = function(
            taskKey, dependencyWorkers, inputRetreiver, list, iterator /*, hasher*/) {
                
        this.taskKey = taskKey;
        this._parentDependencyWorkers = dependencyWorkers;
        this._workerInputRetreiver = inputRetreiver;
        this._parentList = list;
        this._parentIterator = iterator;
        //this._dependsTaskHandles = new HashMap(hasher);
        this._dependsTaskHandles = new JsBuiltinHashMap();
		this.taskApi = new DependencyWorkersTask(this, taskKey);
    };
    
    DependencyWorkersInternalContext.prototype.ended = function() {
        this._parentList.remove(this._parentIterator);
        this._parentIterator = null;

        var iterator = this._dependsTaskHandles.getFirstIterator();
        while (iterator !== null) {
            var handle = this._dependsTaskHandles.getFromIterator(iterator).taskHandle;
            iterator = this._dependsTaskHandles.getNextIterator(iterator);
            
            handle.unregister();
        }
        this._dependsTaskHandles.clear();

		var that = this;
		setTimeout(function() {
			iterator = that.taskHandles.getFirstIterator();
			while (iterator !== null) {
				var handle = that.taskHandles.getFromIterator(iterator);
				iterator = that.taskHandles.getNextIterator(iterator);

				if (handle._callbacks.onTerminated) {
					handle._callbacks.onTerminated();
				}
			}
			
			that.taskHandles.clear();
		});
    };
	
    DependencyWorkersInternalContext.prototype.setPriorityAndNotify = function(
            newPriority) {
                
        if (this.priority === newPriority) {
            return;
        }
        
        this.priority = newPriority;
        this.statusUpdate();

        var iterator = this._dependsTaskHandles.getFirstIterator();
        while (iterator !== null) {
            var handle = this._dependsTaskHandles.getFromIterator(iterator).taskHandle;
            iterator = this._dependsTaskHandles.getNextIterator(iterator);
            
            handle.setPriority(newPriority);
        }
    };
    
    DependencyWorkersInternalContext.prototype.statusUpdate = function() {
        var status = {
            'priority': this.priority,
            'hasListeners': this.taskHandles.getCount() > 0,
            'isWaitingForWorkerResult': this.waitingForWorkerResult,
            'terminatedDependsTasks': this._dependsTasksTerminatedCount,
            'dependsTasks': this._dependsTaskHandles.getCount()
        };
        this.taskApi._onEvent('statusUpdated', status);

		if (this._isActualTerminationPending && !this.waitingForWorkerResult) {
			this._isActualTerminationPending = false;
			this.ended();
		}
	};
    
    DependencyWorkersInternalContext.prototype.recalculatePriority = function() {
        var handles = this.taskHandles;
        
        var iterator = handles.getFirstIterator();
        var isFirst = true;
        var newPriority = 0;
        while (iterator !== null) {
            var handle = handles.getFromIterator(iterator);
            if (isFirst || handle._localPriority > newPriority) {
                newPriority = handle._localPriority;
            }
            iterator = handles.getNextIterator(iterator);
        }

        return newPriority;
    };
    
    DependencyWorkersInternalContext.prototype.newData = function(data) {
        this.hasProcessedData = true;
        this.lastProcessedData = data;
		var that = this;
        
		setTimeout(function() {
			var handles = that.taskHandles;
			var iterator = handles.getFirstIterator();
			while (iterator !== null) {
				var handle = handles.getFromIterator(iterator);
				iterator = handles.getNextIterator(iterator);
				
				handle._callbacks.onData(data, that.taskKey);
			}
		});
    };
    
	DependencyWorkersInternalContext.prototype.dataReady = function dataReady(newDataToProcess, workerType) {
		if (this.isTerminated) {
			throw 'AsyncProxy.DependencyWorkers: already terminated';
		} else if (this.waitigForWorkerResult) {
			// Used in DependencyWorkers._startWorker() when previous worker has finished
			this.pendingDataForWorker = newDataToProcess;
			this.isPendingDataForWorker = true;
			this.pendingWorkerType = workerType;
		} else {
			this._parentDependencyWorkers._dataReady(
				this, newDataToProcess, workerType);
		}
	};

    DependencyWorkersInternalContext.prototype.terminate = function terminate() {
        if (this.isTerminated) {
            throw 'AsyncProxy.DependencyWorkers: already terminated';
        }
		
        this.isTerminated = true;
		if (this.waitingForWorkerResult) {
            this._isActualTerminationPending = true;
        } else {
			this.ended();
		}
    };
	
	Object.defineProperty(DependencyWorkersInternalContext.prototype, 'dependTaskKeys', {
		get: function getDependTaskKeys() {
			return this._dependTaskKeys;
		}
	});
	
	Object.defineProperty(DependencyWorkersInternalContext.prototype, 'dependTaskResults', {
		get: function getDependTaskResults() {
			return this._dependTaskResults;
		}
	});
	
    DependencyWorkersInternalContext.prototype.registerTaskDependency = function(
            taskKey) {
        
        var strKey = this._workerInputRetreiver.getKeyAsString(taskKey);
        var addResult = this._dependsTaskHandles.tryAdd(strKey, function() {
            return { taskHandle: null };
        });
        
        if (!addResult.isNew) {
            throw 'AsyncProxy.DependencyWorkers: Cannot add task dependency twice';
        }
        
        var that = this;
        var gotData = false;
        var isTerminated = false;
		var index = this._dependTaskKeys.length;
		
		this._dependTaskKeys[index] = taskKey;
        
        addResult.value.taskHandle = this._parentDependencyWorkers.startTask(
            taskKey, {
                'onData': onDependencyTaskData,
                'onTerminated': onDependencyTaskTerminated
            }
        );
        
		if (!gotData && addResult.value.taskHandle.hasData()) {
			setTimeout(function() {
                onDependencyTaskData(addResult.value.taskHandle.getLastData());
			});
		}
        
        function onDependencyTaskData(data) {
			that._dependTaskResults[index] = data;
			that._hasDependTaskData[index] = true;
			that.taskApi._onEvent('dependencyTaskData', data, taskKey);
            gotData = true;
        }
        
        function onDependencyTaskTerminated() {
            if (isTerminated) {
                throw 'AsyncProxy.DependencyWorkers: Double termination';
            }
            isTerminated = true;
            that._dependsTaskTerminated();
        }
    };
    
    DependencyWorkersInternalContext.prototype._dependsTaskTerminated = function dependsTaskTerminated() {
        ++this._dependsTasksTerminatedCount;
		if (this._dependsTasksTerminatedCount === this._dependsTaskHandles.getCount()) {
			this.taskApi._onEvent('allDependTasksTerminated');
		}
        this.statusUpdate();
    };
	
    return DependencyWorkersInternalContext;
})();

module.exports = DependencyWorkersInternalContext;
},{"dependency-workers-task":7,"js-builtin-hash-map":10,"linked-list":11}],6:[function(require,module,exports){
'use strict';

var DependencyWorkersTaskHandle = (function DependencyWorkersTaskHandleClosure() {
    function DependencyWorkersTaskHandle(internalContext, callbacks) {
        this._internalContext = internalContext;
        this._localPriority = 0;
        this._callbacks = callbacks;
        this._taskHandlesIterator = internalContext.taskHandles.add(this);
    }
    
    DependencyWorkersTaskHandle.prototype.hasData = function hasData() {
        return this._internalContext.hasProcessedData;
    };
    
    DependencyWorkersTaskHandle.prototype.getLastData = function getLastData() {
        return this._internalContext.lastProcessedData;
    };
    
    DependencyWorkersTaskHandle.prototype.setPriority = function(priority) {
        if (!this._taskHandlesIterator) {
            throw 'AsyncProxy.DependencyWorkers: Already unregistered';
        }

        var newPriority;
        if (priority > this._internalContext.priority) {
            newPriority = priority;
        } else if (this._localPriority < this._internalContext.priority) {
            newPriority = this._internalContext.priority;
        } else {
            newPriority = this._internalContext.recalculatePriority();
        }
        
        this._internalContext.setPriorityAndNotify(newPriority);
    };
    
    DependencyWorkersTaskHandle.prototype.unregister = function() {
        if (!this._taskHandlesIterator) {
            throw 'AsyncProxy.DependencyWorkers: Already unregistered';
        }
        this._internalContext.taskHandles.remove(this._taskHandlesIterator);
        this._taskHandlesIterator = null;
        
        if (this._internalContext.taskHandles.getCount() === 0) {
            if (!this._internalContext.isTerminated) {
                // Should be called from statusUpdate when worker shut down
				//this._internalContext.ended();
				
                this._internalContext.statusUpdate();
            }
        } else if (this._localPriority === this._internalContext.priority) {
            var newPriority = this._internalContext.recalculatePriority();
            this._internalContext.setPriorityAndNotify(newPriority);
        }
    };

    return DependencyWorkersTaskHandle;
})();

module.exports = DependencyWorkersTaskHandle;
},{}],7:[function(require,module,exports){
'use strict';

var DependencyWorkersTask = (function DependencyWorkersTaskClosure() {
	function DependencyWorkersTask(wrapped, key, registerWrappedEvents) {
		this._wrapped = wrapped;
		this._key = key;
		this._eventListeners = {
			'dependencyTaskData': [],
			'statusUpdated': [],
			'allDependTasksTerminated': []
		};
		
		if (registerWrappedEvents) {
			for (var event in this._eventListeners) {
				this._registerWrappedEvent(event);
			}
		}
	}
	
	DependencyWorkersTask.prototype.dataReady = function dataReady(newDataToProcess, workerType) {
		this._wrapped.dataReady(newDataToProcess, workerType);
	};
	
	DependencyWorkersTask.prototype.terminate = function terminate() {
		this._wrapped.terminate();
	};
	
	DependencyWorkersTask.prototype.registerTaskDependency = function registerTaskDependency(taskKey) {
		return this._wrapped.registerTaskDependency(taskKey);
	};
	
	DependencyWorkersTask.prototype.on = function on(event, listener) {
		if (!this._eventListeners[event]) {
			throw 'AsyncProxy.DependencyWorkers: Task has no event ' + event;
		}
		this._eventListeners[event].push(listener);
	};
	
	Object.defineProperty(DependencyWorkersTask.prototype, 'key', {
		get: function getKey() {
			return this._key;
		}
	});
	
	Object.defineProperty(DependencyWorkersTask.prototype, 'dependTaskKeys', {
		get: function getDependTaskKeys() {
			return this._wrapped.dependTaskKeys;
		}
	});
	
	Object.defineProperty(DependencyWorkersTask.prototype, 'dependTaskResults', {
		get: function getDependTaskResults() {
			return this._wrapped.dependTaskResults;
		}
	});
	
	DependencyWorkersTask.prototype._onEvent = function onEvent(event, arg1, arg2) {
		if (event == 'statusUpdated') {
			arg1 = this._modifyStatus(arg1);
		}
		var listeners = this._eventListeners[event];
		for (var i = 0; i < listeners.length; ++i) {
			listeners[i].call(this, arg1, arg2);
		}
	};
	
	DependencyWorkersTask.prototype._modifyStatus = function modifyStatus(status) {
		return status;
	};
	
	DependencyWorkersTask.prototype._registerWrappedEvent = function registerWrappedEvent(event) {
		var that = this;
		this._wrapped.on(event, function(arg1, arg2) {
			that._onEvent(event, arg1, arg2);
		});
	};

	return DependencyWorkersTask;
})();

module.exports = DependencyWorkersTask;
},{}],8:[function(require,module,exports){
'use strict';

/* global console: false */
/* global Promise: false */

var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersInternalContext = require('dependency-workers-internal-context');
var DependencyWorkersTaskHandle = require('dependency-workers-task-handle');
var AsyncProxyMaster = require('async-proxy-master');

var DependencyWorkers = (function DependencyWorkersClosure() {
    function DependencyWorkers(workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._internalContexts = new JsBuiltinHashMap();
        that._workerPoolByTaskType = [];
        that._taskOptionsByTaskType = [];
        
        if (!workerInputRetreiver.getWorkerTypeOptions) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getWorkerTypeOptions() method';
        }
        if (!workerInputRetreiver.getKeyAsString) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getKeyAsString() method';
        }
    }
    
    DependencyWorkers.prototype.startTask = function startTask(
        taskKey, callbacks) {
        
        var dependencyWorkers = this;
        
        var strKey = this._workerInputRetreiver.getKeyAsString(taskKey);
        var addResult = this._internalContexts.tryAdd(strKey, function() {
            return new DependencyWorkersInternalContext();
        });
        
        var internalContext = addResult.value;
        var taskHandle = new DependencyWorkersTaskHandle(
            internalContext, callbacks);
        
        if (addResult.isNew) {
            internalContext.initialize(
                taskKey,
                this,
                this._workerInputRetreiver,
                this._internalContexts,
                addResult.iterator,
                this._workerInputRetreiver);
				
            this._workerInputRetreiver.taskStarted(internalContext.taskApi);
        }
        

        return taskHandle;
    };
    
    DependencyWorkers.prototype.startTaskPromise =
            function startTaskPromise(taskKey) {
        
        var that = this;
        return new Promise(function(resolve, reject) {
            var taskHandle = that.startTask(
                taskKey, { 'onData': onData, 'onTerminated': onTerminated });
            
            var hasData = taskHandle.hasData();
            var result;
            if (hasData) {
                result = taskHandle.getLastData();
            }
            
            function onData(data) {
                hasData = true;
                result = data;
            }
            
            function onTerminated() {
                if (hasData) {
                    resolve(result);
                } else {
                    reject('AsyncProxy.DependencyWorkers: Internal ' +
                        'error - task terminated but no data returned');
                }
            }
        });
    };
    
    DependencyWorkers.prototype._dataReady = function dataReady(
			internalContext, dataToProcess, workerType) {
        
		var that = this;
        var worker;
        var workerPool = that._workerPoolByTaskType[workerType];
        if (!workerPool) {
            workerPool = [];
            that._workerPoolByTaskType[workerType] = workerPool;
        }
        if (workerPool.length > 0) {
            worker = workerPool.pop();
        } else {
            var workerArgs = that._workerInputRetreiver.getWorkerTypeOptions(
                workerType);

			if (!workerArgs) {
				internalContext.newData(dataToProcess);
				internalContext.statusUpdate();
				return;
			}
            
			worker = new AsyncProxyMaster(
                workerArgs.scriptsToImport,
                workerArgs.ctorName,
                workerArgs.ctorArgs);
        }
        
        if (!internalContext.waitingForWorkerResult) {
            internalContext.waitingForWorkerResult = true;
            internalContext.statusUpdate();
        }
        
        worker.callFunction(
                'start',
                [dataToProcess, internalContext.taskKey],
                {'isReturnPromise': true})
            .then(function(processedData) {
                internalContext.newData(processedData);
                return processedData;
            }).catch(function(e) {
                console.log('Error in DependencyWorkers\' worker: ' + e);
                return e;
            }).then(function(result) {
                workerPool.push(worker);
                
                if (!that._checkIfPendingData(internalContext)) {
                    internalContext.waitingForWorkerResult = false;
                    internalContext.statusUpdate();
                }
            });
    };
	
	DependencyWorkers.prototype._checkIfPendingData = function checkIfPendingData(internalContext) {
		if (!internalContext.isPendingDataForWorker) {
			return false;
		}
		
		var dataToProcess = internalContext.pendingDataForWorker;
		internalContext.isPendingDataForWorker = false;
		internalContext.pendingDataForWorker = null;
		
		this._dataReady(
			internalContext,
			dataToProcess,
			internalContext.pendingWorkerType);
		
		return true;
	};
    
    return DependencyWorkers;
})();

module.exports = DependencyWorkers;
},{"async-proxy-master":3,"dependency-workers-internal-context":5,"dependency-workers-task-handle":6,"js-builtin-hash-map":10}],9:[function(require,module,exports){
'use strict';

var LinkedList = require('linked-list');

var HashMap = (function HashMapClosure() {

function HashMap(hasher) {
    var that = this;
    that._hasher = hasher;
	that.clear();
}

HashMap.prototype.clear = function clear() {
    this._listByKey = [];
    this._listOfLists = new LinkedList();
    this._count = 0;
};

HashMap.prototype.getFromKey = function getFromKey(key) {
    var hashCode = this._hasher['getHashCode'](key);
    var hashElements = this._listByKey[hashCode];
    if (!hashElements) {
        return null;
    }
    var list = hashElements.list;
    
    var iterator = list.getFirstIterator();
    while (iterator !== null) {
        var item = list.getFromIterator(iterator);
        if (this._hasher['isEqual'](item.key, key)) {
            return item.value;
        }
        
        iterator = list.getNextIterator(iterator);
    }

    return null;
};

HashMap.prototype.getFromIterator = function getFromIterator(iterator) {
    return iterator._hashElements.list.getFromIterator(iterator._internalIterator).value;
};

HashMap.prototype.tryAdd = function tryAdd(key, createValue) {
    var hashCode = this._hasher['getHashCode'](key);
    var hashElements = this._listByKey[hashCode];
    if (!hashElements) {
        hashElements = {
            hashCode: hashCode,
            list: new LinkedList(),
            listOfListsIterator: null
        };
        hashElements.listOfListsIterator = this._listOfLists.add(hashElements);
        this._listByKey[hashCode] = hashElements;
    }
    
    var iterator = {
        _hashElements: hashElements,
        _internalIterator: null
    };
    
    iterator._internalIterator = hashElements.list.getFirstIterator();
    while (iterator._internalIterator !== null) {
        var item = hashElements.list.getFromIterator(iterator._internalIterator);
        if (this._hasher['isEqual'](item.key, key)) {
            return {
                iterator: iterator,
                isNew: false,
                value: item.value
            };
        }
        
        iterator._internalIterator = hashElements.list.getNextIterator(iterator._internalIterator);
    }
    
    var value = createValue();
    iterator._internalIterator = hashElements.list.add({
        key: key,
        value: value
    });
    ++this._count;
    
    return {
        iterator: iterator,
        isNew: true,
        value: value
    };
};

HashMap.prototype.remove = function remove(iterator) {
    var oldListCount = iterator._hashElements.list.getCount();
    iterator._hashElements.list.remove(iterator._internalIterator);
    var newListCount = iterator._hashElements.list.getCount();
    
    this._count += (newListCount - oldListCount);
    if (newListCount === 0) {
        this._listOfLists.remove(iterator._hashElements.listOfListsIterator);
        delete this._listByKey[iterator._hashElements.hashCode];
    }
};

HashMap.prototype.getCount = function getCount() {
    return this._count;
};

HashMap.prototype.getFirstIterator = function getFirstIterator() {
    var firstListIterator = this._listOfLists.getFirstIterator();
    var firstHashElements = null;
    var firstInternalIterator = null;
    if (firstListIterator !== null) {
        firstHashElements = this._listOfLists.getFromIterator(firstListIterator);
        firstInternalIterator = firstHashElements.list.getFirstIterator();
    }
    if (firstInternalIterator === null) {
        return null;
    }
    
    return {
        _hashElements: firstHashElements,
        _internalIterator: firstInternalIterator
    };
};

HashMap.prototype.getNextIterator = function getNextIterator(iterator) {
    var nextIterator = {
        _hashElements: iterator._hashElements,
        _internalIterator: iterator._hashElements.list.getNextIterator(
            iterator._internalIterator)
    };
    
    while (nextIterator._internalIterator === null) {
        var nextListOfListsIterator = this._listOfLists.getNextIterator(
            iterator._hashElements.listOfListsIterator);
        if (nextListOfListsIterator === null) {
            return null;
        }
        
        nextIterator._hashElements = this._listOfLists.getFromIterator(
            nextListOfListsIterator);
        nextIterator._internalIterator =
            nextIterator._hashElements.list.getFirstIterator();
    }
    return nextIterator;
};

return HashMap;
})();

module.exports = HashMap;
},{"linked-list":11}],10:[function(require,module,exports){
'use strict';

var HashMap = require('hash-map');

var JsBuiltinHashMap = (function HashMapClosure() {
    
// This class expose same API as HashMap but not requiring getHashCode() and isEqual() functions.
// That way it's easy to switch between implementations.

var simpleHasher = {
    'getHashCode': function getHashCode(key) {
        return key;
    },
    
    'isEqual': function isEqual(key1, key2) {
        return key1 === key2;
    }
};

function JsBuiltinHashMap() {
    HashMap.call(this, /*hasher=*/simpleHasher);
}

JsBuiltinHashMap.prototype = Object.create(HashMap.prototype);

return JsBuiltinHashMap;
})();

module.exports = JsBuiltinHashMap;
},{"hash-map":9}],11:[function(require,module,exports){
'use strict';

var LinkedList = (function LinkedListClosure() {

function LinkedList() {
    this.clear();
}

LinkedList.prototype.clear = function clear() {
    this._first = { _prev: null, _parent: this };
    this._last = { _next: null, _parent: this };
    this._count = 0;
    
    this._last._prev = this._first;
    this._first._next = this._last;
};

LinkedList.prototype.add = function add(value, addBefore) {
    if (addBefore === null || addBefore === undefined) {
        addBefore = this._last;
    }
    
    this._validateIteratorOfThis(addBefore);
    
    ++this._count;
    
    var newNode = {
        _value: value,
        _next: addBefore,
        _prev: addBefore._prev,
        _parent: this
    };
    
    newNode._prev._next = newNode;
    addBefore._prev = newNode;
    
    return newNode;
};

LinkedList.prototype.remove = function remove(iterator) {
    this._validateIteratorOfThis(iterator);
    
    --this._count;
    
    iterator._prev._next = iterator._next;
    iterator._next._prev = iterator._prev;
    iterator._parent = null;
};

LinkedList.prototype.getFromIterator = function getFromIterator(iterator) {
    this._validateIteratorOfThis(iterator);
    
    return iterator._value;
};

LinkedList.prototype.getFirstIterator = function getFirstIterator() {
    var iterator = this.getNextIterator(this._first);
    return iterator;
};

LinkedList.prototype.getLastIterator = function getFirstIterator() {
    var iterator = this.getPrevIterator(this._last);
    return iterator;
};

LinkedList.prototype.getNextIterator = function getNextIterator(iterator) {
    this._validateIteratorOfThis(iterator);

    if (iterator._next === this._last) {
        return null;
    }
    
    return iterator._next;
};

LinkedList.prototype.getPrevIterator = function getPrevIterator(iterator) {
    this._validateIteratorOfThis(iterator);

    if (iterator._prev === this._first) {
        return null;
    }
    
    return iterator._prev;
};

LinkedList.prototype.getCount = function getCount() {
    return this._count;
};

LinkedList.prototype._validateIteratorOfThis =
    function validateIteratorOfThis(iterator) {
    
    if (iterator._parent !== this) {
        throw 'iterator must be of the current LinkedList';
    }
};

return LinkedList;
})();

module.exports = LinkedList;
},{}],12:[function(require,module,exports){
'use strict';

var SchedulerWrapperInputRetreiver = require('scheduler-wrapper-input-retreiver');
var DependencyWorkers = require('dependency-workers');

var SchedulerDependencyWorkers = (function SchedulerDependencyWorkersClosure() {
    function SchedulerDependencyWorkers(scheduler, inputRetreiver) {
        var wrapperInputRetreiver = new SchedulerWrapperInputRetreiver(scheduler, inputRetreiver);
        DependencyWorkers.call(this, wrapperInputRetreiver);
    }
    
    SchedulerDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    return SchedulerDependencyWorkers;
})();

module.exports = SchedulerDependencyWorkers;
},{"dependency-workers":8,"scheduler-wrapper-input-retreiver":14}],13:[function(require,module,exports){
'use strict';

var DependencyWorkersTask = require('dependency-workers-task');

var SchedulerTask = (function SchedulerTaskClosure() {
    function SchedulerTask(scheduler, inputRetreiver, isDisableWorkerCache, wrappedTask) {
        var that = this;
		DependencyWorkersTask.call(this, wrappedTask, wrappedTask.key, /*registerWrappedEvents=*/true);
        that._scheduler = scheduler;
		that._inputRetreiver = inputRetreiver;
		that._isDisableWorkerCache = isDisableWorkerCache;
		that._wrappedTask = wrappedTask;
        that._onScheduledBound = that._onScheduled.bind(that);
        
        that._pendingDataToProcess = null;
        that._hasPendingDataToProcess = false;
        that._cancelPendingDataToProcess = false;
        that._isWorkerActive = false;
		that._isTerminated = false;
        that._lastStatus = { 'isWaitingForWorkerResult': false };
    }
	
	SchedulerTask.prototype = Object.create(DependencyWorkersTask.prototype);
    
    SchedulerTask.prototype._modifyStatus = function modifyStatus(status) {
        this._lastStatus = JSON.parse(JSON.stringify(status));
        this._checkIfJobDone(status);
        this._lastStatus.isWaitingForWorkerResult =
            status.isWaitingForWorkerResult || this._hasPendingDataToProcess;
        
		return this._lastStatus;
    };
    
    SchedulerTask.prototype.dataReady = function onDataReadyToProcess(
            newDataToProcess, workerType) {
                
        if (this._isTerminated) {
            throw 'AsyncProxy.DependencyWorkers: Data after termination';
        }
        
        if (this._isDisableWorkerCache[workerType] === undefined) {
			this._isDisableWorkerCache[workerType] = this._inputRetreiver.getWorkerTypeOptions(workerType) === null;
		}
		if (this._isDisableWorkerCache[workerType]) {
            this._pendingDataToProcess = null;
            this._cancelPendingDataToProcess =
                this._hasPendingDataToProcess && !this._isWorkerActive;
            this._hasPendingDataToProcess = false;
            DependencyWorkersTask.prototype.dataReady.call(this, newDataToProcess, workerType);
            
            var isStatusChanged =
                this._lastStatus.isWaitingForWorkerResult &&
                !this._hasPendingDataToProcess;
            if (isStatusChanged) {
                this._lastStatus.isWaitingForWorkerResult = false;
                this._onEvent('statusUpdated', this._lastStatus);
            }
            
            return;
        }
        
        this._pendingDataToProcess = newDataToProcess;
        this._cancelPendingDataToProcess = false;
        var hadPendingDataToProcess = this._hasPendingDataToProcess;
        this._hasPendingDataToProcess = true;

        if (!hadPendingDataToProcess && !this._isWorkerActive) {
            this._scheduler.enqueueJob(
                this._onScheduledBound, this);
        }
    };
    
    SchedulerTask.prototype.terminate = function terminate() {
        if (this._isTerminated) {
            throw 'AsyncProxy.DependencyWorkers: Double termination';
        }
        
        this._isTerminated = true;
        if (!this._hasPendingDataToProcess) {
			DependencyWorkersTask.prototype.terminate.call(this);
		}
    };
    
    SchedulerTask.prototype._onScheduled = function dataReadyForWorker(
            resource, jobContext, jobCallbacks) {
                
        if (jobContext !== this) {
            throw 'AsyncProxy.DependencyWorkers: Unexpected context';
        }
        
        if (this._cancelPendingDataToProcess) {
            this._cancelPendingDataToProcess = false;
			jobCallbacks.jobDone();
        } else {
			if (!this._hasPendingDataToProcess) {
				throw 'AsyncProxy.DependencyWorkers: !enqueuedProcessJob';
			}
			
			this._isWorkerActive = true;
			this._hasPendingDataToProcess = false;
			this._jobCallbacks = jobCallbacks;
			var data = this._pendingDataToProcess;
			this._pendingDataToProcess = null;
			DependencyWorkersTask.prototype.dataReady.call(this, data);
		}
		
		if (this._isTerminated) {
			DependencyWorkersTask.prototype.terminate.call(this);
		}
    };
    
    SchedulerTask.prototype._checkIfJobDone = function checkIfJobDone(status) {
        if (!this._isWorkerActive || status.isWaitingForWorkerResult) {
            return;
        }
        
        if (this._cancelPendingDataToProcess) {
            throw 'AsyncProxy.DependencyWorkers: cancelPendingDataToProcess';
        }
        
        this._isWorkerActive = false;
        
        if (this._hasPendingDataToProcess) {
            this._scheduler.enqueueJob(
                this._onScheduledBound, this);
        }

        this._jobCallbacks.jobDone();
    };
    
    return SchedulerTask;
})();

module.exports = SchedulerTask;
},{"dependency-workers-task":7}],14:[function(require,module,exports){
'use strict';

var SchedulerTask = require('scheduler-task');
var WrapperInputRetreiverBase = require('wrapper-input-retreiver-base');

var SchedulerWrapperInputRetreiver = (function SchedulerWrapperInputRetreiverClosure() {
    function SchedulerWrapperInputRetreiver(scheduler, inputRetreiver) {
        WrapperInputRetreiverBase.call(this, inputRetreiver);
        var that = this;
        that._scheduler = scheduler;
		that._inputRetreiver = inputRetreiver;
		that._isDisableWorkerCache = {};

        if (!inputRetreiver.taskStarted) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.taskStarted() method';
        }
    }
    
    SchedulerWrapperInputRetreiver.prototype = Object.create(WrapperInputRetreiverBase.prototype);
    
    SchedulerWrapperInputRetreiver.prototype.taskStarted =
            function taskStarted(task) {
        
        var wrapperTask = new SchedulerTask(
			this._scheduler, this._inputRetreiver, this._isDisableWorkerCache, task);
        return this._inputRetreiver.taskStarted(wrapperTask);
    };
    
    return SchedulerWrapperInputRetreiver;
})();

module.exports = SchedulerWrapperInputRetreiver;
},{"scheduler-task":13,"wrapper-input-retreiver-base":15}],15:[function(require,module,exports){
'use strict';

var WrapperInputRetreiverBase = (function WrapperInputRetreiverBaseClosure() {
    function WrapperInputRetreiverBase(inputRetreiver) {
        if (!inputRetreiver.getKeyAsString) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getKeyAsString() method';
        }
        if (!inputRetreiver.getWorkerTypeOptions) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getTaskTypeOptions() method';
        }

        var that = this;
        that._inputRetreiver = inputRetreiver;
    }
    
    WrapperInputRetreiverBase.prototype.taskStarted =
            function taskStarted(task) {
        
        throw 'AsyncProxy.WrapperInputRetreiverBase internal error: Not implemented taskStarted()';
    };
    
    WrapperInputRetreiverBase.prototype.getKeyAsString = function(key) {
        return this._inputRetreiver.getKeyAsString(key);
    };
    
    
    WrapperInputRetreiverBase.prototype.getWorkerTypeOptions = function(taskType) {
        return this._inputRetreiver.getWorkerTypeOptions(taskType);
    };
    
    return WrapperInputRetreiverBase;
})();

module.exports = WrapperInputRetreiverBase;
},{}],16:[function(require,module,exports){
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
},{}],17:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"dup":16}],18:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXN5bmMtcHJveHktZXhwb3J0cy5qcyIsInNyYy9hc3luYy1wcm94eS1mYWN0b3J5LmpzIiwic3JjL2FzeW5jLXByb3h5LW1hc3Rlci5qcyIsInNyYy9hc3luYy1wcm94eS1zbGF2ZS5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvZGVwZW5kZW5jeS13b3JrZXJzLWludGVybmFsLWNvbnRleHQuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWhhbmRsZS5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2suanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2RlcGVuZGVuY3ktd29ya2Vycy5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvaGFzaC1tYXAuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2pzLWJ1aWx0aW4taGFzaC1tYXAuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2xpbmtlZC1saXN0LmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9zY2hlZHVsZXItZGVwZW5kZW5jeS13b3JrZXJzLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9zY2hlZHVsZXItdGFzay5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvc2NoZWR1bGVyLXdyYXBwZXItaW5wdXQtcmV0cmVpdmVyLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy93cmFwcGVyLWlucHV0LXJldHJlaXZlci1iYXNlLmpzIiwic3JjL3NjcmlwdHMtdG8tSW1wb3J0LVBvb2wuanMiLCJzcmMvc3ViLXdvcmtlci1lbXVsYXRpb24tZm9yLWNocm9tZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOU5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4UEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSA9IHJlcXVpcmUoJ3N1Yi13b3JrZXItZW11bGF0aW9uLWZvci1jaHJvbWUnKTtcclxudmFyIEFzeW5jUHJveHlGYWN0b3J5ID0gcmVxdWlyZSgnYXN5bmMtcHJveHktZmFjdG9yeScpO1xudmFyIEFzeW5jUHJveHlTbGF2ZSA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LXNsYXZlJyk7XG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xudmFyIFNjcmlwdHNUb0ltcG9ydFBvb2wgPSByZXF1aXJlKCdzY3JpcHRzLXRvLUltcG9ydC1Qb29sJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2VycycpO1xudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZSA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWhhbmRsZScpO1xudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFzayA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrJyk7XG52YXIgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSA9IHJlcXVpcmUoJ3dyYXBwZXItaW5wdXQtcmV0cmVpdmVyLWJhc2UnKTtcclxudmFyIFNjaGVkdWxlclRhc2sgPSByZXF1aXJlKCdzY2hlZHVsZXItdGFzaycpO1xudmFyIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlciA9IHJlcXVpcmUoJ3NjaGVkdWxlci13cmFwcGVyLWlucHV0LXJldHJlaXZlcicpO1xudmFyIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzID0gcmVxdWlyZSgnc2NoZWR1bGVyLWRlcGVuZGVuY3ktd29ya2VycycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5RmFjdG9yeSA9IEFzeW5jUHJveHlGYWN0b3J5O1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5U2xhdmUgPSBBc3luY1Byb3h5U2xhdmU7XHJcbm1vZHVsZS5leHBvcnRzLkFzeW5jUHJveHlNYXN0ZXIgPSBBc3luY1Byb3h5TWFzdGVyO1xyXG5tb2R1bGUuZXhwb3J0cy5TY3JpcHRzVG9JbXBvcnRQb29sID0gU2NyaXB0c1RvSW1wb3J0UG9vbDtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnMgPSBEZXBlbmRlbmN5V29ya2VycztcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlO1xyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2s7XHJcbm1vZHVsZS5leHBvcnRzLldyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJUYXNrID0gU2NoZWR1bGVyVGFzaztcclxubW9kdWxlLmV4cG9ydHMuU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyID0gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XHJcblxyXG52YXIgQXN5bmNQcm94eUZhY3RvcnkgPSAoZnVuY3Rpb24gQXN5bmNQcm94eUZhY3RvcnlDbG9zdXJlKCkge1xyXG4gICAgdmFyIGZhY3RvcnlTaW5nbGV0b24gPSB7fTtcclxuXHRcclxuXHRmYWN0b3J5U2luZ2xldG9uLmNyZWF0ZSA9IGZ1bmN0aW9uIGNyZWF0ZShzY3JpcHRzVG9JbXBvcnQsIGN0b3JOYW1lLCBtZXRob2RzLCBwcm94eUN0b3IpIHtcclxuXHRcdGlmICgoIXNjcmlwdHNUb0ltcG9ydCkgfHwgIShzY3JpcHRzVG9JbXBvcnQubGVuZ3RoKSkge1xyXG5cdFx0XHR0aHJvdyAnQXN5bmNQcm94eUZhY3RvcnkgZXJyb3I6IG1pc3Npbmcgc2NyaXB0c1RvSW1wb3J0ICgybmQgYXJndW1lbnQpJztcclxuXHRcdH1cclxuXHRcdGlmICghbWV0aG9kcykge1xyXG5cdFx0XHR0aHJvdyAnQXN5bmNQcm94eUZhY3RvcnkgZXJyb3I6IG1pc3NpbmcgbWV0aG9kcyAoM3JkIGFyZ3VtZW50KSc7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdHZhciBQcm94eUNsYXNzID0gcHJveHlDdG9yIHx8IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgdGhhdCA9IHRoaXM7XHJcblx0XHRcdHRoaXMuX193b3JrZXJIZWxwZXJDdG9yQXJncyA9IGNvbnZlcnRBcmdzKGFyZ3VtZW50cyk7XHJcblx0XHR9O1xyXG5cdFx0XHJcblx0XHRQcm94eUNsYXNzLnByb3RvdHlwZS5fZ2V0V29ya2VySGVscGVyID0gZnVuY3Rpb24gZ2V0V29ya2VySGVscGVyKCkge1xyXG5cdFx0XHRpZiAoIXRoaXMuX193b3JrZXJIZWxwZXIpIHtcclxuXHRcdFx0XHR0aGlzLl9fd29ya2VySGVscGVyID0gbmV3IEFzeW5jUHJveHlNYXN0ZXIoXHJcblx0XHRcdFx0XHRzY3JpcHRzVG9JbXBvcnQsIGN0b3JOYW1lLCB0aGlzLl9fd29ya2VySGVscGVyQ3RvckFyZ3MgfHwgW10pO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHRyZXR1cm4gdGhpcy5fX3dvcmtlckhlbHBlcjtcclxuXHRcdH07XHJcblx0XHRcclxuXHRcdGZvciAodmFyIG1ldGhvZE5hbWUgaW4gbWV0aG9kcykge1xyXG5cdFx0XHRnZW5lcmF0ZU1ldGhvZChQcm94eUNsYXNzLCBtZXRob2ROYW1lLCBtZXRob2RzW21ldGhvZE5hbWVdIHx8IFtdKTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0cmV0dXJuIFByb3h5Q2xhc3M7XHJcblx0fTtcclxuXHRcclxuXHRmdW5jdGlvbiBnZW5lcmF0ZU1ldGhvZChQcm94eUNsYXNzLCBtZXRob2ROYW1lLCBtZXRob2RBcmdzRGVzY3JpcHRpb24pIHtcclxuXHRcdGlmICh0eXBlb2YgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uID09PSAnZnVuY3Rpb24nKSB7XHJcblx0XHRcdFByb3h5Q2xhc3MucHJvdG90eXBlW21ldGhvZE5hbWVdID0gbWV0aG9kQXJnc0Rlc2NyaXB0aW9uO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdHZhciBtZXRob2RPcHRpb25zID0gbWV0aG9kQXJnc0Rlc2NyaXB0aW9uWzBdIHx8IHt9O1xyXG5cdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbiBnZW5lcmF0ZWRGdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHdvcmtlckhlbHBlciA9IHRoaXMuX2dldFdvcmtlckhlbHBlcigpO1xyXG5cdFx0XHR2YXIgYXJnc1RvU2VuZCA9IFtdO1xyXG5cdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRcdHZhciBhcmdEZXNjcmlwdGlvbiA9IG1ldGhvZEFyZ3NEZXNjcmlwdGlvbltpICsgMV07XHJcblx0XHRcdFx0dmFyIGFyZ1ZhbHVlID0gYXJndW1lbnRzW2ldO1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdGlmIChhcmdEZXNjcmlwdGlvbiA9PT0gJ2NhbGxiYWNrJykge1xyXG5cdFx0XHRcdFx0YXJnc1RvU2VuZFtpXSA9IHdvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soYXJnVmFsdWUpO1xyXG5cdFx0XHRcdH0gZWxzZSBpZiAoIWFyZ0Rlc2NyaXB0aW9uKSB7XHJcblx0XHRcdFx0XHRhcmdzVG9TZW5kW2ldID0gYXJnVmFsdWU7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdHRocm93ICdBc3luY1Byb3h5RmFjdG9yeSBlcnJvcjogVW5yZWNvZ25pemVkIGFyZ3VtZW50ICcgK1xyXG5cdFx0XHRcdFx0XHQnZGVzY3JpcHRpb24gJyArIGFyZ0Rlc2NyaXB0aW9uICsgJyBpbiBhcmd1bWVudCAnICtcclxuXHRcdFx0XHRcdFx0KGkgKyAxKSArICcgb2YgbWV0aG9kICcgKyBtZXRob2ROYW1lO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbihcclxuXHRcdFx0XHRtZXRob2ROYW1lLCBhcmdzVG9TZW5kLCBtZXRob2RBcmdzRGVzY3JpcHRpb25bMF0pO1xyXG5cdFx0fTtcclxuXHR9XHJcblx0XHJcblx0ZnVuY3Rpb24gY29udmVydEFyZ3MoYXJnc09iamVjdCkge1xyXG5cdFx0dmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJnc09iamVjdC5sZW5ndGgpO1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzT2JqZWN0Lmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdGFyZ3NbaV0gPSBhcmdzT2JqZWN0W2ldO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRyZXR1cm4gYXJncztcclxuXHR9XHJcbiAgICBcclxuICAgIHJldHVybiBmYWN0b3J5U2luZ2xldG9uO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5RmFjdG9yeTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBTY3JpcHRzVG9JbXBvcnRQb29sID0gcmVxdWlyZSgnc2NyaXB0cy10by1pbXBvcnQtcG9vbCcpO1xyXG5cclxudmFyIEFzeW5jUHJveHlNYXN0ZXIgPSAoZnVuY3Rpb24gQXN5bmNQcm94eU1hc3RlckNsb3N1cmUoKSB7XHJcbiAgICB2YXIgY2FsbElkID0gMDtcclxuICAgIHZhciBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkID0gZmFsc2U7XHJcbiAgICB2YXIgbWFzdGVyRW50cnlVcmwgPSBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIEFzeW5jUHJveHlNYXN0ZXIoc2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgY3RvckFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fY2FsbGJhY2tzID0gW107XHJcbiAgICAgICAgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxscyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3N1YldvcmtlckJ5SWQgPSBbXTtcclxuICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzID0gW107XHJcbiAgICAgICAgdGhhdC5fdXNlckRhdGFIYW5kbGVyID0gbnVsbDtcclxuICAgICAgICB0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA9IDA7XHJcbiAgICAgICAgdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSA9IG9wdGlvbnMuZnVuY3Rpb25zQnVmZmVyU2l6ZSB8fCA1O1xyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcyA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzY3JpcHROYW1lID0gZ2V0U2NyaXB0TmFtZSgpO1xyXG4gICAgICAgIHZhciBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcgPSBtYWluU2xhdmVTY3JpcHRDb250ZW50LnRvU3RyaW5nKCk7XHJcbiAgICAgICAgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nID0gc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nLnJlcGxhY2UoXHJcbiAgICAgICAgICAgICdTQ1JJUFRfUExBQ0VIT0xERVInLCBzY3JpcHROYW1lKTtcclxuICAgICAgICB2YXIgc2xhdmVTY3JpcHRDb250ZW50QmxvYiA9IG5ldyBCbG9iKFxyXG4gICAgICAgICAgICBbJygnLCBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcsICcpKCknXSxcclxuICAgICAgICAgICAgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XHJcbiAgICAgICAgdmFyIHNsYXZlU2NyaXB0VXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzbGF2ZVNjcmlwdENvbnRlbnRCbG9iKTtcclxuXHJcbiAgICAgICAgdGhhdC5fd29ya2VyID0gbmV3IFdvcmtlcihzbGF2ZVNjcmlwdFVybCk7XHJcbiAgICAgICAgdGhhdC5fd29ya2VyLm9ubWVzc2FnZSA9IG9uV29ya2VyTWVzc2FnZUludGVybmFsO1xyXG5cclxuICAgICAgICB0aGF0Ll93b3JrZXIucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ2N0b3InLFxyXG4gICAgICAgICAgICBzY3JpcHRzVG9JbXBvcnQ6IHNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgY3Rvck5hbWU6IGN0b3JOYW1lLFxyXG4gICAgICAgICAgICBhcmdzOiBjdG9yQXJncyxcclxuICAgICAgICAgICAgY2FsbElkOiArK2NhbGxJZCxcclxuICAgICAgICAgICAgaXNQcm9taXNlOiBmYWxzZSxcclxuICAgICAgICAgICAgbWFzdGVyRW50cnlVcmw6IEFzeW5jUHJveHlNYXN0ZXIuZ2V0RW50cnlVcmwoKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZUludGVybmFsKHdvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5zZXRVc2VyRGF0YUhhbmRsZXIgPSBmdW5jdGlvbiBzZXRVc2VyRGF0YUhhbmRsZXIodXNlckRhdGFIYW5kbGVyKSB7XHJcbiAgICAgICAgdGhpcy5fdXNlckRhdGFIYW5kbGVyID0gdXNlckRhdGFIYW5kbGVyO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIHRoaXMuX3dvcmtlci50ZXJtaW5hdGUoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3N1YldvcmtlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdGhpcy5fc3ViV29ya2Vyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5jYWxsRnVuY3Rpb24gPSBmdW5jdGlvbiBjYWxsRnVuY3Rpb24oZnVuY3Rpb25Ub0NhbGwsIGFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgaXNSZXR1cm5Qcm9taXNlID0gISFvcHRpb25zLmlzUmV0dXJuUHJvbWlzZTtcclxuICAgICAgICB2YXIgdHJhbnNmZXJhYmxlc0FyZyA9IG9wdGlvbnMudHJhbnNmZXJhYmxlcyB8fCBbXTtcclxuICAgICAgICB2YXIgcGF0aHNUb1RyYW5zZmVyYWJsZXMgPVxyXG4gICAgICAgICAgICBvcHRpb25zLnBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBsb2NhbENhbGxJZCA9ICsrY2FsbElkO1xyXG4gICAgICAgIHZhciBwcm9taXNlT25NYXN0ZXJTaWRlID0gbnVsbDtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmV0dXJuUHJvbWlzZSkge1xyXG4gICAgICAgICAgICBwcm9taXNlT25NYXN0ZXJTaWRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24gcHJvbWlzZUZ1bmMocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2xvY2FsQ2FsbElkXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlOiByZXNvbHZlLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdDogcmVqZWN0XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHNlbmRNZXNzYWdlRnVuY3Rpb24gPSBvcHRpb25zLmlzU2VuZEltbWVkaWF0ZWx5ID9cclxuICAgICAgICAgICAgc2VuZE1lc3NhZ2VUb1NsYXZlOiBlbnF1ZXVlTWVzc2FnZVRvU2xhdmU7XHJcblx0XHRcclxuXHRcdHZhciB0cmFuc2ZlcmFibGVzO1xyXG5cdFx0aWYgKHR5cGVvZiB0cmFuc2ZlcmFibGVzQXJnID09PSAnZnVuY3Rpb24nKSB7XHJcblx0XHRcdHRyYW5zZmVyYWJsZXMgPSB0cmFuc2ZlcmFibGVzQXJnKCk7XHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHR0cmFuc2ZlcmFibGVzID0gQXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdFx0dHJhbnNmZXJhYmxlc0FyZywgYXJncyk7XHJcblx0XHR9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VuZE1lc3NhZ2VGdW5jdGlvbih0aGlzLCB0cmFuc2ZlcmFibGVzLCAvKmlzRnVuY3Rpb25DYWxsPSovdHJ1ZSwge1xyXG4gICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogZnVuY3Rpb25Ub0NhbGwsXHJcbiAgICAgICAgICAgIGFyZ3M6IGFyZ3MgfHwgW10sXHJcbiAgICAgICAgICAgIGNhbGxJZDogbG9jYWxDYWxsSWQsXHJcbiAgICAgICAgICAgIGlzUHJvbWlzZTogaXNSZXR1cm5Qcm9taXNlLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdCA6IHBhdGhzVG9UcmFuc2ZlcmFibGVzXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmV0dXJuUHJvbWlzZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gcHJvbWlzZU9uTWFzdGVyU2lkZTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS53cmFwQ2FsbGJhY2sgPSBmdW5jdGlvbiB3cmFwQ2FsbGJhY2soXHJcbiAgICAgICAgY2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgb3B0aW9ucykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgIHZhciBsb2NhbENhbGxJZCA9ICsrY2FsbElkO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBjYWxsYmFja0hhbmRsZSA9IHtcclxuICAgICAgICAgICAgaXNXb3JrZXJIZWxwZXJDYWxsYmFjazogdHJ1ZSxcclxuICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogISFvcHRpb25zLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIGNhbGxJZDogbG9jYWxDYWxsSWQsXHJcbiAgICAgICAgICAgIGNhbGxiYWNrTmFtZTogY2FsbGJhY2tOYW1lLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGludGVybmFsQ2FsbGJhY2tIYW5kbGUgPSB7XHJcbiAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6ICEhb3B0aW9ucy5pc011bHRpcGxlVGltZUNhbGxiYWNrLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBjYWxsYmFjazogY2FsbGJhY2ssXHJcbiAgICAgICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzOiBvcHRpb25zLnBhdGhzVG9UcmFuc2ZlcmFibGVzXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9jYWxsYmFja3NbbG9jYWxDYWxsSWRdID0gaW50ZXJuYWxDYWxsYmFja0hhbmRsZTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gY2FsbGJhY2tIYW5kbGU7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5mcmVlQ2FsbGJhY2sgPSBmdW5jdGlvbiBmcmVlQ2FsbGJhY2soY2FsbGJhY2tIYW5kbGUpIHtcclxuICAgICAgICBkZWxldGUgdGhpcy5fY2FsbGJhY2tzW2NhbGxiYWNrSGFuZGxlLmNhbGxJZF07XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLyBTdGF0aWMgZnVuY3Rpb25zXHJcbiAgICBcclxuICAgIEFzeW5jUHJveHlNYXN0ZXIuZ2V0RW50cnlVcmwgPSBmdW5jdGlvbiBnZXRFbnRyeVVybCgpIHtcclxuICAgICAgICBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICByZXR1cm4gbWFzdGVyRW50cnlVcmw7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLl9zZXRFbnRyeVVybCA9IGZ1bmN0aW9uIHNldEVudHJ5VXJsKG5ld1VybCkge1xyXG4gICAgICAgIGlmIChtYXN0ZXJFbnRyeVVybCAhPT0gbmV3VXJsICYmIGlzR2V0TWFzdGVyRW50cnlVcmxDYWxsZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1ByZXZpb3VzIHZhbHVlcyByZXR1cm5lZCBmcm9tIGdldE1hc3RlckVudHJ5VXJsICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lzIHdyb25nLiBBdm9pZCBjYWxsaW5nIGl0IHdpdGhpbiB0aGUgc2xhdmUgY2B0b3InO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbWFzdGVyRW50cnlVcmwgPSBuZXdVcmw7XHJcbiAgICB9O1xyXG5cdFxyXG5cdEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzID0gZnVuY3Rpb24gZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdHBhdGhzVG9UcmFuc2ZlcmFibGVzLCBwYXRoc0Jhc2UpIHtcclxuXHRcdFxyXG4gICAgICAgIGlmIChwYXRoc1RvVHJhbnNmZXJhYmxlcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID0gbmV3IEFycmF5KHBhdGhzVG9UcmFuc2ZlcmFibGVzLmxlbmd0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoc1RvVHJhbnNmZXJhYmxlcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICB2YXIgcGF0aCA9IHBhdGhzVG9UcmFuc2ZlcmFibGVzW2ldO1xyXG4gICAgICAgICAgICB2YXIgdHJhbnNmZXJhYmxlID0gcGF0aHNCYXNlO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBwYXRoLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbWVtYmVyID0gcGF0aFtqXTtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZSA9IHRyYW5zZmVyYWJsZVttZW1iZXJdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0cmFuc2ZlcmFibGVzW2ldID0gdHJhbnNmZXJhYmxlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdHJhbnNmZXJhYmxlcztcclxuICAgIH07XHJcbiAgICBcclxuICAgIC8vIFByaXZhdGUgZnVuY3Rpb25zXHJcblx0XHJcblx0ZnVuY3Rpb24gZ2V0U2NyaXB0TmFtZSgpIHtcclxuICAgICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoKTtcclxuXHRcdHJldHVybiBTY3JpcHRzVG9JbXBvcnRQb29sLl9nZXRTY3JpcHROYW1lKGVycm9yKTtcclxuXHR9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG1haW5TbGF2ZVNjcmlwdENvbnRlbnQoKSB7XHJcblx0XHQvLyBUaGlzIGZ1bmN0aW9uIGlzIG5vdCBydW4gZGlyZWN0bHk6IEl0IGNvcGllZCBhcyBhIHN0cmluZyBpbnRvIGEgYmxvYlxyXG5cdFx0Ly8gYW5kIHJ1biBpbiB0aGUgV2ViIFdvcmtlciBnbG9iYWwgc2NvcGVcclxuXHRcdFxyXG5cdFx0LyogZ2xvYmFsIGltcG9ydFNjcmlwdHM6IGZhbHNlICovXHJcbiAgICAgICAgaW1wb3J0U2NyaXB0cygnU0NSSVBUX1BMQUNFSE9MREVSJyk7XHJcblx0XHQvKiBnbG9iYWwgYXN5bmNQcm94eTogZmFsc2UgKi9cclxuICAgICAgICBhc3luY1Byb3h5LkFzeW5jUHJveHlTbGF2ZS5faW5pdGlhbGl6ZVNsYXZlKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCkge1xyXG4gICAgICAgIHZhciBjYWxsSWQgPSB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZDtcclxuICAgICAgICBcclxuICAgICAgICBzd2l0Y2ggKHdvcmtlckV2ZW50LmRhdGEudHlwZSkge1xyXG4gICAgICAgICAgICBjYXNlICdmdW5jdGlvbkNhbGxlZCc6XHJcbiAgICAgICAgICAgICAgICAtLXRoYXQuX25vdFJldHVybmVkRnVuY3Rpb25zO1xyXG4gICAgICAgICAgICAgICAgdHJ5U2VuZFBlbmRpbmdNZXNzYWdlcyh0aGF0KTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAncHJvbWlzZVJlc3VsdCc6XHJcbiAgICAgICAgICAgICAgICB2YXIgcHJvbWlzZVRvUmVzb2x2ZSA9IHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHNbY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSB3b3JrZXJFdmVudC5kYXRhLnJlc3VsdDtcclxuICAgICAgICAgICAgICAgIHByb21pc2VUb1Jlc29sdmUucmVzb2x2ZShyZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3Byb21pc2VGYWlsdXJlJzpcclxuICAgICAgICAgICAgICAgIHZhciBwcm9taXNlVG9SZWplY3QgPSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgcmVhc29uID0gd29ya2VyRXZlbnQuZGF0YS5yZWFzb247XHJcbiAgICAgICAgICAgICAgICBwcm9taXNlVG9SZWplY3QucmVqZWN0KHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAndXNlckRhdGEnOlxyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX3VzZXJEYXRhSGFuZGxlciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoYXQuX3VzZXJEYXRhSGFuZGxlcih3b3JrZXJFdmVudC5kYXRhLnVzZXJEYXRhKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdjYWxsYmFjayc6XHJcbiAgICAgICAgICAgICAgICB2YXIgY2FsbGJhY2tIYW5kbGUgPSB0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBtZXNzYWdlIGZyb20gU2xhdmVXb3JrZXIgb2YgY2FsbGJhY2sgSUQ6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZCArICcuIE1heWJlIHNob3VsZCBpbmRpY2F0ZSAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ2lzTXVsdGlwbGVUaW1lc0NhbGxiYWNrID0gdHJ1ZSBvbiBjcmVhdGlvbj8nO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIWNhbGxiYWNrSGFuZGxlLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LmZyZWVDYWxsYmFjayh0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlLmNhbGxiYWNrICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tIYW5kbGUuY2FsbGJhY2suYXBwbHkobnVsbCwgd29ya2VyRXZlbnQuZGF0YS5hcmdzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJDdG9yJzpcclxuICAgICAgICAgICAgICAgIHZhciBzdWJXb3JrZXJDcmVhdGVkID0gbmV3IFdvcmtlcih3b3JrZXJFdmVudC5kYXRhLnNjcmlwdFVybCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgaWQgPSB3b3JrZXJFdmVudC5kYXRhLnN1YldvcmtlcklkO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJCeUlkW2lkXSA9IHN1YldvcmtlckNyZWF0ZWQ7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzLnB1c2goc3ViV29ya2VyQ3JlYXRlZCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1YldvcmtlckNyZWF0ZWQub25tZXNzYWdlID0gZnVuY3Rpb24gb25TdWJXb3JrZXJNZXNzYWdlKHN1YldvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZW5xdWV1ZU1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGF0LCBzdWJXb3JrZXJFdmVudC5wb3J0cywgLyppc0Z1bmN0aW9uQ2FsbD0qL2ZhbHNlLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ3N1Yldvcmtlck9uTWVzc2FnZScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJXb3JrZXJJZDogaWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiBzdWJXb3JrZXJFdmVudC5kYXRhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJQb3N0TWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9Qb3N0TWVzc2FnZSA9IHRoYXQuX3N1YldvcmtlckJ5SWRbd29ya2VyRXZlbnQuZGF0YS5zdWJXb3JrZXJJZF07XHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXJUb1Bvc3RNZXNzYWdlLnBvc3RNZXNzYWdlKHdvcmtlckV2ZW50LmRhdGEuZGF0YSk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1YldvcmtlclRlcm1pbmF0ZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9UZXJtaW5hdGUgPSB0aGF0Ll9zdWJXb3JrZXJCeUlkW3dvcmtlckV2ZW50LmRhdGEuc3ViV29ya2VySWRdO1xyXG4gICAgICAgICAgICAgICAgc3ViV29ya2VyVG9UZXJtaW5hdGUudGVybWluYXRlKCk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnVW5rbm93biBtZXNzYWdlIGZyb20gQXN5bmNQcm94eVNsYXZlIG9mIHR5cGU6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckV2ZW50LmRhdGEudHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVucXVldWVNZXNzYWdlVG9TbGF2ZShcclxuICAgICAgICB0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA+PSB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplKSB7XHJcbiAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXM6IHRyYW5zZmVyYWJsZXMsXHJcbiAgICAgICAgICAgICAgICBpc0Z1bmN0aW9uQ2FsbDogaXNGdW5jdGlvbkNhbGwsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBtZXNzYWdlXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbmRNZXNzYWdlVG9TbGF2ZSh0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgICAgICAgXHJcbiAgICBmdW5jdGlvbiBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgdGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNGdW5jdGlvbkNhbGwpIHtcclxuICAgICAgICAgICAgKyt0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fd29ya2VyLnBvc3RNZXNzYWdlKG1lc3NhZ2UsIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0cnlTZW5kUGVuZGluZ01lc3NhZ2VzKHRoYXQpIHtcclxuICAgICAgICB3aGlsZSAodGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPCB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplICYmXHJcbiAgICAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgbWVzc2FnZSA9IHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5zaGlmdCgpO1xyXG4gICAgICAgICAgICBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgICAgICAgICB0aGF0LFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS50cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS5pc0Z1bmN0aW9uQ2FsbCxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCkge1xyXG4gICAgICAgIHZhciBiYXNlVXJsID0gbG9jYXRpb24uaHJlZjtcclxuICAgICAgICB2YXIgZW5kT2ZQYXRoID0gYmFzZVVybC5sYXN0SW5kZXhPZignLycpO1xyXG4gICAgICAgIGlmIChlbmRPZlBhdGggPj0gMCkge1xyXG4gICAgICAgICAgICBiYXNlVXJsID0gYmFzZVVybC5zdWJzdHJpbmcoMCwgZW5kT2ZQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGJhc2VVcmw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBBc3luY1Byb3h5TWFzdGVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5TWFzdGVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XHJcbnZhciBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgPSByZXF1aXJlKCdzdWItd29ya2VyLWVtdWxhdGlvbi1mb3ItY2hyb21lJyk7XHJcblxyXG52YXIgQXN5bmNQcm94eVNsYXZlID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlTbGF2ZUNsb3N1cmUoKSB7XHJcbiAgICB2YXIgc2xhdmVIZWxwZXJTaW5nbGV0b24gPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID0gbnVsbDtcclxuICAgIHZhciBzbGF2ZVNpZGVNYWluSW5zdGFuY2U7XHJcbiAgICB2YXIgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gZGVmYXVsdEluc3RhbmNlQ3JlYXRvcjtcclxuICAgIHZhciBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0ge307XHJcbiAgICB2YXIgY3Rvck5hbWU7XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLl9pbml0aWFsaXplU2xhdmUgPSBmdW5jdGlvbiBpbml0aWFsaXplU2xhdmUoKSB7XHJcbiAgICAgICAgc2VsZi5vbm1lc3NhZ2UgPSBvbk1lc3NhZ2U7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZXRTbGF2ZVNpZGVDcmVhdG9yID0gZnVuY3Rpb24gc2V0U2xhdmVTaWRlQ3JlYXRvcihjcmVhdG9yKSB7XHJcbiAgICAgICAgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gY3JlYXRvcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLnNldEJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID1cclxuICAgICAgICBmdW5jdGlvbiBzZXRCZWZvcmVPcGVyYXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgICAgICAgICBiZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9IGxpc3RlbmVyO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZW5kVXNlckRhdGFUb01hc3RlciA9IGZ1bmN0aW9uIHNlbmRVc2VyRGF0YVRvTWFzdGVyKFxyXG4gICAgICAgIHVzZXJEYXRhKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICd1c2VyRGF0YScsXHJcbiAgICAgICAgICAgIHVzZXJEYXRhOiB1c2VyRGF0YVxyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24ud3JhcFByb21pc2VGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwUHJvbWlzZUZyb21TbGF2ZVNpZGUoXHJcbiAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXMpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgcHJvbWlzZVRoZW4gPSBwcm9taXNlLnRoZW4oZnVuY3Rpb24gc2VuZFByb21pc2VUb01hc3RlcihyZXN1bHQpIHtcclxuICAgICAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXMgPVxyXG5cdFx0XHRcdEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG5cdFx0XHRcdFx0cGF0aHNUb1RyYW5zZmVyYWJsZXMsIHJlc3VsdCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwcm9taXNlUmVzdWx0JyxcclxuICAgICAgICAgICAgICAgICAgICBjYWxsSWQ6IGNhbGxJZCxcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHByb21pc2VUaGVuWydjYXRjaCddKGZ1bmN0aW9uIHNlbmRGYWlsdXJlVG9NYXN0ZXIocmVhc29uKSB7XHJcbiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgICAgdHlwZTogJ3Byb21pc2VGYWlsdXJlJyxcclxuICAgICAgICAgICAgICAgIGNhbGxJZDogY2FsbElkLFxyXG4gICAgICAgICAgICAgICAgcmVhc29uOiByZWFzb25cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlKGNhbGxiYWNrSGFuZGxlKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHZhciBpc0FscmVhZHlDYWxsZWQgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBjYWxsYmFja1dyYXBwZXJGcm9tU2xhdmVTaWRlKCkge1xyXG4gICAgICAgICAgICBpZiAoaXNBbHJlYWR5Q2FsbGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnQ2FsbGJhY2sgaXMgY2FsbGVkIHR3aWNlIGJ1dCBpc011bHRpcGxlVGltZUNhbGxiYWNrICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICc9IGZhbHNlJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGFyZ3VtZW50c0FzQXJyYXkgPSBnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgIT09IG51bGwpIHtcclxuXHRcdFx0XHR0cnkge1xyXG5cdFx0XHRcdFx0YmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIuY2FsbChcclxuXHRcdFx0XHRcdFx0c2xhdmVTaWRlTWFpbkluc3RhbmNlLFxyXG5cdFx0XHRcdFx0XHQnY2FsbGJhY2snLFxyXG5cdFx0XHRcdFx0XHRjYWxsYmFja0hhbmRsZS5jYWxsYmFja05hbWUsXHJcblx0XHRcdFx0XHRcdGFyZ3VtZW50c0FzQXJyYXkpO1xyXG5cdFx0XHRcdH0gY2F0Y2ggKGUpIHtcclxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKCdBc3luY1Byb3h5U2xhdmUuYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgaGFzIHRocm93biBhbiBleGNlcHRpb246ICcgKyBlKTtcclxuXHRcdFx0XHR9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID1cclxuXHRcdFx0XHRBc3luY1Byb3h5TWFzdGVyLl9leHRyYWN0VHJhbnNmZXJhYmxlcyhcclxuXHRcdFx0XHRcdGNhbGxiYWNrSGFuZGxlLnBhdGhzVG9UcmFuc2ZlcmFibGVzLCBhcmd1bWVudHNBc0FycmF5KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdjYWxsYmFjaycsXHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbElkOiBjYWxsYmFja0hhbmRsZS5jYWxsSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnczogYXJndW1lbnRzQXNBcnJheVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKCFjYWxsYmFja0hhbmRsZS5pc011bHRpcGxlVGltZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICBpc0FscmVhZHlDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBjYWxsYmFja1dyYXBwZXJGcm9tU2xhdmVTaWRlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gb25NZXNzYWdlKGV2ZW50KSB7XHJcbiAgICAgICAgdmFyIGZ1bmN0aW9uTmFtZVRvQ2FsbCA9IGV2ZW50LmRhdGEuZnVuY3Rpb25Ub0NhbGw7XHJcbiAgICAgICAgdmFyIGFyZ3MgPSBldmVudC5kYXRhLmFyZ3M7XHJcbiAgICAgICAgdmFyIGNhbGxJZCA9IGV2ZW50LmRhdGEuY2FsbElkO1xyXG4gICAgICAgIHZhciBpc1Byb21pc2UgPSBldmVudC5kYXRhLmlzUHJvbWlzZTtcclxuICAgICAgICB2YXIgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQgPVxyXG4gICAgICAgICAgICBldmVudC5kYXRhLnBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciByZXN1bHQgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN3aXRjaCAoZnVuY3Rpb25OYW1lVG9DYWxsKSB7XHJcbiAgICAgICAgICAgIGNhc2UgJ2N0b3InOlxyXG4gICAgICAgICAgICAgICAgQXN5bmNQcm94eU1hc3Rlci5fc2V0RW50cnlVcmwoZXZlbnQuZGF0YS5tYXN0ZXJFbnRyeVVybCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciBzY3JpcHRzVG9JbXBvcnQgPSBldmVudC5kYXRhLnNjcmlwdHNUb0ltcG9ydDtcclxuICAgICAgICAgICAgICAgIGN0b3JOYW1lID0gZXZlbnQuZGF0YS5jdG9yTmFtZTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzY3JpcHRzVG9JbXBvcnQubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHRcdC8qIGdsb2JhbCBpbXBvcnRTY3JpcHRzOiBmYWxzZSAqL1xyXG4gICAgICAgICAgICAgICAgICAgIGltcG9ydFNjcmlwdHMoc2NyaXB0c1RvSW1wb3J0W2ldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgc2xhdmVTaWRlTWFpbkluc3RhbmNlID0gc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yLmFwcGx5KG51bGwsIGFyZ3MpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1Yldvcmtlck9uTWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyID0gc3ViV29ya2VySWRUb1N1YldvcmtlcltldmVudC5kYXRhLnN1YldvcmtlcklkXTtcclxuICAgICAgICAgICAgICAgIHZhciB3b3JrZXJFdmVudCA9IHsgZGF0YTogZXZlbnQuZGF0YS5kYXRhIH07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1Yldvcmtlci5vbm1lc3NhZ2Uod29ya2VyRXZlbnQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGFyZ3MgPSBuZXcgQXJyYXkoZXZlbnQuZGF0YS5hcmdzLmxlbmd0aCk7XHJcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBldmVudC5kYXRhLmFyZ3MubGVuZ3RoOyArK2opIHtcclxuICAgICAgICAgICAgdmFyIGFyZyA9IGV2ZW50LmRhdGEuYXJnc1tqXTtcclxuICAgICAgICAgICAgaWYgKGFyZyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgICAgICAgICBhcmcgIT09IG51bGwgJiZcclxuICAgICAgICAgICAgICAgIGFyZy5pc1dvcmtlckhlbHBlckNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGFyZyA9IHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBDYWxsYmFja0Zyb21TbGF2ZVNpZGUoYXJnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXJnc1tqXSA9IGFyZztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGZ1bmN0aW9uQ29udGFpbmVyID0gc2xhdmVTaWRlTWFpbkluc3RhbmNlO1xyXG4gICAgICAgIHZhciBmdW5jdGlvblRvQ2FsbDtcclxuICAgICAgICB3aGlsZSAoZnVuY3Rpb25Db250YWluZXIpIHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGwgPSBzbGF2ZVNpZGVNYWluSW5zdGFuY2VbZnVuY3Rpb25OYW1lVG9DYWxsXTtcclxuICAgICAgICAgICAgaWYgKGZ1bmN0aW9uVG9DYWxsKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG5cdFx0XHQvKiBqc2hpbnQgcHJvdG86IHRydWUgKi9cclxuICAgICAgICAgICAgZnVuY3Rpb25Db250YWluZXIgPSBmdW5jdGlvbkNvbnRhaW5lci5fX3Byb3RvX187XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghZnVuY3Rpb25Ub0NhbGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkgZXJyb3I6IGNvdWxkIG5vdCBmaW5kIGZ1bmN0aW9uICcgKyBmdW5jdGlvbk5hbWVUb0NhbGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBwcm9taXNlID0gZnVuY3Rpb25Ub0NhbGwuYXBwbHkoc2xhdmVTaWRlTWFpbkluc3RhbmNlLCBhcmdzKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNQcm9taXNlKSB7XHJcbiAgICAgICAgICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBQcm9taXNlRnJvbVNsYXZlU2lkZShcclxuICAgICAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdmdW5jdGlvbkNhbGxlZCcsXHJcbiAgICAgICAgICAgIGNhbGxJZDogZXZlbnQuZGF0YS5jYWxsSWQsXHJcbiAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGRlZmF1bHRJbnN0YW5jZUNyZWF0b3IoKSB7XHJcbiAgICAgICAgdmFyIGluc3RhbmNlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHZhciBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUgPSBjdG9yTmFtZS5zcGxpdCgnLicpO1xyXG4gICAgICAgICAgICB2YXIgbWVtYmVyID0gc2VsZjtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUubGVuZ3RoOyArK2kpXHJcbiAgICAgICAgICAgICAgICBtZW1iZXIgPSBtZW1iZXJbbmFtZXNwYWNlc0FuZEN0b3JOYW1lW2ldXTtcclxuICAgICAgICAgICAgdmFyIFR5cGVDdG9yID0gbWVtYmVyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGJpbmRBcmdzID0gW251bGxdLmNvbmNhdChnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cykpO1xyXG4gICAgICAgICAgICBpbnN0YW5jZSA9IG5ldyAoRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQuYXBwbHkoVHlwZUN0b3IsIGJpbmRBcmdzKSkoKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIGxvY2F0aW5nIGNsYXNzIG5hbWUgJyArIGN0b3JOYW1lICsgJzogJyArIGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGdldEFyZ3VtZW50c0FzQXJyYXkoYXJncykge1xyXG4gICAgICAgIHZhciBhcmd1bWVudHNBc0FycmF5ID0gbmV3IEFycmF5KGFyZ3MubGVuZ3RoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgYXJndW1lbnRzQXNBcnJheVtpXSA9IGFyZ3NbaV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBhcmd1bWVudHNBc0FycmF5O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5Xb3JrZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5pbml0aWFsaXplKHN1YldvcmtlcklkVG9TdWJXb3JrZXIpO1xyXG4gICAgICAgIHNlbGYuV29ya2VyID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gc2xhdmVIZWxwZXJTaW5nbGV0b247XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEFzeW5jUHJveHlTbGF2ZTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gcmVxdWlyZSgnanMtYnVpbHRpbi1oYXNoLW1hcCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dCA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dENsb3N1cmUoKSB7XHJcblx0ZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQoKSB7XHJcbiAgICAgICAgLy8gVGhpcyBjbGFzcyBpcyBub3QgZXhwb3NlZCBvdXRzaWRlIEFzeW5jUHJveHksIEkgYWxsb3dlZCBteXNlbGYgdG9cclxuICAgICAgICAvLyB1c2UgcHVibGljIG1lbWJlcnNcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmlzVGVybWluYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMucHJpb3JpdHkgPSAwO1xyXG4gICAgICAgIHRoaXMubGFzdFByb2Nlc3NlZERhdGEgPSBudWxsO1xyXG5cdFx0dGhpcy50YXNrQXBpID0gbnVsbDtcclxuICAgICAgICB0aGlzLmhhc1Byb2Nlc3NlZERhdGEgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLmlzUGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyID0gbnVsbDtcclxuICAgICAgICB0aGlzLnBlbmRpbmdXb3JrZXJUeXBlID0gMDtcclxuICAgICAgICBcclxuICAgICAgICAvL3RoaXMudGFza0NvbnRleHQgPSBudWxsO1xyXG4gICAgICAgIHRoaXMudGFza0hhbmRsZXMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0tleSA9IG51bGw7XHJcblx0XHR0aGlzLl9pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCA9IDA7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0ID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9wYXJlbnRJdGVyYXRvciA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzID0gbnVsbDtcclxuXHRcdFxyXG5cdFx0dGhpcy5fZGVwZW5kVGFza0tleXMgPSBbXTtcclxuXHRcdHRoaXMuX2RlcGVuZFRhc2tSZXN1bHRzID0gW107XHJcblx0XHR0aGlzLl9oYXNEZXBlbmRUYXNrRGF0YSA9IFtdO1xyXG5cdH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLmluaXRpYWxpemUgPSBmdW5jdGlvbihcclxuICAgICAgICAgICAgdGFza0tleSwgZGVwZW5kZW5jeVdvcmtlcnMsIGlucHV0UmV0cmVpdmVyLCBsaXN0LCBpdGVyYXRvciAvKiwgaGFzaGVyKi8pIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0tleSA9IHRhc2tLZXk7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMgPSBkZXBlbmRlbmN5V29ya2VycztcclxuICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudExpc3QgPSBsaXN0O1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gaXRlcmF0b3I7XHJcbiAgICAgICAgLy90aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMgPSBuZXcgSGFzaE1hcChoYXNoZXIpO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcyA9IG5ldyBKc0J1aWx0aW5IYXNoTWFwKCk7XHJcblx0XHR0aGlzLnRhc2tBcGkgPSBuZXcgRGVwZW5kZW5jeVdvcmtlcnNUYXNrKHRoaXMsIHRhc2tLZXkpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLmVuZGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50TGlzdC5yZW1vdmUodGhpcy5fcGFyZW50SXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gbnVsbDtcclxuXHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGhhbmRsZSA9IHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpLnRhc2tIYW5kbGU7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBoYW5kbGUudW5yZWdpc3RlcigpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMuY2xlYXIoKTtcclxuXHJcblx0XHR2YXIgdGhhdCA9IHRoaXM7XHJcblx0XHRzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpdGVyYXRvciA9IHRoYXQudGFza0hhbmRsZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG5cdFx0XHR3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuXHRcdFx0XHR2YXIgaGFuZGxlID0gdGhhdC50YXNrSGFuZGxlcy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG5cdFx0XHRcdGl0ZXJhdG9yID0gdGhhdC50YXNrSGFuZGxlcy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG5cclxuXHRcdFx0XHRpZiAoaGFuZGxlLl9jYWxsYmFja3Mub25UZXJtaW5hdGVkKSB7XHJcblx0XHRcdFx0XHRoYW5kbGUuX2NhbGxiYWNrcy5vblRlcm1pbmF0ZWQoKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHRoYXQudGFza0hhbmRsZXMuY2xlYXIoKTtcclxuXHRcdH0pO1xyXG4gICAgfTtcclxuXHRcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0LnByb3RvdHlwZS5zZXRQcmlvcml0eUFuZE5vdGlmeSA9IGZ1bmN0aW9uKFxyXG4gICAgICAgICAgICBuZXdQcmlvcml0eSkge1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMucHJpb3JpdHkgPT09IG5ld1ByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5wcmlvcml0eSA9IG5ld1ByaW9yaXR5O1xyXG4gICAgICAgIHRoaXMuc3RhdHVzVXBkYXRlKCk7XHJcblxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBoYW5kbGUgPSB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKS50YXNrSGFuZGxlO1xyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaGFuZGxlLnNldFByaW9yaXR5KG5ld1ByaW9yaXR5KTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUuc3RhdHVzVXBkYXRlID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdmFyIHN0YXR1cyA9IHtcclxuICAgICAgICAgICAgJ3ByaW9yaXR5JzogdGhpcy5wcmlvcml0eSxcclxuICAgICAgICAgICAgJ2hhc0xpc3RlbmVycyc6IHRoaXMudGFza0hhbmRsZXMuZ2V0Q291bnQoKSA+IDAsXHJcbiAgICAgICAgICAgICdpc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQnOiB0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQsXHJcbiAgICAgICAgICAgICd0ZXJtaW5hdGVkRGVwZW5kc1Rhc2tzJzogdGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50LFxyXG4gICAgICAgICAgICAnZGVwZW5kc1Rhc2tzJzogdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzLmdldENvdW50KClcclxuICAgICAgICB9O1xyXG4gICAgICAgIHRoaXMudGFza0FwaS5fb25FdmVudCgnc3RhdHVzVXBkYXRlZCcsIHN0YXR1cyk7XHJcblxyXG5cdFx0aWYgKHRoaXMuX2lzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nICYmICF0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuXHRcdFx0dGhpcy5faXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgPSBmYWxzZTtcclxuXHRcdFx0dGhpcy5lbmRlZCgpO1xyXG5cdFx0fVxyXG5cdH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0LnByb3RvdHlwZS5yZWNhbGN1bGF0ZVByaW9yaXR5ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdmFyIGhhbmRsZXMgPSB0aGlzLnRhc2tIYW5kbGVzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IGhhbmRsZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHZhciBpc0ZpcnN0ID0gdHJ1ZTtcclxuICAgICAgICB2YXIgbmV3UHJpb3JpdHkgPSAwO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgaGFuZGxlID0gaGFuZGxlcy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBpZiAoaXNGaXJzdCB8fCBoYW5kbGUuX2xvY2FsUHJpb3JpdHkgPiBuZXdQcmlvcml0eSkge1xyXG4gICAgICAgICAgICAgICAgbmV3UHJpb3JpdHkgPSBoYW5kbGUuX2xvY2FsUHJpb3JpdHk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaXRlcmF0b3IgPSBoYW5kbGVzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gbmV3UHJpb3JpdHk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUubmV3RGF0YSA9IGZ1bmN0aW9uKGRhdGEpIHtcclxuICAgICAgICB0aGlzLmhhc1Byb2Nlc3NlZERhdGEgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMubGFzdFByb2Nlc3NlZERhdGEgPSBkYXRhO1xyXG5cdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIFxyXG5cdFx0c2V0VGltZW91dChmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGhhbmRsZXMgPSB0aGF0LnRhc2tIYW5kbGVzO1xyXG5cdFx0XHR2YXIgaXRlcmF0b3IgPSBoYW5kbGVzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuXHRcdFx0d2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcblx0XHRcdFx0dmFyIGhhbmRsZSA9IGhhbmRsZXMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHRcdFx0XHRpdGVyYXRvciA9IGhhbmRsZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHRoYW5kbGUuX2NhbGxiYWNrcy5vbkRhdGEoZGF0YSwgdGhhdC50YXNrS2V5KTtcclxuXHRcdFx0fVxyXG5cdFx0fSk7XHJcbiAgICB9O1xyXG4gICAgXHJcblx0RGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLmRhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKSB7XHJcblx0XHRpZiAodGhpcy5pc1Rlcm1pbmF0ZWQpIHtcclxuXHRcdFx0dGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IGFscmVhZHkgdGVybWluYXRlZCc7XHJcblx0XHR9IGVsc2UgaWYgKHRoaXMud2FpdGlnRm9yV29ya2VyUmVzdWx0KSB7XHJcblx0XHRcdC8vIFVzZWQgaW4gRGVwZW5kZW5jeVdvcmtlcnMuX3N0YXJ0V29ya2VyKCkgd2hlbiBwcmV2aW91cyB3b3JrZXIgaGFzIGZpbmlzaGVkXHJcblx0XHRcdHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBuZXdEYXRhVG9Qcm9jZXNzO1xyXG5cdFx0XHR0aGlzLmlzUGVuZGluZ0RhdGFGb3JXb3JrZXIgPSB0cnVlO1xyXG5cdFx0XHR0aGlzLnBlbmRpbmdXb3JrZXJUeXBlID0gd29ya2VyVHlwZTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzLl9kYXRhUmVhZHkoXHJcblx0XHRcdFx0dGhpcywgbmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSk7XHJcblx0XHR9XHJcblx0fTtcclxuXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogYWxyZWFkeSB0ZXJtaW5hdGVkJztcclxuICAgICAgICB9XHJcblx0XHRcclxuICAgICAgICB0aGlzLmlzVGVybWluYXRlZCA9IHRydWU7XHJcblx0XHRpZiAodGhpcy53YWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG5cdFx0XHR0aGlzLmVuZGVkKCk7XHJcblx0XHR9XHJcbiAgICB9O1xyXG5cdFxyXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUsICdkZXBlbmRUYXNrS2V5cycsIHtcclxuXHRcdGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza0tleXMoKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLl9kZXBlbmRUYXNrS2V5cztcclxuXHRcdH1cclxuXHR9KTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLCAnZGVwZW5kVGFza1Jlc3VsdHMnLCB7XHJcblx0XHRnZXQ6IGZ1bmN0aW9uIGdldERlcGVuZFRhc2tSZXN1bHRzKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5fZGVwZW5kVGFza1Jlc3VsdHM7XHJcblx0XHR9XHJcblx0fSk7XHJcblx0XHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSA9IGZ1bmN0aW9uKFxyXG4gICAgICAgICAgICB0YXNrS2V5KSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHN0cktleSA9IHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKHRhc2tLZXkpO1xyXG4gICAgICAgIHZhciBhZGRSZXN1bHQgPSB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMudHJ5QWRkKHN0cktleSwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHRhc2tIYW5kbGU6IG51bGwgfTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogQ2Fubm90IGFkZCB0YXNrIGRlcGVuZGVuY3kgdHdpY2UnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdmFyIGdvdERhdGEgPSBmYWxzZTtcclxuICAgICAgICB2YXIgaXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcblx0XHR2YXIgaW5kZXggPSB0aGlzLl9kZXBlbmRUYXNrS2V5cy5sZW5ndGg7XHJcblx0XHRcclxuXHRcdHRoaXMuX2RlcGVuZFRhc2tLZXlzW2luZGV4XSA9IHRhc2tLZXk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWRkUmVzdWx0LnZhbHVlLnRhc2tIYW5kbGUgPSB0aGlzLl9wYXJlbnREZXBlbmRlbmN5V29ya2Vycy5zdGFydFRhc2soXHJcbiAgICAgICAgICAgIHRhc2tLZXksIHtcclxuICAgICAgICAgICAgICAgICdvbkRhdGEnOiBvbkRlcGVuZGVuY3lUYXNrRGF0YSxcclxuICAgICAgICAgICAgICAgICdvblRlcm1pbmF0ZWQnOiBvbkRlcGVuZGVuY3lUYXNrVGVybWluYXRlZFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgICBcclxuXHRcdGlmICghZ290RGF0YSAmJiBhZGRSZXN1bHQudmFsdWUudGFza0hhbmRsZS5oYXNEYXRhKCkpIHtcclxuXHRcdFx0c2V0VGltZW91dChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIG9uRGVwZW5kZW5jeVRhc2tEYXRhKGFkZFJlc3VsdC52YWx1ZS50YXNrSGFuZGxlLmdldExhc3REYXRhKCkpO1xyXG5cdFx0XHR9KTtcclxuXHRcdH1cclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbkRlcGVuZGVuY3lUYXNrRGF0YShkYXRhKSB7XHJcblx0XHRcdHRoYXQuX2RlcGVuZFRhc2tSZXN1bHRzW2luZGV4XSA9IGRhdGE7XHJcblx0XHRcdHRoYXQuX2hhc0RlcGVuZFRhc2tEYXRhW2luZGV4XSA9IHRydWU7XHJcblx0XHRcdHRoYXQudGFza0FwaS5fb25FdmVudCgnZGVwZW5kZW5jeVRhc2tEYXRhJywgZGF0YSwgdGFza0tleSk7XHJcbiAgICAgICAgICAgIGdvdERhdGEgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbkRlcGVuZGVuY3lUYXNrVGVybWluYXRlZCgpIHtcclxuICAgICAgICAgICAgaWYgKGlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IERvdWJsZSB0ZXJtaW5hdGlvbic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhhdC5fZGVwZW5kc1Rhc2tUZXJtaW5hdGVkKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLl9kZXBlbmRzVGFza1Rlcm1pbmF0ZWQgPSBmdW5jdGlvbiBkZXBlbmRzVGFza1Rlcm1pbmF0ZWQoKSB7XHJcbiAgICAgICAgKyt0aGlzLl9kZXBlbmRzVGFza3NUZXJtaW5hdGVkQ291bnQ7XHJcblx0XHRpZiAodGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50ID09PSB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMuZ2V0Q291bnQoKSkge1xyXG5cdFx0XHR0aGlzLnRhc2tBcGkuX29uRXZlbnQoJ2FsbERlcGVuZFRhc2tzVGVybWluYXRlZCcpO1xyXG5cdFx0fVxyXG4gICAgICAgIHRoaXMuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICB9O1xyXG5cdFxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0O1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZUNsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tIYW5kbGUoaW50ZXJuYWxDb250ZXh0LCBjYWxsYmFja3MpIHtcclxuICAgICAgICB0aGlzLl9pbnRlcm5hbENvbnRleHQgPSBpbnRlcm5hbENvbnRleHQ7XHJcbiAgICAgICAgdGhpcy5fbG9jYWxQcmlvcml0eSA9IDA7XHJcbiAgICAgICAgdGhpcy5fY2FsbGJhY2tzID0gY2FsbGJhY2tzO1xyXG4gICAgICAgIHRoaXMuX3Rhc2tIYW5kbGVzSXRlcmF0b3IgPSBpbnRlcm5hbENvbnRleHQudGFza0hhbmRsZXMuYWRkKHRoaXMpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tIYW5kbGUucHJvdG90eXBlLmhhc0RhdGEgPSBmdW5jdGlvbiBoYXNEYXRhKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnRlcm5hbENvbnRleHQuaGFzUHJvY2Vzc2VkRGF0YTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZS5wcm90b3R5cGUuZ2V0TGFzdERhdGEgPSBmdW5jdGlvbiBnZXRMYXN0RGF0YSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxDb250ZXh0Lmxhc3RQcm9jZXNzZWREYXRhO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlLnByb3RvdHlwZS5zZXRQcmlvcml0eSA9IGZ1bmN0aW9uKHByaW9yaXR5KSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl90YXNrSGFuZGxlc0l0ZXJhdG9yKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBBbHJlYWR5IHVucmVnaXN0ZXJlZCc7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgbmV3UHJpb3JpdHk7XHJcbiAgICAgICAgaWYgKHByaW9yaXR5ID4gdGhpcy5faW50ZXJuYWxDb250ZXh0LnByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIG5ld1ByaW9yaXR5ID0gcHJpb3JpdHk7XHJcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9sb2NhbFByaW9yaXR5IDwgdGhpcy5faW50ZXJuYWxDb250ZXh0LnByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIG5ld1ByaW9yaXR5ID0gdGhpcy5faW50ZXJuYWxDb250ZXh0LnByaW9yaXR5O1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG5ld1ByaW9yaXR5ID0gdGhpcy5faW50ZXJuYWxDb250ZXh0LnJlY2FsY3VsYXRlUHJpb3JpdHkoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faW50ZXJuYWxDb250ZXh0LnNldFByaW9yaXR5QW5kTm90aWZ5KG5ld1ByaW9yaXR5KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZS5wcm90b3R5cGUudW5yZWdpc3RlciA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGlmICghdGhpcy5fdGFza0hhbmRsZXNJdGVyYXRvcikge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogQWxyZWFkeSB1bnJlZ2lzdGVyZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9pbnRlcm5hbENvbnRleHQudGFza0hhbmRsZXMucmVtb3ZlKHRoaXMuX3Rhc2tIYW5kbGVzSXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3Rhc2tIYW5kbGVzSXRlcmF0b3IgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9pbnRlcm5hbENvbnRleHQudGFza0hhbmRsZXMuZ2V0Q291bnQoKSA9PT0gMCkge1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX2ludGVybmFsQ29udGV4dC5pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgICAgIC8vIFNob3VsZCBiZSBjYWxsZWQgZnJvbSBzdGF0dXNVcGRhdGUgd2hlbiB3b3JrZXIgc2h1dCBkb3duXHJcblx0XHRcdFx0Ly90aGlzLl9pbnRlcm5hbENvbnRleHQuZW5kZWQoKTtcclxuXHRcdFx0XHRcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ludGVybmFsQ29udGV4dC5zdGF0dXNVcGRhdGUoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5fbG9jYWxQcmlvcml0eSA9PT0gdGhpcy5faW50ZXJuYWxDb250ZXh0LnByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIHZhciBuZXdQcmlvcml0eSA9IHRoaXMuX2ludGVybmFsQ29udGV4dC5yZWNhbGN1bGF0ZVByaW9yaXR5KCk7XHJcbiAgICAgICAgICAgIHRoaXMuX2ludGVybmFsQ29udGV4dC5zZXRQcmlvcml0eUFuZE5vdGlmeShuZXdQcmlvcml0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tIYW5kbGU7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFzayA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDbG9zdXJlKCkge1xyXG5cdGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFzayh3cmFwcGVkLCBrZXksIHJlZ2lzdGVyV3JhcHBlZEV2ZW50cykge1xyXG5cdFx0dGhpcy5fd3JhcHBlZCA9IHdyYXBwZWQ7XHJcblx0XHR0aGlzLl9rZXkgPSBrZXk7XHJcblx0XHR0aGlzLl9ldmVudExpc3RlbmVycyA9IHtcclxuXHRcdFx0J2RlcGVuZGVuY3lUYXNrRGF0YSc6IFtdLFxyXG5cdFx0XHQnc3RhdHVzVXBkYXRlZCc6IFtdLFxyXG5cdFx0XHQnYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJzogW11cclxuXHRcdH07XHJcblx0XHRcclxuXHRcdGlmIChyZWdpc3RlcldyYXBwZWRFdmVudHMpIHtcclxuXHRcdFx0Zm9yICh2YXIgZXZlbnQgaW4gdGhpcy5fZXZlbnRMaXN0ZW5lcnMpIHtcclxuXHRcdFx0XHR0aGlzLl9yZWdpc3RlcldyYXBwZWRFdmVudChldmVudCk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkobmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSkge1xyXG5cdFx0dGhpcy5fd3JhcHBlZC5kYXRhUmVhZHkobmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSk7XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZSgpIHtcclxuXHRcdHRoaXMuX3dyYXBwZWQudGVybWluYXRlKCk7XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnJlZ2lzdGVyVGFza0RlcGVuZGVuY3kgPSBmdW5jdGlvbiByZWdpc3RlclRhc2tEZXBlbmRlbmN5KHRhc2tLZXkpIHtcclxuXHRcdHJldHVybiB0aGlzLl93cmFwcGVkLnJlZ2lzdGVyVGFza0RlcGVuZGVuY3kodGFza0tleSk7XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcblx0XHRpZiAoIXRoaXMuX2V2ZW50TGlzdGVuZXJzW2V2ZW50XSkge1xyXG5cdFx0XHR0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogVGFzayBoYXMgbm8gZXZlbnQgJyArIGV2ZW50O1xyXG5cdFx0fVxyXG5cdFx0dGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdLnB1c2gobGlzdGVuZXIpO1xyXG5cdH07XHJcblx0XHJcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdrZXknLCB7XHJcblx0XHRnZXQ6IGZ1bmN0aW9uIGdldEtleSgpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX2tleTtcclxuXHRcdH1cclxuXHR9KTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tLZXlzJywge1xyXG5cdFx0Z2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza0tleXM7XHJcblx0XHR9XHJcblx0fSk7XHJcblx0XHJcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdkZXBlbmRUYXNrUmVzdWx0cycsIHtcclxuXHRcdGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza1Jlc3VsdHMoKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLl93cmFwcGVkLmRlcGVuZFRhc2tSZXN1bHRzO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcblx0XHRpZiAoZXZlbnQgPT0gJ3N0YXR1c1VwZGF0ZWQnKSB7XHJcblx0XHRcdGFyZzEgPSB0aGlzLl9tb2RpZnlTdGF0dXMoYXJnMSk7XHJcblx0XHR9XHJcblx0XHR2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdO1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0bGlzdGVuZXJzW2ldLmNhbGwodGhpcywgYXJnMSwgYXJnMik7XHJcblx0XHR9XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLl9tb2RpZnlTdGF0dXMgPSBmdW5jdGlvbiBtb2RpZnlTdGF0dXMoc3RhdHVzKSB7XHJcblx0XHRyZXR1cm4gc3RhdHVzO1xyXG5cdH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5fcmVnaXN0ZXJXcmFwcGVkRXZlbnQgPSBmdW5jdGlvbiByZWdpc3RlcldyYXBwZWRFdmVudChldmVudCkge1xyXG5cdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG5cdFx0dGhpcy5fd3JhcHBlZC5vbihldmVudCwgZnVuY3Rpb24oYXJnMSwgYXJnMikge1xyXG5cdFx0XHR0aGF0Ll9vbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKTtcclxuXHRcdH0pO1xyXG5cdH07XHJcblxyXG5cdHJldHVybiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2s7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFzazsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgSnNCdWlsdGluSGFzaE1hcCA9IHJlcXVpcmUoJ2pzLWJ1aWx0aW4taGFzaC1tYXAnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0ID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLWludGVybmFsLWNvbnRleHQnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZSA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWhhbmRsZScpO1xyXG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzKHdvcmtlcklucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3dvcmtlcklucHV0UmV0cmVpdmVyID0gd29ya2VySW5wdXRSZXRyZWl2ZXI7XHJcbiAgICAgICAgdGhhdC5faW50ZXJuYWxDb250ZXh0cyA9IG5ldyBKc0J1aWx0aW5IYXNoTWFwKCk7XHJcbiAgICAgICAgdGhhdC5fd29ya2VyUG9vbEJ5VGFza1R5cGUgPSBbXTtcclxuICAgICAgICB0aGF0Ll90YXNrT3B0aW9uc0J5VGFza1R5cGUgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXdvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICd3b3JrZXJJbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ3dvcmtlcklucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5zdGFydFRhc2sgPSBmdW5jdGlvbiBzdGFydFRhc2soXHJcbiAgICAgICAgdGFza0tleSwgY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGRlcGVuZGVuY3lXb3JrZXJzID0gdGhpcztcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc3RyS2V5ID0gdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcodGFza0tleSk7XHJcbiAgICAgICAgdmFyIGFkZFJlc3VsdCA9IHRoaXMuX2ludGVybmFsQ29udGV4dHMudHJ5QWRkKHN0cktleSwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBuZXcgRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgaW50ZXJuYWxDb250ZXh0ID0gYWRkUmVzdWx0LnZhbHVlO1xyXG4gICAgICAgIHZhciB0YXNrSGFuZGxlID0gbmV3IERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZShcclxuICAgICAgICAgICAgaW50ZXJuYWxDb250ZXh0LCBjYWxsYmFja3MpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChhZGRSZXN1bHQuaXNOZXcpIHtcclxuICAgICAgICAgICAgaW50ZXJuYWxDb250ZXh0LmluaXRpYWxpemUoXHJcbiAgICAgICAgICAgICAgICB0YXNrS2V5LFxyXG4gICAgICAgICAgICAgICAgdGhpcyxcclxuICAgICAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5faW50ZXJuYWxDb250ZXh0cyxcclxuICAgICAgICAgICAgICAgIGFkZFJlc3VsdC5pdGVyYXRvcixcclxuICAgICAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyKTtcclxuXHRcdFx0XHRcclxuICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIudGFza1N0YXJ0ZWQoaW50ZXJuYWxDb250ZXh0LnRhc2tBcGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuXHJcbiAgICAgICAgcmV0dXJuIHRhc2tIYW5kbGU7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuc3RhcnRUYXNrUHJvbWlzZSA9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHN0YXJ0VGFza1Byb21pc2UodGFza0tleSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgIHZhciB0YXNrSGFuZGxlID0gdGhhdC5zdGFydFRhc2soXHJcbiAgICAgICAgICAgICAgICB0YXNrS2V5LCB7ICdvbkRhdGEnOiBvbkRhdGEsICdvblRlcm1pbmF0ZWQnOiBvblRlcm1pbmF0ZWQgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgaGFzRGF0YSA9IHRhc2tIYW5kbGUuaGFzRGF0YSgpO1xyXG4gICAgICAgICAgICB2YXIgcmVzdWx0O1xyXG4gICAgICAgICAgICBpZiAoaGFzRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gdGFza0hhbmRsZS5nZXRMYXN0RGF0YSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvbkRhdGEoZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgaGFzRGF0YSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBkYXRhO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoaGFzRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KCdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBJbnRlcm5hbCAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ2Vycm9yIC0gdGFzayB0ZXJtaW5hdGVkIGJ1dCBubyBkYXRhIHJldHVybmVkJyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5fZGF0YVJlYWR5ID0gZnVuY3Rpb24gZGF0YVJlYWR5KFxyXG5cdFx0XHRpbnRlcm5hbENvbnRleHQsIGRhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpIHtcclxuICAgICAgICBcclxuXHRcdHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB2YXIgd29ya2VyO1xyXG4gICAgICAgIHZhciB3b3JrZXJQb29sID0gdGhhdC5fd29ya2VyUG9vbEJ5VGFza1R5cGVbd29ya2VyVHlwZV07XHJcbiAgICAgICAgaWYgKCF3b3JrZXJQb29sKSB7XHJcbiAgICAgICAgICAgIHdvcmtlclBvb2wgPSBbXTtcclxuICAgICAgICAgICAgdGhhdC5fd29ya2VyUG9vbEJ5VGFza1R5cGVbd29ya2VyVHlwZV0gPSB3b3JrZXJQb29sO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAod29ya2VyUG9vbC5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIHdvcmtlciA9IHdvcmtlclBvb2wucG9wKCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdmFyIHdvcmtlckFyZ3MgPSB0aGF0Ll93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucyhcclxuICAgICAgICAgICAgICAgIHdvcmtlclR5cGUpO1xyXG5cclxuXHRcdFx0aWYgKCF3b3JrZXJBcmdzKSB7XHJcblx0XHRcdFx0aW50ZXJuYWxDb250ZXh0Lm5ld0RhdGEoZGF0YVRvUHJvY2Vzcyk7XHJcblx0XHRcdFx0aW50ZXJuYWxDb250ZXh0LnN0YXR1c1VwZGF0ZSgpO1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG4gICAgICAgICAgICBcclxuXHRcdFx0d29ya2VyID0gbmV3IEFzeW5jUHJveHlNYXN0ZXIoXHJcbiAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLnNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgICAgIHdvcmtlckFyZ3MuY3Rvck5hbWUsXHJcbiAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLmN0b3JBcmdzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFpbnRlcm5hbENvbnRleHQud2FpdGluZ0ZvcldvcmtlclJlc3VsdCkge1xyXG4gICAgICAgICAgICBpbnRlcm5hbENvbnRleHQud2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IHRydWU7XHJcbiAgICAgICAgICAgIGludGVybmFsQ29udGV4dC5zdGF0dXNVcGRhdGUoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgd29ya2VyLmNhbGxGdW5jdGlvbihcclxuICAgICAgICAgICAgICAgICdzdGFydCcsXHJcbiAgICAgICAgICAgICAgICBbZGF0YVRvUHJvY2VzcywgaW50ZXJuYWxDb250ZXh0LnRhc2tLZXldLFxyXG4gICAgICAgICAgICAgICAgeydpc1JldHVyblByb21pc2UnOiB0cnVlfSlcclxuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24ocHJvY2Vzc2VkRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgaW50ZXJuYWxDb250ZXh0Lm5ld0RhdGEocHJvY2Vzc2VkRGF0YSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvY2Vzc2VkRGF0YTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goZnVuY3Rpb24oZSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0Vycm9yIGluIERlcGVuZGVuY3lXb3JrZXJzXFwnIHdvcmtlcjogJyArIGUpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGU7XHJcbiAgICAgICAgICAgIH0pLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcbiAgICAgICAgICAgICAgICB3b3JrZXJQb29sLnB1c2god29ya2VyKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCF0aGF0Ll9jaGVja0lmUGVuZGluZ0RhdGEoaW50ZXJuYWxDb250ZXh0KSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGludGVybmFsQ29udGV4dC53YWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJuYWxDb250ZXh0LnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgIH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLl9jaGVja0lmUGVuZGluZ0RhdGEgPSBmdW5jdGlvbiBjaGVja0lmUGVuZGluZ0RhdGEoaW50ZXJuYWxDb250ZXh0KSB7XHJcblx0XHRpZiAoIWludGVybmFsQ29udGV4dC5pc1BlbmRpbmdEYXRhRm9yV29ya2VyKSB7XHJcblx0XHRcdHJldHVybiBmYWxzZTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0dmFyIGRhdGFUb1Byb2Nlc3MgPSBpbnRlcm5hbENvbnRleHQucGVuZGluZ0RhdGFGb3JXb3JrZXI7XHJcblx0XHRpbnRlcm5hbENvbnRleHQuaXNQZW5kaW5nRGF0YUZvcldvcmtlciA9IGZhbHNlO1xyXG5cdFx0aW50ZXJuYWxDb250ZXh0LnBlbmRpbmdEYXRhRm9yV29ya2VyID0gbnVsbDtcclxuXHRcdFxyXG5cdFx0dGhpcy5fZGF0YVJlYWR5KFxyXG5cdFx0XHRpbnRlcm5hbENvbnRleHQsXHJcblx0XHRcdGRhdGFUb1Byb2Nlc3MsXHJcblx0XHRcdGludGVybmFsQ29udGV4dC5wZW5kaW5nV29ya2VyVHlwZSk7XHJcblx0XHRcclxuXHRcdHJldHVybiB0cnVlO1xyXG5cdH07XHJcbiAgICBcclxuICAgIHJldHVybiBEZXBlbmRlbmN5V29ya2VycztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnM7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdCcpO1xyXG5cclxudmFyIEhhc2hNYXAgPSAoZnVuY3Rpb24gSGFzaE1hcENsb3N1cmUoKSB7XHJcblxyXG5mdW5jdGlvbiBIYXNoTWFwKGhhc2hlcikge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgdGhhdC5faGFzaGVyID0gaGFzaGVyO1xyXG5cdHRoYXQuY2xlYXIoKTtcclxufVxyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiBjbGVhcigpIHtcclxuICAgIHRoaXMuX2xpc3RCeUtleSA9IFtdO1xyXG4gICAgdGhpcy5fbGlzdE9mTGlzdHMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0RnJvbUtleSA9IGZ1bmN0aW9uIGdldEZyb21LZXkoa2V5KSB7XHJcbiAgICB2YXIgaGFzaENvZGUgPSB0aGlzLl9oYXNoZXJbJ2dldEhhc2hDb2RlJ10oa2V5KTtcclxuICAgIHZhciBoYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0QnlLZXlbaGFzaENvZGVdO1xyXG4gICAgaWYgKCFoYXNoRWxlbWVudHMpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIHZhciBsaXN0ID0gaGFzaEVsZW1lbnRzLmxpc3Q7XHJcbiAgICBcclxuICAgIHZhciBpdGVyYXRvciA9IGxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGl0ZW0gPSBsaXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgaWYgKHRoaXMuX2hhc2hlclsnaXNFcXVhbCddKGl0ZW0ua2V5LCBrZXkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBpdGVtLnZhbHVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpdGVyYXRvciA9IGxpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbnVsbDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZyb21JdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZyb21JdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpLnZhbHVlO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUudHJ5QWRkID0gZnVuY3Rpb24gdHJ5QWRkKGtleSwgY3JlYXRlVmFsdWUpIHtcclxuICAgIHZhciBoYXNoQ29kZSA9IHRoaXMuX2hhc2hlclsnZ2V0SGFzaENvZGUnXShrZXkpO1xyXG4gICAgdmFyIGhhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV07XHJcbiAgICBpZiAoIWhhc2hFbGVtZW50cykge1xyXG4gICAgICAgIGhhc2hFbGVtZW50cyA9IHtcclxuICAgICAgICAgICAgaGFzaENvZGU6IGhhc2hDb2RlLFxyXG4gICAgICAgICAgICBsaXN0OiBuZXcgTGlua2VkTGlzdCgpLFxyXG4gICAgICAgICAgICBsaXN0T2ZMaXN0c0l0ZXJhdG9yOiBudWxsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBoYXNoRWxlbWVudHMubGlzdE9mTGlzdHNJdGVyYXRvciA9IHRoaXMuX2xpc3RPZkxpc3RzLmFkZChoYXNoRWxlbWVudHMpO1xyXG4gICAgICAgIHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV0gPSBoYXNoRWxlbWVudHM7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpdGVyYXRvciA9IHtcclxuICAgICAgICBfaGFzaEVsZW1lbnRzOiBoYXNoRWxlbWVudHMsXHJcbiAgICAgICAgX2ludGVybmFsSXRlcmF0b3I6IG51bGxcclxuICAgIH07XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID0gaGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGl0ZW0gPSBoYXNoRWxlbWVudHMubGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgICAgIGlmICh0aGlzLl9oYXNoZXJbJ2lzRXF1YWwnXShpdGVtLmtleSwga2V5KSkge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgaXRlcmF0b3I6IGl0ZXJhdG9yLFxyXG4gICAgICAgICAgICAgICAgaXNOZXc6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgdmFsdWU6IGl0ZW0udmFsdWVcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdmFsdWUgPSBjcmVhdGVWYWx1ZSgpO1xyXG4gICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5hZGQoe1xyXG4gICAgICAgIGtleToga2V5LFxyXG4gICAgICAgIHZhbHVlOiB2YWx1ZVxyXG4gICAgfSk7XHJcbiAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGl0ZXJhdG9yOiBpdGVyYXRvcixcclxuICAgICAgICBpc05ldzogdHJ1ZSxcclxuICAgICAgICB2YWx1ZTogdmFsdWVcclxuICAgIH07XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHZhciBvbGRMaXN0Q291bnQgPSBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0Q291bnQoKTtcclxuICAgIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5yZW1vdmUoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgdmFyIG5ld0xpc3RDb3VudCA9IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRDb3VudCgpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jb3VudCArPSAobmV3TGlzdENvdW50IC0gb2xkTGlzdENvdW50KTtcclxuICAgIGlmIChuZXdMaXN0Q291bnQgPT09IDApIHtcclxuICAgICAgICB0aGlzLl9saXN0T2ZMaXN0cy5yZW1vdmUoaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBkZWxldGUgdGhpcy5fbGlzdEJ5S2V5W2l0ZXJhdG9yLl9oYXNoRWxlbWVudHMuaGFzaENvZGVdO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGZpcnN0TGlzdEl0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgdmFyIGZpcnN0SGFzaEVsZW1lbnRzID0gbnVsbDtcclxuICAgIHZhciBmaXJzdEludGVybmFsSXRlcmF0b3IgPSBudWxsO1xyXG4gICAgaWYgKGZpcnN0TGlzdEl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgZmlyc3RIYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGcm9tSXRlcmF0b3IoZmlyc3RMaXN0SXRlcmF0b3IpO1xyXG4gICAgICAgIGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9IGZpcnN0SGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgfVxyXG4gICAgaWYgKGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIF9oYXNoRWxlbWVudHM6IGZpcnN0SGFzaEVsZW1lbnRzLFxyXG4gICAgICAgIF9pbnRlcm5hbEl0ZXJhdG9yOiBmaXJzdEludGVybmFsSXRlcmF0b3JcclxuICAgIH07XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHZhciBuZXh0SXRlcmF0b3IgPSB7XHJcbiAgICAgICAgX2hhc2hFbGVtZW50czogaXRlcmF0b3IuX2hhc2hFbGVtZW50cyxcclxuICAgICAgICBfaW50ZXJuYWxJdGVyYXRvcjogaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldE5leHRJdGVyYXRvcihcclxuICAgICAgICAgICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB3aGlsZSAobmV4dEl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0TmV4dEl0ZXJhdG9yKFxyXG4gICAgICAgICAgICBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3RPZkxpc3RzSXRlcmF0b3IpO1xyXG4gICAgICAgIGlmIChuZXh0TGlzdE9mTGlzdHNJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbmV4dEl0ZXJhdG9yLl9oYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGcm9tSXRlcmF0b3IoXHJcbiAgICAgICAgICAgIG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBuZXh0SXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPVxyXG4gICAgICAgICAgICBuZXh0SXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0SXRlcmF0b3I7XHJcbn07XHJcblxyXG5yZXR1cm4gSGFzaE1hcDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSGFzaE1hcDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSGFzaE1hcCA9IHJlcXVpcmUoJ2hhc2gtbWFwJyk7XHJcblxyXG52YXIgSnNCdWlsdGluSGFzaE1hcCA9IChmdW5jdGlvbiBIYXNoTWFwQ2xvc3VyZSgpIHtcclxuICAgIFxyXG4vLyBUaGlzIGNsYXNzIGV4cG9zZSBzYW1lIEFQSSBhcyBIYXNoTWFwIGJ1dCBub3QgcmVxdWlyaW5nIGdldEhhc2hDb2RlKCkgYW5kIGlzRXF1YWwoKSBmdW5jdGlvbnMuXHJcbi8vIFRoYXQgd2F5IGl0J3MgZWFzeSB0byBzd2l0Y2ggYmV0d2VlbiBpbXBsZW1lbnRhdGlvbnMuXHJcblxyXG52YXIgc2ltcGxlSGFzaGVyID0ge1xyXG4gICAgJ2dldEhhc2hDb2RlJzogZnVuY3Rpb24gZ2V0SGFzaENvZGUoa2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIGtleTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgICdpc0VxdWFsJzogZnVuY3Rpb24gaXNFcXVhbChrZXkxLCBrZXkyKSB7XHJcbiAgICAgICAgcmV0dXJuIGtleTEgPT09IGtleTI7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBKc0J1aWx0aW5IYXNoTWFwKCkge1xyXG4gICAgSGFzaE1hcC5jYWxsKHRoaXMsIC8qaGFzaGVyPSovc2ltcGxlSGFzaGVyKTtcclxufVxyXG5cclxuSnNCdWlsdGluSGFzaE1hcC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEhhc2hNYXAucHJvdG90eXBlKTtcclxuXHJcbnJldHVybiBKc0J1aWx0aW5IYXNoTWFwO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBKc0J1aWx0aW5IYXNoTWFwOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gKGZ1bmN0aW9uIExpbmtlZExpc3RDbG9zdXJlKCkge1xyXG5cclxuZnVuY3Rpb24gTGlua2VkTGlzdCgpIHtcclxuICAgIHRoaXMuY2xlYXIoKTtcclxufVxyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiBjbGVhcigpIHtcclxuICAgIHRoaXMuX2ZpcnN0ID0geyBfcHJldjogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fbGFzdCA9IHsgX25leHQ6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2NvdW50ID0gMDtcclxuICAgIFxyXG4gICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgdGhpcy5fZmlyc3QuX25leHQgPSB0aGlzLl9sYXN0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gYWRkKHZhbHVlLCBhZGRCZWZvcmUpIHtcclxuICAgIGlmIChhZGRCZWZvcmUgPT09IG51bGwgfHwgYWRkQmVmb3JlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICBcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHZhciBuZXdOb2RlID0ge1xyXG4gICAgICAgIF92YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICBfcHJldjogYWRkQmVmb3JlLl9wcmV2LFxyXG4gICAgICAgIF9wYXJlbnQ6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIG5ld05vZGUuX3ByZXYuX25leHQgPSBuZXdOb2RlO1xyXG4gICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgIFxyXG4gICAgcmV0dXJuIG5ld05vZGU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICAtLXRoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICBpdGVyYXRvci5fcHJldi5fbmV4dCA9IGl0ZXJhdG9yLl9uZXh0O1xyXG4gICAgaXRlcmF0b3IuX25leHQuX3ByZXYgPSBpdGVyYXRvci5fcHJldjtcclxuICAgIGl0ZXJhdG9yLl9wYXJlbnQgPSBudWxsO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0RnJvbUl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXROZXh0SXRlcmF0b3IodGhpcy5fZmlyc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TGFzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9uZXh0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0UHJldkl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0UHJldkl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX3ByZXYgPT09IHRoaXMuX2ZpcnN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fcHJldjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY291bnQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyA9XHJcbiAgICBmdW5jdGlvbiB2YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKSB7XHJcbiAgICBcclxuICAgIGlmIChpdGVyYXRvci5fcGFyZW50ICE9PSB0aGlzKSB7XHJcbiAgICAgICAgdGhyb3cgJ2l0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICB9XHJcbn07XHJcblxyXG5yZXR1cm4gTGlua2VkTGlzdDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlua2VkTGlzdDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyID0gcmVxdWlyZSgnc2NoZWR1bGVyLXdyYXBwZXItaW5wdXQtcmV0cmVpdmVyJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2VycycpO1xyXG5cclxudmFyIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzID0gKGZ1bmN0aW9uIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzKHNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICB2YXIgd3JhcHBlcklucHV0UmV0cmVpdmVyID0gbmV3IFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlcihzY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyKTtcclxuICAgICAgICBEZXBlbmRlbmN5V29ya2Vycy5jYWxsKHRoaXMsIHdyYXBwZXJJbnB1dFJldHJlaXZlcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VyczsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxuXHJcbnZhciBTY2hlZHVsZXJUYXNrID0gKGZ1bmN0aW9uIFNjaGVkdWxlclRhc2tDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gU2NoZWR1bGVyVGFzayhzY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyLCBpc0Rpc2FibGVXb3JrZXJDYWNoZSwgd3JhcHBlZFRhc2spIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcblx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2suY2FsbCh0aGlzLCB3cmFwcGVkVGFzaywgd3JhcHBlZFRhc2sua2V5LCAvKnJlZ2lzdGVyV3JhcHBlZEV2ZW50cz0qL3RydWUpO1xyXG4gICAgICAgIHRoYXQuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuXHRcdHRoYXQuX2lucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcblx0XHR0aGF0Ll9pc0Rpc2FibGVXb3JrZXJDYWNoZSA9IGlzRGlzYWJsZVdvcmtlckNhY2hlO1xyXG5cdFx0dGhhdC5fd3JhcHBlZFRhc2sgPSB3cmFwcGVkVGFzaztcclxuICAgICAgICB0aGF0Ll9vblNjaGVkdWxlZEJvdW5kID0gdGhhdC5fb25TY2hlZHVsZWQuYmluZCh0aGF0KTtcclxuICAgICAgICBcclxuICAgICAgICB0aGF0Ll9wZW5kaW5nRGF0YVRvUHJvY2VzcyA9IG51bGw7XHJcbiAgICAgICAgdGhhdC5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBmYWxzZTtcclxuICAgICAgICB0aGF0Ll9jYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgIHRoYXQuX2lzV29ya2VyQWN0aXZlID0gZmFsc2U7XHJcblx0XHR0aGF0Ll9pc1Rlcm1pbmF0ZWQgPSBmYWxzZTtcclxuICAgICAgICB0aGF0Ll9sYXN0U3RhdHVzID0geyAnaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0JzogZmFsc2UgfTtcclxuICAgIH1cclxuXHRcclxuXHRTY2hlZHVsZXJUYXNrLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSk7XHJcbiAgICBcclxuICAgIFNjaGVkdWxlclRhc2sucHJvdG90eXBlLl9tb2RpZnlTdGF0dXMgPSBmdW5jdGlvbiBtb2RpZnlTdGF0dXMoc3RhdHVzKSB7XHJcbiAgICAgICAgdGhpcy5fbGFzdFN0YXR1cyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoc3RhdHVzKSk7XHJcbiAgICAgICAgdGhpcy5fY2hlY2tJZkpvYkRvbmUoc3RhdHVzKTtcclxuICAgICAgICB0aGlzLl9sYXN0U3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9XHJcbiAgICAgICAgICAgIHN0YXR1cy5pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgfHwgdGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3M7XHJcbiAgICAgICAgXHJcblx0XHRyZXR1cm4gdGhpcy5fbGFzdFN0YXR1cztcclxuICAgIH07XHJcbiAgICBcclxuICAgIFNjaGVkdWxlclRhc2sucHJvdG90eXBlLmRhdGFSZWFkeSA9IGZ1bmN0aW9uIG9uRGF0YVJlYWR5VG9Qcm9jZXNzKFxyXG4gICAgICAgICAgICBuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBEYXRhIGFmdGVyIHRlcm1pbmF0aW9uJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlW3dvcmtlclR5cGVdID09PSB1bmRlZmluZWQpIHtcclxuXHRcdFx0dGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGVbd29ya2VyVHlwZV0gPSB0aGlzLl9pbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucyh3b3JrZXJUeXBlKSA9PT0gbnVsbDtcclxuXHRcdH1cclxuXHRcdGlmICh0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZVt3b3JrZXJUeXBlXSkge1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nRGF0YVRvUHJvY2VzcyA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzID1cclxuICAgICAgICAgICAgICAgIHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzICYmICF0aGlzLl9pc1dvcmtlckFjdGl2ZTtcclxuICAgICAgICAgICAgdGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBmYWxzZTtcclxuICAgICAgICAgICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5kYXRhUmVhZHkuY2FsbCh0aGlzLCBuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBpc1N0YXR1c0NoYW5nZWQgPVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fbGFzdFN0YXR1cy5pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgJiZcclxuICAgICAgICAgICAgICAgICF0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcztcclxuICAgICAgICAgICAgaWYgKGlzU3RhdHVzQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbGFzdFN0YXR1cy5pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX29uRXZlbnQoJ3N0YXR1c1VwZGF0ZWQnLCB0aGlzLl9sYXN0U3RhdHVzKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGF0YVRvUHJvY2VzcyA9IG5ld0RhdGFUb1Byb2Nlc3M7XHJcbiAgICAgICAgdGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBmYWxzZTtcclxuICAgICAgICB2YXIgaGFkUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSB0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcztcclxuICAgICAgICB0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IHRydWU7XHJcblxyXG4gICAgICAgIGlmICghaGFkUGVuZGluZ0RhdGFUb1Byb2Nlc3MgJiYgIXRoaXMuX2lzV29ya2VyQWN0aXZlKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjaGVkdWxlci5lbnF1ZXVlSm9iKFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fb25TY2hlZHVsZWRCb3VuZCwgdGhpcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IERvdWJsZSB0ZXJtaW5hdGlvbic7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzVGVybWluYXRlZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2Vzcykge1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZS5jYWxsKHRoaXMpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuX29uU2NoZWR1bGVkID0gZnVuY3Rpb24gZGF0YVJlYWR5Rm9yV29ya2VyKFxyXG4gICAgICAgICAgICByZXNvdXJjZSwgam9iQ29udGV4dCwgam9iQ2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICBpZiAoam9iQ29udGV4dCAhPT0gdGhpcykge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogVW5leHBlY3RlZCBjb250ZXh0JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzID0gZmFsc2U7XHJcblx0XHRcdGpvYkNhbGxiYWNrcy5qb2JEb25lKCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuXHRcdFx0aWYgKCF0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2Vzcykge1xyXG5cdFx0XHRcdHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiAhZW5xdWV1ZWRQcm9jZXNzSm9iJztcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0dGhpcy5faXNXb3JrZXJBY3RpdmUgPSB0cnVlO1xyXG5cdFx0XHR0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG5cdFx0XHR0aGlzLl9qb2JDYWxsYmFja3MgPSBqb2JDYWxsYmFja3M7XHJcblx0XHRcdHZhciBkYXRhID0gdGhpcy5fcGVuZGluZ0RhdGFUb1Byb2Nlc3M7XHJcblx0XHRcdHRoaXMuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbnVsbDtcclxuXHRcdFx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5kYXRhUmVhZHkuY2FsbCh0aGlzLCBkYXRhKTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0aWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZS5jYWxsKHRoaXMpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuX2NoZWNrSWZKb2JEb25lID0gZnVuY3Rpb24gY2hlY2tJZkpvYkRvbmUoc3RhdHVzKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9pc1dvcmtlckFjdGl2ZSB8fCBzdGF0dXMuaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBjYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2Vzcyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzV29ya2VyQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjaGVkdWxlci5lbnF1ZXVlSm9iKFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fb25TY2hlZHVsZWRCb3VuZCwgdGhpcyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB0aGlzLl9qb2JDYWxsYmFja3Muam9iRG9uZSgpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFNjaGVkdWxlclRhc2s7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNjaGVkdWxlclRhc2s7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFNjaGVkdWxlclRhc2sgPSByZXF1aXJlKCdzY2hlZHVsZXItdGFzaycpO1xyXG52YXIgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSA9IHJlcXVpcmUoJ3dyYXBwZXItaW5wdXQtcmV0cmVpdmVyLWJhc2UnKTtcclxuXHJcbnZhciBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIgPSAoZnVuY3Rpb24gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlcihzY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5jYWxsKHRoaXMsIGlucHV0UmV0cmVpdmVyKTtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG5cdFx0dGhhdC5faW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuXHRcdHRoYXQuX2lzRGlzYWJsZVdvcmtlckNhY2hlID0ge307XHJcblxyXG4gICAgICAgIGlmICghaW5wdXRSZXRyZWl2ZXIudGFza1N0YXJ0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLnRhc2tTdGFydGVkKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlKTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyLnByb3RvdHlwZS50YXNrU3RhcnRlZCA9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHRhc2tTdGFydGVkKHRhc2spIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgd3JhcHBlclRhc2sgPSBuZXcgU2NoZWR1bGVyVGFzayhcclxuXHRcdFx0dGhpcy5fc2NoZWR1bGVyLCB0aGlzLl9pbnB1dFJldHJlaXZlciwgdGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGUsIHRhc2spO1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnB1dFJldHJlaXZlci50YXNrU3RhcnRlZCh3cmFwcGVyVGFzayk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXI7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSAoZnVuY3Rpb24gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZUNsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlKGlucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnaW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWlucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICdpbnB1dFJldHJlaXZlci5nZXRUYXNrVHlwZU9wdGlvbnMoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX2lucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlLnRhc2tTdGFydGVkID1cclxuICAgICAgICAgICAgZnVuY3Rpb24gdGFza1N0YXJ0ZWQodGFzaykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRocm93ICdBc3luY1Byb3h5LldyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgaW50ZXJuYWwgZXJyb3I6IE5vdCBpbXBsZW1lbnRlZCB0YXNrU3RhcnRlZCgpJztcclxuICAgIH07XHJcbiAgICBcclxuICAgIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlLmdldEtleUFzU3RyaW5nID0gZnVuY3Rpb24oa2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKGtleSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBcclxuICAgIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlLmdldFdvcmtlclR5cGVPcHRpb25zID0gZnVuY3Rpb24odGFza1R5cGUpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnModGFza1R5cGUpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2U7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2U7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFNjcmlwdHNUb0ltcG9ydFBvb2wgPSAoZnVuY3Rpb24gU2NyaXB0c1RvSW1wb3J0UG9vbENsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBTY3JpcHRzVG9JbXBvcnRQb29sKCkge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll9zY3JpcHRzQnlOYW1lID0ge307XHJcbiAgICAgICAgdGhhdC5fc2NyaXB0c0FycmF5ID0gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgU2NyaXB0c1RvSW1wb3J0UG9vbC5wcm90b3R5cGUuYWRkU2NyaXB0RnJvbUVycm9yV2l0aFN0YWNrVHJhY2UgPVxyXG4gICAgICAgIGZ1bmN0aW9uIGFkZFNjcmlwdEZvcldvcmtlckltcG9ydChlcnJvcldpdGhTdGFja1RyYWNlKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGZpbGVOYW1lID0gU2NyaXB0c1RvSW1wb3J0UG9vbC5fZ2V0U2NyaXB0TmFtZShlcnJvcldpdGhTdGFja1RyYWNlKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX3NjcmlwdHNCeU5hbWVbZmlsZU5hbWVdKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNCeU5hbWVbZmlsZU5hbWVdID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0FycmF5ID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY3JpcHRzVG9JbXBvcnRQb29sLnByb3RvdHlwZS5nZXRTY3JpcHRzRm9yV29ya2VySW1wb3J0ID1cclxuICAgICAgICBmdW5jdGlvbiBnZXRTY3JpcHRzRm9yV29ya2VySW1wb3J0KCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zY3JpcHRzQXJyYXkgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0FycmF5ID0gW107XHJcbiAgICAgICAgICAgIGZvciAodmFyIGZpbGVOYW1lIGluIHRoaXMuX3NjcmlwdHNCeU5hbWUpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNBcnJheS5wdXNoKGZpbGVOYW1lKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdGhpcy5fc2NyaXB0c0FycmF5O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NyaXB0c1RvSW1wb3J0UG9vbC5fZ2V0U2NyaXB0TmFtZSA9IGZ1bmN0aW9uIGdldFNjcmlwdE5hbWUoZXJyb3JXaXRoU3RhY2tUcmFjZSkge1xyXG4gICAgICAgIHZhciBzdGFjayA9IGVycm9yV2l0aFN0YWNrVHJhY2Uuc3RhY2sudHJpbSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBjdXJyZW50U3RhY2tGcmFtZVJlZ2V4ID0gL2F0ICh8W14gXSsgXFwoKShbXiBdKyk6XFxkKzpcXGQrLztcclxuICAgICAgICB2YXIgc291cmNlID0gY3VycmVudFN0YWNrRnJhbWVSZWdleC5leGVjKHN0YWNrKTtcclxuICAgICAgICBpZiAoc291cmNlICYmIHNvdXJjZVsyXSAhPT0gXCJcIikge1xyXG4gICAgICAgICAgICByZXR1cm4gc291cmNlWzJdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIGxhc3RTdGFja0ZyYW1lUmVnZXggPSBuZXcgUmVnRXhwKC8uK1xcLyguKj8pOlxcZCsoOlxcZCspKiQvKTtcclxuICAgICAgICBzb3VyY2UgPSBsYXN0U3RhY2tGcmFtZVJlZ2V4LmV4ZWMoc3RhY2spO1xyXG4gICAgICAgIGlmIChzb3VyY2UgJiYgc291cmNlWzFdICE9PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBzb3VyY2VbMV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChlcnJvcldpdGhTdGFja1RyYWNlLmZpbGVOYW1lICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGVycm9yV2l0aFN0YWNrVHJhY2UuZmlsZU5hbWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRocm93ICdJbWFnZURlY29kZXJGcmFtZXdvcmsuanM6IENvdWxkIG5vdCBnZXQgY3VycmVudCBzY3JpcHQgVVJMJztcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTY3JpcHRzVG9JbXBvcnRQb29sO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY3JpcHRzVG9JbXBvcnRQb29sOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG5cclxudmFyIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSA9IChmdW5jdGlvbiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWVDbG9zdXJlKCkge1xyXG4gICAgdmFyIHN1YldvcmtlcklkID0gMDtcclxuICAgIHZhciBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0gbnVsbDtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lKHNjcmlwdFVybCkge1xyXG4gICAgICAgIGlmIChzdWJXb3JrZXJJZFRvU3ViV29ya2VyID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5IGludGVybmFsIGVycm9yOiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgJyArXHJcbiAgICAgICAgICAgICAgICAnbm90IGluaXRpYWxpemVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3N1YldvcmtlcklkID0gKytzdWJXb3JrZXJJZDtcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyW3RoYXQuX3N1YldvcmtlcklkXSA9IHRoYXQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWJXb3JrZXJDdG9yJyxcclxuICAgICAgICAgICAgc3ViV29ya2VySWQ6IHRoYXQuX3N1YldvcmtlcklkLFxyXG4gICAgICAgICAgICBzY3JpcHRVcmw6IHNjcmlwdFVybFxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uIGluaXRpYWxpemUoXHJcbiAgICAgICAgc3ViV29ya2VySWRUb1N1Yldvcmtlcl8pIHtcclxuICAgICAgICBcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0gc3ViV29ya2VySWRUb1N1Yldvcmtlcl87XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUucHJvdG90eXBlLnBvc3RNZXNzYWdlID0gZnVuY3Rpb24gcG9zdE1lc3NhZ2UoXHJcbiAgICAgICAgZGF0YSwgdHJhbnNmZXJhYmxlcykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnc3ViV29ya2VyUG9zdE1lc3NhZ2UnLFxyXG4gICAgICAgICAgICBzdWJXb3JrZXJJZDogdGhpcy5fc3ViV29ya2VySWQsXHJcbiAgICAgICAgICAgIGRhdGE6IGRhdGFcclxuICAgICAgICB9LFxyXG4gICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoXHJcbiAgICAgICAgZGF0YSwgdHJhbnNmZXJhYmxlcykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnc3ViV29ya2VyVGVybWluYXRlJyxcclxuICAgICAgICAgICAgc3ViV29ya2VySWQ6IHRoaXMuX3N1YldvcmtlcklkXHJcbiAgICAgICAgfSxcclxuICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWU7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZTsiXX0=
