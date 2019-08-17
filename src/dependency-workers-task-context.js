'use strict';

var DependencyWorkersTaskContext = (function DependencyWorkersTaskContextClosure() {
    function DependencyWorkersTaskContext(taskInternals, callbacks) {
        this._taskInternals = taskInternals;
        this._callbacks = callbacks;
        this._taskContextsIterator = taskInternals.taskContexts.add(this);
        this._priorityCalculatorIterator = null;
    }
    
    Object.defineProperty(DependencyWorkersTaskContext.prototype, 'isActive', { get: function() {
        return this._taskInternals.isActualTerminationPending || !this._taskInternals.isTerminated;
    } });
    
    Object.defineProperty(DependencyWorkersTaskContext.prototype, 'isTerminated', { get: function() {
        return this._taskInternals.isTerminated;
    } });
    
    DependencyWorkersTaskContext.prototype.getProcessedData = function getProcessedData() {
        return this._taskInternals.processedData;
    };
    
    DependencyWorkersTaskContext.prototype.setPriorityCalculator = function setPriorityCalculator(calculator) {
        if (this._priorityCalculatorIterator !== null) {
            this._taskInternals.priorityCalculators.remove(this._priorityCalculatorIterator);
            this._priorityCalculatorIterator = null;
            // The following optimization, to register only if me having calculator, seems to be buggy; It might cause
            // a SchedulerTask to abort although having non aborted dependant tasks.
            // Instead we register for all the lifetime of the taskInternals
            //if (!calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
            //    this._taskInternals.unregisterDependPriorityCalculator();
            //}
        //} else if (calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
        //    this._taskInternals.registerDependPriorityCalculator();
        }
        
        if (calculator) {
            this._priorityCalculatorIterator = this._taskInternals.priorityCalculators.add(calculator);
        }
    };
    
    DependencyWorkersTaskContext.prototype.unregister = function() {
        if (!this._taskContextsIterator) {
            throw 'dependencyWorkers: Already unregistered';
        }
        
        this.setPriorityCalculator(null);
        
        this._taskInternals.taskContexts.remove(this._taskContextsIterator);
        this._taskContextsIterator = null;
        if (!this._taskInternals.isTerminated) {
            if (this._taskInternals.taskContexts.getCount() === 0) {
                this._taskInternals.abort(/*abortByScheduler=*/false);
            } else {
                this._taskInternals.statusUpdate();
            }
        }
    };

    return DependencyWorkersTaskContext;
})();

module.exports = DependencyWorkersTaskContext;