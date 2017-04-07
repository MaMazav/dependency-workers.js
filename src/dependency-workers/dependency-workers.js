'use strict';

function DependencyWorkersClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function DependencyWorkers(workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._internalContexts = new JsBuiltinHashMap();
        that._workerPoolByTaskType = [];
        that._taskOptionsByTaskType = [];
        
        if (!workerInputRetreiver['getWorkerTypeOptions']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getWorkerTypeOptions() method';
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
				
            this._workerInputRetreiver['taskStarted'](internalContext.taskApi);
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
    
    DependencyWorkers.prototype._dataReady = function dataReady(
			internalContext, dataToProcess, workerType) {
        
		var that = this;
        var worker;
        var workerPool = that._workerPoolByTaskType[workerType];
        if (!workerPool) {
            workerPool = [];
            that._workerPoolByTaskType[workerType] = workerPool;
        }
        if (workerPool.length > 0) {
            worker = workerPool.pop();
        } else {
            var workerArgs = that._workerInputRetreiver['getWorkerTypeOptions'](
                workerType);

			if (!workerArgs) {
				internalContext.newData(dataToProcess);
				internalContext.statusUpdate();
				return;
			}
            
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
                
                if (!that._checkIfPendingData(internalContext)) {
                    internalContext.waitingForWorkerResult = false;
                    internalContext.statusUpdate();
                }
            });
    };
	
	DependencyWorkers.prototype._checkIfPendingData = function checkIfPendingData(internalContext) {
		if (!internalContext.isPendingDataForWorker) {
			return false;
		}
		
		var dataToProcess = internalContext.pendingDataForWorker;
		internalContext.isPendingDataForWorker = false;
		internalContext.pendingDataForWorker = null;
		
		this._dataReady(
			internalContext,
			dataToProcess,
			internalContext.pendingWorkerType);
		
		return true;
	};
    
    asyncProxyScriptBlob.addMember(DependencyWorkersClosure, 'DependencyWorkers');
    
    return DependencyWorkers;
}

var DependencyWorkers = DependencyWorkersClosure();