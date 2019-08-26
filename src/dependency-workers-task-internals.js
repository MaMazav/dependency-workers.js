'use strict';

var LinkedList = require('linked-list');
var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTask = require('dependency-workers-task');

var DependencyWorkersTaskInternals = (function DependencyWorkersTaskInternalsClosure() {
    function DependencyWorkersTaskInternals() {
        // This class is not exposed outside dependencyWorkers but as an internal struct, thus 
        // may contain public members
        
        this.isTerminated = false;
        this.isActualTerminationPending = false;
        this.processedData = [];
        this.taskApi = null;
        
        this.pendingDataForWorker = [];
        this.canSkipLastPendingDataForWorker = false;
        
        this.taskContexts = new LinkedList();
        this.priorityCalculators = new LinkedList();
        
        this.taskKey = null;
        this._dependsTasksTerminatedCount = 0;
        this._parentDependencyWorkers = null;
        this._workerInputRetreiver = null;
        this._parentList = null;
        this._parentIterator = null;
        this._dependsTaskContexts = null;
        this._priorityCalculator = null;
        this._isRegisteredDependPriorityCalculator = false;
        this._isDetached = false;
        this._canSkipLastProcessedData = false;
        this._jobCallbacks = null;
        this._isAborted = false;
        this._isAbortedNotByScheduler = false;
        this._isUserCalledTerminate = false;
        this._isWaitingForWorkerResult = false;
        
        this._dependTaskKeys = [];
        this._dependTaskResults = [];
        this._hasDependTaskData = [];
        
        this._pendingDelayedAction = false;
        this._pendingDelayedDependencyData = [];
        this._pendingDelayedEnded = false;
        this._pendingDelayedNewData = [];
        this._pendingDelayedCanSkipLastNewData = false;
        this._pendingWorkerDone = false;
        
        var that = this;
        this._scheduleNotifier = {
            'calculatePriority': function() {
                return that.calculatePriority();
            },
            'schedule': function(jobCallbacks) {
                if (that._jobCallbacks !== null) {
                    throw 'dependencyWorkers: scheduleNotifier.schedule was called twice';
                }
                
                if ((!jobCallbacks) || !jobCallbacks['jobDone']) {
                    throw 'dependencyWorkers: Passed invalid jobCallbacks argument to scheduleNotifier.schedule(). Ensure jobCallbacks has jobDone method';
                }
                
                if (that._isAbortedNotByScheduler) {
                    jobCallbacks.jobDone();
                    return;
                }
                
                if (this.isTerminated && !this.isActualTerminationPending) {
                    throw 'dependencyWorkers: scheduled after termination';
                }
                
                var dataToProcess = that.pendingDataForWorker.shift();
                var canSkip = false;
                if (that.pendingDataForWorker.length === 0) {
                    canSkip = that.canSkipLastPendingDataForWorker;
                    that.canSkipLastPendingDataForWorker = false;
                }
                
                that._jobCallbacks = jobCallbacks;
                that._parentDependencyWorkers._dataReady(
                    that,
                    dataToProcess.data,
                    dataToProcess.workerType,
                    canSkip);
            },
            'abort': function(abortedByScheduler) {
                that.abort(abortedByScheduler);
            }
        };
    }
    
    DependencyWorkersTaskInternals.prototype.initialize = function(
            taskKey, dependencyWorkers, inputRetreiver, list, iterator /*, hasher*/) {
                
        this.taskKey = taskKey;
        this._parentDependencyWorkers = dependencyWorkers;
        this._workerInputRetreiver = inputRetreiver;
        this._parentList = list;
        this._parentIterator = iterator;
        this._dependsTaskContexts = new JsBuiltinHashMap();
        this.taskApi = new DependencyWorkersTask(this, taskKey);
        this._registerDependPriorityCalculator();
        dependencyWorkers.initializingTask(this.taskApi, this._scheduleNotifier);
    };
    
    DependencyWorkersTaskInternals.prototype.ended = function() {
        this._pendingDelayedEnded = true;
        this._schedulePendingDelayedActions();
    };
    
    DependencyWorkersTaskInternals.prototype.statusUpdate = function() {
        var status = {
            'hasListeners': this.taskContexts.getCount() > 0,
            'isWaitingForWorkerResult': this._isWaitingForWorkerResult,
            'terminatedDependsTasks': this._dependsTasksTerminatedCount,
            'dependsTasks': this._dependsTaskContexts.getCount()
        };
        this.taskApi._onEvent('statusUpdated', status);

        if (this.isActualTerminationPending && !this._isWaitingForWorkerResult) {
            this.isActualTerminationPending = false;
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
    
    DependencyWorkersTaskInternals.prototype.newData = function(data, canSkip) {
        if (this._pendingDelayedCanSkipLastNewData) {
            this._pendingDelayedNewData[this._pendingDelayedNewData.length - 1] = data;
        } else {
            this._pendingDelayedNewData.push(data);
        }
        
        this._pendingDelayedCanSkipLastNewData = !!canSkip;
        this._schedulePendingDelayedActions();
    };
    
    DependencyWorkersTaskInternals.prototype.workerDone = function() {
        if (this._jobCallbacks === null) {
            throw 'dependencyWorkers: Job done without previously started';
        }
        
        var jobCallbacks = this._jobCallbacks;
        this._jobCallbacks = null;
        
        if (this.pendingDataForWorker.length === 0) {
            this._pendingWorkerDone = true;
            this._schedulePendingDelayedActions();
        }
        
        jobCallbacks['jobDone']();

        if (this.pendingDataForWorker.length > 0) {
            this.waitForSchedule();
        }
    };
    
    DependencyWorkersTaskInternals.prototype.dataReady = function dataReady(
        newDataToProcess, workerType, canSkip) {
        
        if (this.isTerminated) {
            if (this._isUserCalledTerminate) {
                throw 'dependencyWorkers: already terminated';
            }
            
            return;
        }
        
        // Used in DependencyWorkers._startWorker() when previous worker has finished
        var pendingData = {
            data: newDataToProcess,
            workerType: workerType
        };
        
        if (this.canSkipLastPendingDataForWorker) {
            this.pendingDataForWorker[this.pendingDataForWorker.length - 1] = pendingData;
        } else {
            this.pendingDataForWorker.push(pendingData);
        }
        this.canSkipLastPendingDataForWorker = !!canSkip;
        
        if (!this._isWaitingForWorkerResult || this._pendingWorkerDone) {
            this._isWaitingForWorkerResult = true;
            this._pendingWorkerDone = false;
            this.waitForSchedule();
            this.statusUpdate();
        }
    };
    
    DependencyWorkersTaskInternals.prototype.waitForSchedule = function waitForSchedule() {
        var workerType = this.pendingDataForWorker[0].workerType;
        this._parentDependencyWorkers.waitForSchedule(this._scheduleNotifier, workerType);
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
        if (this.isTerminated && !this.isActualTerminationPending) {
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
        if (this._isUserCalledTerminate) {
            throw 'dependencyWorkers: already terminated';
        }
        
        this._isUserCalledTerminate = true;
        this._terminateInternal();
    };
    
    DependencyWorkersTaskInternals.prototype.abort = function abort(abortedByScheduler) {
        if (this._isAborted) {
            return;
        }
        
        this._isAborted = true;
        if (this.isTerminated) {
            if (!this.isActualTerminationPending && !this._isAbortedNotByScheduler) {
                throw 'dependencyWorkers: aborted after termination';
            }
        } else if (!abortedByScheduler) {
            this._isAbortedNotByScheduler = true;
        } else if (this.pendingDataForWorker.length === 0) {
            throw 'dependencyWorkers: Abort without task waiting for schedule';
        } else {
            this._isWaitingForWorkerResult = false; // only if aborted by scheduler
        }
        
        this.pendingDataForWorker = [];
        this.canSkipLastPendingDataForWorker = false;
        
        if (!this.isTerminated) {
            this.customEvent('aborting', this.taskKey);
        }
        
        this._terminateInternal();
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
        
        if (!addResult.value.taskContext.isActive) {
            throw 'dependency-workers error: dependant task already terminated';
        }
        
        // Might be removed: Code for debug which relies on internal member taskContext._taskInternals
        if (addResult.value.taskContext._taskInternals._isAborted) {
            throw 'dependencyWorkers error: dependant task already aborted';
        }
        
        if (this._isRegisteredDependPriorityCalculator) {
            addResult.value.taskContext.setPriorityCalculator(this._priorityCalculator);
        }
        
        if (gotData) {
            throw 'dependency-workers error: Internal error: callback called before dependency registration completed';
        }
        
        var processedData = addResult.value.taskContext.getProcessedData();
        for (var i = 0; i < processedData.length; ++i) {
            this._pendingDelayedDependencyData.push({
                data: processedData[i],
                onDependencyTaskData: onDependencyTaskData
            });
        }
        
        if (processedData.length > 0) {
            this._schedulePendingDelayedActions();
        }
        
        return addResult.value.taskContext;
        
        function onDependencyTaskData(data) {
            if (that._pendingDelayedDependencyData.length > 0) {
                // Avoid bypass of delayed data by new data
                that._pendingDelayedDependencyData.push({
                    data: data,
                    onDependencyTaskData: onDependencyTaskData
                });
                
                that._schedulePendingDelayedActions();
                
                return;
            }
            
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
    
    DependencyWorkersTaskInternals.prototype._terminateInternal = function terminateInternal() {
        if (this.isTerminated) {
            return;
        }
        
        this.detachBeforeTermination();
        this.isTerminated = true;

        if (this._isWaitingForWorkerResult) {
            this.isActualTerminationPending = true;
        } else {
            this.ended();
        }
    };
    
    DependencyWorkersTaskInternals.prototype._registerDependPriorityCalculator = function registerDependPriorityCalculator() {
        if (this._isRegisteredDependPriorityCalculator) {
            throw 'dependencyWorkers: already registered depend priority calculator';
        }
        if (this._priorityCalculator === null) {
            var that = this;
            this._priorityCalculator = function() {
                return that.calculatePriority();
            };
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
    
    DependencyWorkersTaskInternals.prototype._schedulePendingDelayedActions = function() {
        if (this._pendingDelayedAction) {
            return;
        }
        
        this._pendingDelayedAction = true;
        var that = this;
        setTimeout(function() {
            var iterator;
            var context;
            that._pendingDelayedAction = false;
            
            if (that._pendingDelayedDependencyData.length > 0) {
                var localListeners = that._pendingDelayedDependencyData;
                that._pendingDelayedDependencyData = [];
                
                for (var i = 0; i < localListeners.length; ++i) {
                    localListeners[i].onDependencyTaskData(localListeners[i].data);
                }
            }
            
            if (that._pendingDelayedNewData.length > 0) {
                var newData = that._pendingDelayedNewData;
                var canSkipLast = that._pendingDelayedCanSkipLastNewData;
                that._pendingDelayedNewData = [];
                that._pendingDelayedCanSkipLastNewData = false;
                
                if (that._canSkipLastProcessedData) {
                    that.processedData.pop();
                }
                
                for (var i = 0; i < newData.length; ++i) {
                    that.processedData.push(newData[i]);
                    that._canSkipLastProcessedData = canSkipLast && i === newData.length - 1;
                    that._iterateCallbacks(function(callbacks) {
                        callbacks.onData(newData[i], that.taskKey);
                    });
                }
            }
            
            if (that._pendingWorkerDone) {
                that._isWaitingForWorkerResult = false;
                that.statusUpdate();
            }
            
            if (that._pendingDelayedEnded) {
                that._pendingDelayedEnded = false;
                that._iterateCallbacks(function(callbacks) {
                    if (callbacks.onTerminated) {
                        callbacks.onTerminated(that._isAborted);
                    }
                });
                
                that.taskContexts.clear();
            }
        });
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