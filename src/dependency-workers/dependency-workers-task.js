'use strict';

var DependencyWorkersTask = (function DependencyWorkersTaskClosure() {
	function DependencyWorkersTask(internalContext, parentObj, onRegistered, onTerminated, dataReadyObj, dataReady) {
		this._internalContext = internalContext;
		this._onRegistered = onRegistered;
		this._onTerminated = onTerminated;
		this._dataReady = dataReady;
		this._parentObj = parentObj;
		this._dataReadyObj = dataReadyObj;
		this._eventListeners = {
			'dependencyTaskData': [],
			'statusUpdated': [],
			'allDependTasksTerminated': []
		};
	}
	
	DependencyWorkersTask.prototype.dataReady = function dataReady(newDataToProcess, workerType) {
		if (this._internalContext.isTerminated) {
			throw 'AsyncProxy.DependencyWorkers: already terminated';
		} else if (this._internalContext.waitingForWorkerResult) {
			// Used in DependencyWorkers._startWorker() when previous worker has finished
			this._internalContext.pendingDataForWorker = newDataToProcess;
			this._internalContext.isPendingDataForWorker = true;
			this._internalContext.pendingWorkerType = workerType;
		} else {
			this._dataReady.call(
				this._dataReadyObj,
				this._internalContext,
				newDataToProcess,
				workerType);
		}
	};
	
	DependencyWorkersTask.prototype.terminate = function terminate() {
		this._onTerminated.call(this._parentObj);
	};
	
	DependencyWorkersTask.prototype.registerTaskDependency = function registerTaskDependency(taskKey) {
		return this._internalContext.registerTaskDependency(taskKey);
	};
	
	DependencyWorkersTask.prototype.on = function on(event, listener) {
		if (!this._eventListeners[event]) {
			throw 'AsyncProxy.DependencyWorkers: Task has no event ' + event;
		}
		this._eventListeners[event].push(listener);
		
		if (this._onRegistered) {
			this._onRegistered.call(this._parentObj, event, listener);
		}
	};
	
	Object.defineProperty(DependencyWorkersTask.prototype, 'dependTaskKeys', {
		get: function getDependTaskKeys() {
			return this._internalContext.dependTaskKeys;
		}
	});
	
	Object.defineProperty(DependencyWorkersTask.prototype, 'dependTaskResults', {
		get: function getDependTaskResults() {
			return this._internalContext.dependTaskResults;
		}
	});
	
	DependencyWorkersTask.prototype._onEvent = function onEvent(event, arg1, arg2) {
		var listeners = this._eventListeners[event];
		for (var i = 0; i < listeners.length; ++i) {
			listeners[i].call(this, arg1, arg2);
		}
	};

    asyncProxyScriptBlob.addMember(DependencyWorkersTaskClosure, 'DependencyWorkersTask');

	return DependencyWorkersTask;
})();