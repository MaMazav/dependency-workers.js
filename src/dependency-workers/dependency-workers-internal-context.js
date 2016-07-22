'use strict';

var DependencyWorkersInternalContext = (function DependencyWorkersInternalContextClosure() {
	function DependencyWorkersInternalContext() {
        // This class is not exposed outside AsyncProxy, I allowed myself to
        // use public members
        
        this.isTerminated = false;
        this.priority = 0;
        this.lastProcessedData = null;
        this.hasProcessedData = false;
        
        this.isActiveWorker = false;
        this.isPendingDataForWorker = false;
        this.pendingDataForWorker = null;
        
        this.taskContext = null;
        this.taskHandles = new LinkedList();
        
        this.onTerminatedBound = this._onTerminated.bind(this);
        this.registerTaskDependencyBound = this._registerTaskDependency.bind(
            this);

        this._dependsTasksTerminatedCount = 0;
        this._parentDependencyWorkers = null;
        this._parentList = null;
        this._parentIterator = null;
        this._dependsTaskHandles = null;
	}
    
    DependencyWorkersInternalContext.prototype.initialize = function(
            dependencyWorkers, list, iterator, hasher) {
                
        this._parentDependencyWorkers = dependencyWorkers;
        this._parentList = list;
        this._parentIterator = iterator;
        this._dependsTaskHandles = new HashMap(hasher);
    };
    
    DependencyWorkersInternalContext.prototype.ended = function() {
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
        
        this._dependsTaskHandles = [];
        this._parentList.remove(this._parentIterator);
        this._parentIterator = null;
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
            'isIdle': !this.isActiveWorker,
            'terminatedDependsTasks': this._dependsTasksTerminatedCount,
            'dependsTasks': this._dependsTaskHandles.getCount()
        };
        this.taskContext['statusUpdated'](status);
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
    
    DependencyWorkersInternalContext.prototype._onTerminated = function() {
        if (this.isTerminated) {
            throw 'AsyncProxy.DependencyWorkers: already terminated';
        } else if (this.isActiveWorker) {
            throw 'AsyncProxy.DependencyWorkers: Cannot terminate while ' +
                'task is processing. Wait for statusUpdated() callback ' +
                'with isIdle == true';
        }
        
        this.isTerminated = true;
        this.ended();
    };
    
    DependencyWorkersInternalContext.prototype._dependsTaskTerminated = function() {
        ++this._dependsTasksTerminatedCount;
        this.statusUpdate();
    };
    
    DependencyWorkersInternalContext.prototype._registerTaskDependency = function(
            taskKey) {
        
        var addResult = this._dependsTaskHandles.tryAdd(taskKey, function() {
            return { taskHandle: null };
        });
        
        if (!addResult.isNew) {
            throw 'AsyncProxy.DependencyWorkers: Cannot add task dependency twice';
        }
        
        var that = this;
        var gotData = false;
        var isTerminated = false;
        
        addResult.value.taskHandle = this._parentDependencyWorkers.startTask(
            taskKey, {
                'onData': onDependencyTaskResult,
                'onTerminated': onDependencyTaskTerminated
            }
        );
        
        setTimeout(function() {
            if (!gotData && addResult.value.taskHandle.hasData()) {
                onDependencyTaskResult(addResult.taskHandle.getLastData());
            }
        });
        
        function onDependencyTaskResult(data) {
            that.taskContext['onDependencyTaskResult'](data, taskKey);
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

    return DependencyWorkersInternalContext;
})();