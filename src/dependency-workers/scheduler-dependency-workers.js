'use strict';

function SchedulerDependencyWorkersClosure(DependencyWorkers) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerDependencyWorkers(scheduler, inputRetreiver) {
        var wrapperInputRetreiver = new SchedulerWrapperInputRetreiver(scheduler, inputRetreiver);
        DependencyWorkers.call(this, wrapperInputRetreiver);
        
        if (!inputRetreiver['createTaskContext']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.createTaskContext() method';
        }
    }
    
    SchedulerDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    SchedulerDependencyWorkers.prototype.getTaskContext = function getTaskContext(taskKey) {
        var schedulerTaskContext =
            DependencyWorkers.prototype.getTaskContext.call(this, taskKey);
        
        var taskContext = schedulerTaskContext.getWrappedContext();
        return taskContext;
    };
    
    asyncProxyScriptBlob.addMember(SchedulerDependencyWorkersClosure, 'SchedulerDependencyWorkers', null, 'DependencyWorkers');
    
    return SchedulerDependencyWorkers;
}

var SchedulerDependencyWorkers = SchedulerDependencyWorkersClosure(DependencyWorkers);