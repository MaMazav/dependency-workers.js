'use strict';

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
		
		this.dependTaskKeys = [];
		this.dependTaskResults = [];
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
		this.taskApi = new DependencyWorkersTask(
			this,
			this,
			this._onRegistered,
			this._onTerminated,
			this._parentDependencyWorkers,
			this._parentDependencyWorkers._dataReady);
    };
    
    DependencyWorkersInternalContext.prototype.ended = function() {
        this._parentList.remove(this._parentIterator);
        this._parentIterator = null;

        var iterator = this._dependsTaskHandles.getFirstIterator();
        while (iterator != null) {
            var handle = this._dependsTaskHandles.getFromIterator(iterator).taskHandle;
            iterator = this._dependsTaskHandles.getNextIterator(iterator);
            
            handle.unregister();
        }

        iterator = this.taskHandles.getFirstIterator();
        while (iterator != null) {
            var handle = this.taskHandles.getFromIterator(iterator);
            iterator = this.taskHandles.getNextIterator(iterator);

            if (handle._callbacks['onTerminated']) {
                handle._callbacks['onTerminated']();
            }
        }
        this.taskHandles.clear();
        
        this._dependsTaskHandles.clear();
    };
	
    DependencyWorkersInternalContext.prototype.setPriorityAndNotify = function(
            newPriority) {
                
        if (this.priority === newPriority) {
            return;
        }
        
        this.priority = newPriority;
        this.statusUpdate();

        var iterator = this._dependsTaskHandles.getFirstIterator();
        while (iterator != null) {
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
        while (iterator != null) {
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
        
        var handles = this.taskHandles;
        var iterator = handles.getFirstIterator();
        while (iterator != null) {
            var handle = handles.getFromIterator(iterator);
            iterator = handles.getNextIterator(iterator);
            
            handle._callbacks['onData'](data, this.taskKey);
        }
    };
    
    DependencyWorkersInternalContext.prototype._onTerminated = function() {
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
    
    DependencyWorkersInternalContext.prototype._dependsTaskTerminated = function dependsTaskTerminated() {
        ++this._dependsTasksTerminatedCount;
		if (this._dependsTasksTerminatedCount === this._dependsTaskHandles.getCount()) {
			this.taskApi._onEvent('allDependTasksTerminated');
		}
        this.statusUpdate();
    };
	
    DependencyWorkersInternalContext.prototype.registerTaskDependency = function(
            taskKey) {
        
        var strKey = this._workerInputRetreiver['getKeyAsString'](taskKey);
        var addResult = this._dependsTaskHandles.tryAdd(strKey, function() {
            return { taskHandle: null };
        });
        
        if (!addResult.isNew) {
            throw 'AsyncProxy.DependencyWorkers: Cannot add task dependency twice';
        }
        
        var that = this;
        var gotData = false;
        var isTerminated = false;
		var index = this.dependTaskKeys.length;
		
		this.dependTaskKeys[index] = taskKey;
        
        addResult.value.taskHandle = this._parentDependencyWorkers.startTask(
            taskKey, {
                'onData': onDependencyTaskData,
                'onTerminated': onDependencyTaskTerminated
            }
        );
        
        setTimeout(function() {
            if (!gotData && addResult.value.taskHandle.hasData()) {
                onDependencyTaskData(addResult.taskHandle.getLastData());
            }
        });
        
        function onDependencyTaskData(data) {
			that.dependTaskResults[index] = data;
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
    }
	
	DependencyWorkersInternalContext.prototype._onRegistered = function onRegistered(event, listener) {
		if (event === 'allDependTasksTerminated' && this._dependsTasksTerminatedCount === this._dependsTaskHandles.getCount()) {
			listener.call(this);
		} else if (event === 'dependencyTaskData') {
			for (var i = 0; i < this._hasDependTaskData.length; ++i) {
				if (this._hasDependTaskData[i]) {
					listener.call(this, this.dependTaskResults[i], this.dependTaskKeys[i]);
				}
			}
		}
	};
	
    return DependencyWorkersInternalContext;
})();