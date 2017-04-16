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