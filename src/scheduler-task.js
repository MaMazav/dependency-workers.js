'use strict';

var DependencyWorkersTask = require('dependency-workers-task');

var SchedulerTask = (function SchedulerTaskClosure() {
    function SchedulerTask(scheduler, inputRetreiver, isDisableWorkerCache, wrappedTask) {
        var that = this;
        DependencyWorkersTask.call(
            this,
            wrappedTask,
            wrappedTask.key,
            /*registerWrappedEvents=*/true);
            
        that._scheduler = scheduler;
        that._inputRetreiver = inputRetreiver;
        that._isDisableWorkerCache = isDisableWorkerCache;
        that._onScheduledBound = that._onScheduled.bind(that);
        that._onAbortedBySchedulerBound = that._onAbortedByScheduler.bind(that);
        
        that._jobCallbacks = null;
        that._pendingDataToProcess = null;
        that._pendingWorkerType = 0;
        that._key = wrappedTask.key;
        that._hadAnyData = false;
        that._hasPendingDataToProcess = false;
        that._cancelPendingDataToProcess = false;
        that._isWorkerActive = false;
        that._isSchedulerTaskTerminated = false;
        that._isAborted = false;
        that._isAbortedByScheduler = false;
        that._lastStatus = { 'isWaitingForWorkerResult': false };
        
        that.on('statusUpdated', that._abortIfNeeded.bind(that));
        that.on('dependencyTaskCustom', function(customEventName, dependencyTaskKey) {
            if (customEventName === 'aborting' && !that._abortIfNeeded()) {
                throw 'Task ' + dependencyTaskKey + ' aborted but a task depends ' +
                    'on it didn\'t. Check scheduler consistency';
            }
        });
    }
    
    SchedulerTask.prototype = Object.create(DependencyWorkersTask.prototype);
    
    SchedulerTask.prototype._modifyStatus = function modifyStatus(status) {
        this._lastStatus = JSON.parse(JSON.stringify(status));
        this._checkIfJobDone(status);
        this._lastStatus.isWaitingForWorkerResult =
            status.isWaitingForWorkerResult || this._hasPendingDataToProcess;
        
        return this._lastStatus;
    };
    
    SchedulerTask.prototype.dataReady = function onDataReadyToProcess(
            newDataToProcess, workerType) {
                
        if (this._isSchedulerTaskTerminated) {
            throw 'dependencyWorkers: Data after termination';
        }
        
        if (this._isAborted) {
            throw 'dependencyWorkers: Data after scheduler aborted. ' +
                'Did you registered to task.on(\'custom\') event to check ' +
                ' for \'aborting\' custom event?';
        }
        
        this._hadAnyData = true;
        
        if (this._isDisableWorkerCache[workerType] === undefined) {
            this._isDisableWorkerCache[workerType] = this._inputRetreiver.getWorkerTypeOptions(workerType) === null;
        }
        
        if (this._isDisableWorkerCache[workerType]) {
            this._pendingDataToProcess = null;
            this._cancelPendingDataIfExist();
            this._hasPendingDataToProcess = false;
            DependencyWorkersTask.prototype.dataReady.call(this, newDataToProcess, workerType);
            
            var isStatusChanged =
                this._lastStatus.isWaitingForWorkerResult &&
                !this._hasPendingDataToProcess;
            if (isStatusChanged) {
                this._lastStatus.isWaitingForWorkerResult = false;
                this._onEvent('statusUpdated', this._lastStatus);
            }
            
            return;
        }
        
        this._pendingDataToProcess = newDataToProcess;
        this._pendingWorkerType = workerType;
        this._cancelPendingDataToProcess = false;
        var hadPendingDataToProcess = this._hasPendingDataToProcess;
        this._hasPendingDataToProcess = true;

        if (!hadPendingDataToProcess && !this._isWorkerActive) {
            this._scheduler.enqueueJob(
                this._onScheduledBound, this, this._onAbortedBySchedulerBound);
        }
    };
    
    SchedulerTask.prototype.terminate = function terminate() {
        if (this._isSchedulerTaskTerminated) {
            throw 'dependencyWorkers: Double termination';
        }
        
        this._isSchedulerTaskTerminated = true;
        if (this._isAborted) {
            return;
        }
        
        if (!this._hadAnyData) {
            throw 'dependencyWorkers: Terminated without getting any data';
        }
        
        if (this._hasPendingDataToProcess) {
            this.detachBeforeTermination();
        } else {
            DependencyWorkersTask.prototype.terminate.call(this);
        }
    };
    
    SchedulerTask.prototype._onScheduled = function onScheduled(
            resource, jobContext, jobCallbacks) {
                
        if (jobContext !== this) {
            throw 'dependencyWorkers: Unexpected context';
        }
        
        if (!this._hasPendingDataToProcess) {
            throw 'dependencyWorkers: !enqueuedProcessJob';
        }

        var data = this._pendingDataToProcess;
        this._pendingDataToProcess = null;

        if (this._cancelPendingDataToProcess) {
            this._cancelPendingDataToProcess = false;
            jobCallbacks.jobDone();
        } else {
            
            this._isWorkerActive = true;
            this._hasPendingDataToProcess = false;
            this._jobCallbacks = jobCallbacks;
            DependencyWorkersTask.prototype.dataReady.call(this, data, this._pendingWorkerType);
        }
        
        if (this._isSchedulerTaskTerminated) {
            DependencyWorkersTask.prototype.terminate.call(this);
        }
    };
    
    SchedulerTask.prototype._abortIfNeeded = function checkIfShouldAbort() {
        if (!this._scheduler.shouldAbort(this)) {
            return false;
        }
        
        this._cancelPendingDataIfExist();
        this._abort();
        return true;
    };
    
    SchedulerTask.prototype._onAbortedByScheduler = function onAborted(jobContext) {
        if (jobContext !== this) {
            throw 'dependencyWorkers: Unexpected context';
        }
        
        if (this._isAbortedByScheduler) {
            throw 'dependencyWorkers: Scheduler aborted twice';
        }
        
        if (!this._hasPendingDataToProcess) {
            throw 'dependencyWorkers: Scheduler aborted without job';
        }
        
        this._isAbortedByScheduler = true;
        this._abort();
    };
    
    SchedulerTask.prototype._abort = function abort() {
        if (this.isTerminated) {
            return;
        }
        
        var isAlreadyAborted = this._isAborted;
        this._isAborted = true;
        if (!isAlreadyAborted) {
            this.customEvent('aborting', this._key);
        }
        
        DependencyWorkersTask.prototype.terminate.call(this);
    };
    
    SchedulerTask.prototype._cancelPendingDataIfExist = function cancelPendingDataIfExist() {
        this._cancelPendingDataToProcess =
            this._hasPendingDataToProcess && !this._isWorkerActive;
    };
    
    SchedulerTask.prototype._checkIfJobDone = function checkIfJobDone(status) {
        if (!this._isWorkerActive || status.isWaitingForWorkerResult) {
            return;
        }
        
        if (this._cancelPendingDataToProcess) {
            throw 'dependencyWorkers: cancelPendingDataToProcess';
        }
        
        this._isWorkerActive = false;
        
        var jobCallbacks = this._jobCallbacks;
        this._jobCallbacks = null;
        
        if (this._hasPendingDataToProcess) {
            this._scheduler.enqueueJob(
                this._onScheduledBound, this, this._onAbortedBySchedulerBound);
        }

        jobCallbacks.jobDone();
    };
    
    return SchedulerTask;
})();

module.exports = SchedulerTask;