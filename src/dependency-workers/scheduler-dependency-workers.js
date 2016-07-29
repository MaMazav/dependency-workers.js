'use strict';

function SchedulerDependencyWorkersClosure(DependencyWorkers) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerDependencyWorkers(scheduler, scriptsToImport, ctorName, ctorArgs, inputRetreiver) {
        var wrapperInputRetreiver = new SchedulerWrapperInputRetreiver(scheduler, inputRetreiver);
        DependencyWorkers.call(this, scriptsToImport, ctorName, ctorArgs, wrapperInputRetreiver);
    }
    
    SchedulerDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    SchedulerDependencyWorkers.prototype.getTaskContext = function getTaskContext(taskKey) {
        var schedulerTaskContext =
            DependencyWorkers.prototype.getTaskContext.call(this, taskKey);
        
        var taskContext = schedulerTaskContext.getWrappedContext();
        return taskContext;
    };
    
    SchedulerDependencyWorkers.prototype.startTaskPromise =
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
    
    asyncProxyScriptBlob.addMember(SchedulerDependencyWorkersClosure, 'SchedulerDependencyWorkers', null, 'DependencyWorkers');
    
    return SchedulerDependencyWorkers;
}

var SchedulerDependencyWorkers = SchedulerDependencyWorkersClosure(DependencyWorkers);