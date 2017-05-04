'use strict';

var DependencyWorkersTaskContext = (function DependencyWorkersTaskContextClosure() {
    function DependencyWorkersTaskContext(taskInternals, callbacks) {
        this._taskInternals = taskInternals;
        this._callbacks = callbacks;
        this._taskContextsIterator = taskInternals.taskContexts.add(this);
		this._priorityCalculatorIterator = null;
    }
    
    DependencyWorkersTaskContext.prototype.hasData = function hasData() {
        return this._taskInternals.hasProcessedData;
    };
    
    DependencyWorkersTaskContext.prototype.getLastData = function getLastData() {
        return this._taskInternals.lastProcessedData;
    };
	
	DependencyWorkersTaskContext.prototype.setPriorityCalculator = function setPriorityCalculator(calculator) {
		if (this._priorityCalculatorIterator !== null) {
			this._taskInternals.priorityCalculators.remove(this._priorityCalculatorIterator);
			this._priorityCalculatorIterator = null;
			if (!calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
				this._taskInternals.unregisterDependPriorityCalculator();
			}
		} else if (calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
			this._taskInternals.registerDependPriorityCalculator();
		}
		
		if (calculator) {
			this._priorityCalculatorIterator = this._taskInternals.priorityCalculators.add(calculator);
		}
	};
    
    DependencyWorkersTaskContext.prototype.unregister = function() {
        if (!this._taskContextsIterator) {
            throw 'AsyncProxy.DependencyWorkers: Already unregistered';
        }
		
		this.setPriorityCalculator(null);
		
        this._taskInternals.taskContexts.remove(this._taskContextsIterator);
        this._taskContextsIterator = null;
        
		if (!this._taskInternals.isTerminated) {
			// Should be called from statusUpdate when worker shut down
			//this._taskInternals.ended();
			
			this._taskInternals.statusUpdate();
		}
    };

    return DependencyWorkersTaskContext;
})();

module.exports = DependencyWorkersTaskContext;