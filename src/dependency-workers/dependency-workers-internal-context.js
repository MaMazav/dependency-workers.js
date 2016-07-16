'use strict';

var DependencyWorkersInternalContext = (function DependencyWorkersInternalContextClosure() {
	function DependencyWorkersInternalContext() {
        this.isTerminated = false;
        this.priority = 0;
        this.lastProcessedData = null;
        this.hasProcessedData = false;
        
        this.isActiveWorker = false;
        this.isPendingDataForWorker = false;
        this.pendingDataForWorker = null;
        
        this.taskContext = null;
        this.dependsTaskHandles = [];
        this.taskHandles = new LinkedList();
        this.gotDataFromDependsTaskHandles = [];
        this.dependsTasksTerminatedCount = 0;
        this.onTerminatedBound = this.onTerminated.bind(this);
	}
    
    DependencyWorkersInternalContext.prototype.setParentList = function(list, iterator) {
        this._parentList = list;
        this._parentIterator = iterator;
    };
    
    DependencyWorkersInternalContext.prototype.ended = function() {
        var dependsHandles = this.dependsTaskHandles;
        for (var i = 0; i < dependsHandles.length; ++i) {
            dependsHandles[i].unregister();
        }
        
        var iterator = this.taskHandles.getFirstIterator();
        while (iterator != null) {
            var handle = this.taskHandles.getValue(iterator);
            iterator = this.taskHandles.getNextIterator(iterator);

            if (handle._callbacks['onTerminated']) {
                handle._callbacks['onTerminated']();
            }
        }
        this.taskHandles.clear();
        
        this.dependsTaskHandles = [];
        this._parentList.remove(this._parentIterator);
        this._parentIterator = null;
    };
	
    DependencyWorkersInternalContext.prototype.setPriorityAndNotify = function(newPriority) {
        if (this.priority === newPriority) {
            return;
        }
        
        this.priority = newPriority;
        this.statusUpdate();

        var depends = this.dependsTaskHandles;
        for (var i = 0; i < depends.length; ++i) {
            depends[i]['setPriority'](newPriority);
        }
    };
    
    DependencyWorkersInternalContext.prototype.statusUpdate = function() {
        this.taskContext['statusUpdated']({
            priority: this.priority,
            hasListeners: this.taskHandles.getCount() > 0,
            isIdle: !this.isActiveWorker,
            terminatedDependsTasks: this.dependsTasksTerminatedCount
        });
    };
    
    DependencyWorkersInternalContext.prototype.recalculatePriority = function() {
        var handles = this.taskHandles;
        
        var iterator = handles.getFirstIterator();
        var isFirst = true;
        var newPriority = 0;
        while (iterator != null) {
            var handle = handles.getValue(iterator);
            if (isFirst || handle._localPriority > newPriority) {
                newPriority = handle._localPriority;
            }
            iterator = handles.getNextIterator(iterator);
        }

        return newPriority;
    };
    
    DependencyWorkersInternalContext.prototype.onTerminated = function() {
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
    
    DependencyWorkersInternalContext.prototype.dependsTaskTerminated = function() {
        ++this.dependsTasksTerminatedCount;
        this.statusUpdate();
    };

    return DependencyWorkersInternalContext;
})();