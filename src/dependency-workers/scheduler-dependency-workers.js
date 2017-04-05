'use strict';

function SchedulerDependencyWorkersClosure(DependencyWorkers) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerDependencyWorkers(scheduler, inputRetreiver) {
        var wrapperInputRetreiver = new SchedulerWrapperInputRetreiver(scheduler, inputRetreiver);
        DependencyWorkers.call(this, wrapperInputRetreiver);
    }
    
    SchedulerDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    asyncProxyScriptBlob.addMember(SchedulerDependencyWorkersClosure, 'SchedulerDependencyWorkers', null, 'DependencyWorkers');
    
    return SchedulerDependencyWorkers;
}

var SchedulerDependencyWorkers = SchedulerDependencyWorkersClosure(DependencyWorkers);