var AsyncProxyMaster=function AsyncProxyMasterClosure(){var callId=0;var isGetMasterEntryUrlCalled=false;var masterEntryUrl=getBaseUrlFromEntryScript();function AsyncProxyMaster(scriptsToImport,ctorName,ctorArgs,options){var self=this;options=options||{};var slaveScriptContentString=mainSlaveScriptContent.toString();var scriptUrl=AsyncProxySlave._getScriptName();slaveScriptContentString=slaveScriptContentString.replace("SCRIPT_PLACEHOLDER",scriptUrl);var slaveScriptContentBlob=new Blob(["(",slaveScriptContentString,
")()"],{type:"application/javascript"});var slaveScriptUrl=URL.createObjectURL(slaveScriptContentBlob);this._callbacks=[];this._pendingPromiseCalls=[];this._subWorkerById=[];this._subWorkers=[];this._worker=new Worker(slaveScriptUrl);this._worker.onmessage=onWorkerMessageInternal;this._userDataHandler=null;this._notReturnedFunctions=0;this._functionsBufferSize=options["functionsBufferSize"]||5;this._pendingMessages=[];this._worker.postMessage({functionToCall:"ctor",scriptsToImport:scriptsToImport,
ctorName:ctorName,args:ctorArgs,callId:++callId,isPromise:false,masterEntryUrl:AsyncProxyMaster.getEntryUrl()});function onWorkerMessageInternal(workerEvent){onWorkerMessage(self,workerEvent)}}AsyncProxyMaster.prototype.setUserDataHandler=function setUserDataHandler(userDataHandler){this._userDataHandler=userDataHandler};AsyncProxyMaster.prototype.terminate=function terminate(){this._worker.terminate();for(var i=0;i<this._subWorkers.length;++i)this._subWorkers[i].terminate()};AsyncProxyMaster.prototype.callFunction=
function callFunction(functionToCall,args,options){options=options||{};var isReturnPromise=!!options["isReturnPromise"];var transferables=options["transferables"];var pathsToTransferables=options["pathsToTransferablesInPromiseResult"];var localCallId=++callId;var promiseOnMasterSide=null;var self=this;if(isReturnPromise)promiseOnMasterSide=new Promise(function promiseFunc(resolve,reject){self._pendingPromiseCalls[localCallId]={resolve:resolve,reject:reject}});var sendMessageFunction=options["isSendImmediately"]?
sendMessageToSlave:enqueueMessageToSlave;sendMessageFunction(this,transferables,true,{functionToCall:functionToCall,args:args||[],callId:localCallId,isPromise:isReturnPromise,pathsToTransferablesInPromiseResult:pathsToTransferables});if(isReturnPromise)return promiseOnMasterSide};AsyncProxyMaster.prototype.wrapCallback=function wrapCallback(callback,callbackName,options){options=options||{};var localCallId=++callId;var callbackHandle={isWorkerHelperCallback:true,isMultipleTimeCallback:!!options["isMultipleTimeCallback"],
callId:localCallId,callbackName:callbackName,pathsToTransferables:options["pathsToTransferables"]};var internalCallbackHandle={isMultipleTimeCallback:!!options["isMultipleTimeCallback"],callId:localCallId,callback:callback,pathsToTransferables:options["pathsToTransferables"]};this._callbacks[localCallId]=internalCallbackHandle;return callbackHandle};AsyncProxyMaster.prototype.freeCallback=function freeCallback(callbackHandle){delete this._callbacks[callbackHandle.callId]};AsyncProxyMaster.getEntryUrl=
function getEntryUrl(){isGetMasterEntryUrlCalled=true;return masterEntryUrl};AsyncProxyMaster._setEntryUrl=function setEntryUrl(newUrl){if(masterEntryUrl!==newUrl&&isGetMasterEntryUrlCalled)throw"Previous values returned from getMasterEntryUrl "+"is wrong. Avoid calling it within the slave c`tor";masterEntryUrl=newUrl};function mainSlaveScriptContent(){importScripts("SCRIPT_PLACEHOLDER");AsyncProxySlave._initializeSlave()}function onWorkerMessage(self,workerEvent){var callId=workerEvent.data.callId;
switch(workerEvent.data.type){case "functionCalled":--self._notReturnedFunctions;trySendPendingMessages(self);break;case "promiseResult":var promiseData=self._pendingPromiseCalls[callId];delete self._pendingPromiseCalls[callId];var result=workerEvent.data.result;promiseData.resolve(result);break;case "promiseFailure":var promiseData=self._pendingPromiseCalls[callId];delete self._pendingPromiseCalls[callId];var reason=workerEvent.data.reason;promiseData.reject(reason);break;case "userData":if(self._userDataHandler!==
null)self._userDataHandler(workerEvent.data.userData);break;case "callback":var callbackHandle=self._callbacks[workerEvent.data.callId];if(callbackHandle===undefined)throw"Unexpected message from SlaveWorker of callback ID: "+workerEvent.data.callId+". Maybe should indicate "+"isMultipleTimesCallback = true on creation?";if(!callbackHandle.isMultipleTimeCallback)self.freeCallback(self._callbacks[workerEvent.data.callId]);if(callbackHandle.callback!==null)callbackHandle.callback.apply(null,workerEvent.data.args);
break;case "subWorkerCtor":var subWorker=new Worker(workerEvent.data.scriptUrl);var id=workerEvent.data.subWorkerId;self._subWorkerById[id]=subWorker;self._subWorkers.push(subWorker);subWorker.onmessage=function onSubWorkerMessage(subWorkerEvent){enqueueMessageToSlave(self,subWorkerEvent.ports,false,{functionToCall:"subWorkerOnMessage",subWorkerId:id,data:subWorkerEvent.data})};break;case "subWorkerPostMessage":var subWorker=self._subWorkerById[workerEvent.data.subWorkerId];subWorker.postMessage(workerEvent.data.data);
break;case "subWorkerTerminate":var subWorker=self._subWorkerById[workerEvent.data.subWorkerId];subWorker.terminate();break;default:throw"Unknown message from AsyncProxySlave of type: "+workerEvent.data.type;}}function enqueueMessageToSlave(self,transferables,isFunctionCall,message){if(self._notReturnedFunctions>=self._functionsBufferSize){self._pendingMessages.push({transferables:transferables,isFunctionCall:isFunctionCall,message:message});return}sendMessageToSlave(self,transferables,isFunctionCall,
message)}function sendMessageToSlave(self,transferables,isFunctionCall,message){if(isFunctionCall)++self._notReturnedFunctions;self._worker.postMessage(message,transferables)}function trySendPendingMessages(self){while(self._notReturnedFunctions<self._functionsBufferSize&&self._pendingMessages.length>0){var message=self._pendingMessages.shift();sendMessageToSlave(self,message.transferables,message.isFunctionCall,message.message)}}function getBaseUrlFromEntryScript(){var baseUrl=location.href;var endOfPath=
baseUrl.lastIndexOf("/");if(endOfPath>=0)baseUrl=baseUrl.substring(0,endOfPath);return baseUrl}return AsyncProxyMaster}();var SubWorkerEmulationForChrome=function SubWorkerEmulationForChromeClosure(){var subWorkerId=0;var subWorkerIdToSubWorker=null;function SubWorkerEmulationForChrome(scriptUrl){if(subWorkerIdToSubWorker===null)throw"AsyncProxy internal error: SubWorkerEmulationForChrome "+"not initialized";this._subWorkerId=++subWorkerId;subWorkerIdToSubWorker[this._subWorkerId]=this;self.postMessage({type:"subWorkerCtor",subWorkerId:this._subWorkerId,scriptUrl:scriptUrl})}SubWorkerEmulationForChrome.initialize=function initialize(subWorkerIdToSubWorker_){subWorkerIdToSubWorker=
subWorkerIdToSubWorker_};SubWorkerEmulationForChrome.prototype.postMessage=function postMessage(data,transferables){self.postMessage({type:"subWorkerPostMessage",subWorkerId:this._subWorkerId,data:data},transferables)};SubWorkerEmulationForChrome.prototype.terminate=function terminate(data,transferables){self.postMessage({type:"subWorkerTerminate",subWorkerId:this._subWorkerId},transferables)};return SubWorkerEmulationForChrome}();
var AsyncProxySlave=function AsyncProxySlaveClosure(){var slaveHelperSingleton={};var beforeOperationListener=null;var slaveSideMainInstance;var slaveSideInstanceCreator=defaultInstanceCreator;var subWorkerIdToSubWorker={};var ctorName;slaveHelperSingleton._initializeSlave=function initializeSlave(){self.onmessage=onMessage};slaveHelperSingleton.setSlaveSideCreator=function setSlaveSideCreator(creator){slaveSideInstanceCreator=creator};slaveHelperSingleton.setBeforeOperationListener=function setBeforeOperationListener(listener){beforeOperationListener=
listener};slaveHelperSingleton.sendUserDataToMaster=function sendUserDataToMaster(userData){self.postMessage({type:"userData",userData:userData})};slaveHelperSingleton.wrapPromiseFromSlaveSide=function wrapPromiseFromSlaveSide(callId,promise,pathsToTransferables){var promiseThen=promise.then(function sendPromiseToMaster(result){var transferables=extractTransferables(pathsToTransferables,result);self.postMessage({type:"promiseResult",callId:callId,result:result},transferables)});promiseThen["catch"](function sendFailureToMaster(reason){self.postMessage({type:"promiseFailure",
callId:callId,reason:reason})})};slaveHelperSingleton.wrapCallbackFromSlaveSide=function wrapCallbackFromSlaveSide(callbackHandle){var isAlreadyCalled=false;function callbackWrapperFromSlaveSide(){if(isAlreadyCalled)throw"Callback is called twice but isMultipleTimeCallback "+"= false";var argumentsAsArray=getArgumentsAsArray(arguments);if(beforeOperationListener!==null)beforeOperationListener.call(slaveSideMainInstance,"callback",callbackHandle.callbackName,argumentsAsArray);var transferables=extractTransferables(callbackHandle.pathsToTransferables,
argumentsAsArray);self.postMessage({type:"callback",callId:callbackHandle.callId,args:argumentsAsArray},transferables);if(!callbackHandle.isMultipleTimeCallback)isAlreadyCalled=true}return callbackWrapperFromSlaveSide};slaveHelperSingleton._getScriptName=function _getScriptName(){var error=new Error;var scriptName=ScriptsToImportPool._getScriptName(error);return scriptName};function extractTransferables(pathsToTransferables,pathsBase){if(pathsToTransferables===undefined)return undefined;var transferables=
new Array(pathsToTransferables.length);for(var i=0;i<pathsToTransferables.length;++i){var path=pathsToTransferables[i];var transferable=pathsBase;for(var j=0;j<path.length;++j){var member=path[j];transferable=transferable[member]}transferables[i]=transferable}return transferables}function onMessage(event){var functionNameToCall=event.data.functionToCall;var args=event.data.args;var callId=event.data.callId;var isPromise=event.data.isPromise;var pathsToTransferablesInPromiseResult=event.data.pathsToTransferablesInPromiseResult;
var result=null;switch(functionNameToCall){case "ctor":AsyncProxyMaster._setEntryUrl(event.data.masterEntryUrl);var scriptsToImport=event.data.scriptsToImport;ctorName=event.data.ctorName;for(var i=0;i<scriptsToImport.length;++i)importScripts(scriptsToImport[i]);slaveSideMainInstance=slaveSideInstanceCreator.apply(null,args);return;case "subWorkerOnMessage":var subWorker=subWorkerIdToSubWorker[event.data.subWorkerId];var workerEvent={data:event.data.data};subWorker.onmessage(workerEvent);return}args=
new Array(event.data.args.length);for(var i=0;i<event.data.args.length;++i){var arg=event.data.args[i];if(arg!==undefined&&arg!==null&&arg.isWorkerHelperCallback)arg=slaveHelperSingleton.wrapCallbackFromSlaveSide(arg);args[i]=arg}var functionContainer=slaveSideMainInstance;var functionToCall;while(functionContainer){functionToCall=slaveSideMainInstance[functionNameToCall];if(functionToCall)break;functionContainer=functionContainer.__proto__}if(!functionToCall)throw"AsyncProxy error: could not find function "+
functionToCall;var promise=functionToCall.apply(slaveSideMainInstance,args);if(isPromise)slaveHelperSingleton.wrapPromiseFromSlaveSide(callId,promise,pathsToTransferablesInPromiseResult);self.postMessage({type:"functionCalled",callId:event.data.callId,result:result})}function defaultInstanceCreator(){var TypeCtor=self[ctorName];var bindArgs=[null].concat(getArgumentsAsArray(arguments));var instance=new (Function.prototype.bind.apply(TypeCtor,bindArgs));return instance}function getArgumentsAsArray(args){var argumentsAsArray=
new Array(args.length);for(var i=0;i<args.length;++i)argumentsAsArray[i]=args[i];return argumentsAsArray}if(self["Worker"]===undefined){SubWorkerEmulationForChrome.initialize(subWorkerIdToSubWorker);self["Worker"]=SubWorkerEmulationForChrome}return slaveHelperSingleton}();var ScriptsToImportPool=function ScriptsToImportPoolClosure(){function ScriptsToImportPool(){this._scriptsByName={};this._scriptsArray=null}ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace=function addScriptForWorkerImport(errorWithStackTrace){var fileName=ScriptsToImportPool._getScriptName(errorWithStackTrace);if(!this._scriptsByName[fileName]){this._scriptsByName[fileName]=true;this._scriptsArray=null}};ScriptsToImportPool.prototype.getScriptsForWorkerImport=function getScriptsForWorkerImport(){if(this._scriptsArray===
null){this._scriptsArray=[];for(var fileName in this._scriptsByName)this._scriptsArray.push(fileName)}return this._scriptsArray};ScriptsToImportPool._getScriptName=function getScriptName(errorWithStackTrace){var stack=errorWithStackTrace.stack.trim();var currentStackFrameRegex=/at (|[^ ]+ \()([^ ]+):\d+:\d+/;var source=currentStackFrameRegex.exec(stack);if(source&&source[2]!=="")return source[2];var lastStackFrameRegex=new RegExp(/.+\/(.*?):\d+(:\d+)*$/);source=lastStackFrameRegex.exec(stack);if(source&&
source[1]!=="")return source[1];if(errorWithStackTrace.fileName!=undefined)return errorWithStackTrace.fileName;throw"ImageDecoderFramework.js: Could not get current script URL";};return ScriptsToImportPool}();self["AsyncProxy"]={};self["AsyncProxy"]["AsyncProxySlave"]=AsyncProxySlave;self["AsyncProxy"]["AsyncProxyMaster"]=AsyncProxyMaster;self["AsyncProxy"]["ScriptsToImportPool"]=ScriptsToImportPool;SubWorkerEmulationForChrome.prototype["postMessage"]=SubWorkerEmulationForChrome.prototype.postMessage;SubWorkerEmulationForChrome.prototype["terminate"]=SubWorkerEmulationForChrome.prototype.terminate;AsyncProxySlave["setSlaveSideCreator"]=AsyncProxySlave.setSlaveSideCreator;
AsyncProxySlave["setBeforeOperationListener"]=AsyncProxySlave.setBeforeOperationListener;AsyncProxySlave["sendUserDataToMaster"]=AsyncProxySlave.sendUserDataToMaster;AsyncProxySlave["wrapPromiseFromSlaveSide"]=AsyncProxySlave.wrapPromiseFromSlaveSide;AsyncProxySlave["wrapCallbackFromSlaveSide"]=AsyncProxySlave.wrapCallbackFromSlaveSide;AsyncProxyMaster.prototype["setUserDataHandler"]=AsyncProxyMaster.prototype.setUserDataHandler;AsyncProxyMaster.prototype["terminate"]=AsyncProxyMaster.prototype.terminate;
AsyncProxyMaster.prototype["callFunction"]=AsyncProxyMaster.prototype.callFunction;AsyncProxyMaster.prototype["wrapCallback"]=AsyncProxyMaster.prototype.wrapCallback;AsyncProxyMaster.prototype["freeCallback"]=AsyncProxyMaster.prototype.freeCallback;AsyncProxyMaster["getEntryUrl"]=AsyncProxyMaster.getEntryUrl;ScriptsToImportPool.prototype["addScriptFromErrorWithStackTrace"]=ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace;ScriptsToImportPool.prototype["getScriptsForWorkerImport"]=ScriptsToImportPool.prototype.getScriptsForWorkerImport;
