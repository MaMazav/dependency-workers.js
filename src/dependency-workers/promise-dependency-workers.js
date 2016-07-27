'use strict';

function PromiseDependencyWorkersClosure(DependencyWorkers) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function PromiseDependencyWorkers(scriptsToImport, ctorName, ctorArgs, promiseInputRetreiver) {
        var inputRetreiver = new PromiseWrapperInputRetreiver(promiseInputRetreiver);
        DependencyWorkers.call(this, scriptsToImport, ctorName, ctorArgs, inputRetreiver);
    }
    
    PromiseDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    PromiseDependencyWorkers.prototype.startTaskPromise =
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
                    reject('AsyncProxy.PromiseDependencyWorkers: Internal ' +
                        'error - task terminated but no data returned');
                }
            }
        });
    };
    
    asyncProxyScriptBlob.addMember(PromiseDependencyWorkersClosure, 'PromiseDependencyWorkers', null, 'DependencyWorkers');
    
    return PromiseDependencyWorkers;
}

var PromiseDependencyWorkers = PromiseDependencyWorkersClosure(DependencyWorkers);