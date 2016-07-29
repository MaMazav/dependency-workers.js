'use strict';

function DependencyWorkersClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function DependencyWorkers(scriptsToImport, ctorName, ctorArgs, workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._ctorName = ctorName;
        that._ctorArgs = ctorArgs;
        that._scriptsToImport = scriptsToImport;
        that._internalContexts = new HashMap(/*hasher=*/workerInputRetreiver);
        that._workerPool = [];
        
        if (!workerInputRetreiver['createTaskContext']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.createTaskContext() method';
        }
        if (!workerInputRetreiver['getHashCode']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getHashCode() method';
        }
        if (!workerInputRetreiver['isEqual']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.isEqual() method';
        }
    }
    
    DependencyWorkers.prototype.startTask = function startTask(
        taskKey, callbacks) {
        
        var dependencyWorkers = this;
        
        var addResult = this._internalContexts.tryAdd(taskKey, function() {
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
                this._internalContexts,
                addResult.iterator,
                this._workerInputRetreiver);
            this._startNewTask(internalContext);
        }
        
        return taskHandle;
    };
    
    DependencyWorkers.prototype.getTaskContext = function getTaskContext(taskKey) {
        var context = this._internalContexts.getFromKey(taskKey);
        if (context === null) {
            return null;
        }
        
        return context.taskContext;
    };
    
    DependencyWorkers.prototype._startNewTask = function startNewTask(
        internalContext) {
        
        taskContext = this._workerInputRetreiver['createTaskContext'](
            internalContext.taskKey, {
                'onDataReadyToProcess': onDataReadyToProcess,
                'onTerminated': internalContext.onTerminatedBound,
                'registerTaskDependency': internalContext.registerTaskDependencyBound
            }
        );
        internalContext.taskContext = taskContext;
        
        if (!taskContext['statusUpdated']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.statusUpdated()';
        }
        if (!taskContext['onDependencyTaskResult']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.onDependencyTaskResult()';
        }
        
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
            return;
        }
        
        var worker;
        if (that._workerPool.length > 0) {
            worker = that._workerPool.pop();
        } else {
            worker = new AsyncProxyMaster(
                that._scriptsToImport,
                that._ctorName,
                that._ctorArgs);
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
                that._workerPool.push(worker);
                
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