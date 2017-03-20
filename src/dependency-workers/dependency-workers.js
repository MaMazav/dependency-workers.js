'use strict';

function DependencyWorkersClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function DependencyWorkers(workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._internalContexts = new JsBuiltinHashMap();
        that._workerPoolByTaskType = [];
        that._taskOptionsByTaskType = [];
        that._getTaskContextBound = that.getTaskContext.bind(this);
        
        if (!workerInputRetreiver['createTaskContext']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.createTaskContext() method';
        }
        if (!workerInputRetreiver['getTaskTypeOptions']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getTaskTypeOptions() method';
        }
        if (!workerInputRetreiver['getKeyAsString']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getKeyAsString() method';
        }
    }
    
    DependencyWorkers.prototype.startTask = function startTask(
        taskKey, callbacks) {
        
        var dependencyWorkers = this;
        
        var strKey = this._workerInputRetreiver['getKeyAsString'](taskKey);
        var addResult = this._internalContexts.tryAdd(strKey, function() {
            // internalContext
            return new DependencyWorkersInternalContext();
        });
        
        var internalContext = addResult.value;
        var taskHandle = new DependencyWorkersTaskHandle(
            internalContext, callbacks);
        
        if (addResult.isNew) {
            internalContext.initialize(
                taskKey,
                this,
                this._workerInputRetreiver,
                this._internalContexts,
                addResult.iterator,
                this._workerInputRetreiver);
            this._startNewTask(internalContext);
        }
        
        return taskHandle;
    };
    
    DependencyWorkers.prototype.startTaskPromise =
            function startTaskPromise(taskKey) {
        
        var that = this;
        return new Promise(function(resolve, reject) {
            var taskHandle = that.startTask(
                taskKey, { 'onData': onData, 'onTerminated': onTerminated });
            
            var hasData = taskHandle.hasData();
            var result;
            if (hasData) {
                result = taskHandle.getLastData();
            }
            
            function onData(data) {
                hasData = true;
                result = data;
            }
            
            function onTerminated() {
                if (hasData) {
                    resolve(result);
                } else {
                    reject('AsyncProxy.DependencyWorkers: Internal ' +
                        'error - task terminated but no data returned');
                }
            }
        });
    };
    
    DependencyWorkers.prototype.getTaskContext = function getTaskContext(taskKey) {
        strKey = this._workerInputRetreiver['getKeyAsString'](taskKey);
        var context = this._internalContexts.getFromKey(strKey);
        if (context === null) {
            return null;
        }
        
        return context.taskContext;
    };
    
    DependencyWorkers.prototype._startNewTask = function startNewTask(
        internalContext) {
        
        taskContext = this._workerInputRetreiver['createTaskContext'](
            internalContext.taskKey, {
                'getTaskContext': this._getTaskContextBound,
                'onDataReadyToProcess': onDataReadyToProcess,
                'onTerminated': internalContext.onTerminatedBound,
                'registerTaskDependency': internalContext.registerTaskDependencyBound
            }
        );
        internalContext.taskContext = taskContext;
        
        if (!taskContext['getTaskType']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.getTaskType()';
        }
        if (!taskContext['statusUpdated']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.statusUpdated()';
        }
        if (!taskContext['onDependencyTaskResult']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.onDependencyTaskResult()';
        }
        internalContext.taskType = internalContext.taskContext['getTaskType']();
        
        var that = this;
        
        function onDataReadyToProcess(newDataToProcess, isDisableWorker) {
            if (internalContext.isTerminated) {
                throw 'AsyncProxy.DependencyWorkers: already terminated';
            } else if (internalContext.waitingForWorkerResult) {
                internalContext.pendingDataForWorker = newDataToProcess;
                internalContext.isPendingDataForWorker = true;
                internalContext.pendingDataIsDisableWorker = isDisableWorker;
            } else {
                that._startWorker(
                    internalContext,
                    newDataToProcess,
                    isDisableWorker);
            }
        }
    };
    
    DependencyWorkers.prototype._startWorker = function startWorker(
        internalContext, dataToProcess, isDisableWorker) {
            
        var that = this;
        
        if (isDisableWorker) {
            internalContext.newData(dataToProcess);
            internalContext.statusUpdate();
            return;
        }
        
        var worker;
        var workerPool = that._workerPoolByTaskType[internalContext.taskType];
        if (!workerPool) {
            workerPool = [];
            that._workerPoolByTaskType[internalContext.taskType] = workerPool;
        }
        if (workerPool.length > 0) {
            worker = workerPool.pop();
        } else {
            var workerArgs = that._workerInputRetreiver['getTaskTypeOptions'](
                internalContext.taskType);
            worker = new AsyncProxyMaster(
                workerArgs['scriptsToImport'],
                workerArgs['ctorName'],
                workerArgs['ctorArgs']);
        }
        
        if (!internalContext.waitingForWorkerResult) {
            internalContext.waitingForWorkerResult = true;
            internalContext.statusUpdate();
        }
        
        worker.callFunction(
                'start',
                [dataToProcess, internalContext.taskKey],
                {'isReturnPromise': true})
            .then(function(processedData) {
                internalContext.newData(processedData);
                return processedData;
            }).catch(function(e) {
                console.log('Error in DependencyWorkers\' worker: ' + e);
                return e;
            }).then(function(result) {
                workerPool.push(worker);
                
                if (!internalContext.isPendingDataForWorker) {
                    internalContext.waitingForWorkerResult = false;
                    internalContext.statusUpdate();
                    return;
                }
                
                var dataToProcess = internalContext.pendingDataForWorker;
                internalContext.isPendingDataForWorker = false;
                internalContext.pendingDataForWorker = null;
                
                that._startWorker(
                    internalContext,
                    dataToProcess,
                    internalContext.pendingDataIsDisableWorker);
                
                return result;
            });
    };
    
    asyncProxyScriptBlob.addMember(DependencyWorkersClosure, 'DependencyWorkers');
    
    return DependencyWorkers;
}

var DependencyWorkers = DependencyWorkersClosure();