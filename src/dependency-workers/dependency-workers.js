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
            internalContext.setParentList(this._internalContexts, addResult.iterator);
            this._startNewTask(taskKey, internalContext);
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
        taskKey, internalContext) {
        
        taskContext = this._workerInputRetreiver['createTaskContext'](taskKey, {
            'onDataReadyToProcess': onDataReadyToProcess,
            'onTerminated': internalContext.onTerminatedBound
        });
        internalContext.taskContext = taskContext;
        
        var dependsOnTasks = taskContext['dependsOnTasks'];
        
        if (!taskContext['statusUpdated']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.statusUpdated()';
        }
        if (dependsOnTasks && !taskContext['onDependencyTaskResult']) {
            throw 'AsyncProxy.DependencyWorkers: Cannot accept ' +
                'dependsOnTasks without onDependencyTaskResult in ' +
                'taskContext';
        }
        
        var that = this;
        
        internalContext.gotDataFromDependsTaskHandles =
            new Array(dependsOnTasks.length);
        for (var i = 0; i < dependsOnTasks.length; ++i) {
            internalContext.gotDataFromDependsTaskHandles[i] = false;
            var dependencyTaskHandle;
            
            (function closure(index) {
                var isTerminated = false;
                
                dependencyTaskHandle = that.startTask(dependsOnTasks[index], {
                    'onData': onDependencyTaskResult,
                    'onTerminated': onDependencyTaskTerminated
                });
                
                function onDependencyTaskResult(data) {
                    internalContext.taskContext['onDependencyTaskResult'](data, dependsOnTasks[index]);
                    internalContext.gotDataFromDependsTaskHandles[index] = true;
                }
                
                function onDependencyTaskTerminated() {
                    if (isTerminated) {
                        throw 'AsyncProxy.DependencyWorkers: Double termination';
                    }
                    isTerminated = true;
                    internalContext.dependsTaskTerminated();
                }
            })(/*index=*/i);
            
            internalContext.dependsTaskHandles.push(dependencyTaskHandle);
        }
        
        setTimeout(function() {
            for (var i = 0; i < internalContext.dependsTaskHandles.length; ++i) {
                var handle = internalContext.dependsTaskHandles[i];
                if (!internalContext.gotDataFromDependsTaskHandles[i] &&
                    handle.hasData()) {
                    
                    taskContext['onDependencyTaskResult'](
                        handle.getLastData(), dependsOnTasks[i]);
                }
            }
        });

        function onDataReadyToProcess(newDataToProcess) {
            if (internalContext.isTerminated) {
                throw 'AsyncProxy.DependencyWorkers: already terminated';
            } else if (internalContext.isActiveWorker) {
                internalContext.pendingDataForWorker = newDataToProcess;
                internalContext.isPendingDataForWorker = true;
            } else {
                that._startWorker(internalContext, newDataToProcess, taskKey);
            }
        }
    };
    
    DependencyWorkers.prototype._startWorker = function startWorker(
        internalContext, dataToProcess, taskKey) {
            
        var that = this;
        
        var worker;
        if (that._workerPool.length > 0) {
            worker = that._workerPool.pop();
        } else {
            worker = new AsyncProxyMaster(
                that._scriptsToImport,
                that._ctorName,
                that._ctorArgs);
        }
        
        internalContext.isActiveWorker = true;
        internalContext.statusUpdate();
        worker.callFunction(
                'start',
                [dataToProcess, taskKey],
                {'isReturnPromise': true})
            .then(function(processedData) {
                internalContext.hasProcessedData = true;
                internalContext.lastProcessedData = processedData;
                
                var handles = internalContext.taskHandles;
                var iterator = handles.getFirstIterator();
                while (iterator != null) {
                    var handle = handles.getValue(iterator);
                    iterator = handles.getNextIterator(iterator);
                    
                    handle._callbacks['onData'](processedData, taskKey);
                }
                
                return processedData;
            }).catch(function(e) {
                console.log('Error in DependencyWorkers\' worker: ' + e);
                return e;
            }).then(function(result) {
                that._workerPool.push(worker);
                if (!internalContext.isPendingDataForWorker) {
                    internalContext.isActiveWorker = false;
                    internalContext.statusUpdate();
                    return;
                }
                
                var dataToProcess = internalContext.pendingDataForWorker;
                internalContext.isPendingDataForWorker = false;
                internalContext.pendingDataForWorker = null;
                
                that._startWorker(internalContext, dataToProcess);
                
                return result;
            });
    };
    
    asyncProxyScriptBlob.addMember(DependencyWorkersClosure, 'DependencyWorkers');
    
    return DependencyWorkers;
}

var DependencyWorkers = DependencyWorkersClosure();