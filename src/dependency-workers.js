'use strict';

function DependencyWorkersClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function DependencyWorkers(scriptsToImport, ctorName, ctorArgs, workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._ctorName = ctorName;
        that._ctorArgs = ctorArgs;
        that._scriptsToImport = scriptsToImport;
        that._taskPromises = new HashMap(/*hasher=*/workerInputRetreiver);
        that._workerPool = [];
    }
    
    DependencyWorkers.prototype.startTask = function startTask(taskKey) {
        var that = this;
        var addRes = that._taskPromises.tryAdd(taskKey, function() {
            return new Promise(function(resolve, reject) {
                var promise = that._waitForResult(taskKey, addRes.iterator);
                promise.then(function(result) {
                    that._taskPromises.remove(addRes.iterator);
                    resolve(result);
                }).catch(reject);
            });
        });
        
        var promise = addRes.value;
        return promise;
    };
    
    DependencyWorkers.prototype._waitForResult = function waitForResult(taskKey) {
        var workerInput = this._workerInputRetreiver['getWorkerInput'](taskKey);
        var resultPromise = workerInput['resultPromise'];
        var dependantTasks = workerInput['dependantTasks'];
        
        if (resultPromise) {
            if (dependantTasks && dependantTasks.length > 0) {
                throw 'AsyncProxy.DependencyWorkers: Cannot accept both resultPromise and dependantTasks';
            }
            return resultPromise;
        }
        
        var dependantPromises = [];
        for (var i = 0; i < dependantTasks.length; ++i) {
            dependantPromises.push(this.startTask(dependantTasks[i]));
        }
        
        var that = this;
        return new Promise(function(resolve, reject) {
            Promise.all(dependantPromises).then(function (dependantResults) {
                var worker;
                if (that._workerPool.length > 0) {
                    worker = that._workerPool.pop();
                } else {
                    worker = new AsyncProxyMaster(
                        that._scriptsToImport,
                        that._ctorName,
                        that._ctorArgs);
                }
                
                worker.callFunction(
                        'start',
                        [dependantResults, dependantTasks, taskKey],
                        {'isReturnPromise': true})
                    .then(resolve)
                    .catch(reject)
                    .then(function() {
                        that._workerPool.push(worker);
                    });
            });
        });
    };
    
    asyncProxyScriptBlob.addMember(DependencyWorkersClosure, 'DependencyWorkers');
    
    return DependencyWorkers;
}

var DependencyWorkers = DependencyWorkersClosure();