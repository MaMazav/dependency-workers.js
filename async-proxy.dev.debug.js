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
		
		this._pendingDelayedAction = false;
		this._pendingDelayedDependencyData = [];
		this._pendingDelayedEnded = false;
		this._pendingDelayedNewData = false;
		this._performPendingDelayedActionsBound = this._performPendingDelayedActions.bind(this);
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

		this._pendingDelayedEnded = true;
		if (!this._pendingDelayedAction) {
			this._pendingDelayedAction = true;
			setTimeout(this._performPendingDelayedActionsBound);
		}
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
        
		this._pendingDelayedNewData = true;
		if (!this._pendingDelayedAction) {
			this._pendingDelayedAction = true;
			setTimeout(this._performPendingDelayedActionsBound);
		}
    };
    
	DependencyWorkersInternalContext.prototype.dataReady = function dataReady(newDataToProcess, workerType) {
		if (this.isTerminated) {
			throw 'AsyncProxy.DependencyWorkers: already terminated';
		} else if (this.waitingForWorkerResult) {
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
			this._pendingDelayedDependencyData.push({
				data: addResult.value.taskHandle.getLastData(),
				onDependencyTaskData: onDependencyTaskData
			});
			if (!this._pendingDelayedAction) {
				this._pendingDelayedAction = true;
				setTimeout(this._performPendingDelayedActionsBound);
			}
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
	
	DependencyWorkersInternalContext.prototype._performPendingDelayedActions = function() {
		var iterator;
		var handle;
		this._pendingDelayedAction = false;
		
		if (this._pendingDelayedDependencyData.length > 0) {
			var localListeners = this._pendingDelayedDependencyData;
			this._pendingDelayedDependencyData = [];
			
			for (var i = 0; i < localListeners.length; ++i) {
				localListeners[i].onDependencyTaskData(localListeners[i].data);
			}
		}
		
		if (this._pendingDelayedNewData) {
			var handles = this.taskHandles;
			iterator = handles.getFirstIterator();
			while (iterator !== null) {
				handle = handles.getFromIterator(iterator);
				iterator = handles.getNextIterator(iterator);
				
				handle._callbacks.onData(this.lastProcessedData, this.taskKey);
			}
		}
		
		if (this._pendingDelayedEnded) {
			iterator = this.taskHandles.getFirstIterator();
			while (iterator !== null) {
				handle = this.taskHandles.getFromIterator(iterator);
				iterator = this.taskHandles.getNextIterator(iterator);

				if (handle._callbacks.onTerminated) {
					handle._callbacks.onTerminated();
				}
			}
			
			this.taskHandles.clear();
		}
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXN5bmMtcHJveHktZXhwb3J0cy5qcyIsInNyYy9hc3luYy1wcm94eS1mYWN0b3J5LmpzIiwic3JjL2FzeW5jLXByb3h5LW1hc3Rlci5qcyIsInNyYy9hc3luYy1wcm94eS1zbGF2ZS5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvZGVwZW5kZW5jeS13b3JrZXJzLWludGVybmFsLWNvbnRleHQuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWhhbmRsZS5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2suanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2RlcGVuZGVuY3ktd29ya2Vycy5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvaGFzaC1tYXAuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2pzLWJ1aWx0aW4taGFzaC1tYXAuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2xpbmtlZC1saXN0LmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9zY2hlZHVsZXItZGVwZW5kZW5jeS13b3JrZXJzLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9zY2hlZHVsZXItdGFzay5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvc2NoZWR1bGVyLXdyYXBwZXItaW5wdXQtcmV0cmVpdmVyLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy93cmFwcGVyLWlucHV0LXJldHJlaXZlci1iYXNlLmpzIiwic3JjL3NjcmlwdHMtdG8tSW1wb3J0LVBvb2wuanMiLCJzcmMvc3ViLXdvcmtlci1lbXVsYXRpb24tZm9yLWNocm9tZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOU5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1UkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSA9IHJlcXVpcmUoJ3N1Yi13b3JrZXItZW11bGF0aW9uLWZvci1jaHJvbWUnKTtcclxudmFyIEFzeW5jUHJveHlGYWN0b3J5ID0gcmVxdWlyZSgnYXN5bmMtcHJveHktZmFjdG9yeScpO1xudmFyIEFzeW5jUHJveHlTbGF2ZSA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LXNsYXZlJyk7XG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xudmFyIFNjcmlwdHNUb0ltcG9ydFBvb2wgPSByZXF1aXJlKCdzY3JpcHRzLXRvLUltcG9ydC1Qb29sJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2VycycpO1xudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZSA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWhhbmRsZScpO1xudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFzayA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrJyk7XG52YXIgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSA9IHJlcXVpcmUoJ3dyYXBwZXItaW5wdXQtcmV0cmVpdmVyLWJhc2UnKTtcclxudmFyIFNjaGVkdWxlclRhc2sgPSByZXF1aXJlKCdzY2hlZHVsZXItdGFzaycpO1xudmFyIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlciA9IHJlcXVpcmUoJ3NjaGVkdWxlci13cmFwcGVyLWlucHV0LXJldHJlaXZlcicpO1xudmFyIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzID0gcmVxdWlyZSgnc2NoZWR1bGVyLWRlcGVuZGVuY3ktd29ya2VycycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5RmFjdG9yeSA9IEFzeW5jUHJveHlGYWN0b3J5O1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5U2xhdmUgPSBBc3luY1Byb3h5U2xhdmU7XHJcbm1vZHVsZS5leHBvcnRzLkFzeW5jUHJveHlNYXN0ZXIgPSBBc3luY1Byb3h5TWFzdGVyO1xyXG5tb2R1bGUuZXhwb3J0cy5TY3JpcHRzVG9JbXBvcnRQb29sID0gU2NyaXB0c1RvSW1wb3J0UG9vbDtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnMgPSBEZXBlbmRlbmN5V29ya2VycztcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlO1xyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2s7XHJcbm1vZHVsZS5leHBvcnRzLldyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJUYXNrID0gU2NoZWR1bGVyVGFzaztcclxubW9kdWxlLmV4cG9ydHMuU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyID0gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XHJcblxyXG52YXIgQXN5bmNQcm94eUZhY3RvcnkgPSAoZnVuY3Rpb24gQXN5bmNQcm94eUZhY3RvcnlDbG9zdXJlKCkge1xyXG4gICAgdmFyIGZhY3RvcnlTaW5nbGV0b24gPSB7fTtcclxuXHRcclxuXHRmYWN0b3J5U2luZ2xldG9uLmNyZWF0ZSA9IGZ1bmN0aW9uIGNyZWF0ZShzY3JpcHRzVG9JbXBvcnQsIGN0b3JOYW1lLCBtZXRob2RzLCBwcm94eUN0b3IpIHtcclxuXHRcdGlmICgoIXNjcmlwdHNUb0ltcG9ydCkgfHwgIShzY3JpcHRzVG9JbXBvcnQubGVuZ3RoKSkge1xyXG5cdFx0XHR0aHJvdyAnQXN5bmNQcm94eUZhY3RvcnkgZXJyb3I6IG1pc3Npbmcgc2NyaXB0c1RvSW1wb3J0ICgybmQgYXJndW1lbnQpJztcclxuXHRcdH1cclxuXHRcdGlmICghbWV0aG9kcykge1xyXG5cdFx0XHR0aHJvdyAnQXN5bmNQcm94eUZhY3RvcnkgZXJyb3I6IG1pc3NpbmcgbWV0aG9kcyAoM3JkIGFyZ3VtZW50KSc7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdHZhciBQcm94eUNsYXNzID0gcHJveHlDdG9yIHx8IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgdGhhdCA9IHRoaXM7XHJcblx0XHRcdHRoaXMuX193b3JrZXJIZWxwZXJDdG9yQXJncyA9IGNvbnZlcnRBcmdzKGFyZ3VtZW50cyk7XHJcblx0XHR9O1xyXG5cdFx0XHJcblx0XHRQcm94eUNsYXNzLnByb3RvdHlwZS5fZ2V0V29ya2VySGVscGVyID0gZnVuY3Rpb24gZ2V0V29ya2VySGVscGVyKCkge1xyXG5cdFx0XHRpZiAoIXRoaXMuX193b3JrZXJIZWxwZXIpIHtcclxuXHRcdFx0XHR0aGlzLl9fd29ya2VySGVscGVyID0gbmV3IEFzeW5jUHJveHlNYXN0ZXIoXHJcblx0XHRcdFx0XHRzY3JpcHRzVG9JbXBvcnQsIGN0b3JOYW1lLCB0aGlzLl9fd29ya2VySGVscGVyQ3RvckFyZ3MgfHwgW10pO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHRyZXR1cm4gdGhpcy5fX3dvcmtlckhlbHBlcjtcclxuXHRcdH07XHJcblx0XHRcclxuXHRcdGZvciAodmFyIG1ldGhvZE5hbWUgaW4gbWV0aG9kcykge1xyXG5cdFx0XHRnZW5lcmF0ZU1ldGhvZChQcm94eUNsYXNzLCBtZXRob2ROYW1lLCBtZXRob2RzW21ldGhvZE5hbWVdIHx8IFtdKTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0cmV0dXJuIFByb3h5Q2xhc3M7XHJcblx0fTtcclxuXHRcclxuXHRmdW5jdGlvbiBnZW5lcmF0ZU1ldGhvZChQcm94eUNsYXNzLCBtZXRob2ROYW1lLCBtZXRob2RBcmdzRGVzY3JpcHRpb24pIHtcclxuXHRcdGlmICh0eXBlb2YgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uID09PSAnZnVuY3Rpb24nKSB7XHJcblx0XHRcdFByb3h5Q2xhc3MucHJvdG90eXBlW21ldGhvZE5hbWVdID0gbWV0aG9kQXJnc0Rlc2NyaXB0aW9uO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdHZhciBtZXRob2RPcHRpb25zID0gbWV0aG9kQXJnc0Rlc2NyaXB0aW9uWzBdIHx8IHt9O1xyXG5cdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbiBnZW5lcmF0ZWRGdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHdvcmtlckhlbHBlciA9IHRoaXMuX2dldFdvcmtlckhlbHBlcigpO1xyXG5cdFx0XHR2YXIgYXJnc1RvU2VuZCA9IFtdO1xyXG5cdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRcdHZhciBhcmdEZXNjcmlwdGlvbiA9IG1ldGhvZEFyZ3NEZXNjcmlwdGlvbltpICsgMV07XHJcblx0XHRcdFx0dmFyIGFyZ1ZhbHVlID0gYXJndW1lbnRzW2ldO1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdGlmIChhcmdEZXNjcmlwdGlvbiA9PT0gJ2NhbGxiYWNrJykge1xyXG5cdFx0XHRcdFx0YXJnc1RvU2VuZFtpXSA9IHdvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soYXJnVmFsdWUpO1xyXG5cdFx0XHRcdH0gZWxzZSBpZiAoIWFyZ0Rlc2NyaXB0aW9uKSB7XHJcblx0XHRcdFx0XHRhcmdzVG9TZW5kW2ldID0gYXJnVmFsdWU7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdHRocm93ICdBc3luY1Byb3h5RmFjdG9yeSBlcnJvcjogVW5yZWNvZ25pemVkIGFyZ3VtZW50ICcgK1xyXG5cdFx0XHRcdFx0XHQnZGVzY3JpcHRpb24gJyArIGFyZ0Rlc2NyaXB0aW9uICsgJyBpbiBhcmd1bWVudCAnICtcclxuXHRcdFx0XHRcdFx0KGkgKyAxKSArICcgb2YgbWV0aG9kICcgKyBtZXRob2ROYW1lO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbihcclxuXHRcdFx0XHRtZXRob2ROYW1lLCBhcmdzVG9TZW5kLCBtZXRob2RBcmdzRGVzY3JpcHRpb25bMF0pO1xyXG5cdFx0fTtcclxuXHR9XHJcblx0XHJcblx0ZnVuY3Rpb24gY29udmVydEFyZ3MoYXJnc09iamVjdCkge1xyXG5cdFx0dmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJnc09iamVjdC5sZW5ndGgpO1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzT2JqZWN0Lmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdGFyZ3NbaV0gPSBhcmdzT2JqZWN0W2ldO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRyZXR1cm4gYXJncztcclxuXHR9XHJcbiAgICBcclxuICAgIHJldHVybiBmYWN0b3J5U2luZ2xldG9uO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5RmFjdG9yeTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBTY3JpcHRzVG9JbXBvcnRQb29sID0gcmVxdWlyZSgnc2NyaXB0cy10by1pbXBvcnQtcG9vbCcpO1xyXG5cclxudmFyIEFzeW5jUHJveHlNYXN0ZXIgPSAoZnVuY3Rpb24gQXN5bmNQcm94eU1hc3RlckNsb3N1cmUoKSB7XHJcbiAgICB2YXIgY2FsbElkID0gMDtcclxuICAgIHZhciBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkID0gZmFsc2U7XHJcbiAgICB2YXIgbWFzdGVyRW50cnlVcmwgPSBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIEFzeW5jUHJveHlNYXN0ZXIoc2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgY3RvckFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fY2FsbGJhY2tzID0gW107XHJcbiAgICAgICAgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxscyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3N1YldvcmtlckJ5SWQgPSBbXTtcclxuICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzID0gW107XHJcbiAgICAgICAgdGhhdC5fdXNlckRhdGFIYW5kbGVyID0gbnVsbDtcclxuICAgICAgICB0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA9IDA7XHJcbiAgICAgICAgdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSA9IG9wdGlvbnMuZnVuY3Rpb25zQnVmZmVyU2l6ZSB8fCA1O1xyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcyA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzY3JpcHROYW1lID0gZ2V0U2NyaXB0TmFtZSgpO1xyXG4gICAgICAgIHZhciBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcgPSBtYWluU2xhdmVTY3JpcHRDb250ZW50LnRvU3RyaW5nKCk7XHJcbiAgICAgICAgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nID0gc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nLnJlcGxhY2UoXHJcbiAgICAgICAgICAgICdTQ1JJUFRfUExBQ0VIT0xERVInLCBzY3JpcHROYW1lKTtcclxuICAgICAgICB2YXIgc2xhdmVTY3JpcHRDb250ZW50QmxvYiA9IG5ldyBCbG9iKFxyXG4gICAgICAgICAgICBbJygnLCBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcsICcpKCknXSxcclxuICAgICAgICAgICAgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XHJcbiAgICAgICAgdmFyIHNsYXZlU2NyaXB0VXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzbGF2ZVNjcmlwdENvbnRlbnRCbG9iKTtcclxuXHJcbiAgICAgICAgdGhhdC5fd29ya2VyID0gbmV3IFdvcmtlcihzbGF2ZVNjcmlwdFVybCk7XHJcbiAgICAgICAgdGhhdC5fd29ya2VyLm9ubWVzc2FnZSA9IG9uV29ya2VyTWVzc2FnZUludGVybmFsO1xyXG5cclxuICAgICAgICB0aGF0Ll93b3JrZXIucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ2N0b3InLFxyXG4gICAgICAgICAgICBzY3JpcHRzVG9JbXBvcnQ6IHNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgY3Rvck5hbWU6IGN0b3JOYW1lLFxyXG4gICAgICAgICAgICBhcmdzOiBjdG9yQXJncyxcclxuICAgICAgICAgICAgY2FsbElkOiArK2NhbGxJZCxcclxuICAgICAgICAgICAgaXNQcm9taXNlOiBmYWxzZSxcclxuICAgICAgICAgICAgbWFzdGVyRW50cnlVcmw6IEFzeW5jUHJveHlNYXN0ZXIuZ2V0RW50cnlVcmwoKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZUludGVybmFsKHdvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5zZXRVc2VyRGF0YUhhbmRsZXIgPSBmdW5jdGlvbiBzZXRVc2VyRGF0YUhhbmRsZXIodXNlckRhdGFIYW5kbGVyKSB7XHJcbiAgICAgICAgdGhpcy5fdXNlckRhdGFIYW5kbGVyID0gdXNlckRhdGFIYW5kbGVyO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIHRoaXMuX3dvcmtlci50ZXJtaW5hdGUoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3N1YldvcmtlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdGhpcy5fc3ViV29ya2Vyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5jYWxsRnVuY3Rpb24gPSBmdW5jdGlvbiBjYWxsRnVuY3Rpb24oZnVuY3Rpb25Ub0NhbGwsIGFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgaXNSZXR1cm5Qcm9taXNlID0gISFvcHRpb25zLmlzUmV0dXJuUHJvbWlzZTtcclxuICAgICAgICB2YXIgdHJhbnNmZXJhYmxlc0FyZyA9IG9wdGlvbnMudHJhbnNmZXJhYmxlcyB8fCBbXTtcclxuICAgICAgICB2YXIgcGF0aHNUb1RyYW5zZmVyYWJsZXMgPVxyXG4gICAgICAgICAgICBvcHRpb25zLnBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBsb2NhbENhbGxJZCA9ICsrY2FsbElkO1xyXG4gICAgICAgIHZhciBwcm9taXNlT25NYXN0ZXJTaWRlID0gbnVsbDtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmV0dXJuUHJvbWlzZSkge1xyXG4gICAgICAgICAgICBwcm9taXNlT25NYXN0ZXJTaWRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24gcHJvbWlzZUZ1bmMocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2xvY2FsQ2FsbElkXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlOiByZXNvbHZlLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdDogcmVqZWN0XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHNlbmRNZXNzYWdlRnVuY3Rpb24gPSBvcHRpb25zLmlzU2VuZEltbWVkaWF0ZWx5ID9cclxuICAgICAgICAgICAgc2VuZE1lc3NhZ2VUb1NsYXZlOiBlbnF1ZXVlTWVzc2FnZVRvU2xhdmU7XHJcblx0XHRcclxuXHRcdHZhciB0cmFuc2ZlcmFibGVzO1xyXG5cdFx0aWYgKHR5cGVvZiB0cmFuc2ZlcmFibGVzQXJnID09PSAnZnVuY3Rpb24nKSB7XHJcblx0XHRcdHRyYW5zZmVyYWJsZXMgPSB0cmFuc2ZlcmFibGVzQXJnKCk7XHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHR0cmFuc2ZlcmFibGVzID0gQXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdFx0dHJhbnNmZXJhYmxlc0FyZywgYXJncyk7XHJcblx0XHR9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VuZE1lc3NhZ2VGdW5jdGlvbih0aGlzLCB0cmFuc2ZlcmFibGVzLCAvKmlzRnVuY3Rpb25DYWxsPSovdHJ1ZSwge1xyXG4gICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogZnVuY3Rpb25Ub0NhbGwsXHJcbiAgICAgICAgICAgIGFyZ3M6IGFyZ3MgfHwgW10sXHJcbiAgICAgICAgICAgIGNhbGxJZDogbG9jYWxDYWxsSWQsXHJcbiAgICAgICAgICAgIGlzUHJvbWlzZTogaXNSZXR1cm5Qcm9taXNlLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdCA6IHBhdGhzVG9UcmFuc2ZlcmFibGVzXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmV0dXJuUHJvbWlzZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gcHJvbWlzZU9uTWFzdGVyU2lkZTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS53cmFwQ2FsbGJhY2sgPSBmdW5jdGlvbiB3cmFwQ2FsbGJhY2soXHJcbiAgICAgICAgY2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgb3B0aW9ucykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgIHZhciBsb2NhbENhbGxJZCA9ICsrY2FsbElkO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBjYWxsYmFja0hhbmRsZSA9IHtcclxuICAgICAgICAgICAgaXNXb3JrZXJIZWxwZXJDYWxsYmFjazogdHJ1ZSxcclxuICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogISFvcHRpb25zLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIGNhbGxJZDogbG9jYWxDYWxsSWQsXHJcbiAgICAgICAgICAgIGNhbGxiYWNrTmFtZTogY2FsbGJhY2tOYW1lLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGludGVybmFsQ2FsbGJhY2tIYW5kbGUgPSB7XHJcbiAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6ICEhb3B0aW9ucy5pc011bHRpcGxlVGltZUNhbGxiYWNrLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBjYWxsYmFjazogY2FsbGJhY2ssXHJcbiAgICAgICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzOiBvcHRpb25zLnBhdGhzVG9UcmFuc2ZlcmFibGVzXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9jYWxsYmFja3NbbG9jYWxDYWxsSWRdID0gaW50ZXJuYWxDYWxsYmFja0hhbmRsZTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gY2FsbGJhY2tIYW5kbGU7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5mcmVlQ2FsbGJhY2sgPSBmdW5jdGlvbiBmcmVlQ2FsbGJhY2soY2FsbGJhY2tIYW5kbGUpIHtcclxuICAgICAgICBkZWxldGUgdGhpcy5fY2FsbGJhY2tzW2NhbGxiYWNrSGFuZGxlLmNhbGxJZF07XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLyBTdGF0aWMgZnVuY3Rpb25zXHJcbiAgICBcclxuICAgIEFzeW5jUHJveHlNYXN0ZXIuZ2V0RW50cnlVcmwgPSBmdW5jdGlvbiBnZXRFbnRyeVVybCgpIHtcclxuICAgICAgICBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICByZXR1cm4gbWFzdGVyRW50cnlVcmw7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLl9zZXRFbnRyeVVybCA9IGZ1bmN0aW9uIHNldEVudHJ5VXJsKG5ld1VybCkge1xyXG4gICAgICAgIGlmIChtYXN0ZXJFbnRyeVVybCAhPT0gbmV3VXJsICYmIGlzR2V0TWFzdGVyRW50cnlVcmxDYWxsZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1ByZXZpb3VzIHZhbHVlcyByZXR1cm5lZCBmcm9tIGdldE1hc3RlckVudHJ5VXJsICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lzIHdyb25nLiBBdm9pZCBjYWxsaW5nIGl0IHdpdGhpbiB0aGUgc2xhdmUgY2B0b3InO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbWFzdGVyRW50cnlVcmwgPSBuZXdVcmw7XHJcbiAgICB9O1xyXG5cdFxyXG5cdEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzID0gZnVuY3Rpb24gZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdHBhdGhzVG9UcmFuc2ZlcmFibGVzLCBwYXRoc0Jhc2UpIHtcclxuXHRcdFxyXG4gICAgICAgIGlmIChwYXRoc1RvVHJhbnNmZXJhYmxlcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID0gbmV3IEFycmF5KHBhdGhzVG9UcmFuc2ZlcmFibGVzLmxlbmd0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoc1RvVHJhbnNmZXJhYmxlcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICB2YXIgcGF0aCA9IHBhdGhzVG9UcmFuc2ZlcmFibGVzW2ldO1xyXG4gICAgICAgICAgICB2YXIgdHJhbnNmZXJhYmxlID0gcGF0aHNCYXNlO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBwYXRoLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbWVtYmVyID0gcGF0aFtqXTtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZSA9IHRyYW5zZmVyYWJsZVttZW1iZXJdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0cmFuc2ZlcmFibGVzW2ldID0gdHJhbnNmZXJhYmxlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdHJhbnNmZXJhYmxlcztcclxuICAgIH07XHJcbiAgICBcclxuICAgIC8vIFByaXZhdGUgZnVuY3Rpb25zXHJcblx0XHJcblx0ZnVuY3Rpb24gZ2V0U2NyaXB0TmFtZSgpIHtcclxuICAgICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoKTtcclxuXHRcdHJldHVybiBTY3JpcHRzVG9JbXBvcnRQb29sLl9nZXRTY3JpcHROYW1lKGVycm9yKTtcclxuXHR9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG1haW5TbGF2ZVNjcmlwdENvbnRlbnQoKSB7XHJcblx0XHQvLyBUaGlzIGZ1bmN0aW9uIGlzIG5vdCBydW4gZGlyZWN0bHk6IEl0IGNvcGllZCBhcyBhIHN0cmluZyBpbnRvIGEgYmxvYlxyXG5cdFx0Ly8gYW5kIHJ1biBpbiB0aGUgV2ViIFdvcmtlciBnbG9iYWwgc2NvcGVcclxuXHRcdFxyXG5cdFx0LyogZ2xvYmFsIGltcG9ydFNjcmlwdHM6IGZhbHNlICovXHJcbiAgICAgICAgaW1wb3J0U2NyaXB0cygnU0NSSVBUX1BMQUNFSE9MREVSJyk7XHJcblx0XHQvKiBnbG9iYWwgYXN5bmNQcm94eTogZmFsc2UgKi9cclxuICAgICAgICBhc3luY1Byb3h5LkFzeW5jUHJveHlTbGF2ZS5faW5pdGlhbGl6ZVNsYXZlKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCkge1xyXG4gICAgICAgIHZhciBjYWxsSWQgPSB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZDtcclxuICAgICAgICBcclxuICAgICAgICBzd2l0Y2ggKHdvcmtlckV2ZW50LmRhdGEudHlwZSkge1xyXG4gICAgICAgICAgICBjYXNlICdmdW5jdGlvbkNhbGxlZCc6XHJcbiAgICAgICAgICAgICAgICAtLXRoYXQuX25vdFJldHVybmVkRnVuY3Rpb25zO1xyXG4gICAgICAgICAgICAgICAgdHJ5U2VuZFBlbmRpbmdNZXNzYWdlcyh0aGF0KTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAncHJvbWlzZVJlc3VsdCc6XHJcbiAgICAgICAgICAgICAgICB2YXIgcHJvbWlzZVRvUmVzb2x2ZSA9IHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHNbY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSB3b3JrZXJFdmVudC5kYXRhLnJlc3VsdDtcclxuICAgICAgICAgICAgICAgIHByb21pc2VUb1Jlc29sdmUucmVzb2x2ZShyZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3Byb21pc2VGYWlsdXJlJzpcclxuICAgICAgICAgICAgICAgIHZhciBwcm9taXNlVG9SZWplY3QgPSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgcmVhc29uID0gd29ya2VyRXZlbnQuZGF0YS5yZWFzb247XHJcbiAgICAgICAgICAgICAgICBwcm9taXNlVG9SZWplY3QucmVqZWN0KHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAndXNlckRhdGEnOlxyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX3VzZXJEYXRhSGFuZGxlciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoYXQuX3VzZXJEYXRhSGFuZGxlcih3b3JrZXJFdmVudC5kYXRhLnVzZXJEYXRhKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdjYWxsYmFjayc6XHJcbiAgICAgICAgICAgICAgICB2YXIgY2FsbGJhY2tIYW5kbGUgPSB0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBtZXNzYWdlIGZyb20gU2xhdmVXb3JrZXIgb2YgY2FsbGJhY2sgSUQ6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZCArICcuIE1heWJlIHNob3VsZCBpbmRpY2F0ZSAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ2lzTXVsdGlwbGVUaW1lc0NhbGxiYWNrID0gdHJ1ZSBvbiBjcmVhdGlvbj8nO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIWNhbGxiYWNrSGFuZGxlLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LmZyZWVDYWxsYmFjayh0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlLmNhbGxiYWNrICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tIYW5kbGUuY2FsbGJhY2suYXBwbHkobnVsbCwgd29ya2VyRXZlbnQuZGF0YS5hcmdzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJDdG9yJzpcclxuICAgICAgICAgICAgICAgIHZhciBzdWJXb3JrZXJDcmVhdGVkID0gbmV3IFdvcmtlcih3b3JrZXJFdmVudC5kYXRhLnNjcmlwdFVybCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgaWQgPSB3b3JrZXJFdmVudC5kYXRhLnN1YldvcmtlcklkO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJCeUlkW2lkXSA9IHN1YldvcmtlckNyZWF0ZWQ7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzLnB1c2goc3ViV29ya2VyQ3JlYXRlZCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1YldvcmtlckNyZWF0ZWQub25tZXNzYWdlID0gZnVuY3Rpb24gb25TdWJXb3JrZXJNZXNzYWdlKHN1YldvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZW5xdWV1ZU1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGF0LCBzdWJXb3JrZXJFdmVudC5wb3J0cywgLyppc0Z1bmN0aW9uQ2FsbD0qL2ZhbHNlLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ3N1Yldvcmtlck9uTWVzc2FnZScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJXb3JrZXJJZDogaWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiBzdWJXb3JrZXJFdmVudC5kYXRhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJQb3N0TWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9Qb3N0TWVzc2FnZSA9IHRoYXQuX3N1YldvcmtlckJ5SWRbd29ya2VyRXZlbnQuZGF0YS5zdWJXb3JrZXJJZF07XHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXJUb1Bvc3RNZXNzYWdlLnBvc3RNZXNzYWdlKHdvcmtlckV2ZW50LmRhdGEuZGF0YSk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1YldvcmtlclRlcm1pbmF0ZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9UZXJtaW5hdGUgPSB0aGF0Ll9zdWJXb3JrZXJCeUlkW3dvcmtlckV2ZW50LmRhdGEuc3ViV29ya2VySWRdO1xyXG4gICAgICAgICAgICAgICAgc3ViV29ya2VyVG9UZXJtaW5hdGUudGVybWluYXRlKCk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnVW5rbm93biBtZXNzYWdlIGZyb20gQXN5bmNQcm94eVNsYXZlIG9mIHR5cGU6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckV2ZW50LmRhdGEudHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVucXVldWVNZXNzYWdlVG9TbGF2ZShcclxuICAgICAgICB0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA+PSB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplKSB7XHJcbiAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXM6IHRyYW5zZmVyYWJsZXMsXHJcbiAgICAgICAgICAgICAgICBpc0Z1bmN0aW9uQ2FsbDogaXNGdW5jdGlvbkNhbGwsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBtZXNzYWdlXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbmRNZXNzYWdlVG9TbGF2ZSh0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgICAgICAgXHJcbiAgICBmdW5jdGlvbiBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgdGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNGdW5jdGlvbkNhbGwpIHtcclxuICAgICAgICAgICAgKyt0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fd29ya2VyLnBvc3RNZXNzYWdlKG1lc3NhZ2UsIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0cnlTZW5kUGVuZGluZ01lc3NhZ2VzKHRoYXQpIHtcclxuICAgICAgICB3aGlsZSAodGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPCB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplICYmXHJcbiAgICAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgbWVzc2FnZSA9IHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5zaGlmdCgpO1xyXG4gICAgICAgICAgICBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgICAgICAgICB0aGF0LFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS50cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS5pc0Z1bmN0aW9uQ2FsbCxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCkge1xyXG4gICAgICAgIHZhciBiYXNlVXJsID0gbG9jYXRpb24uaHJlZjtcclxuICAgICAgICB2YXIgZW5kT2ZQYXRoID0gYmFzZVVybC5sYXN0SW5kZXhPZignLycpO1xyXG4gICAgICAgIGlmIChlbmRPZlBhdGggPj0gMCkge1xyXG4gICAgICAgICAgICBiYXNlVXJsID0gYmFzZVVybC5zdWJzdHJpbmcoMCwgZW5kT2ZQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGJhc2VVcmw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBBc3luY1Byb3h5TWFzdGVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5TWFzdGVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XHJcbnZhciBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgPSByZXF1aXJlKCdzdWItd29ya2VyLWVtdWxhdGlvbi1mb3ItY2hyb21lJyk7XHJcblxyXG52YXIgQXN5bmNQcm94eVNsYXZlID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlTbGF2ZUNsb3N1cmUoKSB7XHJcbiAgICB2YXIgc2xhdmVIZWxwZXJTaW5nbGV0b24gPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID0gbnVsbDtcclxuICAgIHZhciBzbGF2ZVNpZGVNYWluSW5zdGFuY2U7XHJcbiAgICB2YXIgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gZGVmYXVsdEluc3RhbmNlQ3JlYXRvcjtcclxuICAgIHZhciBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0ge307XHJcbiAgICB2YXIgY3Rvck5hbWU7XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLl9pbml0aWFsaXplU2xhdmUgPSBmdW5jdGlvbiBpbml0aWFsaXplU2xhdmUoKSB7XHJcbiAgICAgICAgc2VsZi5vbm1lc3NhZ2UgPSBvbk1lc3NhZ2U7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZXRTbGF2ZVNpZGVDcmVhdG9yID0gZnVuY3Rpb24gc2V0U2xhdmVTaWRlQ3JlYXRvcihjcmVhdG9yKSB7XHJcbiAgICAgICAgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gY3JlYXRvcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLnNldEJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID1cclxuICAgICAgICBmdW5jdGlvbiBzZXRCZWZvcmVPcGVyYXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgICAgICAgICBiZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9IGxpc3RlbmVyO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZW5kVXNlckRhdGFUb01hc3RlciA9IGZ1bmN0aW9uIHNlbmRVc2VyRGF0YVRvTWFzdGVyKFxyXG4gICAgICAgIHVzZXJEYXRhKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICd1c2VyRGF0YScsXHJcbiAgICAgICAgICAgIHVzZXJEYXRhOiB1c2VyRGF0YVxyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24ud3JhcFByb21pc2VGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwUHJvbWlzZUZyb21TbGF2ZVNpZGUoXHJcbiAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXMpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgcHJvbWlzZVRoZW4gPSBwcm9taXNlLnRoZW4oZnVuY3Rpb24gc2VuZFByb21pc2VUb01hc3RlcihyZXN1bHQpIHtcclxuICAgICAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXMgPVxyXG5cdFx0XHRcdEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG5cdFx0XHRcdFx0cGF0aHNUb1RyYW5zZmVyYWJsZXMsIHJlc3VsdCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwcm9taXNlUmVzdWx0JyxcclxuICAgICAgICAgICAgICAgICAgICBjYWxsSWQ6IGNhbGxJZCxcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHByb21pc2VUaGVuWydjYXRjaCddKGZ1bmN0aW9uIHNlbmRGYWlsdXJlVG9NYXN0ZXIocmVhc29uKSB7XHJcbiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgICAgdHlwZTogJ3Byb21pc2VGYWlsdXJlJyxcclxuICAgICAgICAgICAgICAgIGNhbGxJZDogY2FsbElkLFxyXG4gICAgICAgICAgICAgICAgcmVhc29uOiByZWFzb25cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlKGNhbGxiYWNrSGFuZGxlKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHZhciBpc0FscmVhZHlDYWxsZWQgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBjYWxsYmFja1dyYXBwZXJGcm9tU2xhdmVTaWRlKCkge1xyXG4gICAgICAgICAgICBpZiAoaXNBbHJlYWR5Q2FsbGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnQ2FsbGJhY2sgaXMgY2FsbGVkIHR3aWNlIGJ1dCBpc011bHRpcGxlVGltZUNhbGxiYWNrICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICc9IGZhbHNlJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGFyZ3VtZW50c0FzQXJyYXkgPSBnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgIT09IG51bGwpIHtcclxuXHRcdFx0XHR0cnkge1xyXG5cdFx0XHRcdFx0YmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIuY2FsbChcclxuXHRcdFx0XHRcdFx0c2xhdmVTaWRlTWFpbkluc3RhbmNlLFxyXG5cdFx0XHRcdFx0XHQnY2FsbGJhY2snLFxyXG5cdFx0XHRcdFx0XHRjYWxsYmFja0hhbmRsZS5jYWxsYmFja05hbWUsXHJcblx0XHRcdFx0XHRcdGFyZ3VtZW50c0FzQXJyYXkpO1xyXG5cdFx0XHRcdH0gY2F0Y2ggKGUpIHtcclxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKCdBc3luY1Byb3h5U2xhdmUuYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgaGFzIHRocm93biBhbiBleGNlcHRpb246ICcgKyBlKTtcclxuXHRcdFx0XHR9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID1cclxuXHRcdFx0XHRBc3luY1Byb3h5TWFzdGVyLl9leHRyYWN0VHJhbnNmZXJhYmxlcyhcclxuXHRcdFx0XHRcdGNhbGxiYWNrSGFuZGxlLnBhdGhzVG9UcmFuc2ZlcmFibGVzLCBhcmd1bWVudHNBc0FycmF5KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdjYWxsYmFjaycsXHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbElkOiBjYWxsYmFja0hhbmRsZS5jYWxsSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnczogYXJndW1lbnRzQXNBcnJheVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKCFjYWxsYmFja0hhbmRsZS5pc011bHRpcGxlVGltZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICBpc0FscmVhZHlDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBjYWxsYmFja1dyYXBwZXJGcm9tU2xhdmVTaWRlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gb25NZXNzYWdlKGV2ZW50KSB7XHJcbiAgICAgICAgdmFyIGZ1bmN0aW9uTmFtZVRvQ2FsbCA9IGV2ZW50LmRhdGEuZnVuY3Rpb25Ub0NhbGw7XHJcbiAgICAgICAgdmFyIGFyZ3MgPSBldmVudC5kYXRhLmFyZ3M7XHJcbiAgICAgICAgdmFyIGNhbGxJZCA9IGV2ZW50LmRhdGEuY2FsbElkO1xyXG4gICAgICAgIHZhciBpc1Byb21pc2UgPSBldmVudC5kYXRhLmlzUHJvbWlzZTtcclxuICAgICAgICB2YXIgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQgPVxyXG4gICAgICAgICAgICBldmVudC5kYXRhLnBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciByZXN1bHQgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN3aXRjaCAoZnVuY3Rpb25OYW1lVG9DYWxsKSB7XHJcbiAgICAgICAgICAgIGNhc2UgJ2N0b3InOlxyXG4gICAgICAgICAgICAgICAgQXN5bmNQcm94eU1hc3Rlci5fc2V0RW50cnlVcmwoZXZlbnQuZGF0YS5tYXN0ZXJFbnRyeVVybCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciBzY3JpcHRzVG9JbXBvcnQgPSBldmVudC5kYXRhLnNjcmlwdHNUb0ltcG9ydDtcclxuICAgICAgICAgICAgICAgIGN0b3JOYW1lID0gZXZlbnQuZGF0YS5jdG9yTmFtZTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzY3JpcHRzVG9JbXBvcnQubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHRcdC8qIGdsb2JhbCBpbXBvcnRTY3JpcHRzOiBmYWxzZSAqL1xyXG4gICAgICAgICAgICAgICAgICAgIGltcG9ydFNjcmlwdHMoc2NyaXB0c1RvSW1wb3J0W2ldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgc2xhdmVTaWRlTWFpbkluc3RhbmNlID0gc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yLmFwcGx5KG51bGwsIGFyZ3MpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1Yldvcmtlck9uTWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyID0gc3ViV29ya2VySWRUb1N1YldvcmtlcltldmVudC5kYXRhLnN1YldvcmtlcklkXTtcclxuICAgICAgICAgICAgICAgIHZhciB3b3JrZXJFdmVudCA9IHsgZGF0YTogZXZlbnQuZGF0YS5kYXRhIH07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1Yldvcmtlci5vbm1lc3NhZ2Uod29ya2VyRXZlbnQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGFyZ3MgPSBuZXcgQXJyYXkoZXZlbnQuZGF0YS5hcmdzLmxlbmd0aCk7XHJcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBldmVudC5kYXRhLmFyZ3MubGVuZ3RoOyArK2opIHtcclxuICAgICAgICAgICAgdmFyIGFyZyA9IGV2ZW50LmRhdGEuYXJnc1tqXTtcclxuICAgICAgICAgICAgaWYgKGFyZyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgICAgICAgICBhcmcgIT09IG51bGwgJiZcclxuICAgICAgICAgICAgICAgIGFyZy5pc1dvcmtlckhlbHBlckNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGFyZyA9IHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBDYWxsYmFja0Zyb21TbGF2ZVNpZGUoYXJnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXJnc1tqXSA9IGFyZztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGZ1bmN0aW9uQ29udGFpbmVyID0gc2xhdmVTaWRlTWFpbkluc3RhbmNlO1xyXG4gICAgICAgIHZhciBmdW5jdGlvblRvQ2FsbDtcclxuICAgICAgICB3aGlsZSAoZnVuY3Rpb25Db250YWluZXIpIHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGwgPSBzbGF2ZVNpZGVNYWluSW5zdGFuY2VbZnVuY3Rpb25OYW1lVG9DYWxsXTtcclxuICAgICAgICAgICAgaWYgKGZ1bmN0aW9uVG9DYWxsKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG5cdFx0XHQvKiBqc2hpbnQgcHJvdG86IHRydWUgKi9cclxuICAgICAgICAgICAgZnVuY3Rpb25Db250YWluZXIgPSBmdW5jdGlvbkNvbnRhaW5lci5fX3Byb3RvX187XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghZnVuY3Rpb25Ub0NhbGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkgZXJyb3I6IGNvdWxkIG5vdCBmaW5kIGZ1bmN0aW9uICcgKyBmdW5jdGlvbk5hbWVUb0NhbGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBwcm9taXNlID0gZnVuY3Rpb25Ub0NhbGwuYXBwbHkoc2xhdmVTaWRlTWFpbkluc3RhbmNlLCBhcmdzKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNQcm9taXNlKSB7XHJcbiAgICAgICAgICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBQcm9taXNlRnJvbVNsYXZlU2lkZShcclxuICAgICAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdmdW5jdGlvbkNhbGxlZCcsXHJcbiAgICAgICAgICAgIGNhbGxJZDogZXZlbnQuZGF0YS5jYWxsSWQsXHJcbiAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGRlZmF1bHRJbnN0YW5jZUNyZWF0b3IoKSB7XHJcbiAgICAgICAgdmFyIGluc3RhbmNlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHZhciBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUgPSBjdG9yTmFtZS5zcGxpdCgnLicpO1xyXG4gICAgICAgICAgICB2YXIgbWVtYmVyID0gc2VsZjtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUubGVuZ3RoOyArK2kpXHJcbiAgICAgICAgICAgICAgICBtZW1iZXIgPSBtZW1iZXJbbmFtZXNwYWNlc0FuZEN0b3JOYW1lW2ldXTtcclxuICAgICAgICAgICAgdmFyIFR5cGVDdG9yID0gbWVtYmVyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGJpbmRBcmdzID0gW251bGxdLmNvbmNhdChnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cykpO1xyXG4gICAgICAgICAgICBpbnN0YW5jZSA9IG5ldyAoRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQuYXBwbHkoVHlwZUN0b3IsIGJpbmRBcmdzKSkoKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIGxvY2F0aW5nIGNsYXNzIG5hbWUgJyArIGN0b3JOYW1lICsgJzogJyArIGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGdldEFyZ3VtZW50c0FzQXJyYXkoYXJncykge1xyXG4gICAgICAgIHZhciBhcmd1bWVudHNBc0FycmF5ID0gbmV3IEFycmF5KGFyZ3MubGVuZ3RoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgYXJndW1lbnRzQXNBcnJheVtpXSA9IGFyZ3NbaV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBhcmd1bWVudHNBc0FycmF5O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5Xb3JrZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5pbml0aWFsaXplKHN1YldvcmtlcklkVG9TdWJXb3JrZXIpO1xyXG4gICAgICAgIHNlbGYuV29ya2VyID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gc2xhdmVIZWxwZXJTaW5nbGV0b247XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEFzeW5jUHJveHlTbGF2ZTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gcmVxdWlyZSgnanMtYnVpbHRpbi1oYXNoLW1hcCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dCA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dENsb3N1cmUoKSB7XHJcblx0ZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQoKSB7XHJcbiAgICAgICAgLy8gVGhpcyBjbGFzcyBpcyBub3QgZXhwb3NlZCBvdXRzaWRlIEFzeW5jUHJveHksIEkgYWxsb3dlZCBteXNlbGYgdG9cclxuICAgICAgICAvLyB1c2UgcHVibGljIG1lbWJlcnNcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmlzVGVybWluYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMucHJpb3JpdHkgPSAwO1xyXG4gICAgICAgIHRoaXMubGFzdFByb2Nlc3NlZERhdGEgPSBudWxsO1xyXG5cdFx0dGhpcy50YXNrQXBpID0gbnVsbDtcclxuICAgICAgICB0aGlzLmhhc1Byb2Nlc3NlZERhdGEgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLmlzUGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyID0gbnVsbDtcclxuICAgICAgICB0aGlzLnBlbmRpbmdXb3JrZXJUeXBlID0gMDtcclxuICAgICAgICBcclxuICAgICAgICAvL3RoaXMudGFza0NvbnRleHQgPSBudWxsO1xyXG4gICAgICAgIHRoaXMudGFza0hhbmRsZXMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0tleSA9IG51bGw7XHJcblx0XHR0aGlzLl9pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCA9IDA7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0ID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9wYXJlbnRJdGVyYXRvciA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzID0gbnVsbDtcclxuXHRcdFxyXG5cdFx0dGhpcy5fZGVwZW5kVGFza0tleXMgPSBbXTtcclxuXHRcdHRoaXMuX2RlcGVuZFRhc2tSZXN1bHRzID0gW107XHJcblx0XHR0aGlzLl9oYXNEZXBlbmRUYXNrRGF0YSA9IFtdO1xyXG5cdFx0XHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IGZhbHNlO1xyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YSA9IFtdO1xyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCA9IGZhbHNlO1xyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhID0gZmFsc2U7XHJcblx0XHR0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zQm91bmQgPSB0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zLmJpbmQodGhpcyk7XHJcblx0fVxyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKFxyXG4gICAgICAgICAgICB0YXNrS2V5LCBkZXBlbmRlbmN5V29ya2VycywgaW5wdXRSZXRyZWl2ZXIsIGxpc3QsIGl0ZXJhdG9yIC8qLCBoYXNoZXIqLykge1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy50YXNrS2V5ID0gdGFza0tleTtcclxuICAgICAgICB0aGlzLl9wYXJlbnREZXBlbmRlbmN5V29ya2VycyA9IGRlcGVuZGVuY3lXb3JrZXJzO1xyXG4gICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50TGlzdCA9IGxpc3Q7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50SXRlcmF0b3IgPSBpdGVyYXRvcjtcclxuICAgICAgICAvL3RoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcyA9IG5ldyBIYXNoTWFwKGhhc2hlcik7XHJcbiAgICAgICAgdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzID0gbmV3IEpzQnVpbHRpbkhhc2hNYXAoKTtcclxuXHRcdHRoaXMudGFza0FwaSA9IG5ldyBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sodGhpcywgdGFza0tleSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUuZW5kZWQgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0LnJlbW92ZSh0aGlzLl9wYXJlbnRJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50SXRlcmF0b3IgPSBudWxsO1xyXG5cclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgaGFuZGxlID0gdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcikudGFza0hhbmRsZTtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGhhbmRsZS51bnJlZ2lzdGVyKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcy5jbGVhcigpO1xyXG5cclxuXHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkRW5kZWQgPSB0cnVlO1xyXG5cdFx0aWYgKCF0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbikge1xyXG5cdFx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IHRydWU7XHJcblx0XHRcdHNldFRpbWVvdXQodGhpcy5fcGVyZm9ybVBlbmRpbmdEZWxheWVkQWN0aW9uc0JvdW5kKTtcclxuXHRcdH1cclxuICAgIH07XHJcblx0XHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUuc2V0UHJpb3JpdHlBbmROb3RpZnkgPSBmdW5jdGlvbihcclxuICAgICAgICAgICAgbmV3UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLnByaW9yaXR5ID09PSBuZXdQcmlvcml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMucHJpb3JpdHkgPSBuZXdQcmlvcml0eTtcclxuICAgICAgICB0aGlzLnN0YXR1c1VwZGF0ZSgpO1xyXG5cclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgaGFuZGxlID0gdGhpcy5fZGVwZW5kc1Rhc2tIYW5kbGVzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcikudGFza0hhbmRsZTtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0hhbmRsZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGhhbmRsZS5zZXRQcmlvcml0eShuZXdQcmlvcml0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLnN0YXR1c1VwZGF0ZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHZhciBzdGF0dXMgPSB7XHJcbiAgICAgICAgICAgICdwcmlvcml0eSc6IHRoaXMucHJpb3JpdHksXHJcbiAgICAgICAgICAgICdoYXNMaXN0ZW5lcnMnOiB0aGlzLnRhc2tIYW5kbGVzLmdldENvdW50KCkgPiAwLFxyXG4gICAgICAgICAgICAnaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0JzogdGhpcy53YWl0aW5nRm9yV29ya2VyUmVzdWx0LFxyXG4gICAgICAgICAgICAndGVybWluYXRlZERlcGVuZHNUYXNrcyc6IHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCxcclxuICAgICAgICAgICAgJ2RlcGVuZHNUYXNrcyc6IHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcy5nZXRDb3VudCgpXHJcbiAgICAgICAgfTtcclxuICAgICAgICB0aGlzLnRhc2tBcGkuX29uRXZlbnQoJ3N0YXR1c1VwZGF0ZWQnLCBzdGF0dXMpO1xyXG5cclxuXHRcdGlmICh0aGlzLl9pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyAmJiAhdGhpcy53YWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcblx0XHRcdHRoaXMuX2lzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gZmFsc2U7XHJcblx0XHRcdHRoaXMuZW5kZWQoKTtcclxuXHRcdH1cclxuXHR9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUucmVjYWxjdWxhdGVQcmlvcml0eSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHZhciBoYW5kbGVzID0gdGhpcy50YXNrSGFuZGxlcztcclxuICAgICAgICBcclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSBoYW5kbGVzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB2YXIgaXNGaXJzdCA9IHRydWU7XHJcbiAgICAgICAgdmFyIG5ld1ByaW9yaXR5ID0gMDtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGhhbmRsZSA9IGhhbmRsZXMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgaWYgKGlzRmlyc3QgfHwgaGFuZGxlLl9sb2NhbFByaW9yaXR5ID4gbmV3UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgICAgIG5ld1ByaW9yaXR5ID0gaGFuZGxlLl9sb2NhbFByaW9yaXR5O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gaGFuZGxlcy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIG5ld1ByaW9yaXR5O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLm5ld0RhdGEgPSBmdW5jdGlvbihkYXRhKSB7XHJcbiAgICAgICAgdGhpcy5oYXNQcm9jZXNzZWREYXRhID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLmxhc3RQcm9jZXNzZWREYXRhID0gZGF0YTtcclxuICAgICAgICBcclxuXHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkTmV3RGF0YSA9IHRydWU7XHJcblx0XHRpZiAoIXRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uKSB7XHJcblx0XHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gdHJ1ZTtcclxuXHRcdFx0c2V0VGltZW91dCh0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zQm91bmQpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuICAgIFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0LnByb3RvdHlwZS5kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkobmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSkge1xyXG5cdFx0aWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcblx0XHRcdHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHRlcm1pbmF0ZWQnO1xyXG5cdFx0fSBlbHNlIGlmICh0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuXHRcdFx0Ly8gVXNlZCBpbiBEZXBlbmRlbmN5V29ya2Vycy5fc3RhcnRXb3JrZXIoKSB3aGVuIHByZXZpb3VzIHdvcmtlciBoYXMgZmluaXNoZWRcclxuXHRcdFx0dGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IG5ld0RhdGFUb1Byb2Nlc3M7XHJcblx0XHRcdHRoaXMuaXNQZW5kaW5nRGF0YUZvcldvcmtlciA9IHRydWU7XHJcblx0XHRcdHRoaXMucGVuZGluZ1dvcmtlclR5cGUgPSB3b3JrZXJUeXBlO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0dGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMuX2RhdGFSZWFkeShcclxuXHRcdFx0XHR0aGlzLCBuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKTtcclxuXHRcdH1cclxuXHR9O1xyXG5cclxuICAgIERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0LnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHRlcm1pbmF0ZWQnO1xyXG4gICAgICAgIH1cclxuXHRcdFxyXG4gICAgICAgIHRoaXMuaXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuXHRcdGlmICh0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuICAgICAgICAgICAgdGhpcy5faXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcblx0XHRcdHRoaXMuZW5kZWQoKTtcclxuXHRcdH1cclxuICAgIH07XHJcblx0XHJcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0LnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tLZXlzJywge1xyXG5cdFx0Z2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX2RlcGVuZFRhc2tLZXlzO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG5cdFxyXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUsICdkZXBlbmRUYXNrUmVzdWx0cycsIHtcclxuXHRcdGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza1Jlc3VsdHMoKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLl9kZXBlbmRUYXNrUmVzdWx0cztcclxuXHRcdH1cclxuXHR9KTtcclxuXHRcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0LnByb3RvdHlwZS5yZWdpc3RlclRhc2tEZXBlbmRlbmN5ID0gZnVuY3Rpb24oXHJcbiAgICAgICAgICAgIHRhc2tLZXkpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc3RyS2V5ID0gdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcodGFza0tleSk7XHJcbiAgICAgICAgdmFyIGFkZFJlc3VsdCA9IHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcy50cnlBZGQoc3RyS2V5LCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgdGFza0hhbmRsZTogbnVsbCB9O1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghYWRkUmVzdWx0LmlzTmV3KSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBDYW5ub3QgYWRkIHRhc2sgZGVwZW5kZW5jeSB0d2ljZSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB2YXIgZ290RGF0YSA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBpc1Rlcm1pbmF0ZWQgPSBmYWxzZTtcclxuXHRcdHZhciBpbmRleCA9IHRoaXMuX2RlcGVuZFRhc2tLZXlzLmxlbmd0aDtcclxuXHRcdFxyXG5cdFx0dGhpcy5fZGVwZW5kVGFza0tleXNbaW5kZXhdID0gdGFza0tleTtcclxuICAgICAgICBcclxuICAgICAgICBhZGRSZXN1bHQudmFsdWUudGFza0hhbmRsZSA9IHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzLnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgdGFza0tleSwge1xyXG4gICAgICAgICAgICAgICAgJ29uRGF0YSc6IG9uRGVwZW5kZW5jeVRhc2tEYXRhLFxyXG4gICAgICAgICAgICAgICAgJ29uVGVybWluYXRlZCc6IG9uRGVwZW5kZW5jeVRhc2tUZXJtaW5hdGVkXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgIFxyXG5cdFx0aWYgKCFnb3REYXRhICYmIGFkZFJlc3VsdC52YWx1ZS50YXNrSGFuZGxlLmhhc0RhdGEoKSkge1xyXG5cdFx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLnB1c2goe1xyXG5cdFx0XHRcdGRhdGE6IGFkZFJlc3VsdC52YWx1ZS50YXNrSGFuZGxlLmdldExhc3REYXRhKCksXHJcblx0XHRcdFx0b25EZXBlbmRlbmN5VGFza0RhdGE6IG9uRGVwZW5kZW5jeVRhc2tEYXRhXHJcblx0XHRcdH0pO1xyXG5cdFx0XHRpZiAoIXRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uKSB7XHJcblx0XHRcdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSB0cnVlO1xyXG5cdFx0XHRcdHNldFRpbWVvdXQodGhpcy5fcGVyZm9ybVBlbmRpbmdEZWxheWVkQWN0aW9uc0JvdW5kKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uRGVwZW5kZW5jeVRhc2tEYXRhKGRhdGEpIHtcclxuXHRcdFx0dGhhdC5fZGVwZW5kVGFza1Jlc3VsdHNbaW5kZXhdID0gZGF0YTtcclxuXHRcdFx0dGhhdC5faGFzRGVwZW5kVGFza0RhdGFbaW5kZXhdID0gdHJ1ZTtcclxuXHRcdFx0dGhhdC50YXNrQXBpLl9vbkV2ZW50KCdkZXBlbmRlbmN5VGFza0RhdGEnLCBkYXRhLCB0YXNrS2V5KTtcclxuICAgICAgICAgICAgZ290RGF0YSA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uRGVwZW5kZW5jeVRhc2tUZXJtaW5hdGVkKCkge1xyXG4gICAgICAgICAgICBpZiAoaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogRG91YmxlIHRlcm1pbmF0aW9uJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpc1Rlcm1pbmF0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGF0Ll9kZXBlbmRzVGFza1Rlcm1pbmF0ZWQoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dC5wcm90b3R5cGUuX2RlcGVuZHNUYXNrVGVybWluYXRlZCA9IGZ1bmN0aW9uIGRlcGVuZHNUYXNrVGVybWluYXRlZCgpIHtcclxuICAgICAgICArK3RoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudDtcclxuXHRcdGlmICh0aGlzLl9kZXBlbmRzVGFza3NUZXJtaW5hdGVkQ291bnQgPT09IHRoaXMuX2RlcGVuZHNUYXNrSGFuZGxlcy5nZXRDb3VudCgpKSB7XHJcblx0XHRcdHRoaXMudGFza0FwaS5fb25FdmVudCgnYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJyk7XHJcblx0XHR9XHJcbiAgICAgICAgdGhpcy5zdGF0dXNVcGRhdGUoKTtcclxuICAgIH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQucHJvdG90eXBlLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zID0gZnVuY3Rpb24oKSB7XHJcblx0XHR2YXIgaXRlcmF0b3I7XHJcblx0XHR2YXIgaGFuZGxlO1xyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSBmYWxzZTtcclxuXHRcdFxyXG5cdFx0aWYgKHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGEubGVuZ3RoID4gMCkge1xyXG5cdFx0XHR2YXIgbG9jYWxMaXN0ZW5lcnMgPSB0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhO1xyXG5cdFx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhID0gW107XHJcblx0XHRcdFxyXG5cdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IGxvY2FsTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0bG9jYWxMaXN0ZW5lcnNbaV0ub25EZXBlbmRlbmN5VGFza0RhdGEobG9jYWxMaXN0ZW5lcnNbaV0uZGF0YSk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0aWYgKHRoaXMuX3BlbmRpbmdEZWxheWVkTmV3RGF0YSkge1xyXG5cdFx0XHR2YXIgaGFuZGxlcyA9IHRoaXMudGFza0hhbmRsZXM7XHJcblx0XHRcdGl0ZXJhdG9yID0gaGFuZGxlcy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcblx0XHRcdHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG5cdFx0XHRcdGhhbmRsZSA9IGhhbmRsZXMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHRcdFx0XHRpdGVyYXRvciA9IGhhbmRsZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHRoYW5kbGUuX2NhbGxiYWNrcy5vbkRhdGEodGhpcy5sYXN0UHJvY2Vzc2VkRGF0YSwgdGhpcy50YXNrS2V5KTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCkge1xyXG5cdFx0XHRpdGVyYXRvciA9IHRoaXMudGFza0hhbmRsZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG5cdFx0XHR3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuXHRcdFx0XHRoYW5kbGUgPSB0aGlzLnRhc2tIYW5kbGVzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcblx0XHRcdFx0aXRlcmF0b3IgPSB0aGlzLnRhc2tIYW5kbGVzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcblxyXG5cdFx0XHRcdGlmIChoYW5kbGUuX2NhbGxiYWNrcy5vblRlcm1pbmF0ZWQpIHtcclxuXHRcdFx0XHRcdGhhbmRsZS5fY2FsbGJhY2tzLm9uVGVybWluYXRlZCgpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0dGhpcy50YXNrSGFuZGxlcy5jbGVhcigpO1xyXG5cdFx0fVxyXG5cdH07XHJcblx0XHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQ7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzSW50ZXJuYWxDb250ZXh0OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tIYW5kbGUgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZShpbnRlcm5hbENvbnRleHQsIGNhbGxiYWNrcykge1xyXG4gICAgICAgIHRoaXMuX2ludGVybmFsQ29udGV4dCA9IGludGVybmFsQ29udGV4dDtcclxuICAgICAgICB0aGlzLl9sb2NhbFByaW9yaXR5ID0gMDtcclxuICAgICAgICB0aGlzLl9jYWxsYmFja3MgPSBjYWxsYmFja3M7XHJcbiAgICAgICAgdGhpcy5fdGFza0hhbmRsZXNJdGVyYXRvciA9IGludGVybmFsQ29udGV4dC50YXNrSGFuZGxlcy5hZGQodGhpcyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZS5wcm90b3R5cGUuaGFzRGF0YSA9IGZ1bmN0aW9uIGhhc0RhdGEoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2ludGVybmFsQ29udGV4dC5oYXNQcm9jZXNzZWREYXRhO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlLnByb3RvdHlwZS5nZXRMYXN0RGF0YSA9IGZ1bmN0aW9uIGdldExhc3REYXRhKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnRlcm5hbENvbnRleHQubGFzdFByb2Nlc3NlZERhdGE7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tIYW5kbGUucHJvdG90eXBlLnNldFByaW9yaXR5ID0gZnVuY3Rpb24ocHJpb3JpdHkpIHtcclxuICAgICAgICBpZiAoIXRoaXMuX3Rhc2tIYW5kbGVzSXRlcmF0b3IpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IEFscmVhZHkgdW5yZWdpc3RlcmVkJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciBuZXdQcmlvcml0eTtcclxuICAgICAgICBpZiAocHJpb3JpdHkgPiB0aGlzLl9pbnRlcm5hbENvbnRleHQucHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgbmV3UHJpb3JpdHkgPSBwcmlvcml0eTtcclxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2xvY2FsUHJpb3JpdHkgPCB0aGlzLl9pbnRlcm5hbENvbnRleHQucHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgbmV3UHJpb3JpdHkgPSB0aGlzLl9pbnRlcm5hbENvbnRleHQucHJpb3JpdHk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbmV3UHJpb3JpdHkgPSB0aGlzLl9pbnRlcm5hbENvbnRleHQucmVjYWxjdWxhdGVQcmlvcml0eSgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9pbnRlcm5hbENvbnRleHQuc2V0UHJpb3JpdHlBbmROb3RpZnkobmV3UHJpb3JpdHkpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlLnByb3RvdHlwZS51bnJlZ2lzdGVyID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl90YXNrSGFuZGxlc0l0ZXJhdG9yKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBBbHJlYWR5IHVucmVnaXN0ZXJlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuX2ludGVybmFsQ29udGV4dC50YXNrSGFuZGxlcy5yZW1vdmUodGhpcy5fdGFza0hhbmRsZXNJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fdGFza0hhbmRsZXNJdGVyYXRvciA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2ludGVybmFsQ29udGV4dC50YXNrSGFuZGxlcy5nZXRDb3VudCgpID09PSAwKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faW50ZXJuYWxDb250ZXh0LmlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICAgICAgLy8gU2hvdWxkIGJlIGNhbGxlZCBmcm9tIHN0YXR1c1VwZGF0ZSB3aGVuIHdvcmtlciBzaHV0IGRvd25cclxuXHRcdFx0XHQvL3RoaXMuX2ludGVybmFsQ29udGV4dC5lbmRlZCgpO1xyXG5cdFx0XHRcdFxyXG4gICAgICAgICAgICAgICAgdGhpcy5faW50ZXJuYWxDb250ZXh0LnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9sb2NhbFByaW9yaXR5ID09PSB0aGlzLl9pbnRlcm5hbENvbnRleHQucHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgdmFyIG5ld1ByaW9yaXR5ID0gdGhpcy5faW50ZXJuYWxDb250ZXh0LnJlY2FsY3VsYXRlUHJpb3JpdHkoKTtcclxuICAgICAgICAgICAgdGhpcy5faW50ZXJuYWxDb250ZXh0LnNldFByaW9yaXR5QW5kTm90aWZ5KG5ld1ByaW9yaXR5KTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tIYW5kbGU7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFza0hhbmRsZTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0Nsb3N1cmUoKSB7XHJcblx0ZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrKHdyYXBwZWQsIGtleSwgcmVnaXN0ZXJXcmFwcGVkRXZlbnRzKSB7XHJcblx0XHR0aGlzLl93cmFwcGVkID0gd3JhcHBlZDtcclxuXHRcdHRoaXMuX2tleSA9IGtleTtcclxuXHRcdHRoaXMuX2V2ZW50TGlzdGVuZXJzID0ge1xyXG5cdFx0XHQnZGVwZW5kZW5jeVRhc2tEYXRhJzogW10sXHJcblx0XHRcdCdzdGF0dXNVcGRhdGVkJzogW10sXHJcblx0XHRcdCdhbGxEZXBlbmRUYXNrc1Rlcm1pbmF0ZWQnOiBbXVxyXG5cdFx0fTtcclxuXHRcdFxyXG5cdFx0aWYgKHJlZ2lzdGVyV3JhcHBlZEV2ZW50cykge1xyXG5cdFx0XHRmb3IgKHZhciBldmVudCBpbiB0aGlzLl9ldmVudExpc3RlbmVycykge1xyXG5cdFx0XHRcdHRoaXMuX3JlZ2lzdGVyV3JhcHBlZEV2ZW50KGV2ZW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH1cclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKSB7XHJcblx0XHR0aGlzLl93cmFwcGVkLmRhdGFSZWFkeShuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKTtcclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG5cdFx0dGhpcy5fd3JhcHBlZC50ZXJtaW5hdGUoKTtcclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSA9IGZ1bmN0aW9uIHJlZ2lzdGVyVGFza0RlcGVuZGVuY3kodGFza0tleSkge1xyXG5cdFx0cmV0dXJuIHRoaXMuX3dyYXBwZWQucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh0YXNrS2V5KTtcclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuXHRcdGlmICghdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdKSB7XHJcblx0XHRcdHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBUYXNrIGhhcyBubyBldmVudCAnICsgZXZlbnQ7XHJcblx0XHR9XHJcblx0XHR0aGlzLl9ldmVudExpc3RlbmVyc1tldmVudF0ucHVzaChsaXN0ZW5lcik7XHJcblx0fTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSwgJ2tleScsIHtcclxuXHRcdGdldDogZnVuY3Rpb24gZ2V0S2V5KCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5fa2V5O1xyXG5cdFx0fVxyXG5cdH0pO1xyXG5cdFxyXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLCAnZGVwZW5kVGFza0tleXMnLCB7XHJcblx0XHRnZXQ6IGZ1bmN0aW9uIGdldERlcGVuZFRhc2tLZXlzKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5fd3JhcHBlZC5kZXBlbmRUYXNrS2V5cztcclxuXHRcdH1cclxuXHR9KTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tSZXN1bHRzJywge1xyXG5cdFx0Z2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrUmVzdWx0cygpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza1Jlc3VsdHM7XHJcblx0XHR9XHJcblx0fSk7XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5fb25FdmVudCA9IGZ1bmN0aW9uIG9uRXZlbnQoZXZlbnQsIGFyZzEsIGFyZzIpIHtcclxuXHRcdGlmIChldmVudCA9PSAnc3RhdHVzVXBkYXRlZCcpIHtcclxuXHRcdFx0YXJnMSA9IHRoaXMuX21vZGlmeVN0YXR1cyhhcmcxKTtcclxuXHRcdH1cclxuXHRcdHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudExpc3RlbmVyc1tldmVudF07XHJcblx0XHRmb3IgKHZhciBpID0gMDsgaSA8IGxpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRsaXN0ZW5lcnNbaV0uY2FsbCh0aGlzLCBhcmcxLCBhcmcyKTtcclxuXHRcdH1cclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX21vZGlmeVN0YXR1cyA9IGZ1bmN0aW9uIG1vZGlmeVN0YXR1cyhzdGF0dXMpIHtcclxuXHRcdHJldHVybiBzdGF0dXM7XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLl9yZWdpc3RlcldyYXBwZWRFdmVudCA9IGZ1bmN0aW9uIHJlZ2lzdGVyV3JhcHBlZEV2ZW50KGV2ZW50KSB7XHJcblx0XHR2YXIgdGhhdCA9IHRoaXM7XHJcblx0XHR0aGlzLl93cmFwcGVkLm9uKGV2ZW50LCBmdW5jdGlvbihhcmcxLCBhcmcyKSB7XHJcblx0XHRcdHRoYXQuX29uRXZlbnQoZXZlbnQsIGFyZzEsIGFyZzIpO1xyXG5cdFx0fSk7XHJcblx0fTtcclxuXHJcblx0cmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzVGFzaztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gcmVxdWlyZSgnanMtYnVpbHRpbi1oYXNoLW1hcCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNJbnRlcm5hbENvbnRleHQgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtaW50ZXJuYWwtY29udGV4dCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2staGFuZGxlJyk7XHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnMgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnMod29ya2VySW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSB3b3JrZXJJbnB1dFJldHJlaXZlcjtcclxuICAgICAgICB0aGF0Ll9pbnRlcm5hbENvbnRleHRzID0gbmV3IEpzQnVpbHRpbkhhc2hNYXAoKTtcclxuICAgICAgICB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZSA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3Rhc2tPcHRpb25zQnlUYXNrVHlwZSA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ3dvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCF3b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnN0YXJ0VGFzayA9IGZ1bmN0aW9uIHN0YXJ0VGFzayhcclxuICAgICAgICB0YXNrS2V5LCBjYWxsYmFja3MpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgZGVwZW5kZW5jeVdvcmtlcnMgPSB0aGlzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzdHJLZXkgPSB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyh0YXNrS2V5KTtcclxuICAgICAgICB2YXIgYWRkUmVzdWx0ID0gdGhpcy5faW50ZXJuYWxDb250ZXh0cy50cnlBZGQoc3RyS2V5LCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBEZXBlbmRlbmN5V29ya2Vyc0ludGVybmFsQ29udGV4dCgpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpbnRlcm5hbENvbnRleHQgPSBhZGRSZXN1bHQudmFsdWU7XHJcbiAgICAgICAgdmFyIHRhc2tIYW5kbGUgPSBuZXcgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSGFuZGxlKFxyXG4gICAgICAgICAgICBpbnRlcm5hbENvbnRleHQsIGNhbGxiYWNrcyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICBpbnRlcm5hbENvbnRleHQuaW5pdGlhbGl6ZShcclxuICAgICAgICAgICAgICAgIHRhc2tLZXksXHJcbiAgICAgICAgICAgICAgICB0aGlzLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIsXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbnRlcm5hbENvbnRleHRzLFxyXG4gICAgICAgICAgICAgICAgYWRkUmVzdWx0Lml0ZXJhdG9yLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIpO1xyXG5cdFx0XHRcdFxyXG4gICAgICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci50YXNrU3RhcnRlZChpbnRlcm5hbENvbnRleHQudGFza0FwaSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG5cclxuICAgICAgICByZXR1cm4gdGFza0hhbmRsZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5zdGFydFRhc2tQcm9taXNlID1cclxuICAgICAgICAgICAgZnVuY3Rpb24gc3RhcnRUYXNrUHJvbWlzZSh0YXNrS2V5KSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgdmFyIHRhc2tIYW5kbGUgPSB0aGF0LnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgICAgIHRhc2tLZXksIHsgJ29uRGF0YSc6IG9uRGF0YSwgJ29uVGVybWluYXRlZCc6IG9uVGVybWluYXRlZCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBoYXNEYXRhID0gdGFza0hhbmRsZS5oYXNEYXRhKCk7XHJcbiAgICAgICAgICAgIHZhciByZXN1bHQ7XHJcbiAgICAgICAgICAgIGlmIChoYXNEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB0YXNrSGFuZGxlLmdldExhc3REYXRhKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uRGF0YShkYXRhKSB7XHJcbiAgICAgICAgICAgICAgICBoYXNEYXRhID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IGRhdGE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uVGVybWluYXRlZCgpIHtcclxuICAgICAgICAgICAgICAgIGlmIChoYXNEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IEludGVybmFsICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAnZXJyb3IgLSB0YXNrIHRlcm1pbmF0ZWQgYnV0IG5vIGRhdGEgcmV0dXJuZWQnKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLl9kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkoXHJcblx0XHRcdGludGVybmFsQ29udGV4dCwgZGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSkge1xyXG4gICAgICAgIFxyXG5cdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHZhciB3b3JrZXI7XHJcbiAgICAgICAgdmFyIHdvcmtlclBvb2wgPSB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXTtcclxuICAgICAgICBpZiAoIXdvcmtlclBvb2wpIHtcclxuICAgICAgICAgICAgd29ya2VyUG9vbCA9IFtdO1xyXG4gICAgICAgICAgICB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXSA9IHdvcmtlclBvb2w7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh3b3JrZXJQb29sLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgd29ya2VyID0gd29ya2VyUG9vbC5wb3AoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB2YXIgd29ya2VyQXJncyA9IHRoYXQuX3dvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKFxyXG4gICAgICAgICAgICAgICAgd29ya2VyVHlwZSk7XHJcblxyXG5cdFx0XHRpZiAoIXdvcmtlckFyZ3MpIHtcclxuXHRcdFx0XHRpbnRlcm5hbENvbnRleHQubmV3RGF0YShkYXRhVG9Qcm9jZXNzKTtcclxuXHRcdFx0XHRpbnRlcm5hbENvbnRleHQuc3RhdHVzVXBkYXRlKCk7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgICAgIFxyXG5cdFx0XHR3b3JrZXIgPSBuZXcgQXN5bmNQcm94eU1hc3RlcihcclxuICAgICAgICAgICAgICAgIHdvcmtlckFyZ3Muc2NyaXB0c1RvSW1wb3J0LFxyXG4gICAgICAgICAgICAgICAgd29ya2VyQXJncy5jdG9yTmFtZSxcclxuICAgICAgICAgICAgICAgIHdvcmtlckFyZ3MuY3RvckFyZ3MpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWludGVybmFsQ29udGV4dC53YWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIGludGVybmFsQ29udGV4dC53YWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgaW50ZXJuYWxDb250ZXh0LnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB3b3JrZXIuY2FsbEZ1bmN0aW9uKFxyXG4gICAgICAgICAgICAgICAgJ3N0YXJ0JyxcclxuICAgICAgICAgICAgICAgIFtkYXRhVG9Qcm9jZXNzLCBpbnRlcm5hbENvbnRleHQudGFza0tleV0sXHJcbiAgICAgICAgICAgICAgICB7J2lzUmV0dXJuUHJvbWlzZSc6IHRydWV9KVxyXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbihwcm9jZXNzZWREYXRhKSB7XHJcbiAgICAgICAgICAgICAgICBpbnRlcm5hbENvbnRleHQubmV3RGF0YShwcm9jZXNzZWREYXRhKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBwcm9jZXNzZWREYXRhO1xyXG4gICAgICAgICAgICB9KS5jYXRjaChmdW5jdGlvbihlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRXJyb3IgaW4gRGVwZW5kZW5jeVdvcmtlcnNcXCcgd29ya2VyOiAnICsgZSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZTtcclxuICAgICAgICAgICAgfSkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcclxuICAgICAgICAgICAgICAgIHdvcmtlclBvb2wucHVzaCh3b3JrZXIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIXRoYXQuX2NoZWNrSWZQZW5kaW5nRGF0YShpbnRlcm5hbENvbnRleHQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJuYWxDb250ZXh0LndhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBpbnRlcm5hbENvbnRleHQuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgfTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuX2NoZWNrSWZQZW5kaW5nRGF0YSA9IGZ1bmN0aW9uIGNoZWNrSWZQZW5kaW5nRGF0YShpbnRlcm5hbENvbnRleHQpIHtcclxuXHRcdGlmICghaW50ZXJuYWxDb250ZXh0LmlzUGVuZGluZ0RhdGFGb3JXb3JrZXIpIHtcclxuXHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHR2YXIgZGF0YVRvUHJvY2VzcyA9IGludGVybmFsQ29udGV4dC5wZW5kaW5nRGF0YUZvcldvcmtlcjtcclxuXHRcdGludGVybmFsQ29udGV4dC5pc1BlbmRpbmdEYXRhRm9yV29ya2VyID0gZmFsc2U7XHJcblx0XHRpbnRlcm5hbENvbnRleHQucGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBudWxsO1xyXG5cdFx0XHJcblx0XHR0aGlzLl9kYXRhUmVhZHkoXHJcblx0XHRcdGludGVybmFsQ29udGV4dCxcclxuXHRcdFx0ZGF0YVRvUHJvY2VzcyxcclxuXHRcdFx0aW50ZXJuYWxDb250ZXh0LnBlbmRpbmdXb3JrZXJUeXBlKTtcclxuXHRcdFxyXG5cdFx0cmV0dXJuIHRydWU7XHJcblx0fTtcclxuICAgIFxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2VyczsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcblxyXG52YXIgSGFzaE1hcCA9IChmdW5jdGlvbiBIYXNoTWFwQ2xvc3VyZSgpIHtcclxuXHJcbmZ1bmN0aW9uIEhhc2hNYXAoaGFzaGVyKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB0aGF0Ll9oYXNoZXIgPSBoYXNoZXI7XHJcblx0dGhhdC5jbGVhcigpO1xyXG59XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uIGNsZWFyKCkge1xyXG4gICAgdGhpcy5fbGlzdEJ5S2V5ID0gW107XHJcbiAgICB0aGlzLl9saXN0T2ZMaXN0cyA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcbiAgICB0aGlzLl9jb3VudCA9IDA7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRGcm9tS2V5ID0gZnVuY3Rpb24gZ2V0RnJvbUtleShrZXkpIHtcclxuICAgIHZhciBoYXNoQ29kZSA9IHRoaXMuX2hhc2hlclsnZ2V0SGFzaENvZGUnXShrZXkpO1xyXG4gICAgdmFyIGhhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV07XHJcbiAgICBpZiAoIWhhc2hFbGVtZW50cykge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgdmFyIGxpc3QgPSBoYXNoRWxlbWVudHMubGlzdDtcclxuICAgIFxyXG4gICAgdmFyIGl0ZXJhdG9yID0gbGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgaXRlbSA9IGxpc3QuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICBpZiAodGhpcy5faGFzaGVyWydpc0VxdWFsJ10oaXRlbS5rZXksIGtleSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGl0ZW0udmFsdWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGl0ZXJhdG9yID0gbGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0RnJvbUl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcikudmFsdWU7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS50cnlBZGQgPSBmdW5jdGlvbiB0cnlBZGQoa2V5LCBjcmVhdGVWYWx1ZSkge1xyXG4gICAgdmFyIGhhc2hDb2RlID0gdGhpcy5faGFzaGVyWydnZXRIYXNoQ29kZSddKGtleSk7XHJcbiAgICB2YXIgaGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdEJ5S2V5W2hhc2hDb2RlXTtcclxuICAgIGlmICghaGFzaEVsZW1lbnRzKSB7XHJcbiAgICAgICAgaGFzaEVsZW1lbnRzID0ge1xyXG4gICAgICAgICAgICBoYXNoQ29kZTogaGFzaENvZGUsXHJcbiAgICAgICAgICAgIGxpc3Q6IG5ldyBMaW5rZWRMaXN0KCksXHJcbiAgICAgICAgICAgIGxpc3RPZkxpc3RzSXRlcmF0b3I6IG51bGxcclxuICAgICAgICB9O1xyXG4gICAgICAgIGhhc2hFbGVtZW50cy5saXN0T2ZMaXN0c0l0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuYWRkKGhhc2hFbGVtZW50cyk7XHJcbiAgICAgICAgdGhpcy5fbGlzdEJ5S2V5W2hhc2hDb2RlXSA9IGhhc2hFbGVtZW50cztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGl0ZXJhdG9yID0ge1xyXG4gICAgICAgIF9oYXNoRWxlbWVudHM6IGhhc2hFbGVtZW50cyxcclxuICAgICAgICBfaW50ZXJuYWxJdGVyYXRvcjogbnVsbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgaXRlbSA9IGhhc2hFbGVtZW50cy5saXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcik7XHJcbiAgICAgICAgaWYgKHRoaXMuX2hhc2hlclsnaXNFcXVhbCddKGl0ZW0ua2V5LCBrZXkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBpdGVyYXRvcjogaXRlcmF0b3IsXHJcbiAgICAgICAgICAgICAgICBpc05ldzogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICB2YWx1ZTogaXRlbS52YWx1ZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9IGhhc2hFbGVtZW50cy5saXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB2YWx1ZSA9IGNyZWF0ZVZhbHVlKCk7XHJcbiAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9IGhhc2hFbGVtZW50cy5saXN0LmFkZCh7XHJcbiAgICAgICAga2V5OiBrZXksXHJcbiAgICAgICAgdmFsdWU6IHZhbHVlXHJcbiAgICB9KTtcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaXRlcmF0b3I6IGl0ZXJhdG9yLFxyXG4gICAgICAgIGlzTmV3OiB0cnVlLFxyXG4gICAgICAgIHZhbHVlOiB2YWx1ZVxyXG4gICAgfTtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgdmFyIG9sZExpc3RDb3VudCA9IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRDb3VudCgpO1xyXG4gICAgaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LnJlbW92ZShpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcik7XHJcbiAgICB2YXIgbmV3TGlzdENvdW50ID0gaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldENvdW50KCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2NvdW50ICs9IChuZXdMaXN0Q291bnQgLSBvbGRMaXN0Q291bnQpO1xyXG4gICAgaWYgKG5ld0xpc3RDb3VudCA9PT0gMCkge1xyXG4gICAgICAgIHRoaXMuX2xpc3RPZkxpc3RzLnJlbW92ZShpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3RPZkxpc3RzSXRlcmF0b3IpO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLl9saXN0QnlLZXlbaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5oYXNoQ29kZV07XHJcbiAgICB9XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgZmlyc3RMaXN0SXRlcmF0b3IgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB2YXIgZmlyc3RIYXNoRWxlbWVudHMgPSBudWxsO1xyXG4gICAgdmFyIGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9IG51bGw7XHJcbiAgICBpZiAoZmlyc3RMaXN0SXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICBmaXJzdEhhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldEZyb21JdGVyYXRvcihmaXJzdExpc3RJdGVyYXRvcik7XHJcbiAgICAgICAgZmlyc3RJbnRlcm5hbEl0ZXJhdG9yID0gZmlyc3RIYXNoRWxlbWVudHMubGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB9XHJcbiAgICBpZiAoZmlyc3RJbnRlcm5hbEl0ZXJhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgX2hhc2hFbGVtZW50czogZmlyc3RIYXNoRWxlbWVudHMsXHJcbiAgICAgICAgX2ludGVybmFsSXRlcmF0b3I6IGZpcnN0SW50ZXJuYWxJdGVyYXRvclxyXG4gICAgfTtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdmFyIG5leHRJdGVyYXRvciA9IHtcclxuICAgICAgICBfaGFzaEVsZW1lbnRzOiBpdGVyYXRvci5faGFzaEVsZW1lbnRzLFxyXG4gICAgICAgIF9pbnRlcm5hbEl0ZXJhdG9yOiBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0TmV4dEl0ZXJhdG9yKFxyXG4gICAgICAgICAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcilcclxuICAgIH07XHJcbiAgICBcclxuICAgIHdoaWxlIChuZXh0SXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICB2YXIgbmV4dExpc3RPZkxpc3RzSXRlcmF0b3IgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXROZXh0SXRlcmF0b3IoXHJcbiAgICAgICAgICAgIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdE9mTGlzdHNJdGVyYXRvcik7XHJcbiAgICAgICAgaWYgKG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBuZXh0SXRlcmF0b3IuX2hhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldEZyb21JdGVyYXRvcihcclxuICAgICAgICAgICAgbmV4dExpc3RPZkxpc3RzSXRlcmF0b3IpO1xyXG4gICAgICAgIG5leHRJdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9XHJcbiAgICAgICAgICAgIG5leHRJdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5leHRJdGVyYXRvcjtcclxufTtcclxuXHJcbnJldHVybiBIYXNoTWFwO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBIYXNoTWFwOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBIYXNoTWFwID0gcmVxdWlyZSgnaGFzaC1tYXAnKTtcclxuXHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gKGZ1bmN0aW9uIEhhc2hNYXBDbG9zdXJlKCkge1xyXG4gICAgXHJcbi8vIFRoaXMgY2xhc3MgZXhwb3NlIHNhbWUgQVBJIGFzIEhhc2hNYXAgYnV0IG5vdCByZXF1aXJpbmcgZ2V0SGFzaENvZGUoKSBhbmQgaXNFcXVhbCgpIGZ1bmN0aW9ucy5cclxuLy8gVGhhdCB3YXkgaXQncyBlYXN5IHRvIHN3aXRjaCBiZXR3ZWVuIGltcGxlbWVudGF0aW9ucy5cclxuXHJcbnZhciBzaW1wbGVIYXNoZXIgPSB7XHJcbiAgICAnZ2V0SGFzaENvZGUnOiBmdW5jdGlvbiBnZXRIYXNoQ29kZShrZXkpIHtcclxuICAgICAgICByZXR1cm4ga2V5O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgJ2lzRXF1YWwnOiBmdW5jdGlvbiBpc0VxdWFsKGtleTEsIGtleTIpIHtcclxuICAgICAgICByZXR1cm4ga2V5MSA9PT0ga2V5MjtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIEpzQnVpbHRpbkhhc2hNYXAoKSB7XHJcbiAgICBIYXNoTWFwLmNhbGwodGhpcywgLypoYXNoZXI9Ki9zaW1wbGVIYXNoZXIpO1xyXG59XHJcblxyXG5Kc0J1aWx0aW5IYXNoTWFwLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSGFzaE1hcC5wcm90b3R5cGUpO1xyXG5cclxucmV0dXJuIEpzQnVpbHRpbkhhc2hNYXA7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEpzQnVpbHRpbkhhc2hNYXA7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSAoZnVuY3Rpb24gTGlua2VkTGlzdENsb3N1cmUoKSB7XHJcblxyXG5mdW5jdGlvbiBMaW5rZWRMaXN0KCkge1xyXG4gICAgdGhpcy5jbGVhcigpO1xyXG59XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uIGNsZWFyKCkge1xyXG4gICAgdGhpcy5fZmlyc3QgPSB7IF9wcmV2OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9sYXN0ID0geyBfbmV4dDogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG4gICAgXHJcbiAgICB0aGlzLl9sYXN0Ll9wcmV2ID0gdGhpcy5fZmlyc3Q7XHJcbiAgICB0aGlzLl9maXJzdC5fbmV4dCA9IHRoaXMuX2xhc3Q7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiBhZGQodmFsdWUsIGFkZEJlZm9yZSkge1xyXG4gICAgaWYgKGFkZEJlZm9yZSA9PT0gbnVsbCB8fCBhZGRCZWZvcmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGFkZEJlZm9yZSA9IHRoaXMuX2xhc3Q7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoYWRkQmVmb3JlKTtcclxuICAgIFxyXG4gICAgKyt0aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgdmFyIG5ld05vZGUgPSB7XHJcbiAgICAgICAgX3ZhbHVlOiB2YWx1ZSxcclxuICAgICAgICBfbmV4dDogYWRkQmVmb3JlLFxyXG4gICAgICAgIF9wcmV2OiBhZGRCZWZvcmUuX3ByZXYsXHJcbiAgICAgICAgX3BhcmVudDogdGhpc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgbmV3Tm9kZS5fcHJldi5fbmV4dCA9IG5ld05vZGU7XHJcbiAgICBhZGRCZWZvcmUuX3ByZXYgPSBuZXdOb2RlO1xyXG4gICAgXHJcbiAgICByZXR1cm4gbmV3Tm9kZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIC0tdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9wcmV2Ll9uZXh0ID0gaXRlcmF0b3IuX25leHQ7XHJcbiAgICBpdGVyYXRvci5fbmV4dC5fcHJldiA9IGl0ZXJhdG9yLl9wcmV2O1xyXG4gICAgaXRlcmF0b3IuX3BhcmVudCA9IG51bGw7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRGcm9tSXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ZhbHVlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldE5leHRJdGVyYXRvcih0aGlzLl9maXJzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRMYXN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXRQcmV2SXRlcmF0b3IodGhpcy5fbGFzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fbmV4dCA9PT0gdGhpcy5fbGFzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX25leHQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRQcmV2SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRQcmV2SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fcHJldiA9PT0gdGhpcy5fZmlyc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9wcmV2O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzID1cclxuICAgIGZ1bmN0aW9uIHZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpIHtcclxuICAgIFxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wYXJlbnQgIT09IHRoaXMpIHtcclxuICAgICAgICB0aHJvdyAnaXRlcmF0b3IgbXVzdCBiZSBvZiB0aGUgY3VycmVudCBMaW5rZWRMaXN0JztcclxuICAgIH1cclxufTtcclxuXHJcbnJldHVybiBMaW5rZWRMaXN0O1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBMaW5rZWRMaXN0OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIgPSByZXF1aXJlKCdzY2hlZHVsZXItd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXInKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzJyk7XHJcblxyXG52YXIgU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMgPSAoZnVuY3Rpb24gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnNDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMoc2NoZWR1bGVyLCBpbnB1dFJldHJlaXZlcikge1xyXG4gICAgICAgIHZhciB3cmFwcGVySW5wdXRSZXRyZWl2ZXIgPSBuZXcgU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyKHNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgICAgIERlcGVuZGVuY3lXb3JrZXJzLmNhbGwodGhpcywgd3JhcHBlcklucHV0UmV0cmVpdmVyKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnM7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzaycpO1xyXG5cclxudmFyIFNjaGVkdWxlclRhc2sgPSAoZnVuY3Rpb24gU2NoZWR1bGVyVGFza0Nsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBTY2hlZHVsZXJUYXNrKHNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIsIGlzRGlzYWJsZVdvcmtlckNhY2hlLCB3cmFwcGVkVGFzaykge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuXHRcdERlcGVuZGVuY3lXb3JrZXJzVGFzay5jYWxsKHRoaXMsIHdyYXBwZWRUYXNrLCB3cmFwcGVkVGFzay5rZXksIC8qcmVnaXN0ZXJXcmFwcGVkRXZlbnRzPSovdHJ1ZSk7XHJcbiAgICAgICAgdGhhdC5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG5cdFx0dGhhdC5faW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuXHRcdHRoYXQuX2lzRGlzYWJsZVdvcmtlckNhY2hlID0gaXNEaXNhYmxlV29ya2VyQ2FjaGU7XHJcblx0XHR0aGF0Ll93cmFwcGVkVGFzayA9IHdyYXBwZWRUYXNrO1xyXG4gICAgICAgIHRoYXQuX29uU2NoZWR1bGVkQm91bmQgPSB0aGF0Ll9vblNjaGVkdWxlZC5iaW5kKHRoYXQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbnVsbDtcclxuICAgICAgICB0aGF0Ll9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgIHRoYXQuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzID0gZmFsc2U7XHJcbiAgICAgICAgdGhhdC5faXNXb3JrZXJBY3RpdmUgPSBmYWxzZTtcclxuXHRcdHRoYXQuX2lzVGVybWluYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoYXQuX2xhc3RTdGF0dXMgPSB7ICdpc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQnOiBmYWxzZSB9O1xyXG4gICAgfVxyXG5cdFxyXG5cdFNjaGVkdWxlclRhc2sucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlKTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuX21vZGlmeVN0YXR1cyA9IGZ1bmN0aW9uIG1vZGlmeVN0YXR1cyhzdGF0dXMpIHtcclxuICAgICAgICB0aGlzLl9sYXN0U3RhdHVzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzdGF0dXMpKTtcclxuICAgICAgICB0aGlzLl9jaGVja0lmSm9iRG9uZShzdGF0dXMpO1xyXG4gICAgICAgIHRoaXMuX2xhc3RTdGF0dXMuaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0ID1cclxuICAgICAgICAgICAgc3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCB8fCB0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcztcclxuICAgICAgICBcclxuXHRcdHJldHVybiB0aGlzLl9sYXN0U3RhdHVzO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuZGF0YVJlYWR5ID0gZnVuY3Rpb24gb25EYXRhUmVhZHlUb1Byb2Nlc3MoXHJcbiAgICAgICAgICAgIG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IERhdGEgYWZ0ZXIgdGVybWluYXRpb24nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGVbd29ya2VyVHlwZV0gPT09IHVuZGVmaW5lZCkge1xyXG5cdFx0XHR0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZVt3b3JrZXJUeXBlXSA9IHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKHdvcmtlclR5cGUpID09PSBudWxsO1xyXG5cdFx0fVxyXG5cdFx0aWYgKHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlW3dvcmtlclR5cGVdKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPVxyXG4gICAgICAgICAgICAgICAgdGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MgJiYgIXRoaXMuX2lzV29ya2VyQWN0aXZlO1xyXG4gICAgICAgICAgICB0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeS5jYWxsKHRoaXMsIG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGlzU3RhdHVzQ2hhbmdlZCA9XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9sYXN0U3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCAmJlxyXG4gICAgICAgICAgICAgICAgIXRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzO1xyXG4gICAgICAgICAgICBpZiAoaXNTdGF0dXNDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9sYXN0U3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fb25FdmVudCgnc3RhdHVzVXBkYXRlZCcsIHRoaXMuX2xhc3RTdGF0dXMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbmV3RGF0YVRvUHJvY2VzcztcclxuICAgICAgICB0aGlzLl9jYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBoYWRQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzO1xyXG4gICAgICAgIHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gdHJ1ZTtcclxuXHJcbiAgICAgICAgaWYgKCFoYWRQZW5kaW5nRGF0YVRvUHJvY2VzcyAmJiAhdGhpcy5faXNXb3JrZXJBY3RpdmUpIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2IoXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vblNjaGVkdWxlZEJvdW5kLCB0aGlzKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogRG91YmxlIHRlcm1pbmF0aW9uJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAoIXRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcblx0XHRcdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUudGVybWluYXRlLmNhbGwodGhpcyk7XHJcblx0XHR9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS5fb25TY2hlZHVsZWQgPSBmdW5jdGlvbiBkYXRhUmVhZHlGb3JXb3JrZXIoXHJcbiAgICAgICAgICAgIHJlc291cmNlLCBqb2JDb250ZXh0LCBqb2JDYWxsYmFja3MpIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgIGlmIChqb2JDb250ZXh0ICE9PSB0aGlzKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBVbmV4cGVjdGVkIGNvbnRleHQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MpIHtcclxuICAgICAgICAgICAgdGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBmYWxzZTtcclxuXHRcdFx0am9iQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG5cdFx0XHRpZiAoIXRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcblx0XHRcdFx0dGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6ICFlbnF1ZXVlZFByb2Nlc3NKb2InO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR0aGlzLl9pc1dvcmtlckFjdGl2ZSA9IHRydWU7XHJcblx0XHRcdHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gZmFsc2U7XHJcblx0XHRcdHRoaXMuX2pvYkNhbGxiYWNrcyA9IGpvYkNhbGxiYWNrcztcclxuXHRcdFx0dmFyIGRhdGEgPSB0aGlzLl9wZW5kaW5nRGF0YVRvUHJvY2VzcztcclxuXHRcdFx0dGhpcy5fcGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBudWxsO1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeS5jYWxsKHRoaXMsIGRhdGEpO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRpZiAodGhpcy5faXNUZXJtaW5hdGVkKSB7XHJcblx0XHRcdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUudGVybWluYXRlLmNhbGwodGhpcyk7XHJcblx0XHR9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS5fY2hlY2tJZkpvYkRvbmUgPSBmdW5jdGlvbiBjaGVja0lmSm9iRG9uZShzdGF0dXMpIHtcclxuICAgICAgICBpZiAoIXRoaXMuX2lzV29ya2VyQWN0aXZlIHx8IHN0YXR1cy5pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IGNhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNXb3JrZXJBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MpIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2IoXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vblNjaGVkdWxlZEJvdW5kLCB0aGlzKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMuX2pvYkNhbGxiYWNrcy5qb2JEb25lKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gU2NoZWR1bGVyVGFzaztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2NoZWR1bGVyVGFzazsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2NoZWR1bGVyVGFzayA9IHJlcXVpcmUoJ3NjaGVkdWxlci10YXNrJyk7XHJcbnZhciBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlID0gcmVxdWlyZSgnd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZScpO1xyXG5cclxudmFyIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlciA9IChmdW5jdGlvbiBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXJDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyKHNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLmNhbGwodGhpcywgaW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcblx0XHR0aGF0Ll9pbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG5cdFx0dGhhdC5faXNEaXNhYmxlV29ya2VyQ2FjaGUgPSB7fTtcclxuXHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci50YXNrU3RhcnRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnaW5wdXRSZXRyZWl2ZXIudGFza1N0YXJ0ZWQoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUpO1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIucHJvdG90eXBlLnRhc2tTdGFydGVkID1cclxuICAgICAgICAgICAgZnVuY3Rpb24gdGFza1N0YXJ0ZWQodGFzaykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB3cmFwcGVyVGFzayA9IG5ldyBTY2hlZHVsZXJUYXNrKFxyXG5cdFx0XHR0aGlzLl9zY2hlZHVsZXIsIHRoaXMuX2lucHV0UmV0cmVpdmVyLCB0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZSwgdGFzayk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2lucHV0UmV0cmVpdmVyLnRhc2tTdGFydGVkKHdyYXBwZXJUYXNrKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXI7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSA9IChmdW5jdGlvbiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UoaW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICBpZiAoIWlucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICdpbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghaW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLmdldFRhc2tUeXBlT3B0aW9ucygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5faW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUudGFza1N0YXJ0ZWQgPVxyXG4gICAgICAgICAgICBmdW5jdGlvbiB0YXNrU3RhcnRlZCh0YXNrKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSBpbnRlcm5hbCBlcnJvcjogTm90IGltcGxlbWVudGVkIHRhc2tTdGFydGVkKCknO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUuZ2V0S2V5QXNTdHJpbmcgPSBmdW5jdGlvbihrZXkpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoa2V5KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIFxyXG4gICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUuZ2V0V29ya2VyVHlwZU9wdGlvbnMgPSBmdW5jdGlvbih0YXNrVHlwZSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucyh0YXNrVHlwZSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZTtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2NyaXB0c1RvSW1wb3J0UG9vbCA9IChmdW5jdGlvbiBTY3JpcHRzVG9JbXBvcnRQb29sQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFNjcmlwdHNUb0ltcG9ydFBvb2woKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3NjcmlwdHNCeU5hbWUgPSB7fTtcclxuICAgICAgICB0aGF0Ll9zY3JpcHRzQXJyYXkgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTY3JpcHRzVG9JbXBvcnRQb29sLnByb3RvdHlwZS5hZGRTY3JpcHRGcm9tRXJyb3JXaXRoU3RhY2tUcmFjZSA9XHJcbiAgICAgICAgZnVuY3Rpb24gYWRkU2NyaXB0Rm9yV29ya2VySW1wb3J0KGVycm9yV2l0aFN0YWNrVHJhY2UpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgZmlsZU5hbWUgPSBTY3JpcHRzVG9JbXBvcnRQb29sLl9nZXRTY3JpcHROYW1lKGVycm9yV2l0aFN0YWNrVHJhY2UpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghdGhpcy5fc2NyaXB0c0J5TmFtZVtmaWxlTmFtZV0pIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0J5TmFtZVtmaWxlTmFtZV0gPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGlzLl9zY3JpcHRzQXJyYXkgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIFNjcmlwdHNUb0ltcG9ydFBvb2wucHJvdG90eXBlLmdldFNjcmlwdHNGb3JXb3JrZXJJbXBvcnQgPVxyXG4gICAgICAgIGZ1bmN0aW9uIGdldFNjcmlwdHNGb3JXb3JrZXJJbXBvcnQoKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NjcmlwdHNBcnJheSA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aGlzLl9zY3JpcHRzQXJyYXkgPSBbXTtcclxuICAgICAgICAgICAgZm9yICh2YXIgZmlsZU5hbWUgaW4gdGhpcy5fc2NyaXB0c0J5TmFtZSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0FycmF5LnB1c2goZmlsZU5hbWUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB0aGlzLl9zY3JpcHRzQXJyYXk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY3JpcHRzVG9JbXBvcnRQb29sLl9nZXRTY3JpcHROYW1lID0gZnVuY3Rpb24gZ2V0U2NyaXB0TmFtZShlcnJvcldpdGhTdGFja1RyYWNlKSB7XHJcbiAgICAgICAgdmFyIHN0YWNrID0gZXJyb3JXaXRoU3RhY2tUcmFjZS5zdGFjay50cmltKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGN1cnJlbnRTdGFja0ZyYW1lUmVnZXggPSAvYXQgKHxbXiBdKyBcXCgpKFteIF0rKTpcXGQrOlxcZCsvO1xyXG4gICAgICAgIHZhciBzb3VyY2UgPSBjdXJyZW50U3RhY2tGcmFtZVJlZ2V4LmV4ZWMoc3RhY2spO1xyXG4gICAgICAgIGlmIChzb3VyY2UgJiYgc291cmNlWzJdICE9PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBzb3VyY2VbMl07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgbGFzdFN0YWNrRnJhbWVSZWdleCA9IG5ldyBSZWdFeHAoLy4rXFwvKC4qPyk6XFxkKyg6XFxkKykqJC8pO1xyXG4gICAgICAgIHNvdXJjZSA9IGxhc3RTdGFja0ZyYW1lUmVnZXguZXhlYyhzdGFjayk7XHJcbiAgICAgICAgaWYgKHNvdXJjZSAmJiBzb3VyY2VbMV0gIT09IFwiXCIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHNvdXJjZVsxXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGVycm9yV2l0aFN0YWNrVHJhY2UuZmlsZU5hbWUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gZXJyb3JXaXRoU3RhY2tUcmFjZS5maWxlTmFtZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhyb3cgJ0ltYWdlRGVjb2RlckZyYW1ld29yay5qczogQ291bGQgbm90IGdldCBjdXJyZW50IHNjcmlwdCBVUkwnO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFNjcmlwdHNUb0ltcG9ydFBvb2w7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNjcmlwdHNUb0ltcG9ydFBvb2w7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcblxyXG52YXIgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gKGZ1bmN0aW9uIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZUNsb3N1cmUoKSB7XHJcbiAgICB2YXIgc3ViV29ya2VySWQgPSAwO1xyXG4gICAgdmFyIHN1YldvcmtlcklkVG9TdWJXb3JrZXIgPSBudWxsO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUoc2NyaXB0VXJsKSB7XHJcbiAgICAgICAgaWYgKHN1YldvcmtlcklkVG9TdWJXb3JrZXIgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkgaW50ZXJuYWwgZXJyb3I6IFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSAnICtcclxuICAgICAgICAgICAgICAgICdub3QgaW5pdGlhbGl6ZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fc3ViV29ya2VySWQgPSArK3N1YldvcmtlcklkO1xyXG4gICAgICAgIHN1YldvcmtlcklkVG9TdWJXb3JrZXJbdGhhdC5fc3ViV29ya2VySWRdID0gdGhhdDtcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgdHlwZTogJ3N1YldvcmtlckN0b3InLFxyXG4gICAgICAgICAgICBzdWJXb3JrZXJJZDogdGhhdC5fc3ViV29ya2VySWQsXHJcbiAgICAgICAgICAgIHNjcmlwdFVybDogc2NyaXB0VXJsXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5pbml0aWFsaXplID0gZnVuY3Rpb24gaW5pdGlhbGl6ZShcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyXykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN1YldvcmtlcklkVG9TdWJXb3JrZXIgPSBzdWJXb3JrZXJJZFRvU3ViV29ya2VyXztcclxuICAgIH07XHJcbiAgICBcclxuICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5wcm90b3R5cGUucG9zdE1lc3NhZ2UgPSBmdW5jdGlvbiBwb3N0TWVzc2FnZShcclxuICAgICAgICBkYXRhLCB0cmFuc2ZlcmFibGVzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWJXb3JrZXJQb3N0TWVzc2FnZScsXHJcbiAgICAgICAgICAgIHN1YldvcmtlcklkOiB0aGlzLl9zdWJXb3JrZXJJZCxcclxuICAgICAgICAgICAgZGF0YTogZGF0YVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdHJhbnNmZXJhYmxlcyk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZShcclxuICAgICAgICBkYXRhLCB0cmFuc2ZlcmFibGVzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWJXb3JrZXJUZXJtaW5hdGUnLFxyXG4gICAgICAgICAgICBzdWJXb3JrZXJJZDogdGhpcy5fc3ViV29ya2VySWRcclxuICAgICAgICB9LFxyXG4gICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZTtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lOyJdfQ==
