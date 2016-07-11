'use strict';

function UniqueWorkersClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function UniqueWorkers(scriptsToImport, ctorName, ctorArgs, workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._ctorName = ctorName;
        that._ctorArgs = ctorArgs;
        that._scriptsToImport = scriptsToImport;
        that._taskPromises = new HashMap(/*hasher=*/workerInputRetreiver);
        that._workerPool = [];
    }
    
    UniqueWorkers.prototype.startTask = function startTask(taskKey) {
        var that = this;
        var addRes = that._taskPromises.tryAdd(taskKey, function() {
            return new Promise(function(resolve, reject) {
                workerInputRetreiver['getWorkerInput'](taskKey)
                    .then(function(workerInput) {
                        that._startWorker(
                            taskKey, addRes.iterator, workerInput, resolve, reject);
                    }).catch(reject);
            });
        });
        
        var promise = addRes.value;
        return promise;
    };
    
    UniqueWorkers.prototype._startWorker = function startWorker(
        taskKey, taskIterator, workerInput, resolve, reject) {
        
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
        
        var promise = worker.callFunction(
            'start',
            [workerInput, taskKey],
            {'isReturnPromise': true});
        
        promise.then(function(result) {
            that._taskPromises.remove(taskIterator);
            that._workerPool.push(worker);
            resolve(result);
        }).catch(reject);
    };
    
    asyncProxyScriptBlob.addMember(UniqueWorkersClosure, 'UniqueWorkers');
    
    return UniqueWorkers;
}

var UniqueWorkers = UniqueWorkersClosure();