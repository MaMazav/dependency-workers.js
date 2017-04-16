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