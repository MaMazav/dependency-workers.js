'use strict';

function DependencyWorkersClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function DependencyWorkers(scriptsToImport, ctorName, ctorArgs, workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._ctorName = ctorName;
        that._ctorArgs = ctorArgs;
        that._scriptsToImport = scriptsToImport;
        that._taskHandles = new HashMap(/*hasher=*/workerInputRetreiver);
        that._workerPool = [];
    }
    
    DependencyWorkers.prototype.startTask = function startTask(
        taskKey, onData) {
        
        var dependencyWorkers = this;
        
        var addResult = this._taskHandles.tryAdd(taskKey, function() {
            // unique handle
            return {
                isTerminated: false,
                priority: 0,
                lastProcessedData: null,
                hasProcessedData: false,

                isActiveWorker: false,
                isPendingDataForWorker: false,
                pendingDataForWorker: null,

                taskContext: null,
                dependsTaskHandles: [],
                taskHandles: new LinkedList(),
                gotDataFromDependsTaskHandles: [],

                ended: function ended() {
                    var handles = this.dependsTaskHandles;
                    for (var i = 0; i < handles.length; ++i) {
                        handles[i]['unregister']();
                    }
                    this.dependsTaskHandles = [];
                    dependencyWorkers._taskHandles.remove(addResult.iterator);
                }
            }
        });
        
        var uniqueHandle = addResult.value;
        var taskHandle = this._createTaskHandle(
            uniqueHandle, onData);
        
        if (addResult.isNew) {
            this._startNewTask(taskKey, uniqueHandle);
        }
        
        return taskHandle;
    };
    
    DependencyWorkers.prototype._createTaskHandle = function createTaskHandle(
        uniqueHandle, onData) {
            
        var taskHandle = {
            _uniqueHandle: uniqueHandle,
            _taskHandlesIterator: null,
            _localPriority: 0,
            _listener: onData,
            'hasData': function hasData() {
                return this._uniqueHandle.hasProcessedData;
            },
            'getLastData': function getLastData() {
                return this._uniqueHandle.lastProcessedData;
            },
            'setPriority': function(priority) {
                if (!this._taskHandlesIterator) {
                    throw 'AsyncProxy.DependencyWorkers: Already unregistered';
                }

                var newPriority;
                if (priority > this._uniqueHandle.priority) {
                    newPriority = priority;
                } else if (this._localPriority < this._uniqueHandle.priority) {
                    newPriority = this._uniqueHandle.priority;
                } else {
                    newPriority = this._recalculatePriority();
                }
                
                this._setPriorityAndNotify(newPriority);
            },
            'unregister': function() {
                if (!this._taskHandlesIterator) {
                    throw 'AsyncProxy.DependencyWorkers: Already unregistered';
                }
                this._uniqueHandle.taskHandles.remove(this._taskHandlesIterator);
                this._taskHandlesIterator = null;
                
                if (this._uniqueHandle.taskHandles.getCount() == 0) {
                    this._uniqueHandle.ended();
                    this._uniqueHandle.taskContext['unregistered']();
                } else if (this._localPriority === this._uniqueHandle.priority) {
                    var newPriority = this._recalculatePriority();
                    this._setPriorityAndNotify(newPriority);
                }
            },
            _recalculatePriority: function() {
                var handles = this._uniqueHandle.taskHandles;
                
                var handles = uniqueHandle.taskHandles;
                var iterator = handles.getFirstIterator();
                var isFirst = true;
                var newPriority = 0;
                while (iterator != null) {
                    var handle = handles.getValue(iterator);
                    if (isFirst || handle._localPriority > newPriority) {
                        newPriority = handle._localPriority;
                    }
                    iterator = handles.getNextIterator(iterator);
                }

                return newPriority;
            },
            _setPriorityAndNotify: function(newPriority) {
                if (this._uniqueHandle.priority === newPriority) {
                    return;
                }
                
                this._uniqueHandle.priority = newPriority;
                this._uniqueHandle.taskContext['setPriority'](newPriority);

                var depends = this._uniqueHandle.dependsTaskHandles;
                for (var i = 0; i < depends.length; ++i) {
                    depends[i]['setPriority'](newPriority);
                }
            }
        };
        
        taskHandle._taskHandlesIterator =
            uniqueHandle.taskHandles.add(taskHandle);
        
        return taskHandle;
    };
    
    DependencyWorkers.prototype._startNewTask = function startNewTask(
        taskKey, uniqueHandle) {
        
        taskContext = this._workerInputRetreiver['createTaskContext'](
            taskKey, onDataReadyToProcess, onTerminated);
        uniqueHandle.taskContext = taskContext;
        
        var dependsOnTasks = taskContext['dependsOnTasks'];
        
        if (!taskContext['setPriority']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.setPriority()';
        }
        if (!taskContext['unregistered']) {
            throw 'AsyncProxy.DependencyWorkers: missing ' +
                'taskContext.unregistered()';
        }
        if (dependsOnTasks && !taskContext['onDependencyTaskResult']) {
            throw 'AsyncProxy.DependencyWorkers: Cannot accept ' +
                'dependsOnTasks without onDependencyTaskResult in ' +
                'taskContext';
        }
        
        var that = this;
        
        uniqueHandle.gotDataFromDependsTaskHandles =
            new Array(dependsOnTasks.length);
        for (var i = 0; i < dependsOnTasks.length; ++i) {
            uniqueHandle.gotDataFromDependsTaskHandles[i] = false;
            var dependencyTaskHandle;
            
            (function closure(index) {
                dependencyTaskHandle = that.startTask(
                    dependsOnTasks[index], onDependencyTaskResult);
                
                function onDependencyTaskResult(data) {
                    uniqueHandle.taskContext['onDependencyTaskResult'](data, dependsOnTasks[index]);
                    uniqueHandle.gotDataFromDependsTaskHandles[index] = true;
                }
            })(/*index=*/i);
            
            uniqueHandle.dependsTaskHandles.push(dependencyTaskHandle);
        }
        
        setTimeout(function() {
            for (var i = 0; i < uniqueHandle.dependsTaskHandles.length; ++i) {
                var handle = uniqueHandle.dependsTaskHandles[i];
                if (!uniqueHandle.gotDataFromDependsTaskHandles[i] &&
                    handle['hasData']()) {
                    
                    taskContext['onDependencyTaskResult'](
                        handle['getLastData'], dependsOnTasks[i]);
                }
            }
        });

        function onDataReadyToProcess(newDataToProcess) {
            if (uniqueHandle.isActiveWorker) {
                uniqueHandle.pendingDataForWorker = newDataToProcess;
                uniqueHandle.isPendingDataForWorker = true;
            } else {
                that._startWorker(uniqueHandle, newDataToProcess, taskKey);
            }
        }
        
        function onTerminated() {
            if (uniqueHandle.isTerminated) {
                throw 'AsyncProxy.DependencyWorkers: already terminated';
            }
            uniqueHandle.isTerminated = true;
            
            uniqueHandle.ended();
        }
    };
    
    DependencyWorkers.prototype._startWorker = function startWorker(
        uniqueHandle, dataToProcess, taskKey) {
            
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
        
        uniqueHandle.isActiveWorker = true;
        worker.callFunction(
                'start',
                [dataToProcess, taskKey],
                {'isReturnPromise': true})
            .then(function(processedData) {
                uniqueHandle.hasProcessedData = true;
                uniqueHandle.lastProcessedData = processedData;
                
                var handles = uniqueHandle.taskHandles;
                var iterator = handles.getFirstIterator();
                while (iterator != null) {
                    var handle = handles.getValue(iterator);
                    iterator = handles.getNextIterator(iterator);
                    
                    handle._listener(processedData, taskKey);
                }
            }).catch(function(e) {
                console.log('Error in DependencyWorkers\' worker: ' + e);
            }).then(function() {
                that._workerPool.push(worker);
                if (uniqueHandle.isPendingDataForWorker) {
                    var dataToProcess = uniqueHandle.pendingDataForWorker;
                    uniqueHandle.isPendingDataForWorker = false;
                    uniqueHandle.pendingDataForWorker = null;
                    
                    that._startWorker(uniqueHandle, dataToProcess);
                }
            });
    };
    
    asyncProxyScriptBlob.addMember(DependencyWorkersClosure, 'DependencyWorkers');
    
    return DependencyWorkers;
}

var DependencyWorkers = DependencyWorkersClosure();