!function(t){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=t();else if("function"==typeof define&&define.amd)define([],t);else{var e;e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,e.asyncProxy=t()}}(function(){return function t(e,r,s){function n(i,o){if(!r[i]){if(!e[i]){var l="function"==typeof require&&require;if(!o&&l)return l(i,!0);if(a)return a(i,!0);var c=new Error("Cannot find module '"+i+"'");throw c.code="MODULE_NOT_FOUND",c}var u=r[i]={exports:{}};e[i][0].call(u.exports,function(t){var r=e[i][1][t];return n(r?r:t)},u,u.exports,t,e,r,s)}return r[i].exports}for(var a="function"==typeof require&&require,i=0;i<s.length;i++)n(s[i]);return n}({1:[function(t,e,r){"use strict";var s=t("sub-worker-emulation-for-chrome"),n=t("async-proxy-factory"),a=t("async-proxy-slave"),i=t("async-proxy-master"),o=t("scripts-to-Import-Pool"),l=t("dependency-workers"),c=t("dependency-workers-task-handle"),u=t("dependency-workers-task"),p=t("wrapper-input-retreiver-base"),d=t("scheduler-task"),h=t("scheduler-wrapper-input-retreiver"),y=t("scheduler-dependency-workers");e.exports.SubWorkerEmulationForChrome=s,e.exports.AsyncProxyFactory=n,e.exports.AsyncProxySlave=a,e.exports.AsyncProxyMaster=i,e.exports.ScriptsToImportPool=o,e.exports.DependencyWorkers=l,e.exports.DependencyWorkersTaskHandle=c,e.exports.DependencyWorkersTask=u,e.exports.WrapperInputRetreiverBase=p,e.exports.SchedulerTask=d,e.exports.SchedulerWrapperInputRetreiver=h,e.exports.SchedulerDependencyWorkers=y},{"async-proxy-factory":2,"async-proxy-master":3,"async-proxy-slave":4,"dependency-workers":8,"dependency-workers-task":7,"dependency-workers-task-handle":6,"scheduler-dependency-workers":12,"scheduler-task":13,"scheduler-wrapper-input-retreiver":14,"scripts-to-Import-Pool":16,"sub-worker-emulation-for-chrome":18,"wrapper-input-retreiver-base":15}],2:[function(t,e,r){"use strict";var s=t("async-proxy-master"),n=function(){function t(t,e,r){if("function"==typeof r)return void(t.prototype[e]=r);r[0]||{};t.prototype[e]=function(){for(var t=this._getWorkerHelper(),s=[],n=0;n<arguments.length;++n){var a=r[n+1],i=arguments[n];if("callback"===a)s[n]=t.wrapCallback(i);else{if(a)throw"AsyncProxyFactory error: Unrecognized argument description "+a+" in argument "+(n+1)+" of method "+e;s[n]=i}}return t.callFunction(e,s,r[0])}}function e(t){for(var e=new Array(t.length),r=0;r<t.length;++r)e[r]=t[r];return e}var r={};return r.create=function(r,n,a,i){if(!r||!r.length)throw"AsyncProxyFactory error: missing scriptsToImport (2nd argument)";if(!a)throw"AsyncProxyFactory error: missing methods (3rd argument)";var o=i||function(){this.__workerHelperCtorArgs=e(arguments)};o.prototype._getWorkerHelper=function(){return this.__workerHelper||(this.__workerHelper=new s(r,n,this.__workerHelperCtorArgs||[])),this.__workerHelper};for(var l in a)t(o,l,a[l]||[]);return o},r}();e.exports=n},{"async-proxy-master":3}],3:[function(t,e,r){"use strict";var s=t("scripts-to-import-pool"),n=function(){function t(s,a,i,o){function l(t){n(u,t)}var u=this;o=o||{},u._callbacks=[],u._pendingPromiseCalls=[],u._subWorkerById=[],u._subWorkers=[],u._userDataHandler=null,u._notReturnedFunctions=0,u._functionsBufferSize=o.functionsBufferSize||5,u._pendingMessages=[];var p=e(),d=r.toString();d=d.replace("SCRIPT_PLACEHOLDER",p);var h=new Blob(["(",d,")()"],{type:"application/javascript"}),y=URL.createObjectURL(h);u._worker=new Worker(y),u._worker.onmessage=l,u._worker.postMessage({functionToCall:"ctor",scriptsToImport:s,ctorName:a,args:i,callId:++c,isPromise:!1,masterEntryUrl:t.getEntryUrl()})}function e(){var t=new Error;return s._getScriptName(t)}function r(){importScripts("SCRIPT_PLACEHOLDER"),asyncProxy.AsyncProxySlave._initializeSlave()}function n(t,e){var r=e.data.callId;switch(e.data.type){case"functionCalled":--t._notReturnedFunctions,o(t);break;case"promiseResult":var s=t._pendingPromiseCalls[r];delete t._pendingPromiseCalls[r];var n=e.data.result;s.resolve(n);break;case"promiseFailure":var i=t._pendingPromiseCalls[r];delete t._pendingPromiseCalls[r];var l=e.data.reason;i.reject(l);break;case"userData":null!==t._userDataHandler&&t._userDataHandler(e.data.userData);break;case"callback":var c=t._callbacks[e.data.callId];if(void 0===c)throw"Unexpected message from SlaveWorker of callback ID: "+e.data.callId+". Maybe should indicate isMultipleTimesCallback = true on creation?";c.isMultipleTimeCallback||t.freeCallback(t._callbacks[e.data.callId]),null!==c.callback&&c.callback.apply(null,e.data.args);break;case"subWorkerCtor":var u=new Worker(e.data.scriptUrl),p=e.data.subWorkerId;t._subWorkerById[p]=u,t._subWorkers.push(u),u.onmessage=function(e){a(t,e.ports,!1,{functionToCall:"subWorkerOnMessage",subWorkerId:p,data:e.data})};break;case"subWorkerPostMessage":var d=t._subWorkerById[e.data.subWorkerId];d.postMessage(e.data.data);break;case"subWorkerTerminate":var h=t._subWorkerById[e.data.subWorkerId];h.terminate();break;default:throw"Unknown message from AsyncProxySlave of type: "+e.data.type}}function a(t,e,r,s){return t._notReturnedFunctions>=t._functionsBufferSize?void t._pendingMessages.push({transferables:e,isFunctionCall:r,message:s}):void i(t,e,r,s)}function i(t,e,r,s){r&&++t._notReturnedFunctions,t._worker.postMessage(s,e)}function o(t){for(;t._notReturnedFunctions<t._functionsBufferSize&&t._pendingMessages.length>0;){var e=t._pendingMessages.shift();i(t,e.transferables,e.isFunctionCall,e.message)}}function l(){var t=location.href,e=t.lastIndexOf("/");return e>=0&&(t=t.substring(0,e)),t}var c=0,u=!1,p=l();return t.prototype.setUserDataHandler=function(t){this._userDataHandler=t},t.prototype.terminate=function(){this._worker.terminate();for(var t=0;t<this._subWorkers.length;++t)this._subWorkers[t].terminate()},t.prototype.callFunction=function(e,r,s){s=s||{};var n=!!s.isReturnPromise,o=s.transferables||[],l=s.pathsToTransferablesInPromiseResult,u=++c,p=null,d=this;n&&(p=new Promise(function(t,e){d._pendingPromiseCalls[u]={resolve:t,reject:e}}));var h,y=s.isSendImmediately?i:a;if(h="function"==typeof o?o():t._extractTransferables(o,r),y(this,h,!0,{functionToCall:e,args:r||[],callId:u,isPromise:n,pathsToTransferablesInPromiseResult:l}),n)return p},t.prototype.wrapCallback=function(t,e,r){r=r||{};var s=++c,n={isWorkerHelperCallback:!0,isMultipleTimeCallback:!!r.isMultipleTimeCallback,callId:s,callbackName:e,pathsToTransferables:r.pathsToTransferables},a={isMultipleTimeCallback:!!r.isMultipleTimeCallback,callId:s,callback:t,pathsToTransferables:r.pathsToTransferables};return this._callbacks[s]=a,n},t.prototype.freeCallback=function(t){delete this._callbacks[t.callId]},t.getEntryUrl=function(){return u=!0,p},t._setEntryUrl=function(t){if(p!==t&&u)throw"Previous values returned from getMasterEntryUrl is wrong. Avoid calling it within the slave c`tor";p=t},t._extractTransferables=function(t,e){if(void 0!==t){for(var r=new Array(t.length),s=0;s<t.length;++s){for(var n=t[s],a=e,i=0;i<n.length;++i){var o=n[i];a=a[o]}r[s]=a}return r}},t}();e.exports=n},{"scripts-to-import-pool":17}],4:[function(t,e,r){"use strict";var s=t("async-proxy-master"),n=t("sub-worker-emulation-for-chrome"),a=function(){function t(t){var e=t.data.functionToCall,r=t.data.args,n=t.data.callId,l=t.data.isPromise,p=t.data.pathsToTransferablesInPromiseResult,d=null;switch(e){case"ctor":s._setEntryUrl(t.data.masterEntryUrl);var h=t.data.scriptsToImport;i=t.data.ctorName;for(var y=0;y<h.length;++y)importScripts(h[y]);return void(a=c.apply(null,r));case"subWorkerOnMessage":var f=u[t.data.subWorkerId],_={data:t.data.data};return void f.onmessage(_)}r=new Array(t.data.args.length);for(var k=0;k<t.data.args.length;++k){var v=t.data.args[k];void 0!==v&&null!==v&&v.isWorkerHelperCallback&&(v=o.wrapCallbackFromSlaveSide(v)),r[k]=v}for(var g,m=a;m&&!(g=a[e]);)m=m.__proto__;if(!g)throw"AsyncProxy error: could not find function "+e;var T=g.apply(a,r);l&&o.wrapPromiseFromSlaveSide(n,T,p),self.postMessage({type:"functionCalled",callId:t.data.callId,result:d})}function e(){var t;try{for(var e=i.split("."),s=self,n=0;n<e.length;++n)s=s[e[n]];var a=s,o=[null].concat(r(arguments));t=new(Function.prototype.bind.apply(a,o))}catch(l){throw new Error("Failed locating class name "+i+": "+l)}return t}function r(t){for(var e=new Array(t.length),r=0;r<t.length;++r)e[r]=t[r];return e}var a,i,o={},l=null,c=e,u={};return o._initializeSlave=function(){self.onmessage=t},o.setSlaveSideCreator=function(t){c=t},o.setBeforeOperationListener=function(t){l=t},o.sendUserDataToMaster=function(t){self.postMessage({type:"userData",userData:t})},o.wrapPromiseFromSlaveSide=function(t,e,r){var n=e.then(function(e){var n=s._extractTransferables(r,e);self.postMessage({type:"promiseResult",callId:t,result:e},n)});n["catch"](function(e){self.postMessage({type:"promiseFailure",callId:t,reason:e})})},o.wrapCallbackFromSlaveSide=function(t){function e(){if(n)throw"Callback is called twice but isMultipleTimeCallback = false";var e=r(arguments);if(null!==l)try{l.call(a,"callback",t.callbackName,e)}catch(i){console.log("AsyncProxySlave.beforeOperationListener has thrown an exception: "+i)}var o=s._extractTransferables(t.pathsToTransferables,e);self.postMessage({type:"callback",callId:t.callId,args:e},o),t.isMultipleTimeCallback||(n=!0)}var n=!1;return e},void 0===self.Worker&&(n.initialize(u),self.Worker=n),o}();e.exports=a},{"async-proxy-master":3,"sub-worker-emulation-for-chrome":18}],5:[function(t,e,r){"use strict";var s=t("linked-list"),n=t("js-builtin-hash-map"),a=t("dependency-workers-task"),i=function(){function t(){this.isTerminated=!1,this.priority=0,this.lastProcessedData=null,this.taskApi=null,this.hasProcessedData=!1,this.waitingForWorkerResult=!1,this.isPendingDataForWorker=!1,this.pendingDataForWorker=null,this.pendingWorkerType=0,this.taskHandles=new s,this.taskKey=null,this._isActualTerminationPending=!1,this._dependsTasksTerminatedCount=0,this._parentDependencyWorkers=null,this._workerInputRetreiver=null,this._parentList=null,this._parentIterator=null,this._dependsTaskHandles=null,this._dependTaskKeys=[],this._dependTaskResults=[],this._hasDependTaskData=[]}return t.prototype.initialize=function(t,e,r,s,i){this.taskKey=t,this._parentDependencyWorkers=e,this._workerInputRetreiver=r,this._parentList=s,this._parentIterator=i,this._dependsTaskHandles=new n,this.taskApi=new a(this,t)},t.prototype.ended=function(){this._parentList.remove(this._parentIterator),this._parentIterator=null;for(var t=this._dependsTaskHandles.getFirstIterator();null!==t;){var e=this._dependsTaskHandles.getFromIterator(t).taskHandle;t=this._dependsTaskHandles.getNextIterator(t),e.unregister()}this._dependsTaskHandles.clear();var r=this;setTimeout(function(){for(t=r.taskHandles.getFirstIterator();null!==t;){var e=r.taskHandles.getFromIterator(t);t=r.taskHandles.getNextIterator(t),e._callbacks.onTerminated&&e._callbacks.onTerminated()}r.taskHandles.clear()})},t.prototype.setPriorityAndNotify=function(t){if(this.priority!==t){this.priority=t,this.statusUpdate();for(var e=this._dependsTaskHandles.getFirstIterator();null!==e;){var r=this._dependsTaskHandles.getFromIterator(e).taskHandle;e=this._dependsTaskHandles.getNextIterator(e),r.setPriority(t)}}},t.prototype.statusUpdate=function(){var t={priority:this.priority,hasListeners:this.taskHandles.getCount()>0,isWaitingForWorkerResult:this.waitingForWorkerResult,terminatedDependsTasks:this._dependsTasksTerminatedCount,dependsTasks:this._dependsTaskHandles.getCount()};this.taskApi._onEvent("statusUpdated",t),this._isActualTerminationPending&&!this.waitingForWorkerResult&&(this._isActualTerminationPending=!1,this.ended())},t.prototype.recalculatePriority=function(){for(var t=this.taskHandles,e=t.getFirstIterator(),r=!0,s=0;null!==e;){var n=t.getFromIterator(e);(r||n._localPriority>s)&&(s=n._localPriority),e=t.getNextIterator(e)}return s},t.prototype.newData=function(t){this.hasProcessedData=!0,this.lastProcessedData=t;var e=this;setTimeout(function(){for(var r=e.taskHandles,s=r.getFirstIterator();null!==s;){var n=r.getFromIterator(s);s=r.getNextIterator(s),n._callbacks.onData(t,e.taskKey)}})},t.prototype.dataReady=function(t,e){if(this.isTerminated)throw"AsyncProxy.DependencyWorkers: already terminated";this.waitingForWorkerResult?(this.pendingDataForWorker=t,this.isPendingDataForWorker=!0,this.pendingWorkerType=e):this._parentDependencyWorkers._dataReady(this,t,e)},t.prototype.terminate=function(){if(this.isTerminated)throw"AsyncProxy.DependencyWorkers: already terminated";this.isTerminated=!0,this.waitingForWorkerResult?this._isActualTerminationPending=!0:this.ended()},Object.defineProperty(t.prototype,"dependTaskKeys",{get:function(){return this._dependTaskKeys}}),Object.defineProperty(t.prototype,"dependTaskResults",{get:function(){return this._dependTaskResults}}),t.prototype.registerTaskDependency=function(t){function e(e){a._dependTaskResults[l]=e,a._hasDependTaskData[l]=!0,a.taskApi._onEvent("dependencyTaskData",e,t),i=!0}function r(){if(o)throw"AsyncProxy.DependencyWorkers: Double termination";o=!0,a._dependsTaskTerminated()}var s=this._workerInputRetreiver.getKeyAsString(t),n=this._dependsTaskHandles.tryAdd(s,function(){return{taskHandle:null}});if(!n.isNew)throw"AsyncProxy.DependencyWorkers: Cannot add task dependency twice";var a=this,i=!1,o=!1,l=this._dependTaskKeys.length;this._dependTaskKeys[l]=t,n.value.taskHandle=this._parentDependencyWorkers.startTask(t,{onData:e,onTerminated:r}),!i&&n.value.taskHandle.hasData()&&setTimeout(function(){e(n.value.taskHandle.getLastData())})},t.prototype._dependsTaskTerminated=function(){++this._dependsTasksTerminatedCount,this._dependsTasksTerminatedCount===this._dependsTaskHandles.getCount()&&this.taskApi._onEvent("allDependTasksTerminated"),this.statusUpdate()},t}();e.exports=i},{"dependency-workers-task":7,"js-builtin-hash-map":10,"linked-list":11}],6:[function(t,e,r){"use strict";var s=function(){function t(t,e){this._internalContext=t,this._localPriority=0,this._callbacks=e,this._taskHandlesIterator=t.taskHandles.add(this)}return t.prototype.hasData=function(){return this._internalContext.hasProcessedData},t.prototype.getLastData=function(){return this._internalContext.lastProcessedData},t.prototype.setPriority=function(t){if(!this._taskHandlesIterator)throw"AsyncProxy.DependencyWorkers: Already unregistered";var e;e=t>this._internalContext.priority?t:this._localPriority<this._internalContext.priority?this._internalContext.priority:this._internalContext.recalculatePriority(),this._internalContext.setPriorityAndNotify(e)},t.prototype.unregister=function(){if(!this._taskHandlesIterator)throw"AsyncProxy.DependencyWorkers: Already unregistered";if(this._internalContext.taskHandles.remove(this._taskHandlesIterator),this._taskHandlesIterator=null,0===this._internalContext.taskHandles.getCount())this._internalContext.isTerminated||this._internalContext.statusUpdate();else if(this._localPriority===this._internalContext.priority){var t=this._internalContext.recalculatePriority();this._internalContext.setPriorityAndNotify(t)}},t}();e.exports=s},{}],7:[function(t,e,r){"use strict";var s=function(){function t(t,e,r){if(this._wrapped=t,this._key=e,this._eventListeners={dependencyTaskData:[],statusUpdated:[],allDependTasksTerminated:[]},r)for(var s in this._eventListeners)this._registerWrappedEvent(s)}return t.prototype.dataReady=function(t,e){this._wrapped.dataReady(t,e)},t.prototype.terminate=function(){this._wrapped.terminate()},t.prototype.registerTaskDependency=function(t){return this._wrapped.registerTaskDependency(t)},t.prototype.on=function(t,e){if(!this._eventListeners[t])throw"AsyncProxy.DependencyWorkers: Task has no event "+t;this._eventListeners[t].push(e)},Object.defineProperty(t.prototype,"key",{get:function(){return this._key}}),Object.defineProperty(t.prototype,"dependTaskKeys",{get:function(){return this._wrapped.dependTaskKeys}}),Object.defineProperty(t.prototype,"dependTaskResults",{get:function(){return this._wrapped.dependTaskResults}}),t.prototype._onEvent=function(t,e,r){"statusUpdated"==t&&(e=this._modifyStatus(e));for(var s=this._eventListeners[t],n=0;n<s.length;++n)s[n].call(this,e,r)},t.prototype._modifyStatus=function(t){return t},t.prototype._registerWrappedEvent=function(t){var e=this;this._wrapped.on(t,function(r,s){e._onEvent(t,r,s)})},t}();e.exports=s},{}],8:[function(t,e,r){"use strict";var s=t("js-builtin-hash-map"),n=t("dependency-workers-internal-context"),a=t("dependency-workers-task-handle"),i=t("async-proxy-master"),o=function(){function t(t){var e=this;if(e._workerInputRetreiver=t,e._internalContexts=new s,e._workerPoolByTaskType=[],e._taskOptionsByTaskType=[],!t.getWorkerTypeOptions)throw"AsyncProxy.DependencyWorkers: No workerInputRetreiver.getWorkerTypeOptions() method";if(!t.getKeyAsString)throw"AsyncProxy.DependencyWorkers: No workerInputRetreiver.getKeyAsString() method"}return t.prototype.startTask=function(t,e){var r=this._workerInputRetreiver.getKeyAsString(t),s=this._internalContexts.tryAdd(r,function(){return new n}),i=s.value,o=new a(i,e);return s.isNew&&(i.initialize(t,this,this._workerInputRetreiver,this._internalContexts,s.iterator,this._workerInputRetreiver),this._workerInputRetreiver.taskStarted(i.taskApi)),o},t.prototype.startTaskPromise=function(t){var e=this;return new Promise(function(r,s){function n(t){l=!0,i=t}function a(){l?r(i):s("AsyncProxy.DependencyWorkers: Internal error - task terminated but no data returned")}var i,o=e.startTask(t,{onData:n,onTerminated:a}),l=o.hasData();l&&(i=o.getLastData())})},t.prototype._dataReady=function(t,e,r){var s,n=this,a=n._workerPoolByTaskType[r];if(a||(a=[],n._workerPoolByTaskType[r]=a),a.length>0)s=a.pop();else{var o=n._workerInputRetreiver.getWorkerTypeOptions(r);if(!o)return t.newData(e),void t.statusUpdate();s=new i(o.scriptsToImport,o.ctorName,o.ctorArgs)}t.waitingForWorkerResult||(t.waitingForWorkerResult=!0,t.statusUpdate()),s.callFunction("start",[e,t.taskKey],{isReturnPromise:!0}).then(function(e){return t.newData(e),e})["catch"](function(t){return console.log("Error in DependencyWorkers' worker: "+t),t}).then(function(e){a.push(s),n._checkIfPendingData(t)||(t.waitingForWorkerResult=!1,t.statusUpdate())})},t.prototype._checkIfPendingData=function(t){if(!t.isPendingDataForWorker)return!1;var e=t.pendingDataForWorker;return t.isPendingDataForWorker=!1,t.pendingDataForWorker=null,this._dataReady(t,e,t.pendingWorkerType),!0},t}();e.exports=o},{"async-proxy-master":3,"dependency-workers-internal-context":5,"dependency-workers-task-handle":6,"js-builtin-hash-map":10}],9:[function(t,e,r){"use strict";var s=t("linked-list"),n=function(){function t(t){var e=this;e._hasher=t,e.clear()}return t.prototype.clear=function(){this._listByKey=[],this._listOfLists=new s,this._count=0},t.prototype.getFromKey=function(t){var e=this._hasher.getHashCode(t),r=this._listByKey[e];if(!r)return null;for(var s=r.list,n=s.getFirstIterator();null!==n;){var a=s.getFromIterator(n);if(this._hasher.isEqual(a.key,t))return a.value;n=s.getNextIterator(n)}return null},t.prototype.getFromIterator=function(t){return t._hashElements.list.getFromIterator(t._internalIterator).value},t.prototype.tryAdd=function(t,e){var r=this._hasher.getHashCode(t),n=this._listByKey[r];n||(n={hashCode:r,list:new s,listOfListsIterator:null},n.listOfListsIterator=this._listOfLists.add(n),this._listByKey[r]=n);var a={_hashElements:n,_internalIterator:null};for(a._internalIterator=n.list.getFirstIterator();null!==a._internalIterator;){var i=n.list.getFromIterator(a._internalIterator);if(this._hasher.isEqual(i.key,t))return{iterator:a,isNew:!1,value:i.value};a._internalIterator=n.list.getNextIterator(a._internalIterator)}var o=e();return a._internalIterator=n.list.add({key:t,value:o}),++this._count,{iterator:a,isNew:!0,value:o}},t.prototype.remove=function(t){var e=t._hashElements.list.getCount();t._hashElements.list.remove(t._internalIterator);var r=t._hashElements.list.getCount();this._count+=r-e,0===r&&(this._listOfLists.remove(t._hashElements.listOfListsIterator),delete this._listByKey[t._hashElements.hashCode])},t.prototype.getCount=function(){return this._count},t.prototype.getFirstIterator=function(){var t=this._listOfLists.getFirstIterator(),e=null,r=null;return null!==t&&(e=this._listOfLists.getFromIterator(t),r=e.list.getFirstIterator()),null===r?null:{_hashElements:e,_internalIterator:r}},t.prototype.getNextIterator=function(t){for(var e={_hashElements:t._hashElements,_internalIterator:t._hashElements.list.getNextIterator(t._internalIterator)};null===e._internalIterator;){var r=this._listOfLists.getNextIterator(t._hashElements.listOfListsIterator);if(null===r)return null;e._hashElements=this._listOfLists.getFromIterator(r),e._internalIterator=e._hashElements.list.getFirstIterator()}return e},t}();e.exports=n},{"linked-list":11}],10:[function(t,e,r){"use strict";var s=t("hash-map"),n=function(){function t(){s.call(this,e)}var e={getHashCode:function(t){return t},isEqual:function(t,e){return t===e}};return t.prototype=Object.create(s.prototype),t}();e.exports=n},{"hash-map":9}],11:[function(t,e,r){"use strict";var s=function(){function t(){this.clear()}return t.prototype.clear=function(){this._first={_prev:null,_parent:this},this._last={_next:null,_parent:this},this._count=0,this._last._prev=this._first,this._first._next=this._last},t.prototype.add=function(t,e){null!==e&&void 0!==e||(e=this._last),this._validateIteratorOfThis(e),++this._count;var r={_value:t,_next:e,_prev:e._prev,_parent:this};return r._prev._next=r,e._prev=r,r},t.prototype.remove=function(t){this._validateIteratorOfThis(t),--this._count,t._prev._next=t._next,t._next._prev=t._prev,t._parent=null},t.prototype.getFromIterator=function(t){return this._validateIteratorOfThis(t),t._value},t.prototype.getFirstIterator=function(){var t=this.getNextIterator(this._first);return t},t.prototype.getLastIterator=function(){var t=this.getPrevIterator(this._last);return t},t.prototype.getNextIterator=function(t){return this._validateIteratorOfThis(t),t._next===this._last?null:t._next},t.prototype.getPrevIterator=function(t){return this._validateIteratorOfThis(t),t._prev===this._first?null:t._prev},t.prototype.getCount=function(){return this._count},t.prototype._validateIteratorOfThis=function(t){if(t._parent!==this)throw"iterator must be of the current LinkedList"},t}();e.exports=s},{}],12:[function(t,e,r){"use strict";var s=t("scheduler-wrapper-input-retreiver"),n=t("dependency-workers"),a=function(){function t(t,e){var r=new s(t,e);n.call(this,r)}return t.prototype=Object.create(n.prototype),t}();e.exports=a},{"dependency-workers":8,"scheduler-wrapper-input-retreiver":14}],13:[function(t,e,r){"use strict";var s=t("dependency-workers-task"),n=function(){function t(t,e,r,n){var a=this;s.call(this,n,n.key,!0),a._scheduler=t,a._inputRetreiver=e,a._isDisableWorkerCache=r,a._wrappedTask=n,a._onScheduledBound=a._onScheduled.bind(a),a._pendingDataToProcess=null,a._hasPendingDataToProcess=!1,a._cancelPendingDataToProcess=!1,a._isWorkerActive=!1,a._isTerminated=!1,a._lastStatus={isWaitingForWorkerResult:!1}}return t.prototype=Object.create(s.prototype),t.prototype._modifyStatus=function(t){return this._lastStatus=JSON.parse(JSON.stringify(t)),this._checkIfJobDone(t),this._lastStatus.isWaitingForWorkerResult=t.isWaitingForWorkerResult||this._hasPendingDataToProcess,this._lastStatus},t.prototype.dataReady=function(t,e){if(this._isTerminated)throw"AsyncProxy.DependencyWorkers: Data after termination";if(void 0===this._isDisableWorkerCache[e]&&(this._isDisableWorkerCache[e]=null===this._inputRetreiver.getWorkerTypeOptions(e)),this._isDisableWorkerCache[e]){this._pendingDataToProcess=null,this._cancelPendingDataToProcess=this._hasPendingDataToProcess&&!this._isWorkerActive,this._hasPendingDataToProcess=!1,s.prototype.dataReady.call(this,t,e);var r=this._lastStatus.isWaitingForWorkerResult&&!this._hasPendingDataToProcess;return void(r&&(this._lastStatus.isWaitingForWorkerResult=!1,this._onEvent("statusUpdated",this._lastStatus)))}this._pendingDataToProcess=t,this._cancelPendingDataToProcess=!1;var n=this._hasPendingDataToProcess;this._hasPendingDataToProcess=!0,n||this._isWorkerActive||this._scheduler.enqueueJob(this._onScheduledBound,this)},t.prototype.terminate=function(){if(this._isTerminated)throw"AsyncProxy.DependencyWorkers: Double termination";this._isTerminated=!0,this._hasPendingDataToProcess||s.prototype.terminate.call(this)},t.prototype._onScheduled=function(t,e,r){if(e!==this)throw"AsyncProxy.DependencyWorkers: Unexpected context";if(this._cancelPendingDataToProcess)this._cancelPendingDataToProcess=!1,r.jobDone();else{if(!this._hasPendingDataToProcess)throw"AsyncProxy.DependencyWorkers: !enqueuedProcessJob";this._isWorkerActive=!0,this._hasPendingDataToProcess=!1,this._jobCallbacks=r;var n=this._pendingDataToProcess;this._pendingDataToProcess=null,s.prototype.dataReady.call(this,n)}this._isTerminated&&s.prototype.terminate.call(this)},t.prototype._checkIfJobDone=function(t){if(this._isWorkerActive&&!t.isWaitingForWorkerResult){if(this._cancelPendingDataToProcess)throw"AsyncProxy.DependencyWorkers: cancelPendingDataToProcess";this._isWorkerActive=!1,this._hasPendingDataToProcess&&this._scheduler.enqueueJob(this._onScheduledBound,this),this._jobCallbacks.jobDone()}},t}();e.exports=n},{"dependency-workers-task":7}],14:[function(t,e,r){"use strict";var s=t("scheduler-task"),n=t("wrapper-input-retreiver-base"),a=function(){function t(t,e){n.call(this,e);var r=this;if(r._scheduler=t,r._inputRetreiver=e,r._isDisableWorkerCache={},!e.taskStarted)throw"AsyncProxy.DependencyWorkers: No inputRetreiver.taskStarted() method"}return t.prototype=Object.create(n.prototype),t.prototype.taskStarted=function(t){var e=new s(this._scheduler,this._inputRetreiver,this._isDisableWorkerCache,t);return this._inputRetreiver.taskStarted(e)},t}();e.exports=a},{"scheduler-task":13,"wrapper-input-retreiver-base":15}],15:[function(t,e,r){"use strict";var s=function(){function t(t){if(!t.getKeyAsString)throw"AsyncProxy.DependencyWorkers: No inputRetreiver.getKeyAsString() method";if(!t.getWorkerTypeOptions)throw"AsyncProxy.DependencyWorkers: No inputRetreiver.getTaskTypeOptions() method";var e=this;e._inputRetreiver=t}return t.prototype.taskStarted=function(t){throw"AsyncProxy.WrapperInputRetreiverBase internal error: Not implemented taskStarted()"},t.prototype.getKeyAsString=function(t){return this._inputRetreiver.getKeyAsString(t)},t.prototype.getWorkerTypeOptions=function(t){return this._inputRetreiver.getWorkerTypeOptions(t)},t}();e.exports=s},{}],16:[function(t,e,r){"use strict";var s=function(){function t(){var t=this;t._scriptsByName={},t._scriptsArray=null}return t.prototype.addScriptFromErrorWithStackTrace=function(e){var r=t._getScriptName(e);this._scriptsByName[r]||(this._scriptsByName[r]=!0,this._scriptsArray=null)},t.prototype.getScriptsForWorkerImport=function(){if(null===this._scriptsArray){this._scriptsArray=[];for(var t in this._scriptsByName)this._scriptsArray.push(t)}return this._scriptsArray},t._getScriptName=function(t){var e=t.stack.trim(),r=/at (|[^ ]+ \()([^ ]+):\d+:\d+/,s=r.exec(e);if(s&&""!==s[2])return s[2];var n=new RegExp(/.+\/(.*?):\d+(:\d+)*$/);if(s=n.exec(e),s&&""!==s[1])return s[1];if(void 0!==t.fileName)return t.fileName;throw"ImageDecoderFramework.js: Could not get current script URL"},t}();e.exports=s},{}],17:[function(t,e,r){arguments[4][16][0].apply(r,arguments)},{dup:16}],18:[function(t,e,r){"use strict";var s=function(){function t(t){if(null===r)throw"AsyncProxy internal error: SubWorkerEmulationForChrome not initialized";var s=this;s._subWorkerId=++e,r[s._subWorkerId]=s,self.postMessage({type:"subWorkerCtor",subWorkerId:s._subWorkerId,scriptUrl:t})}var e=0,r=null;return t.initialize=function(t){r=t},t.prototype.postMessage=function(t,e){self.postMessage({type:"subWorkerPostMessage",subWorkerId:this._subWorkerId,data:t},e)},t.prototype.terminate=function(t,e){self.postMessage({type:"subWorkerTerminate",subWorkerId:this._subWorkerId},e)},t}();e.exports=s},{}]},{},[1])(1)});