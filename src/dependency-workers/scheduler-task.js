'use strict';

function SchedulerTaskClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerTask(scheduler, taskKey, callbacks) {
        var that = this;
        that._scheduler = scheduler;
        that._taskKey = taskKey;
        that._taskContext = null;
        that._resource = null;
        that._callbacks = callbacks;
        that._onScheduledBound = that._onScheduled.bind(that);
        that._callbacksForWrappedTask = {
            'onDataReadyToProcess': that._onDataReadyToProcess.bind(that),
            'onTerminated': that._onTerminated.bind(that),
            'registerTaskDependency': callbacks['registerTaskDependency']
        };
        
        that._pendingDataToProcess = null;
        that._hasPendingDataToProcess = false;
        that._cancelPendingDataToProcess = false;
        that._isWorkerActive = false;
        that._lastStatus = { 'isWaitingForWorkerResult': false };
    }
    
    SchedulerTask.prototype.setWrappedContext = function setWrappedContext(
            taskContext) {
                
        if (!taskContext['statusUpdated']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.statusUpdated()';
        }
        if (!taskContext['onDependencyTaskResult']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.onDependencyTaskResult()';
        }
        if (!taskContext['getTaskType']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.getTaskType()';
        }
        
        this._taskContext = taskContext;
    };
    
    SchedulerTask.prototype.getWrappedContext = function getWrappedContext() {
        return this._taskContext;
    };
    
    SchedulerTask.prototype.getCallbacksForWrappedTask =
            function getCallbacksForWrappedTask() {

        return this._callbacksForWrappedTask;
    };
    
    SchedulerTask.prototype.statusUpdated = function statusUpdated(status) {
        this._lastStatus = JSON.parse(JSON.stringify(status));
        this._checkIfJobDone(status);
        this._lastStatus['isWaitingForWorkerResult'] =
            status['isWaitingForWorkerResult'] || this._hasPendingDataToProcess;
        return this._taskContext['statusUpdated'](this._lastStatus);
    };
    
    SchedulerTask.prototype.onDependencyTaskResult =
            function onDependencyTaskResult(data, key) {
        
        return this._taskContext['onDependencyTaskResult'](data, key);
    };
    
    SchedulerTask.prototype.getTaskType = function getTaskType() {
        return this._taskContext['getTaskType']();
    };
    
    SchedulerTask.prototype._onDataReadyToProcess = function onDataReadyToProcess(
            newDataToProcess, isDisableWorker) {
                
        if (this._isTerminated) {
            throw 'AsyncProxy.DependencyWorkers: Data after termination';
        }
        
        if (isDisableWorker) {
            this._pendingDataToProcess = null;
            this._cancelPendingDataToProcess =
                this._hasPendingDataToProcess && !this._isWorkerActive;
            this._hasPendingDataToProcess = false;
            this._callbacks['onDataReadyToProcess'](
                newDataToProcess, isDisableWorker);
            
            var isStatusChanged =
                this._lastStatus['isWaitingForWorkerResult'] &&
                !this._hasPendingDataToProcess;
            if (isStatusChanged) {
                this._lastStatus['isWaitingForWorkerResult'] = false;
                this._taskContext['statusUpdated'](this._lastStatus);
            }
            
            return;
        }
        
        this._pendingDataToProcess = newDataToProcess;
        this._cancelPendingDataToProcess = false;
        var hadPendingDataToProcess = this._hasPendingDataToProcess;
        this._hasPendingDataToProcess = true;

        if (!hadPendingDataToProcess && !this._isWorkerActive) {
            this._scheduler['enqueueJob'](
                this._onScheduledBound, this._taskContext);
        }
    };
    
    SchedulerTask.prototype._onScheduled = function dataReadyForWorker(
            resource, jobContext) {
                
        if (jobContext !== this._taskContext) {
            throw 'AsyncProxy.DependencyWorkers: Unexpected context';
        }
        
        if (this._cancelPendingDataToProcess) {
            this._cancelPendingDataToProcess = false;
            this._scheduler['jobDone'](resource, jobContext);
        }
        if (!this._hasPendingDataToProcess) {
            throw 'AsyncProxy.DependencyWorkers: !enqueuedProcessJob';
        }
        
        this._isWorkerActive = true;
        this._hasPendingDataToProcess = false;
        this._resource = resource;
        this._callbacks['onDataReadyToProcess'](this._pendingDataToProcess);
        this._pendingDataToProcess = null;
    };
    
    SchedulerTask.prototype._checkIfJobDone = function checkIfJobDone(status) {
        if (!this._isWorkerActive || status['isWaitingForWorkerResult']) {
            return;
        }
        
        if (this._cancelPendingDataToProcess) {
            throw 'AsyncProxy.DependencyWorkers: cancelPendingDataToProcess';
        }
        
        this._isWorkerActive = false;
        var resource = this._resource;
        this._resource = null;

        if (this._hasPendingDataToProcess) {
            this._scheduler['enqueueJob'](
                this._onScheduledBound, this._taskContext);
        }

        this._scheduler['jobDone'](resource, this._taskContext);
    };
    
    SchedulerTask.prototype._onTerminated = function onTerminated() {
        if (this._isTerminated) {
            throw 'AsyncProxy.DependencyWorkers: Double termination';
        }
        
        this._isTerminated = true;
        this._cancelPendingDataToProcess =
            this._hasPendingDataToProcess && !this._isWorkerActive;
        this._hasPendingDataToProcess = false;
        
        this._callbacks['onTerminated']();
    };
    
    asyncProxyScriptBlob.addMember(
        SchedulerTaskClosure, 'SchedulerTask');
    
    return SchedulerTask;
}

var SchedulerTask = SchedulerTaskClosure();