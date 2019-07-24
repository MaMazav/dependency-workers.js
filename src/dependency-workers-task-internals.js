'use strict';

var LinkedList = require('linked-list');
var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTask = require('dependency-workers-task');

var DependencyWorkersTaskInternals = (function DependencyWorkersTaskInternalsClosure() {
    function DependencyWorkersTaskInternals() {
        // This class is not exposed outside dependencyWorkers but as an internal struct, thus 
        // may contain public members
        
        this.isTerminated = false;
        this.isTerminatedImmediatelyForDebug = false;
        this.lastProcessedData = null;
        this.taskApi = null;
        this.hasProcessedData = false;
        
        this.waitingForWorkerResult = false;
        this.isPendingDataForWorker = false;
        this.pendingDataForWorker = null;
        this.pendingWorkerType = 0;
        
        this.taskContexts = new LinkedList();
        this.priorityCalculators = new LinkedList();
        
        this.taskKey = null;
        this._isActualTerminationPending = false;
        this._dependsTasksTerminatedCount = 0;
        this._parentDependencyWorkers = null;
        this._workerInputRetreiver = null;
        this._parentList = null;
        this._parentIterator = null;
        this._dependsTaskContexts = null;
        this._priorityCalculator = null;
        this._isRegisteredDependPriorityCalculator = false;
        this._isDetached = false;
        
        this._dependTaskKeys = [];
        this._dependTaskResults = [];
        this._hasDependTaskData = [];
        
        this._pendingDelayedAction = false;
        this._pendingDelayedDependencyData = [];
        this._pendingDelayedEnded = false;
        this._pendingDelayedNewData = false;
        this._performPendingDelayedActionsBound = this._performPendingDelayedActions.bind(this);
    }
    
    DependencyWorkersTaskInternals.prototype.initialize = function(
            taskKey, dependencyWorkers, inputRetreiver, list, iterator /*, hasher*/) {
                
        this.taskKey = taskKey;
        this._parentDependencyWorkers = dependencyWorkers;
        this._workerInputRetreiver = inputRetreiver;
        this._parentList = list;
        this._parentIterator = iterator;
        //this._dependsTaskContexts = new HashMap(hasher);
        this._dependsTaskContexts = new JsBuiltinHashMap();
        this.taskApi = new DependencyWorkersTask(this, taskKey);
        this._registerDependPriorityCalculator();
    };
    
    DependencyWorkersTaskInternals.prototype.ended = function() {
        this._pendingDelayedEnded = true;
        if (!this._pendingDelayedAction) {
            setTimeout(this._performPendingDelayedActionsBound);
        }
    };
    
    DependencyWorkersTaskInternals.prototype.statusUpdate = function() {
        var status = {
            'hasListeners': this.taskContexts.getCount() > 0,
            'isWaitingForWorkerResult': this.waitingForWorkerResult,
            'terminatedDependsTasks': this._dependsTasksTerminatedCount,
            'dependsTasks': this._dependsTaskContexts.getCount()
        };
        this.taskApi._onEvent('statusUpdated', status);

        if (this._isActualTerminationPending && !this.waitingForWorkerResult) {
            this._isActualTerminationPending = false;
            this.ended();
        }
    };
    
    DependencyWorkersTaskInternals.prototype.calculatePriority = function() {
        var iterator = this.priorityCalculators.getFirstIterator();
        var isFirst = true;
        var priority = 0;
        while (iterator !== null) {
            var priorityCalculator = this.priorityCalculators.getFromIterator(iterator);
            var currentPriority = priorityCalculator();
            if (isFirst || currentPriority > priority) {
                priority = currentPriority;
                isFirst = false;
            }
            iterator = this.priorityCalculators.getNextIterator(iterator);
        }

        return priority;
    };
    
    DependencyWorkersTaskInternals.prototype.newData = function(data) {
        this.hasProcessedData = true;
        this.lastProcessedData = data;
        
        this._pendingDelayedNewData = true;
        if (!this._pendingDelayedAction) {
            this._pendingDelayedAction = true;
            setTimeout(this._performPendingDelayedActionsBound);
        }
    };
    
    DependencyWorkersTaskInternals.prototype.dataReady = function dataReady(newDataToProcess, workerType) {
        if (this.isTerminated) {
            throw 'dependencyWorkers: already terminated';
        } else if (this.waitingForWorkerResult) {
            // Used in DependencyWorkers._startWorker() when previous worker has finished
            this.pendingDataForWorker = newDataToProcess;
            this.isPendingDataForWorker = true;
            this.pendingWorkerType = workerType;
        } else {
            this._parentDependencyWorkers._dataReady(
                this, newDataToProcess, workerType);
        }
    };
    
    DependencyWorkersTaskInternals.prototype.detachBeforeTermination = function detach() {
        if (this._isDetached) {
            return;
        }
        
        this._isDetached = true;
        this._parentList.remove(this._parentIterator);
        this._parentIterator = null;

        var iterator = this._dependsTaskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this._dependsTaskContexts.getFromIterator(iterator).taskContext;
            iterator = this._dependsTaskContexts.getNextIterator(iterator);
            
            context.unregister();
        }
        this._dependsTaskContexts.clear();
        
        this._unregisterDependPriorityCalculator();
    };
    
    DependencyWorkersTaskInternals.prototype.customEvent = function customEvent(arg0, arg1) {
        if (this.isTerminated) {
            throw 'dependencyWorkers: already terminated';
        }
        
        this._iterateCallbacks(function(callbacks) {
            if (callbacks.onCustom) {
                callbacks.onCustom(arg0, arg1);
            }
        });
        
        this.taskApi._onEvent('custom', arg0, arg1);
    };

    DependencyWorkersTaskInternals.prototype.terminate = function terminate() {
        if (this.isTerminated) {
            throw 'dependencyWorkers: already terminated';
        }
        
        this.detachBeforeTermination();
        this.isTerminated = true;

        if (this.waitingForWorkerResult) {
            this._isActualTerminationPending = true;
        } else {
            this.ended();
        }
    };
    
    Object.defineProperty(DependencyWorkersTaskInternals.prototype, 'dependTaskKeys', {
        get: function getDependTaskKeys() {
            return this._dependTaskKeys;
        }
    });
    
    Object.defineProperty(DependencyWorkersTaskInternals.prototype, 'dependTaskResults', {
        get: function getDependTaskResults() {
            return this._dependTaskResults;
        }
    });
    
    DependencyWorkersTaskInternals.prototype.registerTaskDependency = function(
            taskKey) {
        
        var strKey = this._workerInputRetreiver.getKeyAsString(taskKey);
        var addResult = this._dependsTaskContexts.tryAdd(strKey, function() {
            return { taskContext: null };
        });
        
        if (!addResult.isNew) {
            throw 'dependencyWorkers: Cannot add task dependency twice';
        }
        
        var that = this;
        var gotData = false;
        var isDependsTaskTerminated = false;
        var index = this._dependTaskKeys.length;
        
        this._dependTaskKeys[index] = taskKey;
        
        addResult.value.taskContext = this._parentDependencyWorkers.startTask(
            taskKey, {
                'onData': onDependencyTaskData,
                'onTerminated': onDependencyTaskTerminated,
                'onCustom': onDependencyTaskCustom,
                calleeForDebug: this
            }
        );
        
        if (addResult.value.taskContext.isTerminated && !addResult.value.taskContext.isTerminatedImmediatelyForDebug) {
            throw 'dependency-workers error: dependant task already terminated';
        }
        
        if (this._isRegisteredDependPriorityCalculator) {
            addResult.value.taskContext.setPriorityCalculator(this._priorityCalculator);
        }
        
        if (!gotData && addResult.value.taskContext.hasData()) {
            this._pendingDelayedDependencyData.push({
                data: addResult.value.taskContext.getLastData(),
                onDependencyTaskData: onDependencyTaskData
            });
            if (!this._pendingDelayedAction) {
                this._pendingDelayedAction = true;
                setTimeout(this._performPendingDelayedActionsBound);
            }
        }
        
        return addResult.value.taskContext;
        
        function onDependencyTaskData(data) {
            that._dependTaskResults[index] = data;
            that._hasDependTaskData[index] = true;
            that.taskApi._onEvent('dependencyTaskData', data, taskKey);
            gotData = true;
        }
        
        function onDependencyTaskCustom(arg0, arg1) {
            that.taskApi._onEvent('dependencyTaskCustom', arg0, arg1);
        }
        
        function onDependencyTaskTerminated() {
            if (isDependsTaskTerminated) {
                throw 'dependencyWorkers: Double termination';
            }
            isDependsTaskTerminated = true;
            that._dependsTaskTerminated();
        }
    };
    
    DependencyWorkersTaskInternals.prototype._registerDependPriorityCalculator = function registerDependPriorityCalculator() {
        if (this._isRegisteredDependPriorityCalculator) {
            throw 'dependencyWorkers: already registered depend priority calculator';
        }
        if (this._priorityCalculator === null) {
            this._priorityCalculator = this.calculatePriority.bind(this);
        }
        this._isRegisteredDependPriorityCalculator = true;
        
        var iterator = this._dependsTaskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this._dependsTaskContexts.getFromIterator(iterator).taskContext;
            iterator = this._dependsTaskContexts.getNextIterator(iterator);
            
            context.setPriorityCalculator(this._priorityCalculator);
        }
    };
    
    DependencyWorkersTaskInternals.prototype._unregisterDependPriorityCalculator = function unregisterDependPriorityCalculator() {
        if (!this._isRegisteredDependPriorityCalculator) {
            throw 'dependencyWorkers: not registered depend priority calculator';
        }
        this._isRegisteredDependPriorityCalculator = false;
        
        var iterator = this._dependsTaskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this._dependsTaskContexts.getFromIterator(iterator).taskContext;
            iterator = this._dependsTaskContexts.getNextIterator(iterator);
            
            context.setPriorityCalculator(null);
        }
    };

    DependencyWorkersTaskInternals.prototype._dependsTaskTerminated = function dependsTaskTerminated() {
        ++this._dependsTasksTerminatedCount;
        if (this._dependsTasksTerminatedCount === this._dependsTaskContexts.getCount()) {
            this.taskApi._onEvent('allDependTasksTerminated');
        }
        this.statusUpdate();
    };
    
    DependencyWorkersTaskInternals.prototype._performPendingDelayedActions = function() {
        var iterator;
        var context;
        this._pendingDelayedAction = false;
        
        if (this._pendingDelayedDependencyData.length > 0) {
            var localListeners = this._pendingDelayedDependencyData;
            this._pendingDelayedDependencyData = [];
            
            for (var i = 0; i < localListeners.length; ++i) {
                localListeners[i].onDependencyTaskData(localListeners[i].data);
            }
        }
        
        if (this._pendingDelayedNewData) {
            var that = this;
            this._pendingDelayedNewData = false;
            this._iterateCallbacks(function(callbacks) {
                callbacks.onData(that.lastProcessedData, that.taskKey);
            });
        }
        
        if (this._pendingDelayedEnded) {
            this._pendingDelayedEnded = false;
            this._iterateCallbacks(function(callbacks) {
                if (callbacks.onTerminated) {
                    callbacks.onTerminated();
                }
            });
            
            this.taskContexts.clear();
        }
    };
    
    DependencyWorkersTaskInternals.prototype._iterateCallbacks = function(perform) {
        var iterator = this.taskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this.taskContexts.getFromIterator(iterator);
            iterator = this.taskContexts.getNextIterator(iterator);

            perform(context._callbacks);
        }

    };
    
    return DependencyWorkersTaskInternals;
})();

module.exports = DependencyWorkersTaskInternals;