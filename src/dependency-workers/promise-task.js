'use strict';

function PromiseTaskClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    var WAITING_FOR_DEPENDS_TASKS = 1;
    var WAITING_FOR_PROMISE = 2;
    var WAITING_FOR_WORKER = 3;
    var TERMINATED = 4;
    
    function PromiseTask(
            taskKey,
            dependsOnTasks,
            workerInputRetreiver,
            callbacks) {
        
        var that = this;
        that._taskKey = taskKey;
        that._dependsOnTasks = dependsOnTasks;
        that._workerInputRetreiver = workerInputRetreiver;
        that._callbacks = callbacks;
        
        that._resultIndexByTaskKey = null;
        that._results = [];
        that._hasResultByIndex = [];
        that._hasResultCount = 0;
        that._waitingFor = WAITING_FOR_DEPENDS_TASKS;
        
        that._checkIfDependsTaskDone();
    }
    
    Object.defineProperty(PromiseTask.prototype, 'dependsOnTasks', {
        get: function() {
            var that = this;
            return that._dependsOnTasks;
        }
    });
    
    PromiseTask.prototype.onDependencyTaskResult = function(result, key) {
        if (this._waitingFor !== WAITING_FOR_DEPENDS_TASKS) {
            throw 'AsyncProxy.PromiseTask: Internal Error: not waiting for ' +
                'tasks depends on';
        }
        
        if (this._resultIndexByTaskKey === null) {
            this._resultIndexByTaskKey = new HashMap(this._workerInputRetreiver);
            for (var i = 0; i < this._dependsOnTasks.length; ++i) {
                this._resultIndexByTaskKey.tryAdd(
                    this._dependsOnTasks[i],
                    function() {
                        return i;
                    });
            }
        }
        
        var index = this._resultIndexByTaskKey.getFromKey(key);
        if (index === null) {
            throw 'AsyncProxy.PromiseTask: Task is not depends on key';
        }
        this._results[index] = result;
        
        if (!this._hasResultByIndex[index]) {
            this._hasResultByIndex[index] = true;
            ++this._hasResultCount;
        }
    };
    
    PromiseTask.prototype.statusUpdated = function(status) {
        if (!status.hasListeners && status.isIdle) {
            this._terminate('No listeners');
        } else if (this._waitingFor === WAITING_FOR_DEPENDS_TASKS) {
            this._checkIfDependsTaskDone(status);
        } else if (status.isIdle && this._waitingFor === WAITING_FOR_WORKER) {
            this._terminate();
        }
    };
    
    PromiseTask.prototype._checkIfDependsTaskDone = function(status) {
        var terminatedDependsTasks = 0;
        if (status) {
            terminatedDependsTasks = status.terminatedDependsTasks;
        }
        if (terminatedDependsTasks !== this._dependsOnTasks.length) {
            return;
        }
        
        var that = this;
        this._waitingFor = WAITING_FOR_PROMISE;
        this._workerInputRetreiver['preWorkerProcess'](this._results, this._dependsOnTasks, this._taskKey)
            .then(function(result) {
                if (that._waitingFor !== TERMINATED) {
                    that._waitingFor = WAITING_FOR_WORKER;
                    that._callbacks['onDataReadyToProcess'](result);
                }
            }).catch(function(reason) {
                that._terminate(reason);
            });
    };
    
    PromiseTask.prototype._terminate = function(reason) {
        if (this._waitingFor !== TERMINATED) {
            this._waitingFor = TERMINATED;
            this._callbacks['onTerminated'](reason);
        }
    };
    
    asyncProxyScriptBlob.addMember(PromiseTaskClosure, 'PromiseTask');
    
    return PromiseTask;
}

var PromiseTask = PromiseTaskClosure();