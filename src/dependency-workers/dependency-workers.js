'use strict';

/* global console: false */
/* global Promise: false */

var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTaskInternals = require('dependency-workers-task-internals');
var DependencyWorkersTaskContext = require('dependency-workers-task-context');
var AsyncProxyMaster = require('async-proxy-master');

var DependencyWorkers = (function DependencyWorkersClosure() {
    function DependencyWorkers(workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._taskInternalss = new JsBuiltinHashMap();
        that._workerPoolByTaskType = [];
        that._taskOptionsByTaskType = [];
        
        if (!workerInputRetreiver.getWorkerTypeOptions) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getWorkerTypeOptions() method';
        }
        if (!workerInputRetreiver.getKeyAsString) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getKeyAsString() method';
        }
    }
    
    DependencyWorkers.prototype.startTask = function startTask(
        taskKey, callbacks) {
        
        var dependencyWorkers = this;
        
        var strKey = this._workerInputRetreiver.getKeyAsString(taskKey);
        var addResult = this._taskInternalss.tryAdd(strKey, function() {
            return new DependencyWorkersTaskInternals();
        });
        
        var taskInternals = addResult.value;
        var taskContext = new DependencyWorkersTaskContext(
            taskInternals, callbacks);
        
        if (addResult.isNew) {
            taskInternals.initialize(
                taskKey,
                this,
                this._workerInputRetreiver,
                this._taskInternalss,
                addResult.iterator,
                this._workerInputRetreiver);
				
            this._workerInputRetreiver.taskStarted(taskInternals.taskApi);
        }
        

        return taskContext;
    };
    
    DependencyWorkers.prototype.startTaskPromise =
            function startTaskPromise(taskKey) {
        
        var that = this;
        return new Promise(function(resolve, reject) {
            var taskContext = that.startTask(
                taskKey, { 'onData': onData, 'onTerminated': onTerminated });
            
            var hasData = taskContext.hasData();
            var result;
            if (hasData) {
                result = taskContext.getLastData();
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
	
	DependencyWorkers.prototype.terminateInactiveWorkers = function() {
		for (var taskType in this._workerPoolByTaskType) {
			var workerPool = this._workerPoolByTaskType[taskType];
			for (var i = 0; i < workerPool; ++i) {
				workerPool[i].terminate();
				workerPool.length = 0;
			}
		}
	};
    
    DependencyWorkers.prototype._dataReady = function dataReady(
			taskInternals, dataToProcess, workerType) {
        
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
            var workerArgs = that._workerInputRetreiver.getWorkerTypeOptions(
                workerType);

			if (!workerArgs) {
				taskInternals.newData(dataToProcess);
				taskInternals.statusUpdate();
				return;
			}
            
			worker = new AsyncProxyMaster(
                workerArgs.scriptsToImport,
                workerArgs.ctorName,
                workerArgs.ctorArgs);
        }
        
        if (!taskInternals.waitingForWorkerResult) {
            taskInternals.waitingForWorkerResult = true;
            taskInternals.statusUpdate();
        }
        
        worker.callFunction(
                'start',
                [dataToProcess, taskInternals.taskKey],
                {'isReturnPromise': true})
            .then(function(processedData) {
                taskInternals.newData(processedData);
                return processedData;
            }).catch(function(e) {
                console.log('Error in DependencyWorkers\' worker: ' + e);
                return e;
            }).then(function(result) {
                workerPool.push(worker);
                
                if (!that._checkIfPendingData(taskInternals)) {
                    taskInternals.waitingForWorkerResult = false;
                    taskInternals.statusUpdate();
                }
            });
    };
	
	DependencyWorkers.prototype._checkIfPendingData = function checkIfPendingData(taskInternals) {
		if (!taskInternals.isPendingDataForWorker) {
			return false;
		}
		
		var dataToProcess = taskInternals.pendingDataForWorker;
		taskInternals.isPendingDataForWorker = false;
		taskInternals.pendingDataForWorker = null;
		
		this._dataReady(
			taskInternals,
			dataToProcess,
			taskInternals.pendingWorkerType);
		
		return true;
	};
    
    return DependencyWorkers;
})();

module.exports = DependencyWorkers;